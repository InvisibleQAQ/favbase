import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';

import { t, formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { CollectionConfigurationNotice } from '../../components/configuration-blocker';
import { DashboardContent } from '../../layouts/dashboard';
import {
  StateBox,
  SyncNowButton,
  PipelineProgressStrip,
  CollectionPageScaffold,
} from '../../components/collection';
import {
  backgroundJobRuntime,
  buildPipelineSegments,
} from '../../hooks/pipeline-segments';
import { useProcessingCoverage } from '../../hooks/use-processing-coverage';
import { useYoutubePlaylists, type YoutubeSyncError } from './use-youtube-playlists';
import { PlaylistChips } from './playlist-chips';
import { YoutubeCard } from './youtube-card';
import { TaggedYoutubeCard } from './tagged-youtube-card';
import { YoutubeGridSkeleton } from './youtube-grid-skeleton';

/** Platform key for all tag operations in this (youtube-only) section. */
const PLATFORM = 'youtube';

// ---------------------------------------------------------------------------
// i18n seam: structured sync errors from the hook → user-facing copy here.
// Rate-limit reuses the settings.youtube key (same semantics as the card).
// ---------------------------------------------------------------------------

function syncErrorMessage(error: YoutubeSyncError): string {
  switch (error.kind) {
    case 'auth':
      return t('youtube.authFailedTitle');
    case 'rate-limit':
      return t('settings.youtube.rateLimited');
    case 'unknown':
      return error.message;
  }
}

// ---------------------------------------------------------------------------
// Platform-specific dashed-box states (shared StateBox shell, youtube copy).
// ---------------------------------------------------------------------------

/** API key / channel not configured — guide the user to Settings → Connections. */
function NotConnectedState({ onGoToSettings }: { onGoToSettings: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBox
      icon={<Iconify icon="mdi:youtube" width={64} sx={{ color: 'text.secondary', mb: 1 }} />}
      title={t('youtube.notConnectedTitle')}
      description={t('youtube.notConnectedDesc')}
      action={
        <Button variant="contained" onClick={onGoToSettings} sx={{ mt: 1 }}>
          {t('youtube.goToSettings')}
        </Button>
      }
    />
  );
}

/** API key rejected mid-sync (YoutubeAuthError) — fix it in settings, then retry. */
function AuthFailedState({
  syncing,
  onSync,
  onGoToSettings,
}: {
  syncing: boolean;
  onSync: () => void;
  onGoToSettings: () => void;
}) {
  const { t } = useTranslation();
  return (
    <StateBox
      icon={<Iconify icon="mdi:youtube" width={64} sx={{ color: 'text.secondary', mb: 1 }} />}
      title={t('youtube.authFailedTitle')}
      description={t('youtube.authFailedDesc')}
      action={
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <Button variant="contained" onClick={onGoToSettings}>
            {t('youtube.goToSettings')}
          </Button>
          <SyncNowButton syncing={syncing} onSync={onSync} label={t('pipeline.fetchNow')} />
        </Box>
      }
    />
  );
}

/** Connected but nothing collected yet — the in-app sync IS the primary path. */
function EmptyLibraryState({ syncing, onSync }: { syncing: boolean; onSync: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBox
      icon={<Iconify icon="mdi:youtube" width={64} sx={{ color: 'error.main', mb: 1 }} />}
      title={t('youtube.emptyTitle')}
      description={t('youtube.emptyDesc')}
      action={
        <Box sx={{ mt: 1 }}>
          <SyncNowButton
            syncing={syncing}
            onSync={onSync}
            label={t('pipeline.fetchNow')}
            variant="contained"
          />
        </Box>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Main view: config gate + scaffold assembly (title bar + sync + search +
// channel chips + video grid all owned by CollectionPageScaffold).
// ---------------------------------------------------------------------------

export function YoutubeView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const yt = useYoutubePlaylists();
  const { coverage, status: coverageStatus } = useProcessingCoverage(
    PLATFORM,
    `${yt.syncing}:${yt.embedJob?.generation ?? 0}:${yt.tagJob?.generation ?? 0}`,
  );

  // Not configured (API key / channel missing from settings): the whole page
  // short-circuits into the connect guide. A single synchronous gate — the
  // old async authorization probe died with OAuth.
  if (!yt.settingsLoading && !yt.hasConfig) {
    return (
      <DashboardContent maxWidth="xl">
        <NotConnectedState onGoToSettings={() => navigate('/settings')} />
      </DashboardContent>
    );
  }

  const captionParts: string[] = [];
  if (yt.libraryCount > 0) {
    captionParts.push(t('youtube.count', { count: yt.libraryCount }));
  }
  if (yt.lastSyncedAt) {
    captionParts.push(t('youtube.lastSynced', { time: formatDateTime(yt.lastSyncedAt.getTime()) }));
  }

  const syncErrorText = yt.syncError ? syncErrorMessage(yt.syncError) : '';
  const fetchLabel = t('pipeline.fetch');
  const embeddingLabel = t('pipeline.embedding');
  const taggingLabel = t('pipeline.tagging');

  const pipeline = (
    <PipelineProgressStrip
      segments={buildPipelineSegments({
        coverage,
        coverageStatus,
        stages: [
          {
            id: 'fetch',
            label: fetchLabel,
            coverage: 'acquisition',
            completedProgress: 'last-run',
            runtime: backgroundJobRuntime(
              yt.syncJob,
              (progress) => progress
                ? { done: progress.fetchedCount, total: null }
                : null,
            ),
          },
          {
            id: 'embedding',
            label: embeddingLabel,
            coverage: 'embedding',
            runtime: backgroundJobRuntime(yt.embedJob),
          },
          {
            id: 'tagging',
            label: taggingLabel,
            coverage: 'tagging',
            runtime: backgroundJobRuntime(yt.tagJob),
          },
        ],
      })}
    />
  );

  return (
    <CollectionPageScaffold
      platform={PLATFORM}
      items={yt.videos}
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
        caption: captionParts.length > 0 ? captionParts.join(' · ') : undefined,
        searchPlaceholder: t('youtube.searchPlaceholder'),
        noMatches: t('youtube.noMatches'),
        syncLabel: t('pipeline.fetchNow'),
        syncingLabel: t('pipeline.fetching'),
        loadFailed: t('common.loadFailed'),
        retry: t('common.retry'),
        syncErrorText,
        syncFailedBanner: t('youtube.syncFailed', { error: syncErrorText }),
      }}
      renderCard={(video, tags, onEditTags) => (
        <YoutubeCard video={video} tags={tags} onEditTags={onEditTags} />
      )}
      renderTaggedCard={(item, openEditor) => (
        <TaggedYoutubeCard item={item} onEditTags={openEditor} />
      )}
      skeleton={<YoutubeGridSkeleton />}
      primaryCategory={yt.libraryCount > 0 ? (
        <PlaylistChips
          playlists={yt.playlists}
          totalCount={yt.libraryCount}
          selected={yt.playlistId}
          onSelect={yt.setPlaylistId}
        />
      ) : null}
      emptyState={<EmptyLibraryState syncing={yt.syncing} onSync={yt.sync} />}
      authFailedState={
        <AuthFailedState
          syncing={yt.syncing}
          onSync={yt.sync}
          onGoToSettings={() => navigate('/settings')}
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
        !yt.settingsLoading && yt.hasConfig && yt.syncError?.kind !== 'auth'
          ? pipeline
          : undefined
      }
    />
  );
}
