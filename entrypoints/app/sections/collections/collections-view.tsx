import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Card from '@mui/material/Card';
import Skeleton from '@mui/material/Skeleton';
import Pagination from '@mui/material/Pagination';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';

import { useTranslation } from '@/lib/i18n/use-translation';
import type { BiliFavOrder } from '@/lib/bilibili/types';
import { Iconify } from '../../components/iconify';
import { DashboardContent } from '../../layouts/dashboard';
import { useBiliFavFolders } from './use-bili-fav-folders';
import { useBiliFavVideos } from './use-bili-fav-videos';
import { useVideoTranscribe } from './use-video-transcribe';
import { useAutoTranscribe } from './use-auto-transcribe';
import { createBiliAutoTranscribeAdapter } from '@/lib/bilibili/auto-transcribe-adapter';
import { VideoCard } from './video-card';
import { FolderChips } from './folder-chips';
import { AutoTranscribeBar } from './auto-transcribe-bar';

const biliAdapter = createBiliAutoTranscribeAdapter();

// ---------------------------------------------------------------------------
// Shared state views (not-logged-in / error / empty / skeleton)
// ---------------------------------------------------------------------------

function NotLoggedIn({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 320,
        gap: 2,
        borderRadius: 2,
        border: `2px dashed ${theme.vars.palette.grey[300]}`,
        p: 4,
      })}
    >
      <Iconify
        icon="solar:shield-keyhole-bold-duotone"
        width={64}
        sx={{ color: 'warning.main', mb: 1 }}
      />
      <Typography variant="h6">{t('collections.notLoggedInTitle')}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 400 }}>
        {t('collections.notLoggedInDesc')}
      </Typography>
      <Button variant="outlined" onClick={onRetry} sx={{ mt: 1 }}>
        {t('collections.retry')}
      </Button>
    </Box>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 320,
        gap: 2,
        borderRadius: 2,
        border: `2px dashed ${theme.vars.palette.grey[300]}`,
        p: 4,
      })}
    >
      <Iconify icon="solar:danger-triangle-bold-duotone" width={64} sx={{ color: 'error.main', mb: 1 }} />
      <Typography variant="h6">{t('collections.loadFailed')}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 400 }}>
        {message}
      </Typography>
      <Button variant="outlined" onClick={onRetry} sx={{ mt: 1 }}>
        {t('collections.retry')}
      </Button>
    </Box>
  );
}

function VideoGridSkeleton() {
  return (
    <Grid container spacing={2.5}>
      {Array.from({ length: 8 }).map((_, i) => (
        <Grid key={i} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
          <Card sx={{ overflow: 'hidden' }}>
            <Skeleton variant="rectangular" height={130} />
            <Box sx={{ p: 1.5 }}>
              <Skeleton variant="text" width="80%" />
              <Skeleton variant="text" width="50%" />
            </Box>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}

function EmptyFolderState() {
  const { t } = useTranslation();
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 320,
        gap: 2,
        borderRadius: 2,
        border: `2px dashed ${theme.vars.palette.grey[300]}`,
      })}
    >
      <Typography variant="h6" sx={{ color: 'text.disabled' }}>
        {t('collections.emptyFolderTitle')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {t('collections.emptyFolderDesc')}
      </Typography>
    </Box>
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

function VideoGridPanel({ mediaId, totalCount, syncing, onSync, lastSyncedAt, autoTranscribe }: {
  mediaId: number;
  totalCount: number;
  syncing: boolean;
  onSync: () => void;
  lastSyncedAt: Date | null;
  autoTranscribe: ReturnType<typeof useAutoTranscribe>;
}) {
  const { t } = useTranslation();
  const { videos, folderTitle, page, totalPages, loading, loginState, error, order, setOrder, goToPage, retry } =
    useBiliFavVideos(mediaId);

  const { getState, startTranscribe, cancelTranscribe, activeBvid } =
    useVideoTranscribe(videos);

  const handlePageChange = (_: React.ChangeEvent<unknown>, value: number) => {
    goToPage(value);
  };

  return (
    <Box sx={{ minWidth: 0 }}>
      {/* Title bar */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ flexShrink: 0 }} noWrap>
          {loading ? <Skeleton width={200} /> : folderTitle}
        </Typography>

        {!loading && (
          <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0 }}>
            {totalCount > 0 && t('collections.videoCount', { count: totalCount })}
            {lastSyncedAt && ` · ${t('collections.lastSynced', { time: lastSyncedAt.toLocaleTimeString() })}`}
          </Typography>
        )}

        <Box sx={{ flex: 1 }} />

        <Button
          variant="contained"
          size="small"
          startIcon={
            syncing ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              <Iconify icon="solar:restart-bold" width={18} />
            )
          }
          onClick={onSync}
          disabled={syncing}
        >
          {syncing ? t('collections.syncing') : t('collections.sync')}
        </Button>
      </Box>

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
          <Grid container spacing={2.5}>
            {videos.map((video) => (
              <Grid key={video.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <VideoCard
                  video={video}
                  transcribeState={getState(video.bvid)}
                  onTranscribe={() => startTranscribe(video)}
                  onCancel={cancelTranscribe}
                  disabled={Boolean(activeBvid && activeBvid !== video.bvid)}
                />
              </Grid>
            ))}
          </Grid>

          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
              <Pagination
                count={totalPages}
                page={page}
                onChange={handlePageChange}
                color="primary"
                shape="rounded"
              />
            </Box>
          )}
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
      <TextField
        fullWidth
        disabled
        placeholder={t('collections.searchPlaceholder')}
        sx={{ mb: 3 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <Iconify icon="eva:search-fill" width={20} sx={{ color: 'text.disabled' }} />
              </InputAdornment>
            ),
          },
        }}
      />

      {/* Folder chips — horizontal filter */}
      <FolderChips
        folders={folders}
        selectedId={selectedId}
        loading={foldersLoading}
        onSelect={handleSelectFolder}
      />

      {/* Folder content */}
      {selectedId ? (
        <VideoGridPanel
          key={selectedId}
          mediaId={selectedId}
          totalCount={selectedFolder?.media_count ?? 0}
          syncing={syncing}
          onSync={sync}
          lastSyncedAt={lastSyncedAt}
          autoTranscribe={autoTranscribe}
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
