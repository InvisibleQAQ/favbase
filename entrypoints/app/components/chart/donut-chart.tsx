import type { ReactNode } from 'react';
import type { SxProps, Theme } from '@mui/material/styles';

import Box from '@mui/material/Box';

/** One arc of the ring. `id` is the caller's own vocabulary, not the chart's. */
export interface DonutSegment {
  id: string;
  /** Fraction of the whole ring, 0..1. Anything <= 0 draws nothing. */
  share: number;
  /** Resolved stroke color — pass a theme value, never a hex literal. */
  color: string;
}

export interface DonutChartProps {
  segments: DonutSegment[];
  /** Ring under the arcs. Always drawn, so an all-zero chart still reads. */
  trackColor: string;
  /** Pre-formatted figure printed in the hole. */
  center?: ReactNode;
  /** Outer diameter in px. The ring shrinks with its container, never grows past this. */
  size?: number;
  /** Ring thickness in px, measured at `size`. */
  thickness?: number;
  sx?: SxProps<Theme>;
}

/** Everything is drawn in this viewBox, so `size` only scales the rendered box. */
const VIEWBOX = 100;
const CENTER = VIEWBOX / 2;

/**
 * Zero-dependency donut: one `<circle>` per segment, sliced with
 * `stroke-dasharray` and rotated into place with `stroke-dashoffset`.
 *
 * The whole block is `aria-hidden`: a chart never carries meaning alone, so
 * every figure it shows must also be printed as text by the caller (legend
 * rows, KPI cards). See `.trellis/spec/frontend/ui-design-system.md` §10.
 */
export function DonutChart({
  segments,
  trackColor,
  center,
  size = 200,
  thickness = 24,
  sx,
}: DonutChartProps) {
  const stroke = (thickness / size) * VIEWBOX;
  const radius = (VIEWBOX - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  let consumed = 0;
  const arcs = segments
    .map((segment) => {
      const share = Math.min(Math.max(segment.share, 0), 1);
      const arc = { ...segment, share, offset: consumed };
      consumed += share;
      return arc;
    })
    .filter((arc) => arc.share > 0);

  return (
    <Box
      aria-hidden="true"
      sx={[
        {
          width: size,
          maxWidth: 1,
          aspectRatio: '1 / 1',
          mx: 'auto',
          position: 'relative',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box
        component="svg"
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        sx={{
          width: 1,
          height: 1,
          display: 'block',
          // 12 o'clock start, clockwise — the reading order of the legend.
          transform: 'rotate(-90deg)',
        }}
      >
        <circle
          cx={CENTER}
          cy={CENTER}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={stroke}
        />
        {arcs.map((arc) => (
          <circle
            key={arc.id}
            data-segment={arc.id}
            cx={CENTER}
            cy={CENTER}
            r={radius}
            fill="none"
            stroke={arc.color}
            strokeWidth={stroke}
            strokeDasharray={`${arc.share * circumference} ${circumference}`}
            strokeDashoffset={-(arc.offset * circumference)}
          />
        ))}
      </Box>
      {center != null && (
        <Box
          sx={{
            inset: 0,
            display: 'flex',
            position: 'absolute',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {center}
        </Box>
      )}
    </Box>
  );
}
