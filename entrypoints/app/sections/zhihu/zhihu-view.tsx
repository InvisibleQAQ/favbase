import { formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { CollectionConfigurationNotice } from '../../components/configuration-blocker';
import {
  EmptyLibraryState,
  NotLoggedInState,
  type SiteAction,
} from '../../components/collection-states';
import { PipelineProgressStrip, CollectionPageScaffold } from '../../components/collection';
import { backgroundJobRuntime, fetchedCountProgress } from '../../hooks/pipeline-segments';
import { useCollectionPipeline } from '../../hooks/use-collection-pipeline';
import { useCollectionBreadcrumbs } from '../../hooks/use-collection-breadcrumbs';
import {
  syncErrorMessage,
  type SyncErrorCopy,
} from '../../hooks/collection-sync-error-message';
import { useZhihuFavorites } from './use-zhihu-favorites';
import { CollectionChips } from './collection-chips';
import { ZhihuCard } from './zhihu-card';
import { TaggedZhihuCard } from './tagged-zhihu-card';
import { ZhihuGridSkeleton } from './zhihu-grid-skeleton';

/** Platform key for all tag operations in this (zhihu-only) section. */
const PLATFORM = 'zhihu';
// Deep-link for the not-logged-in state: zhihu's own login flow, after which
// the extension fetch rides the fresh session cookies. Only that state leads
// with it — in the empty state the in-app Fetch IS the primary path.
const ZHIHU_SITE = {
  href: 'https://www.zhihu.com',
  label: 'zhihu.openZhihu',
  icon: 'simple-icons:zhihu',
} as const satisfies SiteAction;

// ---------------------------------------------------------------------------
// i18n seam: the classified sync error → user-facing copy (shared
// `syncErrorMessage`). Zhihu reports no rate-limit reset, so there is no
// `rateLimitedUntil` form and no Fetch-button lock.
// ---------------------------------------------------------------------------

const SYNC_ERROR_COPY: SyncErrorCopy = {
  auth: 'zhihu.notLoggedInTitle',
  rateLimited: 'zhihu.rateLimited',
};

// ---------------------------------------------------------------------------
// Main view: scaffold assembly (title bar + sync + search + collection chips +
// favorites grid all owned by CollectionPageScaffold).
// ---------------------------------------------------------------------------

export function ZhihuView() {
  const { t } = useTranslation();
  const zhihu = useZhihuFavorites();
  const breadcrumbs = useCollectionBreadcrumbs(PLATFORM);
  const { coverage, coverageStatus, segments } = useCollectionPipeline({
    platform: PLATFORM,
    syncing: zhihu.syncing,
    fetch: backgroundJobRuntime(zhihu.syncJob, fetchedCountProgress),
    embedJob: zhihu.embedJob,
    tagJob: zhihu.tagJob,
  });

  const captionParts: string[] = [];
  if (zhihu.libraryCount > 0) {
    captionParts.push(t('zhihu.count', { count: zhihu.libraryCount }));
  }
  if (zhihu.lastSyncedAt) {
    captionParts.push(t('common.lastSynced', { time: formatDateTime(zhihu.lastSyncedAt.getTime()) }));
  }

  const syncErrorText = zhihu.syncError
    ? syncErrorMessage(zhihu.syncError, SYNC_ERROR_COPY)
    : '';
  const pipeline = <PipelineProgressStrip segments={segments} />;

  return (
    <CollectionPageScaffold
      platform={PLATFORM}
      items={zhihu.items}
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
        breadcrumbs,
        caption: captionParts.length > 0 ? captionParts.join(' · ') : undefined,
        searchPlaceholder: t('zhihu.searchPlaceholder'),
        noMatches: t('zhihu.noMatches'),
        syncErrorText,
      }}
      renderCard={(favorite, tags, onEditTags) => (
        <ZhihuCard favorite={favorite} tags={tags} onEditTags={onEditTags} />
      )}
      renderTaggedCard={(item, openEditor) => (
        <TaggedZhihuCard item={item} onEditTags={openEditor} />
      )}
      skeleton={<ZhihuGridSkeleton />}
      primaryCategory={zhihu.libraryCount > 0 ? (
        <CollectionChips
          collections={zhihu.facets}
          totalCount={zhihu.libraryCount}
          selected={zhihu.filter}
          onSelect={zhihu.setFilter}
        />
      ) : null}
      emptyState={
        <EmptyLibraryState
          icon="simple-icons:zhihu"
          title="zhihu.emptyTitle"
          description="zhihu.emptyDesc"
          syncing={zhihu.syncing}
          onSync={zhihu.sync}
        />
      }
      // No valid zhihu session (a sync threw ZhihuAuthError): log in on
      // zhihu.com, then retry — cookies ride the extension fetch automatically.
      authFailedState={
        <NotLoggedInState
          icon="simple-icons:zhihu"
          title="zhihu.notLoggedInTitle"
          description="zhihu.notLoggedInDesc"
          site={ZHIHU_SITE}
          syncing={zhihu.syncing}
          onSync={zhihu.sync}
        />
      }
      configurationNotice={
        <CollectionConfigurationNotice
          platform={PLATFORM}
          coverage={coverage}
          coverageStatus={coverageStatus}
        />
      }
      pipeline={zhihu.syncError?.kind === 'auth' ? undefined : pipeline}
    />
  );
}
