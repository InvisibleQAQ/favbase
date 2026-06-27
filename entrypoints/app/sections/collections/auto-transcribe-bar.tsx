import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

import { Iconify } from '../../components/iconify';
import type { AutoTranscribeState } from './use-auto-transcribe';

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
      return `收录第 ${state.currentPage}/${state.totalPages} 页...`;
    case 'transcribing':
      if (videoStage === 'start') return '准备转录...';
      if (videoStage) return `转录中 ${videoProgress}%`;
      return '转录中...';
    case 'waiting':
      return `转录中 ${waitSeconds}s...`;
    case 'paused':
      return `速率限制，暂停 ${waitSeconds}s...`;
    default:
      return '';
  }
}

function overallProgress(state: AutoTranscribeState): number {
  const { totalVideos, phase } = state;
  if (phase === 'done') return 100;
  if (totalVideos === 0) return 0;
  const done = state.stats.cc + state.stats.asr + state.stats.skipped;
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
      {stats.cc > 0 && (
        <Chip label={`CC ${stats.cc}`} size="small" color="info" variant="outlined" />
      )}
      {stats.asr > 0 && (
        <Chip label={`ASR ${stats.asr}`} size="small" color="success" variant="outlined" />
      )}
      {stats.skipped > 0 && (
        <Chip label={`跳过 ${stats.skipped}`} size="small" variant="outlined" />
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
  const { phase, stats, currentVideo, currentIndex, totalVideos, previewVideo, pendingCount } = state;
  const isDone = phase === 'done' || phase === 'cancelled';
  const showProgress = running || isDone;

  // ----- Idle: full-width preview panel -----
  if (!showProgress) {
    // All transcribed
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
                自动转录
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                所有视频已转录
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
              自动转录
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
                  · {previewVideo.upper}
                </Typography>
              </Typography>
            )}
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
              共 {pendingCount} 个视频待转录
            </Typography>
          </Box>

          <Button
            variant="contained"
            startIcon={<Iconify icon="solar:play-bold" width={18} />}
            onClick={onStart}
            sx={{ flexShrink: 0, px: 3 }}
          >
            开始
          </Button>
        </Box>
      </Box>
    );
  }

  // ----- Done / Cancelled: summary panel -----
  if (isDone) {
    const total = stats.cc + stats.asr + stats.skipped;
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
              {phase === 'done' ? '转录完成' : '已停止'}
            </Typography>
            {total > 0 && <StatsChips stats={stats} />}
          </Box>

          <Button
            variant="outlined"
            startIcon={<Iconify icon="solar:restart-bold" width={16} />}
            onClick={onStart}
            sx={{ flexShrink: 0 }}
          >
            重新开始
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
                  {currentVideo.upper}
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
        <Tooltip title="停止自动转录">
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
