import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';

import { useTranslation } from '@/lib/i18n/use-translation';
import type { BiliFavOrder } from '@/lib/bilibili/types';
import { Iconify } from '../../components/iconify';
import { DashboardContent } from '../../layouts/dashboard';
import {
  StateBox,
  SectionTitleBar,
  SearchField,
  CardGrid,
  CardGridItem,
  CardGridPagination,
} from '../../components/collection';
import {
  useItemTags,
  useUsedTags,
  useTagFilter,
  TagFilterChips,
  TaggedItemGrid,
  TagEditPopover,
  useTagEditState,
} from '../../components/tags';
import { useBiliFavFolders } from './use-bili-fav-folders';
import { useBiliFavVideos } from './use-bili-fav-videos';
import { useVideoTranscribe } from './use-video-transcribe';
import { useAutoTranscribe } from './use-auto-transcribe';
import { createBiliAutoTranscribeAdapter } from '@/lib/bilibili/auto-transcribe-adapter';
import { VideoCard, INVALID_ATTR } from './video-card';
import { TaggedVideoCard } from './tagged-video-card';
import { VideoGridSkeleton } from './video-grid-skeleton';
import { FolderChips } from './folder-chips';
import { AutoTranscribeBar } from './auto-transcribe-bar';

/** Platform key for all tag operations in this (bilibili-only) section. */
const PLATFORM = 'bilibili';

const biliAdapter = createBiliAutoTranscribeAdapter();

// ---------------------------------------------------------------------------
// Shared state views (not-logged-in / error / empty / skeleton)
// ---------------------------------------------------------------------------

