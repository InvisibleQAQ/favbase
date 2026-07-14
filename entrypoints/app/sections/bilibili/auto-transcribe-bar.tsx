import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';

import { t } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import type { AutoTranscribeState } from '@/lib/auto-transcribe/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function stageLabel(state: AutoTranscribeState): string {
  const { phase, videoStage, videoProgress, waitSeconds } = state;
  switch (phase) {
    case 'syncing':
      return t('autoTranscribe.syncing', { current: state.currentPage, total: state.totalPages });
    case 'transcribing':
      if (videoStage === 'indexing') return t('autoTranscribe.indexing');
      if (videoStage === 'start') return t('autoTranscribe.preparing');
      if (videoStage) return t('autoTranscribe.transcribingPct', { progress: videoProgress });
      return t('autoTranscribe.transcribingGeneric');
    case 'waiting':
      return t('autoTranscribe.waitingTranscribe', { seconds: waitSeconds });
    case 'paused':
      return t('autoTranscribe.paused', { seconds: waitSeconds });
    default:
      return '';
  }
}

function overallProgress(state: AutoTranscribeState): number {
  const { totalVideos, phase } = state;
  if (phase === 'done') return 100;
  if (totalVideos === 0) return 0;
  const done = state.stats.existing + state.stats.cc + state.stats.asr + state.stats.skipped;
  return Math.min(99, Math.round((done / totalVideos) * 100));
}

