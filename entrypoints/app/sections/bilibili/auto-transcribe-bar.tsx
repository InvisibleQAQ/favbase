import Box from '@mui/material/Box';
import type { ReactNode } from 'react';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import { Link as RouterLink } from 'react-router-dom';

import { formatDateTime, t } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { formatDuration } from '../../utils/format-duration';
import type { AutoTranscribeState } from '@/lib/auto-transcribe/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stageLabel(state: AutoTranscribeState): string {
  const { phase, videoStage, videoProgress, waitSeconds } = state;
  switch (phase) {
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
}

function WarningPanel({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <Box role="alert" sx={{ ...PANEL_SX, borderColor: 'warning.main' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Iconify
          icon="solar:danger-triangle-bold-duotone"
          width={28}
          sx={{ color: 'warning.main', flexShrink: 0 }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {message}
          </Typography>
        </Box>
        {action}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Component (pure progress display — transcription starts automatically after
// a fetch; pause/resume belongs to the per-platform library gate)
// ---------------------------------------------------------------------------

export function AutoTranscribeBar({ state, running }: AutoTranscribeBarProps) {
  useTranslation();
  const { phase, stats, currentVideo, currentIndex, totalVideos } = state;
  const isDone = phase === 'done' || phase === 'cancelled';
  const showProgress = running || isDone;

  if (phase === 'configuration_required') {
    return (
      <WarningPanel
        title={t('autoTranscribe.configurationRequiredTitle')}
        message={t('autoTranscribe.configurationRequired')}
        action={
          <Button
            component={RouterLink}
            to="/settings?section=asr"
            variant="outlined"
            color="warning"
            startIcon={<Iconify icon="solar:settings-bold-duotone" width={18} />}
          >
            {t('autoTranscribe.configureAsr')}
          </Button>
        }
      />
    );
  }

  if (phase === 'quota_paused') {
    const quotaMessage = state.quotaResetAt === null
      ? t('autoTranscribe.quotaPausedNoReset')
      : t('autoTranscribe.quotaPausedUntil', { reset: formatDateTime(state.quotaResetAt) });

    return (
      <WarningPanel
        title={t('error.ASR_QUOTA_EXCEEDED')}
        message={quotaMessage}
      />
    );
  }

  // ----- Idle: no historical pending lookup -----
  if (!showProgress) {
    return (
      <Box sx={{ ...PANEL_SX }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Iconify
            icon="solar:subtitles-bold-duotone"
            width={28}
            sx={{ color: 'text.secondary', flexShrink: 0 }}
          />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {t('autoTranscribe.title')}
          </Typography>
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
      </Box>

      {/* Full-width progress bar */}
      <LinearProgress
        variant="determinate"
        value={overallProgress(state)}
        sx={{ borderRadius: 1, height: 5 }}
      />
    </Box>
  );
}