function NotLoggedIn({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <StateBox
      icon={
        <Iconify
          icon="solar:shield-keyhole-bold-duotone"
          width={64}
          sx={{ color: 'warning.main', mb: 1 }}
        />
      }
      title={t('collections.notLoggedInTitle')}
      description={t('collections.notLoggedInDesc')}
      action={
        <Button variant="outlined" onClick={onRetry} sx={{ mt: 1 }}>
          {t('collections.retry')}
        </Button>
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
      title={t('collections.loadFailed')}
      description={message}
      action={
        <Button variant="outlined" onClick={onRetry} sx={{ mt: 1 }}>
          {t('collections.retry')}
        </Button>
      }
    />
  );
}

function EmptyFolderState() {
  const { t } = useTranslation();
  return (
    <StateBox>
      <Typography variant="h6" sx={{ color: 'text.disabled' }}>
        {t('collections.emptyFolderTitle')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {t('collections.emptyFolderDesc')}
      </Typography>
    </StateBox>
  );
}

// ---------------------------------------------------------------------------
// Sort control — server-side order (mtime/view/pubtime), all descending
// ---------------------------------------------------------------------------

const SORT_OPTIONS = [
  { value: 'mtime', labelKey: 'collections.sortFavTime', icon: 'solar:clock-circle-bold' },
  { value: 'view', labelKey: 'collections.sortPlay', icon: 'solar:play-circle-bold' },
  { value: 'pubtime', labelKey: 'collections.sortPubTime', icon: 'solar:calendar-bold' },
] as const;

function SortControl({ order, onChange }: { order: BiliFavOrder; onChange: (o: BiliFavOrder) => void }) {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 2, flexWrap: 'wrap' }}>
      {SORT_OPTIONS.map((opt) => {
        const active = order === opt.value;
        return (
          <Button
            key={opt.value}
            size="small"
            variant="text"
            startIcon={<Iconify icon={opt.icon} width={18} />}
            onClick={() => onChange(opt.value)}
            sx={{
              minWidth: 0,
              px: 1,
              color: active ? 'primary.main' : 'text.secondary',
              fontWeight: active ? 600 : 400,
              textDecoration: active ? 'underline' : 'none',
              textUnderlineOffset: 4,
              '&:hover': {
                bgcolor: 'transparent',
                color: active ? 'primary.dark' : 'text.primary',
              },
            }}
          >
            {t(opt.labelKey)}
          </Button>
        );
      })}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Video grid panel (only rendered when a valid folder is selected)
// ---------------------------------------------------------------------------

function VideoGridPanel({ mediaId, totalCount, syncing, onSync, lastSyncedAt, autoTranscribe, onTagsChanged }: {
  mediaId: number;
  totalCount: number;
  syncing: boolean;
  onSync: () => void;
  lastSyncedAt: Date | null;
  autoTranscribe: ReturnType<typeof useAutoTranscribe>;
  onTagsChanged?: () => void;
}) {
  const { t } = useTranslation();
  const { videos, folderTitle, page, totalPages, loading, loginState, error, order, setOrder, goToPage, retry } =
    useBiliFavVideos(mediaId);

  const { getState, startTranscribe, cancelTranscribe, activeBvid } =
    useVideoTranscribe(videos);

  const { tagsById: tagsByBvid, refresh: refreshItemTags } = useItemTags(
    PLATFORM,
    videos.map((v) => v.bvid),
  );
  const { editing, open: openTagEditor, close: closeTagEditor } = useTagEditState();

  const handleTagsChanged = () => {
    refreshItemTags();
    onTagsChanged?.();
  };

  const captionParts: string[] = [];
  if (totalCount > 0) {
    captionParts.push(t('collections.videoCount', { count: totalCount }));
  }
  if (lastSyncedAt) {
    captionParts.push(t('collections.lastSynced', { time: lastSyncedAt.toLocaleTimeString() }));
  }

  return (
    <Box sx={{ minWidth: 0 }}>
      <SectionTitleBar
        title={loading ? <Skeleton width={200} /> : folderTitle}
        caption={!loading && captionParts.length > 0 ? captionParts.join(' · ') : undefined}
        syncing={syncing}
        onSync={onSync}
        syncLabel={t('collections.sync')}
        syncingLabel={t('collections.syncing')}
      />

      {/* Auto-transcribe bar — full width below title */}
      <Box sx={{ mb: 2.5 }}>
        <AutoTranscribeBar
          state={autoTranscribe.state}
          running={autoTranscribe.running}
          onStart={autoTranscribe.start}
          onStop={autoTranscribe.stop}
        />
      </Box>

      {/* Sort control — between transcribe bar and video grid */}
      {loginState !== 'not_logged_in' && !error && (
        <SortControl order={order} onChange={setOrder} />
      )}

      {/* Video content */}
      {loading ? (
        <VideoGridSkeleton />
      ) : loginState === 'not_logged_in' ? (
        <NotLoggedIn onRetry={retry} />
      ) : error ? (
        <ErrorState message={error} onRetry={retry} />
      ) : videos.length === 0 ? (
        <EmptyFolderState />
      ) : (
        <>
          <CardGrid>
            {videos.map((video) => {
              const isInvalid = video.attr === INVALID_ATTR;
              return (
                <CardGridItem key={video.id}>
                  <VideoCard
                    video={video}
                    transcribeState={getState(video.bvid)}
                    onTranscribe={() => startTranscribe(video)}
                    onCancel={cancelTranscribe}
                    disabled={Boolean(activeBvid && activeBvid !== video.bvid)}
                    tags={isInvalid ? undefined : (tagsByBvid[video.bvid] ?? [])}
                    onEditTags={
                      isInvalid ? undefined : (anchor) => openTagEditor(video.bvid, anchor)
                    }
                  />
                </CardGridItem>
              );
            })}
          </CardGrid>

          <TagEditPopover
            platform={PLATFORM}
            anchorEl={editing?.anchorEl ?? null}
            platformItemId={editing?.platformItemId ?? null}
            tags={editing ? (tagsByBvid[editing.platformItemId] ?? []) : []}
            onClose={closeTagEditor}
            onChanged={handleTagsChanged}
          />

          <CardGridPagination page={page} totalPages={totalPages} onChange={goToPage} />
        </>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main view: search box + folder chips + video grid (flat vertical stack)
// ---------------------------------------------------------------------------

export function CollectionsView() {
  const { t } = useTranslation();
  const { mediaId } = useParams<{ mediaId: string }>();
  const navigate = useNavigate();

  const { folders, loading: foldersLoading, syncing, loginState, lastSyncedAt, error, sync } =
    useBiliFavFolders();

  const selectedId = mediaId ? Number(mediaId) : folders[0]?.id;
  const autoTranscribe = useAutoTranscribe(selectedId, biliAdapter);
  const selectedFolder = folders.find((f) => f.id === selectedId);

  const { usedTags, refresh: refreshUsedTags } = useUsedTags(PLATFORM);
  const { selectedTagIds, toggleTag, clearTags } = useTagFilter(usedTags);

  useEffect(() => {
    if (!mediaId && !foldersLoading && folders.length > 0) {
      navigate(`/collections/bilibili/${folders[0].id}`, { replace: true });
    }
  }, [mediaId, foldersLoading, folders, navigate]);

  const handleSelectFolder = (folderId: number) => {
    navigate(`/collections/bilibili/${folderId}`);
  };

  if (!foldersLoading && loginState === 'not_logged_in') {
    return (
      <DashboardContent maxWidth="xl">
        <NotLoggedIn onRetry={sync} />
      </DashboardContent>
    );
  }

  return (
    <DashboardContent maxWidth="xl">
      {error && (
        <Typography variant="body2" sx={{ color: 'error.main', mb: 2 }}>
          {t('collections.syncFailed', { error })}
        </Typography>
      )}

      {/* Search box — UI-only placeholder, no search logic */}
      <SearchField disabled placeholder={t('collections.searchPlaceholder')} />

      {/* Folder chips — horizontal filter */}
      <FolderChips
        folders={folders}
        selectedId={selectedId}
        loading={foldersLoading}
        onSelect={handleSelectFolder}
      />

      {/* Tag filter chips — cross-folder, multi-select AND; hidden when no used tags */}
      <TagFilterChips
        tags={usedTags}
        selectedIds={selectedTagIds}
        onToggle={toggleTag}
        onClear={clearTags}
      />

      {/* Content: tag-filtered cross-folder grid takes over while filters are active */}
      {selectedTagIds.length > 0 ? (
        <TaggedItemGrid
          platform={PLATFORM}
          tagIds={selectedTagIds}
          renderCard={(item, openTagEditor) => (
            <TaggedVideoCard item={item} onEditTags={openTagEditor} />
          )}
          skeleton={<VideoGridSkeleton />}
          onTagsChanged={refreshUsedTags}
        />
      ) : selectedId ? (
        <VideoGridPanel
          key={selectedId}
          mediaId={selectedId}
          totalCount={selectedFolder?.media_count ?? 0}
          syncing={syncing}
          onSync={sync}
          lastSyncedAt={lastSyncedAt}
          autoTranscribe={autoTranscribe}
          onTagsChanged={refreshUsedTags}
        />
      ) : foldersLoading ? (
        <VideoGridSkeleton />
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 240 }}>
          <Typography variant="body1" sx={{ color: 'text.disabled' }}>
            {t('collections.selectFolder')}
          </Typography>
        </Box>
      )}
    </DashboardContent>
  );
}