const THUMB_W = 100;
const THUMB_H = 60;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Thumbnail({ cover }: { cover?: string }) {
  if (cover) {
    return (
      <Box
        component="img"
        src={cover}
        alt=""
        sx={{
          width: THUMB_W,
          height: THUMB_H,
          borderRadius: 1,
          objectFit: 'cover',
          flexShrink: 0,
          bgcolor: 'grey.200',
        }}
      />
    );
  }
  return (
    <Box
      sx={{
        width: THUMB_W,
        height: THUMB_H,
        borderRadius: 1,
        flexShrink: 0,
        bgcolor: 'grey.200',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Iconify icon="solar:video-library-bold-duotone" width={24} sx={{ color: 'text.disabled' }} />
    </Box>
  );
}

function StatsChips({ stats }: { stats: AutoTranscribeState['stats'] }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
      {stats.existing > 0 && (
        <Chip label={t('autoTranscribe.statsExisting', { count: stats.existing })} size="small" variant="outlined" />
      )}
      {stats.cc > 0 && (
        <Chip label={t('autoTranscribe.statsCC', { count: stats.cc })} size="small" color="info" variant="outlined" />
      )}
      {stats.asr > 0 && (
        <Chip label={t('autoTranscribe.statsASR', { count: stats.asr })} size="small" color="success" variant="outlined" />
      )}
      {stats.skipped > 0 && (
        <Chip label={t('autoTranscribe.statsSkipped', { count: stats.skipped })} size="small" variant="outlined" />
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Shared panel wrapper
// ---------------------------------------------------------------------------

const PANEL_SX = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  width: '100%',
  p: 2,
  borderRadius: 2,
  border: '1px solid',
  borderColor: 'divider',
  bgcolor: 'background.default',
} as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AutoTranscribeBarProps {
  state: AutoTranscribeState;
  running: boolean;
  onStart: () => void;
  onStop: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AutoTranscribeBar({ state, running, onStart, onStop }: AutoTranscribeBarProps) {
  useTranslation();
  const { phase, stats, currentVideo, currentIndex, totalVideos, previewVideo, pendingCount, previewLoading } = state;
  const isDone = phase === 'done' || phase === 'cancelled';
  const showProgress = running || isDone;

  // ----- Idle: full-width preview panel -----
  if (!showProgress) {
    if (previewLoading) {
      return (
        <Box sx={{ ...PANEL_SX }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <CircularProgress size={24} sx={{ flexShrink: 0 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {t('autoTranscribe.title')}
            </Typography>
          </Box>
        </Box>
      );
    }

    if (pendingCount === null) return null;

    // All transcribed (pendingCount is null when source not yet synced — don't treat as "done")
    if (pendingCount === 0 && !previewVideo) {
      return (
        <Box sx={{ ...PANEL_SX }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Iconify
              icon="solar:check-circle-bold"
              width={28}
              sx={{ color: 'success.main', flexShrink: 0 }}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {t('autoTranscribe.title')}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('autoTranscribe.allDone')}
              </Typography>
            </Box>
          </Box>
        </Box>
      );
    }

    return (
      <Box sx={{ ...PANEL_SX }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          <Thumbnail cover={previewVideo?.cover} />
          <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.4 }}>
              {t('autoTranscribe.title')}
            </Typography>
            {previewVideo && (
              <Typography
                variant="body2"
                noWrap
                sx={{ color: 'text.primary', lineHeight: 1.5 }}
                title={previewVideo.title}
              >
                {previewVideo.title}
                <Typography component="span" variant="body2" sx={{ color: 'text.secondary', ml: 0.5 }}>
                  · {previewVideo.author}
                </Typography>
              </Typography>
            )}
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
              {t('autoTranscribe.pendingCount', { count: pendingCount })}
            </Typography>
          </Box>

          <Button
            variant="contained"
            startIcon={<Iconify icon="solar:play-bold" width={18} />}
            onClick={onStart}
            sx={{ flexShrink: 0, px: 3 }}
          >
            {t('autoTranscribe.startBtn')}
          </Button>
        </Box>
      </Box>
    );
  }

  // ----- Done / Cancelled: summary panel -----
  if (isDone) {
    const total = stats.existing + stats.cc + stats.asr + stats.skipped;
    return (
      <Box sx={{ ...PANEL_SX }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Iconify
            icon={phase === 'done' ? 'solar:check-circle-bold' : 'solar:stop-bold'}
            width={28}
            sx={{ color: phase === 'done' ? 'success.main' : 'text.disabled', flexShrink: 0 }}
          />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {phase === 'done' ? t('autoTranscribe.doneTitle') : t('autoTranscribe.cancelled')}
            </Typography>
            {total > 0 && <StatsChips stats={stats} />}
          </Box>

          <Button
            variant="outlined"
            startIcon={<Iconify icon="solar:restart-bold" width={16} />}
            onClick={onStart}
            sx={{ flexShrink: 0 }}
          >
            {t('autoTranscribe.restart')}
          </Button>
        </Box>
      </Box>
    );
  }

  // ----- Running: rich progress panel -----
  return (
    <Box sx={{ ...PANEL_SX }}>
      {/* Main row: thumbnail + info + progress counter + stop */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
        <Thumbnail cover={currentVideo?.cover} />

        {/* Video info */}
        <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <Typography
            variant="subtitle2"
            noWrap
            sx={{ fontWeight: 600, lineHeight: 1.4, fontSize: '0.9rem' }}
            title={currentVideo?.title}
          >
            {currentVideo?.title || stageLabel(state)}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            {currentVideo && (
              <>
                <Typography variant="body2" sx={{ color: 'text.secondary' }} noWrap>
                  {currentVideo.author}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                  {formatDuration(currentVideo.duration)}
                </Typography>
              </>
            )}
            {currentVideo && (
              <>
                <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                  ·
                </Typography>
                <Typography variant="body2" sx={{ color: 'primary.main' }} noWrap>
                  {stageLabel(state)}
                </Typography>
              </>
            )}
          </Box>
        </Box>

        {/* Progress counter */}
        <Box sx={{ textAlign: 'center', flexShrink: 0, minWidth: 56 }}>
          <Typography variant="h5" sx={{ lineHeight: 1.2, fontWeight: 700 }}>
            {currentIndex}
            <Typography component="span" variant="body1" sx={{ color: 'text.secondary', fontWeight: 400 }}>
              /{totalVideos}
            </Typography>
          </Typography>
        </Box>

        {/* Stats chips */}
        <StatsChips stats={stats} />

        {/* Stop button */}
        <Tooltip title={t('autoTranscribe.stopTooltip')}>
          <IconButton
            size="small"
            color="error"
            onClick={onStop}
            sx={{ flexShrink: 0 }}
          >
            <Iconify icon="solar:stop-bold" width={22} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Full-width progress bar */}
      <LinearProgress
        variant={phase === 'syncing' ? 'indeterminate' : 'determinate'}
        value={overallProgress(state)}
        sx={{ borderRadius: 1, height: 5 }}
      />
    </Box>
  );
}
