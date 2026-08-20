import Box from '@mui/material/Box';
import type { ReactNode } from 'react';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';

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

const THUMB_W = 96;
const THUMB_H = 54;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Thumbnail({ cover }: { cover?: string }) {
  return (
    <Box
      sx={{
        width: THUMB_W,
        height: THUMB_H,
        borderRadius: 1,
        flexShrink: 0,
        overflow: 'hidden',
        bgcolor: 'background.neutral',
        color: 'text.disabled',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {cover ? (
        <Box component="img" src={cover} alt="" sx={{ width: 1, height: 1, objectFit: 'cover' }} />
      ) : (
        <Iconify icon="solar:video-library-bold-duotone" width={24} />
      )}
    </Box>
  );
}

function StatsChips({ stats }: { stats: AutoTranscribeState['stats'] }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0, flexWrap: 'wrap' }}>
      {stats.existing > 0 && (
        <Chip label={t('autoTranscribe.statsExisting', { count: stats.existing })} size="small" variant="outlined" />
      )}
      {stats.cc > 0 && (
        <Chip label={t('autoTranscribe.statsCC', { count: stats.cc })} size="small" variant="outlined" />
      )}
      {stats.asr > 0 && (
        <Chip label={t('autoTranscribe.statsASR', { count: stats.asr })} size="small" variant="outlined" />
      )}
      {stats.skipped > 0 && (
        <Chip label={t('autoTranscribe.statsSkipped', { count: stats.skipped })} size="small" variant="outlined" />
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Shared row wrapper: one hairline-framed line that owns its own bottom margin
// (the scaffold's operation slot adds none), so an absent bar costs no space.
// ---------------------------------------------------------------------------

function BarRow({ children, role }: { children: ReactNode; role?: 'status' }) {
  return (
    <Box
      role={role}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        width: '100%',
        px: 2,
        py: 1.25,
        mb: 2.5,
        borderRadius: 3,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      {children}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AutoTranscribeBarProps {
  state: AutoTranscribeState;
  running: boolean;
}

// ---------------------------------------------------------------------------
// Component (pure progress display — transcription starts automatically after
// a fetch; pause/resume belongs to the per-platform library gate). Idle draws
// nothing: the pipeline strip's Transcribe segment already carries coverage.
// ---------------------------------------------------------------------------

export function AutoTranscribeBar({ state, running }: AutoTranscribeBarProps) {
  useTranslation();
  const { phase, stats, currentVideo, currentIndex, totalVideos } = state;
  const isDone = phase === 'done' || phase === 'cancelled';

  if (phase === 'configuration_required') {
    return null;
  }

  if (phase === 'quota_paused') {
    const quotaMessage = state.quotaResetAt === null
      ? t('autoTranscribe.quotaPausedNoReset')
      : t('autoTranscribe.quotaPausedUntil', { reset: formatDateTime(state.quotaResetAt) });

    return (
      <BarRow role="status">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, flexWrap: 'wrap' }}>
          <Iconify
            icon="solar:danger-triangle-bold-duotone"
            width={20}
            sx={{ color: 'warning.main', flexShrink: 0 }}
          />
          <Typography variant="subtitle2" sx={{ flexShrink: 0 }}>
            {t('error.ASR_QUOTA_EXCEEDED')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', minWidth: 0 }}>
            {quotaMessage}
          </Typography>
        </Box>
      </BarRow>
    );
  }

  // ----- Idle: nothing to say that the strip does not already say -----
  if (!running && !isDone) {
    return null;
  }

  // ----- Done / Cancelled: one summary line -----
  if (isDone) {
    const total = stats.existing + stats.cc + stats.asr + stats.skipped;
    return (
      <BarRow role="status">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, flexWrap: 'wrap' }}>
          <Iconify
            icon={phase === 'done' ? 'solar:check-circle-bold' : 'solar:stop-bold'}
            width={20}
            sx={{ color: phase === 'done' ? 'success.main' : 'text.secondary', flexShrink: 0 }}
          />
          <Typography variant="subtitle2" sx={{ flexShrink: 0 }}>
            {phase === 'done' ? t('autoTranscribe.doneTitle') : t('autoTranscribe.cancelled')}
          </Typography>
          {total > 0 && <StatsChips stats={stats} />}
        </Box>
      </BarRow>
    );
  }

  // ----- Running: thumbnail + current video + counter + progress -----
  return (
    <BarRow>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
        <Thumbnail cover={currentVideo?.cover} />

        <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <Typography variant="subtitle2" noWrap title={currentVideo?.title}>
            {currentVideo?.title || stageLabel(state)}
          </Typography>
          {currentVideo && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                {currentVideo.author}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {formatDuration(currentVideo.duration)}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.accent' }} noWrap>
                {stageLabel(state)}
              </Typography>
            </Box>
          )}
        </Box>

        <Typography variant="h3" component="p" sx={{ flexShrink: 0, lineHeight: 1 }}>
          {currentIndex}
          <Typography component="span" variant="body2" sx={{ color: 'text.secondary' }}>
            /{totalVideos}
          </Typography>
        </Typography>

        <StatsChips stats={stats} />
      </Box>

      <LinearProgress variant="determinate" value={overallProgress(state)} sx={{ height: 4 }} />
    </BarRow>
  );
}
