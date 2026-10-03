import { formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { CollectionConfigurationNotice } from '../../components/configuration-blocker';
import {
  EmptyLibraryState,
  FacetChips,
  NeedsConfigState,
} from '../../components/collection-states';
import { DashboardContent } from '../../layouts/dashboard';
import {
  PipelineProgressStrip,
  CollectionPageScaffold,
  SectionTitleBar,
} from '../../components/collection';
import { backgroundJobRuntime, fetchedCountProgress } from '../../hooks/pipeline-segments';
import { useCollectionPipeline } from '../../hooks/use-collection-pipeline';
import { useCollectionBreadcrumbs } from '../../hooks/use-collection-breadcrumbs';
import {
  syncErrorMessage,
  type SyncErrorCopy,
} from '../../hooks/collection-sync-error-message';
import { useYoutubePlaylists } from './use-youtube-playlists';
import { YoutubeCard } from './youtube-card';
import { TaggedYoutubeCard } from './tagged-youtube-card';
import { YoutubeGridSkeleton } from './youtube-grid-skeleton';

/** Platform key for all tag operations in this (youtube-only) section. */
const PLATFORM = 'youtube';

// ---------------------------------------------------------------------------
// i18n seam: the classified sync error → user-facing copy (shared
// `syncErrorMessage`). Rate-limit reuses the settings.youtube key (same
// semantics as the card). Google sends no quota reset, so there is no
// `rateLimitedUntil` form and no Fetch-button lock.
// ---------------------------------------------------------------------------

const SYNC_ERROR_COPY: SyncErrorCopy = {
  auth: 'youtube.authFailedTitle',
  rateLimited: 'settings.youtube.rateLimited',
};

// ---------------------------------------------------------------------------
// Main view: config gate + scaffold assembly (title bar + sync + search +
// channel chips + video grid all owned by CollectionPageScaffold).
// ---------------------------------------------------------------------------

export function YoutubeView() {
  const { t } = useTranslation();
  const yt = useYoutubePlaylists();
  const breadcrumbs = useCollectionBreadcrumbs(PLATFORM);
  const { coverage, coverageStatus, segments } = useCollectionPipeline({
    platform: PLATFORM,
    syncing: yt.syncing,
    fetch: backgroundJobRuntime(yt.syncJob, fetchedCountProgress),
    embedJob: yt.embedJob,
    tagJob: yt.tagJob,
  });

  // Not configured (API key / channel missing from settings): the whole page
  // short-circuits into the connect guide. A single synchronous gate — the
  // old async authorization probe died with OAuth.
  if (!yt.settingsLoading && !yt.configured) {
    return (
      <DashboardContent maxWidth="xl">
        <SectionTitleBar title={t('youtube.title')} links={breadcrumbs} />
        <NeedsConfigState
          icon="mdi:youtube"
          title="youtube.notConnectedTitle"
          description="youtube.notConnectedDesc"
          settings="connections/youtube"
        />
      </DashboardContent>
    );
  }

  const captionParts: string[] = [];
  if (yt.libraryCount > 0) {
    captionParts.push(t('youtube.count', { count: yt.libraryCount }));
  }
  if (yt.lastSyncedAt) {
    captionParts.push(t('common.lastSynced', { time: formatDateTime(yt.lastSyncedAt.getTime()) }));
  }

  const syncErrorText = yt.syncError ? syncErrorMessage(yt.syncError, SYNC_ERROR_COPY) : '';
  const pipeline = <PipelineProgressStrip segments={segments} />;

  return (
    <CollectionPageScaffold
      platform={PLATFORM}
      items={yt.items}
      getRowKey={(video) => video.id}
      getTagId={(video) => video.videoId}
      libraryCount={yt.libraryCount}
      loading={yt.loading}
      metaLoading={yt.metaLoading}
      syncing={yt.syncing}
      queryError={yt.queryError}
      hasSyncError={yt.syncError != null}
      authFailed={yt.syncError?.kind === 'auth'}
      page={yt.page}
      totalPages={yt.totalPages}
      onPageChange={yt.goToPage}
      onSync={yt.sync}
      onRetryQuery={yt.retryQuery}
      searchInput={yt.searchInput}
      onSearchInput={yt.setSearchInput}
      copy={{
        title: t('youtube.title'),
        breadcrumbs,
        caption: captionParts.length > 0 ? captionParts.join(' · ') : undefined,
        searchPlaceholder: t('youtube.searchPlaceholder'),
        noMatches: t('youtube.noMatches'),
        syncErrorText,
      }}
      renderCard={(video, tags, onEditTags) => (
        <YoutubeCard video={video} tags={tags} onEditTags={onEditTags} />
      )}
      renderTaggedCard={(item, openEditor) => (
        <TaggedYoutubeCard item={item} onEditTags={openEditor} />
      )}
      skeleton={<YoutubeGridSkeleton />}
      primaryCategory={yt.libraryCount > 0 ? (
        <FacetChips
          icon="mdi:youtube"
          title="youtube.playlistsTitle"
          facets={yt.facets}
          getKey={(p) => p.playlistId}
          getName={(p) => p.title}
          totalCount={yt.libraryCount}
          selected={yt.filter}
          onSelect={yt.setFilter}
        />
      ) : null}
      emptyState={
        <EmptyLibraryState
          icon="mdi:youtube"
          title="youtube.emptyTitle"
          description="youtube.emptyDesc"
          syncing={yt.syncing}
          onSync={yt.sync}
        />
      }
      // API key rejected mid-sync (YoutubeAuthError): fix it in Settings, then retry.
      authFailedState={
        <NeedsConfigState
          icon="mdi:youtube"
          title="youtube.authFailedTitle"
          description="youtube.authFailedDesc"
          settings="connections/youtube"
          sync={{ syncing: yt.syncing, onSync: yt.sync }}
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
        !yt.settingsLoading && yt.configured && yt.syncError?.kind !== 'auth'
          ? pipeline
          : undefined
      }
    />
  );
}
