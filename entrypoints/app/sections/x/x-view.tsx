import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import CircularProgress from '@mui/material/CircularProgress';

import { t, formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import {
  useItemTags,
  useUsedTags,
  useTagFilter,
  TagFilterChips,
  TaggedItemGrid,
  TagEditPopover,
  useTagEditState,
} from '../../components/tags';
import { DashboardContent } from '../../layouts/dashboard';
import {
  StateBox,
  SectionTitleBar,
  SearchField,
  CardGrid,
  CardGridItem,
  CardGridPagination,
} from '../../components/collection';
import { useXBookmarks, type XSyncError, type XSyncProgress } from './use-x-bookmarks';
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
// Dashed-box states — shared StateBox shell, x copy/actions here
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

function SyncNowButton({ syncing, onSync }: { syncing: boolean; onSync: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      variant="outlined"
      onClick={onSync}
      disabled={syncing}
      startIcon={
        syncing ? (
          <CircularProgress size={16} color="inherit" />
        ) : (
          <Iconify icon="solar:restart-bold" width={18} />
        )
      }
    >
      {t('x.syncNow')}
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
          <SyncNowButton syncing={syncing} onSync={onSync} />
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
          <SyncNowButton syncing={syncing} onSync={onSync} />
        </Box>
      }
    />
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBox
      icon={
        <Iconify
          icon="solar:danger-triangle-bold-duotone"
          width={64}
          sx={{ color: 'error.main', mb: 1 }}
        />
      }
      title={t('x.loadFailed')}
      description={message}
      action={
        <Button variant="outlined" onClick={onRetry} sx={{ mt: 1 }}>
          {t('x.retry')}
        </Button>
      }
    />
  );
}

/** Filters (search/author) matched nothing. */
function NoMatchesState() {
  const { t } = useTranslation();
  return (
    <StateBox>
      <Typography variant="body1" sx={{ color: 'text.disabled' }}>
        {t('x.noMatches')}
      </Typography>
    </StateBox>
  );
}

// ---------------------------------------------------------------------------
// Sync progress — always indeterminate (cursor pagination has no total).
// ---------------------------------------------------------------------------

function SyncProgressBar({ progress }: { progress: XSyncProgress | null }) {
  const { t } = useTranslation();
  return (
    <Box sx={{ mb: 2.5 }}>
      <LinearProgress variant="indeterminate" sx={{ mb: 0.5, borderRadius: 1 }} />
      {progress && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t('x.syncProgress', { fetched: progress.fetchedCount, page: progress.page })}
        </Typography>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main view: title bar + sync + search + author chips + tweet grid
// ---------------------------------------------------------------------------

export function XView() {
  const { t } = useTranslation();
  const x = useXBookmarks();

  // Manual tagging — batch-load tags for the current page, single popover
  // instance, platform-scoped filter chips.
  const { tagsById, refresh: refreshItemTags } = useItemTags(
    PLATFORM,
    x.bookmarks.map((b) => b.tweetId),
  );
  const { editing, open: openTagEditor, close: closeTagEditor } = useTagEditState();
  const { usedTags, refresh: refreshUsedTags } = useUsedTags(PLATFORM);
  const { selectedTagIds, toggleTag, clearTags } = useTagFilter(usedTags);

  const handleTagsChanged = () => {
    refreshItemTags();
    refreshUsedTags();
  };

  const captionParts: string[] = [];
  if (x.libraryCount > 0) {
    captionParts.push(t('x.count', { count: x.libraryCount }));
  }
  if (x.lastSyncedAt) {
    captionParts.push(t('x.lastSynced', { time: formatDateTime(x.lastSyncedAt.getTime()) }));
  }

  // Auth failure short-circuits the empty-library state to the login guide.
  const authFailed = x.syncError?.kind === 'auth';

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

      {/* Sync progress — full width below the title bar */}
      {x.syncing && <SyncProgressBar progress={x.syncProgress} />}

      {/* Sync failure banner (library still shows its persisted data) */}
      {x.syncError && x.libraryCount > 0 && (
        <Typography variant="body2" sx={{ color: 'error.main', mb: 2 }}>
          {t('x.syncFailed', { error: syncErrorMessage(x.syncError) })}
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

      {/* Content: tag-filtered grid takes over while filters are active */}
      {selectedTagIds.length > 0 ? (
        <TaggedItemGrid
          platform={PLATFORM}
          tagIds={selectedTagIds}
          renderCard={(item, openEditor) => <TaggedTweetCard item={item} onEditTags={openEditor} />}
          skeleton={<TweetGridSkeleton />}
          // handleTagsChanged (not just refreshUsedTags): useItemTags lives at
          // this view's top level and never unmounts while the filter is active,
          // so edits in the tagged grid must also refresh tagsById.
          onTagsChanged={handleTagsChanged}
        />
      ) : x.queryError ? (
        <ErrorState message={x.queryError} onRetry={x.retryQuery} />
      ) : authFailed ? (
        <NotLoggedInState syncing={x.syncing} onSync={x.sync} />
      ) : x.syncError && x.libraryCount === 0 ? (
        <ErrorState message={syncErrorMessage(x.syncError)} onRetry={x.sync} />
      ) : x.metaLoading || (x.syncing && x.libraryCount === 0) ? (
        <TweetGridSkeleton />
      ) : x.libraryCount === 0 ? (
        <EmptyLibraryState syncing={x.syncing} onSync={x.sync} />
      ) : x.loading ? (
        <TweetGridSkeleton />
      ) : x.bookmarks.length === 0 ? (
        <NoMatchesState />
      ) : (
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
      )}
    </DashboardContent>
  );
}
