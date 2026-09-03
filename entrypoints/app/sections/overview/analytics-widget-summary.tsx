import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';

import { Iconify } from '../../components/iconify';
import type { IconifyName } from '../../components/iconify/register-icons';

/** Semantic ramps the four dashboard metrics are allowed to wear. */
export type AnalyticsWidgetColor = 'primary' | 'info' | 'warning' | 'success';

export interface AnalyticsWidgetSummaryProps {
  /** Pre-translated metric name. Rendered as a paragraph, never a heading. */
  title: string;
  /** Pre-formatted figure. Pass `—` when the metric has no meaning yet. */
  value: string;
  /** One honest secondary line (e.g. "no tags yet"); omit for a bare figure. */
  caption?: string;
  icon: IconifyName;
  color?: AnalyticsWidgetColor;
}

/**
 * Minimal's `AnalyticsWidgetSummary` without ApexCharts: no sparkline and no
 * trend arrow, because Favbase stores no time series and will not fabricate
 * one (docs/25 D17). Every value here is a `CollectionAnalyticsSnapshot`
 * field, formatted by the caller.
 */
export function AnalyticsWidgetSummary({
  title,
  value,
  caption,
  icon,
  color = 'primary',
}: AnalyticsWidgetSummaryProps) {
  return (
    <Card
      sx={(theme) => ({
        p: 3,
        height: 1,
        boxShadow: 'none',
        color: `${color}.darker`,
        /**
         * Minimal's widget ground: a white base under two 48% brand tints. The
         * base is what keeps the gradient from going muddy on the dark scheme —
         * 48% alpha straight onto a dark paper reads as grey.
         */
        backgroundColor: 'common.white',
        backgroundImage: `linear-gradient(135deg, ${varAlpha(theme.vars.palette[color].lighterChannel, 0.48)}, ${varAlpha(theme.vars.palette[color].lightChannel, 0.48)})`,
      })}
    >
      <Iconify icon={icon} width={48} aria-hidden sx={{ position: 'absolute', top: 24, right: 24 }} />
      {/* Room for the glyph: the metric name wraps instead of running under it. */}
      <Box sx={{ pr: 8 }}>
        <Typography variant="subtitle2" component="p">
          {title}
        </Typography>
        {/* A figure, not a heading — tabular numerals come from CssBaseline. */}
        <Typography data-slot="kpi-value" variant="h3" component="p" sx={{ mt: 1 }}>
          {value}
        </Typography>
        {caption && (
          /**
           * Full `<color>.darker` ink, no `opacity`. Minimal dims this line, but
           * on the 48% tint over white the ramps land at 3.5-3.9:1 at 0.72
           * (success, the coverage card's own color, is the worst at 3.48:1) —
           * under the 4.5:1 floor for 12px text. Size already makes it
           * secondary; a silent alpha is what made it unreadable.
           */
          <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>
            {caption}
          </Typography>
        )}
      </Box>
    </Card>
  );
}
