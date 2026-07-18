import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
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
          <SyncNowButton syncing={syncing} onSync={onSync} label={t('common.syncNow')} />
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
            label={t('common.syncNow')}
            variant="contained"
          />
        </Box>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Main view: title bar + sync + search + channel chips + video grid
// ---------------------------------------------------------------------------

export function YoutubeView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const yt = useYoutubePlaylists();

  // Manual tagging — batch page tags + single popover + platform-scoped filter
  // chips, with the refresh invariant sealed inside the hook. Hooks stay above
  // the early return.
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
    yt.videos.map((v) => v.videoId),
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

  const phase = resolveCollectionPhase({
    tagFiltered: selectedTagIds.length > 0,
    queryError: yt.queryError != null,
    authFailed: yt.syncError?.kind === 'auth',
    syncErrorEmpty: yt.syncError != null && yt.libraryCount === 0,
    metaLoading: yt.metaLoading,
    syncingEmpty: yt.syncing && yt.libraryCount === 0,
    libraryEmpty: yt.libraryCount === 0,
    loading: yt.loading,
    noMatches: yt.videos.length === 0,
  });

  let content: ReactNode;
  switch (phase) {
    case 'tag-filtered':
      content = (
        <TaggedItemGrid
          platform={PLATFORM}
          tagIds={selectedTagIds}
          renderCard={(item, openEditor) => (
            <TaggedYoutubeCard item={item} onEditTags={openEditor} />
          )}
          skeleton={<YoutubeGridSkeleton />}
          onTagsChanged={handleTagsChanged}
        />
      );
      break;
    case 'query-error':
      content = (
        <ErrorState
          title={t('common.loadFailed')}
          message={yt.queryError ?? ''}
          retryLabel={t('common.retry')}
          onRetry={yt.retryQuery}
        />
      );
      break;
    case 'auth-failed':
      content = (
        <AuthFailedState
          syncing={yt.syncing}
          onSync={yt.sync}
          onGoToSettings={() => navigate('/settings')}
        />
      );
      break;
    case 'sync-error':
      content = (
        <ErrorState
          title={t('common.loadFailed')}
          message={syncErrorText}
          retryLabel={t('common.retry')}
          onRetry={yt.sync}
        />
      );
      break;
    case 'skeleton':
      content = <YoutubeGridSkeleton />;
      break;
    case 'empty-library':
      content = <EmptyLibraryState syncing={yt.syncing} onSync={yt.sync} />;
      break;
    case 'no-matches':
      content = <NoMatchesState message={t('youtube.noMatches')} />;
      break;
    case 'grid':
      content = (
        <>
          <CardGrid>
            {yt.videos.map((video) => (
              <CardGridItem key={video.id}>
                <YoutubeCard
                  video={video}
                  tags={tagsById[video.videoId] ?? []}
                  onEditTags={(anchor) => openTagEditor(video.videoId, anchor)}
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

          <CardGridPagination page={yt.page} totalPages={yt.totalPages} onChange={yt.goToPage} />
        </>
      );
      break;
  }

  return (
    <DashboardContent maxWidth="xl">
      <SectionTitleBar
        title={t('youtube.title')}
        caption={captionParts.length > 0 ? captionParts.join(' · ') : undefined}
        syncing={yt.syncing}
        onSync={yt.sync}
        syncLabel={t('youtube.sync')}
        syncingLabel={t('youtube.syncing')}
      />

      {/* Sync progress — indeterminate bar with a running entry count and a
          playlist cursor (i/total). */}
      {yt.syncing && (
        <SyncProgressBar
          caption={
            yt.syncProgress
              ? t('youtube.syncProgress', {
                  fetched: yt.syncProgress.fetchedCount,
                  current: yt.syncProgress.playlistIndex,
                  total: yt.syncProgress.playlistCount,
                })
              : undefined
          }
        />
      )}

      {/* Sync failure banner (library still shows its persisted data) */}
      {yt.syncError && yt.libraryCount > 0 && (
        <Typography variant="body2" sx={{ color: 'error.main', mb: 2 }}>
          {t('youtube.syncFailed', { error: syncErrorText })}
        </Typography>
      )}

      {/* Search — debounced ILIKE over title / description (PGlite) */}
      <SearchField
        value={yt.searchInput}
        onChange={yt.setSearchInput}
        placeholder={t('youtube.searchPlaceholder')}
      />

      {/* Playlist chips — hidden until the library has content */}
      {yt.libraryCount > 0 && (
        <PlaylistChips
          playlists={yt.playlists}
          totalCount={yt.libraryCount}
          selected={yt.playlistId}
          onSelect={yt.setPlaylistId}
        />
      )}

      {/* Tag filter chips — youtube-scoped, multi-select AND; hidden when no used tags */}
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
