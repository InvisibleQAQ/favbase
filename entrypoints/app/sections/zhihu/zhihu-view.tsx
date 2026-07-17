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
import { useZhihuFavorites, type ZhihuSyncError } from './use-zhihu-favorites';
import { CollectionChips } from './collection-chips';
import { ZhihuCard } from './zhihu-card';
import { TaggedZhihuCard } from './tagged-zhihu-card';
import { ZhihuGridSkeleton } from './zhihu-grid-skeleton';

/** Platform key for all tag operations in this (zhihu-only) section. */
const PLATFORM = 'zhihu';
// Deep-link for the not-logged-in state: zhihu's own login flow, after which
// the extension fetch rides the fresh session cookies.
const ZHIHU_URL = 'https://www.zhihu.com';

// ---------------------------------------------------------------------------
// i18n seam: structured sync errors from the hook → user-facing copy here.
// ---------------------------------------------------------------------------

function syncErrorMessage(error: ZhihuSyncError): string {
  switch (error.kind) {
    case 'auth':
      return t('zhihu.notLoggedInTitle');
    case 'rate-limit':
      return t('zhihu.rateLimited');
    case 'unknown':
      return error.message;
  }
}

// ---------------------------------------------------------------------------
// Platform-specific dashed-box states (shared StateBox shell, zhihu copy).
// ---------------------------------------------------------------------------

/** Primary action of the not-logged-in state: open zhihu.com (login there,
 *  then come back and sync — cookies ride the extension fetch automatically). */
function OpenZhihuButton() {
  const { t } = useTranslation();
  return (
    <Button
      component={Link}
      href={ZHIHU_URL}
      target="_blank"
      rel="noopener"
      variant="contained"
      startIcon={<Iconify icon="simple-icons:zhihu" width={18} />}
    >
      {t('zhihu.openZhihu')}
    </Button>
  );
}

/** No valid zhihu session (surfaced when a sync throws ZhihuAuthError) —
 *  guide the user to log in on zhihu.com, then retry the sync. */
function NotLoggedInState({ syncing, onSync }: { syncing: boolean; onSync: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBox
      icon={<Iconify icon="simple-icons:zhihu" width={64} sx={{ color: 'text.secondary', mb: 1 }} />}
      title={t('zhihu.notLoggedInTitle')}
      description={t('zhihu.notLoggedInDesc')}
      action={
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <OpenZhihuButton />
          <SyncNowButton syncing={syncing} onSync={onSync} label={t('common.syncNow')} />
        </Box>
      }
    />
  );
}

