import type { Theme } from '@mui/material/styles';

import Box from '@mui/material/Box';
import LinearProgress, { linearProgressClasses } from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';

export type PipelineSegmentState =
  | 'loading'
  | 'idle'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'completed'
  | 'failed';

export interface PipelineProgressSegment {
  id: string;
  /** Pre-translated short label. */
  label: string;
  /** `null` renders `--` while DB-backed coverage is unavailable. */
  done: number | null;
  /** `null` renders `--`; only a running segment animates indeterminately. */
  total: number | null;
  /** Explicit lifecycle percentage, used when count totals remain unknowable. */
  percent?: number | null;
  state: PipelineSegmentState;
}

export interface PipelineProgressStripProps {
  segments: PipelineProgressSegment[];
}

function boundedPercent(done: number | null, total: number | null): number {
  if (done == null || total == null || total <= 0) return 0;
  return Math.min(100, Math.max(0, (done / total) * 100));
}

function visiblePercent(segment: PipelineProgressSegment): number | null {
  if (segment.percent != null && Number.isFinite(segment.percent)) {
    return Math.round(Math.min(100, Math.max(0, segment.percent)));
  }
  if (segment.done == null || segment.total == null || segment.total <= 0) return null;
  return Math.round(boundedPercent(segment.done, segment.total));
}

/**
 * Compact, always-visible Collection pipeline. Labels are translated by views.
 * Pure display — pause/resume lives in the per-platform library gate, not on
 * segments. Outer spacing (mb) is owned by the scaffold's pipeline row.
 */
export function PipelineProgressStrip({ segments }: PipelineProgressStripProps) {
  if (segments.length === 0) return null;

  return (
    <Box
      data-pipeline-strip
      sx={{
        display: 'flex',
        flexWrap: 'nowrap',
        gap: 1.25,
        minHeight: 28,
        overflowX: 'auto',
        overflowY: 'hidden',
        pb: 0.25,
        scrollbarWidth: 'thin',
      }}
    >
      {segments.map((segment) => {
        const active = segment.state === 'running' || segment.state === 'pausing' || segment.state === 'paused';
        const unknownRunning = (segment.state === 'running' || segment.state === 'pausing') && segment.total == null;
        const percent = visiblePercent(segment);
        // Text never borrows the stamp color: active reads in the accent shade,
        // failure in the scheme-safe error shade, everything else in secondary.
        // Coral and error.main stay on the bar fill, where they are blocks.
        // Palette paths (not `theme.vars`) so the strip still renders outside
        // the app ThemeProvider, as its contract test does.
        const textColor = (theme: Theme) =>
          segment.state === 'failed'
            ? { color: 'error.dark', ...theme.applyStyles('dark', { color: 'error.light' }) }
            : { color: active ? 'text.accent' : 'text.secondary' };

        return (
          <Box
            key={segment.id}
            data-pipeline-segment
            data-segment-id={segment.id}
            data-segment-state={segment.state}
            sx={{ flex: '1 0 112px', minWidth: 112, maxWidth: 220 }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 1,
                minWidth: 0,
                height: 24,
              }}
            >
              <Typography
                variant="caption"
                noWrap
                title={segment.label}
                sx={(theme) => ({ ...textColor(theme), minWidth: 0 })}
              >
                {segment.label}
              </Typography>
              <Typography
                variant="caption"
                sx={(theme) => ({
                  ...textColor(theme),
                  fontWeight: active ? 700 : 500,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                })}
              >
                {segment.done ?? '--'}/{segment.total ?? '--'}
                {percent == null ? null : ` ${percent}%`}
              </Typography>
            </Box>
            <LinearProgress
              aria-label={segment.label}
              variant={unknownRunning ? 'indeterminate' : 'determinate'}
              value={unknownRunning ? undefined : (percent ?? 0)}
              color={segment.state === 'failed' ? 'error' : 'primary'}
              sx={{
                height: 3,
                borderRadius: 1,
                bgcolor: 'action.hover',
                [`& .${linearProgressClasses.bar}`]: {
                  borderRadius: 1,
                  opacity: segment.state === 'idle' ? 0.48 : 1,
                },
              }}
            />
          </Box>
        );
      })}
    </Box>
  );
}
