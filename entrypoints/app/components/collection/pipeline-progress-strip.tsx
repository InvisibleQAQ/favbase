import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import LinearProgress, { linearProgressClasses } from '@mui/material/LinearProgress';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { Iconify } from '../iconify';

export type PipelineSegmentState =
  | 'loading'
  | 'idle'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'completed'
  | 'failed';

export interface PipelineSegmentControl {
  kind: 'pause' | 'pausing' | 'resume';
  label: string;
  disabled: boolean;
  onClick?: () => void;
}

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
  control?: PipelineSegmentControl;
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

/** Compact, always-visible Collection pipeline. Labels are translated by views. */
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
        mb: 2,
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
        const color = segment.state === 'failed' ? 'error.main' : active ? 'primary.main' : 'text.disabled';

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
                sx={{ color: segment.state === 'idle' ? 'text.secondary' : color, minWidth: 0 }}
              >
                {segment.label}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                <Typography
                  variant="caption"
                  sx={{
                    color,
                    fontWeight: active ? 700 : 500,
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {segment.done ?? '--'}/{segment.total ?? '--'}
                  {percent == null ? null : ` ${percent}%`}
                </Typography>
                {segment.control ? (
                  <Tooltip title={segment.control.label}>
                    <Box component="span" sx={{ display: 'inline-flex', width: 24, height: 24 }}>
                      <IconButton
                        data-pipeline-control
                        data-control-kind={segment.control.kind}
                        aria-label={segment.control.label}
                        disabled={segment.control.disabled}
                        onClick={segment.control.onClick}
                        size="small"
                        sx={{ width: 24, height: 24, p: 0 }}
                      >
                        {segment.control.kind === 'pausing' ? (
                          <CircularProgress size={14} thickness={5} aria-hidden />
                        ) : (
                          <Iconify
                            icon={segment.control.kind === 'pause' ? 'solar:pause-bold' : 'solar:play-bold'}
                            width={15}
                          />
                        )}
                      </IconButton>
                    </Box>
                  </Tooltip>
                ) : null}
              </Box>
            </Box>
            <LinearProgress
              aria-label={segment.label}
              variant={unknownRunning ? 'indeterminate' : 'determinate'}
              value={unknownRunning ? undefined : (percent ?? 0)}
              color={segment.state === 'failed' ? 'error' : 'primary'}
              sx={{
                height: 3,
                borderRadius: 0.5,
                bgcolor: 'action.hover',
                [`& .${linearProgressClasses.bar}`]: {
                  borderRadius: 0.5,
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
