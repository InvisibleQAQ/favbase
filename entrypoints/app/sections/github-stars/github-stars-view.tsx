import { formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { CollectionConfigurationNotice } from '../../components/configuration-blocker';
import { EmptyLibraryState, NeedsConfigState } from '../../components/collection-states';
import { DashboardContent } from '../../layouts/dashboard';
import {
  PipelineProgressStrip,
  CardGridSkeleton,
  CollectionCardSkeleton,
  CollectionPageScaffold,
  SectionTitleBar,
} from '../../components/collection';
import {
  backgroundJobRuntime,
  fetchedCountProgress,
  type PipelineRuntimeSnapshot,
} from '../../hooks/pipeline-segments';
import { useCollectionPipeline } from '../../hooks/use-collection-pipeline';
import { useCollectionBreadcrumbs } from '../../hooks/use-collection-breadcrumbs';
import { rateLimitRemainingMs } from '../../hooks/collection-sync-error';
import {
  syncErrorMessage,
  type SyncErrorCopy,
} from '../../hooks/collection-sync-error-message';
import { formatCountdown, useCountdown } from '../../hooks/use-countdown';
import { useGithubStars } from './use-github-stars';
import { LanguageChips } from './language-chips';
import { RepoCard } from './repo-card';
import { TaggedRepoCard } from './tagged-repo-card';

/** Platform key for all tag operations in this (github-only) section. */
const PLATFORM = 'github';

// ---------------------------------------------------------------------------
// i18n seam: the classified sync error → user-facing copy (shared
// `syncErrorMessage`). Reuses the settings.github.* keys (same error semantics
// as the token test). GitHub reports its rate-limit reset, so it has the
// `rateLimitedUntil` form and the Fetch-button lock below.
// ---------------------------------------------------------------------------

const SYNC_ERROR_COPY: SyncErrorCopy = {
  auth: 'settings.github.invalidToken',
  rateLimited: 'settings.github.rateLimitedNoReset',
  rateLimitedUntil: 'settings.github.rateLimited',
};

/** Repo card shape: owner line + name + description. */
function RepoGridSkeleton() {
  return <CardGridSkeleton card={<CollectionCardSkeleton header lines={3} />} />;
}

// ---------------------------------------------------------------------------
// Main view: config gate + scaffold assembly (title bar + sync + search +
// language chips + repo grid all owned by CollectionPageScaffold).
// ---------------------------------------------------------------------------

export function GithubStarsView() {
  const { t } = useTranslation();
  const gh = useGithubStars();
  const breadcrumbs = useCollectionBreadcrumbs(PLATFORM);

  // Two-phase sync: Fetch settles the moment the readme phase starts (the
  // stars pass is done even though the sync job stays running), and the
  // readme stage only shows live progress inside its own phase.
  const syncPhase = gh.syncJob?.progress?.phase ?? gh.syncJob?.lastProgress?.phase;
  const fetchRuntime = backgroundJobRuntime(gh.syncJob, fetchedCountProgress);
  const readmeRuntime = syncPhase === 'stars' && gh.syncJob?.running
    ? null
    : backgroundJobRuntime(
        gh.syncJob,
        (progress) => progress?.phase === 'readme'
          ? { done: progress.done, total: progress.total }
          : null,
      );
  const settledFetchRuntime: PipelineRuntimeSnapshot | null =
    syncPhase === 'readme' && gh.syncJob?.running && fetchRuntime
      ? {
          running: false,
          phase: 'completed',
          lastProgress: fetchRuntime.progress,
        }
      : fetchRuntime;
  const { coverage, coverageStatus, segments } = useCollectionPipeline({
    platform: PLATFORM,
    syncing: gh.syncing,
    fetch: settledFetchRuntime,
    content: { id: 'readme', label: t('pipeline.readme'), runtime: readmeRuntime },
    embedJob: gh.embedJob,
    tagJob: gh.tagJob,
  });
  // A rate limit with a known reset locks the Fetch button until then.
  const lockMs = useCountdown((now) => rateLimitRemainingMs(gh.syncError, now));

  // No token: the whole page short-circuits into the connect guide
  // (Settings -> Connections).
  if (!gh.settingsLoading && !gh.hasToken) {
    return (
      <DashboardContent maxWidth="xl">
        <SectionTitleBar title={t('githubStars.title')} links={breadcrumbs} />
        <NeedsConfigState
          icon="mdi:github"
          title="githubStars.noTokenTitle"
          description="githubStars.noTokenDesc"
          settings="connections/github"
        />
      </DashboardContent>
    );
  }

  const captionParts: string[] = [];
  if (gh.libraryCount > 0) {
    captionParts.push(t('githubStars.repoCount', { count: gh.libraryCount }));
  }
  if (gh.lastSyncedAt) {
    captionParts.push(
      t('common.lastSynced', { time: formatDateTime(gh.lastSyncedAt.getTime()) }),
    );
  }

  const syncErrorText = gh.syncError ? syncErrorMessage(gh.syncError, SYNC_ERROR_COPY) : '';

  const pipeline = <PipelineProgressStrip segments={segments} />;

  return (
    <CollectionPageScaffold
      platform={PLATFORM}
      items={gh.repos}
      getRowKey={(repo) => repo.id}
      getTagId={(repo) => repo.repoId}
      libraryCount={gh.libraryCount}
      loading={gh.loading}
      metaLoading={gh.metaLoading}
      syncing={gh.syncing}
      queryError={gh.queryError}
      hasSyncError={gh.syncError != null}
      // GitHub has no auth-failed content phase — a missing token short-circuits
      // to the configuration gate above, before the scaffold renders.
      authFailed={false}
      page={gh.page}
      totalPages={gh.totalPages}
      onPageChange={gh.goToPage}
      onSync={gh.sync}
      onRetryQuery={gh.retryQuery}
      syncDisabled={lockMs > 0}
      syncDisabledLabel={
        lockMs > 0 ? t('pipeline.fetchAvailableIn', { time: formatCountdown(lockMs) }) : undefined
      }
      searchInput={gh.searchInput}
      onSearchInput={gh.setSearchInput}
      copy={{
        title: t('githubStars.title'),
        breadcrumbs,
        caption: captionParts.length > 0 ? captionParts.join(' · ') : undefined,
        searchPlaceholder: t('githubStars.searchPlaceholder'),
        noMatches: t('githubStars.noMatches'),
        syncErrorText,
      }}
      renderCard={(repo, tags, onEditTags) => (
        <RepoCard repo={repo} tags={tags} onEditTags={onEditTags} />
      )}
      renderTaggedCard={(item, openEditor) => (
        <TaggedRepoCard item={item} onEditTags={openEditor} />
      )}
      skeleton={<RepoGridSkeleton />}
      primaryCategory={gh.libraryCount > 0 ? (
        <LanguageChips
          languages={gh.languages}
          totalCount={gh.libraryCount}
          selected={gh.language}
          onSelect={gh.setLanguage}
        />
      ) : null}
      emptyState={
        <EmptyLibraryState
          icon="mdi:star"
          title="githubStars.emptyTitle"
          description="githubStars.emptyDesc"
          syncing={gh.syncing}
          onSync={gh.sync}
        />
      }
      configurationNotice={
        <CollectionConfigurationNotice
          platform={PLATFORM}
          coverage={coverage}
          coverageStatus={coverageStatus}
        />
      }
      pipeline={
        !gh.settingsLoading && gh.hasToken && gh.syncError?.kind !== 'auth'
          ? pipeline
          : undefined
      }
    />
  );
}
