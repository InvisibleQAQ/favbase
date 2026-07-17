import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';

import { t, formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import {
  useCollectionTags,
  TagFilterChips,
  TaggedItemGrid,
  TagEditPopover,
} from '../../components/tags';
import { DashboardContent } from '../../layouts/dashboard';
import {
  StateBox,
  SectionTitleBar,
  SearchField,
  CardGrid,
  CardGridItem,
  CardGridPagination,
  ErrorState,
  NoMatchesState,
  SyncNowButton,
  SyncProgressBar,
} from '../../components/collection';
import { resolveCollectionPhase } from '../../hooks/collection-phase';
import { useXBookmarks, type XSyncError } from './use-x-bookmarks';
import { AuthorChips } from './author-chips';
import { XCard } from './x-card';
import { TaggedTweetCard } from './tagged-tweet-card';
import { TweetGridSkeleton } from './tweet-grid-skeleton';

/** Platform key for all tag operations in this (x-only) section. */
const PLATFORM = 'x';
// Deep-link to the bookmarks page: logged-out users get X's own login flow
// first, logged-in users land right where the floating fetch button lives.
const X_BOOKMARKS_URL = 'https://x.com/i/bookmarks';

// ---------------------------------------------------------------------------
// i18n seam: structured sync errors from the hook → user-facing copy here.
// ---------------------------------------------------------------------------

function syncErrorMessage(error: XSyncError): string {
  switch (error.kind) {
    case 'auth':
      return t('x.notLoggedInTitle');
    case 'rate-limit':
      return error.resetAt
        ? t('x.rateLimited', { reset: formatDateTime(error.resetAt.getTime()) })
        : t('x.rateLimitedNoReset');
    case 'unknown':
      return error.message;
  }
}

// ---------------------------------------------------------------------------
// Platform-specific dashed-box states (shared StateBox shell, x copy).
// ---------------------------------------------------------------------------

/** Primary action of both empty states: open x.com/i/bookmarks (login-gated by
 *  X itself), where the floating fetch button does the import in place. */
function OpenBookmarksButton() {
  const { t } = useTranslation();
  return (
    <Button
      component={Link}
      href={X_BOOKMARKS_URL}
      target="_blank"
      rel="noopener"
      variant="contained"
      startIcon={<Iconify icon="mdi:twitter" width={18} />}
    >
      {t('x.openBookmarksPage')}
    </Button>
  );
}

/** No valid x.com session (surfaced when a sync throws XAuthError) — guide the
 *  user to log in on X and use the on-page fetch button. */
function NotLoggedInState({ syncing, onSync }: { syncing: boolean; onSync: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBox
      icon={<Iconify icon="mdi:twitter" width={64} sx={{ color: 'text.secondary', mb: 1 }} />}
      title={t('x.notLoggedInTitle')}
      description={t('x.notLoggedInDesc')}
      action={
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <OpenBookmarksButton />
          <SyncNowButton syncing={syncing} onSync={onSync} label={t('common.syncNow')} />
        </Box>
      }
    />
  );
}

/** Never synced (or synced empty) — guide the user to the X bookmarks page
 *  (floating fetch button), with in-app sync as the secondary path. */
function EmptyLibraryState({ syncing, onSync }: { syncing: boolean; onSync: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBox
      icon={<Iconify icon="mdi:twitter" width={64} sx={{ color: 'primary.main', mb: 1 }} />}
      title={t('x.emptyTitle')}
      description={t('x.emptyDesc')}
      action={
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <OpenBookmarksButton />
          <SyncNowButton syncing={syncing} onSync={onSync} label={t('common.syncNow')} />
        </Box>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Main view: title bar + sync + search + author chips + tweet grid
// ---------------------------------------------------------------------------

export function XView() {
  const { t } = useTranslation();
  const x = useXBookmarks();

  // Manual tagging — batch page tags + single popover + platform-scoped filter
  // chips, with the refresh invariant sealed inside the hook.
  const {
    tagsById,
    editing,
    openTagEditor,
    closeTagEditor,
    usedTags,
    selectedTagIds,
    toggleTag,
    clearTags,
    handleTagsChanged,
  } = useCollectionTags(
    PLATFORM,
    x.bookmarks.map((b) => b.tweetId),
  );

  const captionParts: string[] = [];
  if (x.libraryCount > 0) {
    captionParts.push(t('x.count', { count: x.libraryCount }));
  }
  if (x.lastSyncedAt) {
    captionParts.push(t('x.lastSynced', { time: formatDateTime(x.lastSyncedAt.getTime()) }));
  }

  const syncErrorText = x.syncError ? syncErrorMessage(x.syncError) : '';

  const phase = resolveCollectionPhase({
    tagFiltered: selectedTagIds.length > 0,
    queryError: x.queryError != null,
    authFailed: x.syncError?.kind === 'auth',
    syncErrorEmpty: x.syncError != null && x.libraryCount === 0,
    metaLoading: x.metaLoading,
    syncingEmpty: x.syncing && x.libraryCount === 0,
    libraryEmpty: x.libraryCount === 0,
    loading: x.loading,
    noMatches: x.bookmarks.length === 0,
  });

  let content: ReactNode;
  switch (phase) {
    case 'tag-filtered':
      content = (
        <TaggedItemGrid
          platform={PLATFORM}
          tagIds={selectedTagIds}
          renderCard={(item, openEditor) => <TaggedTweetCard item={item} onEditTags={openEditor} />}
          skeleton={<TweetGridSkeleton />}
          onTagsChanged={handleTagsChanged}
        />
      );
      break;
    case 'query-error':
      content = (
        <ErrorState
          title={t('common.loadFailed')}
          message={x.queryError ?? ''}
          retryLabel={t('common.retry')}
          onRetry={x.retryQuery}
        />
      );
      break;
    case 'auth-failed':
      content = <NotLoggedInState syncing={x.syncing} onSync={x.sync} />;
      break;
    case 'sync-error':
      content = (
        <ErrorState
          title={t('common.loadFailed')}
          message={syncErrorText}
          retryLabel={t('common.retry')}
          onRetry={x.sync}
        />
      );
      break;
    case 'skeleton':
      content = <TweetGridSkeleton />;
      break;
    case 'empty-library':
      content = <EmptyLibraryState syncing={x.syncing} onSync={x.sync} />;
      break;
    case 'no-matches':
      content = <NoMatchesState message={t('x.noMatches')} />;
      break;
    case 'grid':
      content = (
        <>
          <CardGrid>
            {x.bookmarks.map((bookmark) => (
              <CardGridItem key={bookmark.id}>
                <XCard
                  bookmark={bookmark}
                  tags={tagsById[bookmark.tweetId] ?? []}
                  onEditTags={(anchor) => openTagEditor(bookmark.tweetId, anchor)}
                />
              </CardGridItem>
            ))}
          </CardGrid>

          <TagEditPopover
            platform={PLATFORM}
            anchorEl={editing?.anchorEl ?? null}
            platformItemId={editing?.platformItemId ?? null}
            tags={editing ? (tagsById[editing.platformItemId] ?? []) : []}
            onClose={closeTagEditor}
            onChanged={handleTagsChanged}
          />

          <CardGridPagination page={x.page} totalPages={x.totalPages} onChange={x.goToPage} />
        </>
      );
      break;
  }

  return (
    <DashboardContent maxWidth="xl">
      <SectionTitleBar
        title={t('x.title')}
        caption={captionParts.length > 0 ? captionParts.join(' · ') : undefined}
        syncing={x.syncing}
        onSync={x.sync}
        syncLabel={t('x.sync')}
        syncingLabel={t('x.syncing')}
      />

      {/* Sync progress — always indeterminate (cursor pagination has no total). */}
      {x.syncing && (
        <SyncProgressBar
          caption={
            x.syncProgress
              ? t('x.syncProgress', { fetched: x.syncProgress.fetchedCount, page: x.syncProgress.page })
              : undefined
          }
        />
      )}

      {/* Sync failure banner (library still shows its persisted data) */}
      {x.syncError && x.libraryCount > 0 && (
        <Typography variant="body2" sx={{ color: 'error.main', mb: 2 }}>
          {t('x.syncFailed', { error: syncErrorText })}
        </Typography>
      )}

      {/* Search — debounced ILIKE over tweet text / author name (PGlite) */}
      <SearchField
        value={x.searchInput}
        onChange={x.setSearchInput}
        placeholder={t('x.searchPlaceholder')}
      />

      {/* Author chips — hidden until the library has content */}
      {x.libraryCount > 0 && (
        <AuthorChips
          authors={x.authors}
          totalCount={x.libraryCount}
          selected={x.author}
          onSelect={x.setAuthor}
        />
      )}

      {/* Tag filter chips — x-scoped, multi-select AND; hidden when no used tags */}
      <TagFilterChips
        tags={usedTags}
        selectedIds={selectedTagIds}
        onToggle={toggleTag}
        onClear={clearTags}
      />

      {content}
    </DashboardContent>
  );
}
