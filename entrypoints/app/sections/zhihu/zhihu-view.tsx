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
import { useZhihuFavorites, type ZhihuSyncError, type ZhihuSyncProgress } from './use-zhihu-favorites';
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
// Dashed-box states — shared StateBox shell, zhihu copy/actions here
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

function SyncNowButton({
  syncing,
  onSync,
  variant = 'outlined',
}: {
  syncing: boolean;
  onSync: () => void;
  variant?: 'contained' | 'outlined';
}) {
  const { t } = useTranslation();
  return (
    <Button
      variant={variant}
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
      {t('zhihu.syncNow')}
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
          <SyncNowButton syncing={syncing} onSync={onSync} />
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
          <SyncNowButton syncing={syncing} onSync={onSync} variant="contained" />
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
      title={t('zhihu.loadFailed')}
      description={message}
      action={
        <Button variant="outlined" onClick={onRetry} sx={{ mt: 1 }}>
          {t('zhihu.retry')}
        </Button>
      }
    />
  );
}

/** Filters (search/collection) matched nothing. */
function NoMatchesState() {
  const { t } = useTranslation();
  return (
    <StateBox>
      <Typography variant="body1" sx={{ color: 'text.disabled' }}>
        {t('zhihu.noMatches')}
      </Typography>
    </StateBox>
  );
}

// ---------------------------------------------------------------------------
// Sync progress — indeterminate (per-collection item totals are lazy), with a
// running fetched count + collection cursor.
// ---------------------------------------------------------------------------

function SyncProgressBar({ progress }: { progress: ZhihuSyncProgress | null }) {
  const { t } = useTranslation();
  return (
    <Box sx={{ mb: 2.5 }}>
      <LinearProgress variant="indeterminate" sx={{ mb: 0.5, borderRadius: 1 }} />
      {progress && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t('zhihu.syncProgress', {
            fetched: progress.fetchedCount,
            current: progress.current,
            total: progress.total,
          })}
        </Typography>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main view: title bar + sync + search + collection chips + favorites grid
// ---------------------------------------------------------------------------

export function ZhihuView() {
  const { t } = useTranslation();
  const zhihu = useZhihuFavorites();

  // Manual tagging — batch-load tags for the current page, single popover
  // instance, platform-scoped filter chips.
  const { tagsById, refresh: refreshItemTags } = useItemTags(
    PLATFORM,
    zhihu.favorites.map((f) => f.platformItemId),
  );
  const { editing, open: openTagEditor, close: closeTagEditor } = useTagEditState();
  const { usedTags, refresh: refreshUsedTags } = useUsedTags(PLATFORM);
  const { selectedTagIds, toggleTag, clearTags } = useTagFilter(usedTags);

  const handleTagsChanged = () => {
    refreshItemTags();
    refreshUsedTags();
  };

  const captionParts: string[] = [];
  if (zhihu.libraryCount > 0) {
    captionParts.push(t('zhihu.count', { count: zhihu.libraryCount }));
  }
  if (zhihu.lastSyncedAt) {
    captionParts.push(t('zhihu.lastSynced', { time: formatDateTime(zhihu.lastSyncedAt.getTime()) }));
  }

  // Auth failure short-circuits the empty-library state to the login guide.
  const authFailed = zhihu.syncError?.kind === 'auth';

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

      {/* Sync progress — full width below the title bar */}
      {zhihu.syncing && <SyncProgressBar progress={zhihu.syncProgress} />}

      {/* Sync failure banner (library still shows its persisted data) */}
      {zhihu.syncError && zhihu.libraryCount > 0 && (
        <Typography variant="body2" sx={{ color: 'error.main', mb: 2 }}>
          {t('zhihu.syncFailed', { error: syncErrorMessage(zhihu.syncError) })}
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

      {/* Content: tag-filtered grid takes over while filters are active */}
      {selectedTagIds.length > 0 ? (
        <TaggedItemGrid
          platform={PLATFORM}
          tagIds={selectedTagIds}
          renderCard={(item, openEditor) => <TaggedZhihuCard item={item} onEditTags={openEditor} />}
          skeleton={<ZhihuGridSkeleton />}
          // handleTagsChanged (not just refreshUsedTags): useItemTags lives at
          // this view's top level and never unmounts while the filter is
          // active, so edits in the tagged grid must also refresh tagsById.
          onTagsChanged={handleTagsChanged}
        />
      ) : zhihu.queryError ? (
        <ErrorState message={zhihu.queryError} onRetry={zhihu.retryQuery} />
      ) : authFailed ? (
        <NotLoggedInState syncing={zhihu.syncing} onSync={zhihu.sync} />
      ) : zhihu.syncError && zhihu.libraryCount === 0 ? (
        <ErrorState message={syncErrorMessage(zhihu.syncError)} onRetry={zhihu.sync} />
      ) : zhihu.metaLoading || (zhihu.syncing && zhihu.libraryCount === 0) ? (
        <ZhihuGridSkeleton />
      ) : zhihu.libraryCount === 0 ? (
        <EmptyLibraryState syncing={zhihu.syncing} onSync={zhihu.sync} />
      ) : zhihu.loading ? (
        <ZhihuGridSkeleton />
      ) : zhihu.favorites.length === 0 ? (
        <NoMatchesState />
      ) : (
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
      )}
    </DashboardContent>
  );
}