/** Never synced (or synced empty) — the in-app sync IS the primary path. */
function EmptyLibraryState({ syncing, onSync }: { syncing: boolean; onSync: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBox
      icon={<Iconify icon="simple-icons:zhihu" width={64} sx={{ color: 'primary.main', mb: 1 }} />}
      title={t('zhihu.emptyTitle')}
      description={t('zhihu.emptyDesc')}
      action={
        <Box sx={{ mt: 1 }}>
          <SyncNowButton
            syncing={syncing}
            onSync={onSync}
            label={t('common.syncNow')}
            variant="contained"
          />
        </Box>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Main view: title bar + sync + search + collection chips + favorites grid
// ---------------------------------------------------------------------------

export function ZhihuView() {
  const { t } = useTranslation();
  const zhihu = useZhihuFavorites();

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
    zhihu.favorites.map((f) => f.platformItemId),
  );

  const captionParts: string[] = [];
  if (zhihu.libraryCount > 0) {
    captionParts.push(t('zhihu.count', { count: zhihu.libraryCount }));
  }
  if (zhihu.lastSyncedAt) {
    captionParts.push(t('zhihu.lastSynced', { time: formatDateTime(zhihu.lastSyncedAt.getTime()) }));
  }

  const syncErrorText = zhihu.syncError ? syncErrorMessage(zhihu.syncError) : '';

  const phase = resolveCollectionPhase({
    tagFiltered: selectedTagIds.length > 0,
    queryError: zhihu.queryError != null,
    authFailed: zhihu.syncError?.kind === 'auth',
    syncErrorEmpty: zhihu.syncError != null && zhihu.libraryCount === 0,
    metaLoading: zhihu.metaLoading,
    syncingEmpty: zhihu.syncing && zhihu.libraryCount === 0,
    libraryEmpty: zhihu.libraryCount === 0,
    loading: zhihu.loading,
    noMatches: zhihu.favorites.length === 0,
  });

  let content: ReactNode;
  switch (phase) {
    case 'tag-filtered':
      content = (
        <TaggedItemGrid
          platform={PLATFORM}
          tagIds={selectedTagIds}
          renderCard={(item, openEditor) => <TaggedZhihuCard item={item} onEditTags={openEditor} />}
          skeleton={<ZhihuGridSkeleton />}
          onTagsChanged={handleTagsChanged}
        />
      );
      break;
    case 'query-error':
      content = (
        <ErrorState
          title={t('common.loadFailed')}
          message={zhihu.queryError ?? ''}
          retryLabel={t('common.retry')}
          onRetry={zhihu.retryQuery}
        />
      );
      break;
    case 'auth-failed':
      content = <NotLoggedInState syncing={zhihu.syncing} onSync={zhihu.sync} />;
      break;
    case 'sync-error':
      content = (
        <ErrorState
          title={t('common.loadFailed')}
          message={syncErrorText}
          retryLabel={t('common.retry')}
          onRetry={zhihu.sync}
        />
      );
      break;
    case 'skeleton':
      content = <ZhihuGridSkeleton />;
      break;
    case 'empty-library':
      content = <EmptyLibraryState syncing={zhihu.syncing} onSync={zhihu.sync} />;
      break;
    case 'no-matches':
      content = <NoMatchesState message={t('zhihu.noMatches')} />;
      break;
    case 'grid':
      content = (
        <>
          <CardGrid>
            {zhihu.favorites.map((favorite) => (
              <CardGridItem key={favorite.id}>
                <ZhihuCard
                  favorite={favorite}
                  tags={tagsById[favorite.platformItemId] ?? []}
                  onEditTags={(anchor) => openTagEditor(favorite.platformItemId, anchor)}
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

          <CardGridPagination
            page={zhihu.page}
            totalPages={zhihu.totalPages}
            onChange={zhihu.goToPage}
          />
        </>
      );
      break;
  }

  return (
    <DashboardContent maxWidth="xl">
      <SectionTitleBar
        title={t('zhihu.title')}
        caption={captionParts.length > 0 ? captionParts.join(' · ') : undefined}
        syncing={zhihu.syncing}
        onSync={zhihu.sync}
        syncLabel={t('zhihu.sync')}
        syncingLabel={t('zhihu.syncing')}
      />

      {/* Sync progress — indeterminate (per-collection item totals are lazy),
          with a running fetched count + collection cursor. */}
      {zhihu.syncing && (
        <SyncProgressBar
          caption={
            zhihu.syncProgress
              ? t('zhihu.syncProgress', {
                  fetched: zhihu.syncProgress.fetchedCount,
                  current: zhihu.syncProgress.current,
                  total: zhihu.syncProgress.total,
                })
              : undefined
          }
        />
      )}

      {/* Sync failure banner (library still shows its persisted data) */}
      {zhihu.syncError && zhihu.libraryCount > 0 && (
        <Typography variant="body2" sx={{ color: 'error.main', mb: 2 }}>
          {t('zhihu.syncFailed', { error: syncErrorText })}
        </Typography>
      )}

      {/* Search — debounced ILIKE over title / excerpt / author (PGlite) */}
      <SearchField
        value={zhihu.searchInput}
        onChange={zhihu.setSearchInput}
        placeholder={t('zhihu.searchPlaceholder')}
      />

      {/* Collection chips — hidden until the library has content */}
      {zhihu.libraryCount > 0 && (
        <CollectionChips
          collections={zhihu.collections}
          totalCount={zhihu.libraryCount}
          selected={zhihu.collectionId}
          onSelect={zhihu.setCollectionId}
        />
      )}

      {/* Tag filter chips — zhihu-scoped, multi-select AND; hidden when no used tags */}
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
