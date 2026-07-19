import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';

import { t, formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import {
  StateBox,
  SyncNowButton,
  SyncProgressBar,
  BackgroundJobsBar,
  CollectionPageScaffold,
} from '../../components/collection';
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
// Main view: scaffold assembly (title bar + sync + search + collection chips +
// favorites grid all owned by CollectionPageScaffold).
// ---------------------------------------------------------------------------

export function ZhihuView() {
  const { t } = useTranslation();
  const zhihu = useZhihuFavorites();

  const captionParts: string[] = [];
  if (zhihu.libraryCount > 0) {
    captionParts.push(t('zhihu.count', { count: zhihu.libraryCount }));
  }
  if (zhihu.lastSyncedAt) {
    captionParts.push(t('zhihu.lastSynced', { time: formatDateTime(zhihu.lastSyncedAt.getTime()) }));
  }

  const syncErrorText = zhihu.syncError ? syncErrorMessage(zhihu.syncError) : '';

  // Post-sync embed / tag progress captions (self-hiding bar under the title).
  const jobCaptions: string[] = [];
  const ep = zhihu.embedJob?.progress as { done: number; total: number } | null | undefined;
  if (zhihu.embedJob?.running && ep && ep.total > 0)
    jobCaptions.push(t('backgroundJobs.embedding', ep));
  const tp = zhihu.tagJob?.progress as { done: number; total: number } | null | undefined;
  if (zhihu.tagJob?.running && tp && tp.total > 0) jobCaptions.push(t('backgroundJobs.tagging', tp));

  return (
    <CollectionPageScaffold
      platform={PLATFORM}
      items={zhihu.favorites}
      getRowKey={(favorite) => favorite.id}
      getTagId={(favorite) => favorite.platformItemId}
      libraryCount={zhihu.libraryCount}
      loading={zhihu.loading}
      metaLoading={zhihu.metaLoading}
      syncing={zhihu.syncing}
      queryError={zhihu.queryError}
      hasSyncError={zhihu.syncError != null}
      authFailed={zhihu.syncError?.kind === 'auth'}
      page={zhihu.page}
      totalPages={zhihu.totalPages}
      onPageChange={zhihu.goToPage}
      onSync={zhihu.sync}
      onRetryQuery={zhihu.retryQuery}
      searchInput={zhihu.searchInput}
      onSearchInput={zhihu.setSearchInput}
      copy={{
        title: t('zhihu.title'),
        caption: captionParts.length > 0 ? captionParts.join(' · ') : undefined,
        searchPlaceholder: t('zhihu.searchPlaceholder'),
        noMatches: t('zhihu.noMatches'),
        syncLabel: t('zhihu.sync'),
        syncingLabel: t('zhihu.syncing'),
        loadFailed: t('common.loadFailed'),
        retry: t('common.retry'),
        syncErrorText,
        syncFailedBanner: t('zhihu.syncFailed', { error: syncErrorText }),
      }}
      renderCard={(favorite, tags, onEditTags) => (
        <ZhihuCard favorite={favorite} tags={tags} onEditTags={onEditTags} />
      )}
      renderTaggedCard={(item, openEditor) => (
        <TaggedZhihuCard item={item} onEditTags={openEditor} />
      )}
      skeleton={<ZhihuGridSkeleton />}
      chips={
        <CollectionChips
          collections={zhihu.collections}
          totalCount={zhihu.libraryCount}
          selected={zhihu.collectionId}
          onSelect={zhihu.setCollectionId}
        />
      }
      emptyState={<EmptyLibraryState syncing={zhihu.syncing} onSync={zhihu.sync} />}
      authFailedState={<NotLoggedInState syncing={zhihu.syncing} onSync={zhihu.sync} />}
      progressBar={
        // Indeterminate (per-collection item totals are lazy), with a running
        // fetched count + collection cursor.
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
      }
      backgroundJobsBar={<BackgroundJobsBar captions={jobCaptions} />}
    />
  );
}
