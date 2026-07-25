import Box from '@mui/material/Box';
import LinearProgress, { linearProgressClasses } from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';

export type PipelineSegmentState = 'loading' | 'idle' | 'running' | 'error';

export interface PipelineProgressSegment {
  id: string;
  /** Pre-translated short label. */
  label: string;
  /** `null` renders `--` while DB-backed coverage is unavailable. */
  done: number | null;
  /** `null` renders `--`; only a running segment animates indeterminately. */
  total: number | null;
  state: PipelineSegmentState;
}

export interface PipelineProgressStripProps {
  segments: PipelineProgressSegment[];
}

function boundedPercent(done: number | null, total: number | null): number {
  if (done == null || total == null || total <= 0) return 0;
  return Math.min(100, Math.max(0, (done / total) * 100));
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
        const unknownRunning = segment.state === 'running' && segment.total == null;
        const color = segment.state === 'error' ? 'error.main' : segment.state === 'running' ? 'primary.main' : 'text.disabled';

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
                height: 17,
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
              <Typography
                variant="caption"
                sx={{
                  color,
                  flexShrink: 0,
                  fontWeight: segment.state === 'running' ? 700 : 500,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {segment.done ?? '--'}/{segment.total ?? '--'}
              </Typography>
            </Box>
            <LinearProgress
              aria-label={segment.label}
              variant={unknownRunning ? 'indeterminate' : 'determinate'}
              value={unknownRunning ? undefined : boundedPercent(segment.done, segment.total)}
              color={segment.state === 'error' ? 'error' : 'primary'}
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
