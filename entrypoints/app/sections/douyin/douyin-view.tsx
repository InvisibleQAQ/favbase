import { formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { CollectionConfigurationNotice } from '../../components/configuration-blocker';
import {
  EmptyLibraryState,
  FacetChips,
  NotLoggedInState,
  type SiteAction,
} from '../../components/collection-states';
import { PipelineProgressStrip, CollectionPageScaffold } from '../../components/collection';
import { AutoTranscribeBar, useAutoTranscribe } from '../../components/auto-transcribe';
import {
  backgroundJobRuntime,
  fetchedCountProgress,
  transcriptionStage,
} from '../../hooks/pipeline-segments';
import { useCollectionPipeline } from '../../hooks/use-collection-pipeline';
import { useCollectionBreadcrumbs } from '../../hooks/use-collection-breadcrumbs';
import { useJob } from '../../hooks/background-jobs-store';
import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import { rateLimitRemainingMs } from '../../hooks/collection-sync-error';
import {
  syncErrorMessage,
  type SyncErrorCopy,
} from '../../hooks/collection-sync-error-message';
import { formatCountdown, useCountdown } from '../../hooks/use-countdown';
import { douyinAutoTranscribePipeline } from './auto-transcribe-runtime';
import { useDouyinFavorites } from './use-douyin-favorites';
import { DouyinCard } from './douyin-card';
import { TaggedDouyinCard } from './tagged-douyin-card';
import { DouyinGridSkeleton } from './douyin-grid-skeleton';

/** Platform key for all tag operations in this (douyin-only) section. */
const PLATFORM = 'douyin';
const JOB_PLATFORM = jobPlatformForCollection(PLATFORM);
// Every request runs in the user's own logged-in www.douyin.com tab (docs/33
// D3), so opening that tab is how the library fills: it leads both the empty
// and the not-logged-in state, and Fetch steps back beside it. favbase never
// opens or touches the tab itself — this is a plain link the user clicks.
const DOUYIN_SITE = {
  href: 'https://www.douyin.com/',
  label: 'douyin.openDouyin',
  icon: 'simple-icons:tiktok',
} as const satisfies SiteAction;

// ---------------------------------------------------------------------------
// i18n seam: the classified sync error → user-facing copy (shared
// `syncErrorMessage`). A DouyinRateLimitError is two different situations,
// told apart by `resetAt` (user decision 2026-10-03: verification and cooldown
// are two things, and `SyncErrorCopy` already picks its copy by whether
// `resetAt` is set): `null` is a verification page the user has to clear in
// the Douyin tab; a reset is favbase's own cooldown after a refusal or a
// withheld page, which also locks the Fetch button below.
// ---------------------------------------------------------------------------

const SYNC_ERROR_COPY: SyncErrorCopy = {
  auth: 'douyin.notLoggedInTitle',
  rateLimited: 'douyin.verificationRequired',
  rateLimitedUntil: 'douyin.rateLimited',
};

// ---------------------------------------------------------------------------
// Main view: scaffold assembly (title bar + sync + search + folder chips +
// favorites grid all owned by CollectionPageScaffold).
// ---------------------------------------------------------------------------

export function DouyinView() {
  const { t } = useTranslation();
  const douyin = useDouyinFavorites();
  const breadcrumbs = useCollectionBreadcrumbs(PLATFORM);
  // Videos are transcribed after the sync (docs/37 Step 3): the automatic
  // session's state drives the bar, the prerequisite banner and the coverage
  // refresh; the shared `transcribe` job is the content stage's runtime.
  const autoTranscribe = useAutoTranscribe(douyinAutoTranscribePipeline);
  const transcribeJob = useJob(JOB_PLATFORM, 'transcribe');
  const { coverage, coverageStatus, segments } = useCollectionPipeline({
    platform: PLATFORM,
    syncing: douyin.syncing,
    fetch: backgroundJobRuntime(douyin.syncJob, fetchedCountProgress),
    content: transcriptionStage(t('pipeline.transcription'), transcribeJob),
    embedJob: douyin.embedJob,
    tagJob: douyin.tagJob,
    extraRefreshKey: `${autoTranscribe.running}:${transcribeJob?.generation ?? 0}`,
  });
  // A cooldown (a rate limit with a reset) locks the Fetch button until then.
  const lockMs = useCountdown((now) => rateLimitRemainingMs(douyin.syncError, now));

  const captionParts: string[] = [];
  if (douyin.libraryCount > 0) {
    captionParts.push(t('douyin.count', { count: douyin.libraryCount }));
    // Douyin reports no favorite time: say what the order is.
    captionParts.push(t('douyin.sortedByPublishTime'));
  }
  if (douyin.lastSyncedAt) {
    captionParts.push(
      t('common.lastSynced', { time: formatDateTime(douyin.lastSyncedAt.getTime()) }),
    );
  }

  const syncErrorText = douyin.syncError
    ? syncErrorMessage(douyin.syncError, SYNC_ERROR_COPY)
    : '';
  const authFailed = douyin.syncError?.kind === 'auth';
  const pipeline = <PipelineProgressStrip segments={segments} />;
  const locked = lockMs > 0;

  return (
    <CollectionPageScaffold
      platform={PLATFORM}
      items={douyin.items}
      getRowKey={(favorite) => favorite.id}
      getTagId={(favorite) => favorite.awemeId}
      libraryCount={douyin.libraryCount}
      loading={douyin.loading}
      metaLoading={douyin.metaLoading}
      syncing={douyin.syncing}
      queryError={douyin.queryError}
      hasSyncError={douyin.syncError != null}
      authFailed={authFailed}
      page={douyin.page}
      totalPages={douyin.totalPages}
      onPageChange={douyin.goToPage}
      onSync={douyin.sync}
      onRetryQuery={douyin.retryQuery}
      syncDisabled={locked}
      syncDisabledLabel={
        locked ? t('pipeline.fetchAvailableIn', { time: formatCountdown(lockMs) }) : undefined
      }
      searchInput={douyin.searchInput}
      onSearchInput={douyin.setSearchInput}
      copy={{
        title: t('douyin.title'),
        breadcrumbs,
        caption: captionParts.length > 0 ? captionParts.join(' · ') : undefined,
        searchPlaceholder: t('douyin.searchPlaceholder'),
        noMatches: t('douyin.noMatches'),
        syncErrorText,
      }}
      renderCard={(favorite, tags, onEditTags) => (
        <DouyinCard favorite={favorite} tags={tags} onEditTags={onEditTags} />
      )}
      renderTaggedCard={(item, openEditor) => (
        <TaggedDouyinCard item={item} onEditTags={openEditor} />
      )}
      skeleton={<DouyinGridSkeleton />}
      // The automatic transcription's progress; idle draws nothing, and the
      // parked-for-a-prerequisite state is the configuration notice's.
      operation={
        <AutoTranscribeBar state={autoTranscribe.state} running={autoTranscribe.running} />
      }
      operationScope="primary-category"
      // Public folders (status === 1) are the only Sources; a favorite outside
      // every public folder shows under "All" only (docs/33 D1 / D-a).
      primaryCategory={douyin.libraryCount > 0 ? (
        <FacetChips
          icon="simple-icons:tiktok"
          title="douyin.foldersTitle"
          facets={douyin.facets}
          getKey={(folder) => folder.folderId}
          getName={(folder) => folder.title}
          totalCount={douyin.libraryCount}
          selected={douyin.filter}
          onSelect={douyin.setFilter}
        />
      ) : null}
      emptyState={
        <EmptyLibraryState
          icon="simple-icons:tiktok"
          title="douyin.emptyTitle"
          description="douyin.emptyDesc"
          site={DOUYIN_SITE}
          syncing={douyin.syncing}
          onSync={douyin.sync}
        />
      }
      // No usable douyin.com tab (thrown before the sync starts) or a tab
      // that is not logged in: open douyin.com, log in, keep it open, retry.
      authFailedState={
        <NotLoggedInState
          icon="simple-icons:tiktok"
          title="douyin.notLoggedInTitle"
          description="douyin.notLoggedInDesc"
          site={DOUYIN_SITE}
          syncing={douyin.syncing}
          onSync={douyin.sync}
        />
      }
      // Both optional slots are passed on purpose: `tsc` would not notice a
      // missing one, and without the notice a Tags backlog has no way back.
      configurationNotice={
        <CollectionConfigurationNotice
          platform={PLATFORM}
          coverage={coverage}
          coverageStatus={coverageStatus}
          prerequisiteBlocked={autoTranscribe.state.prerequisiteBlocked}
        />
      }
      pipeline={authFailed ? undefined : pipeline}
    />
  );
}
