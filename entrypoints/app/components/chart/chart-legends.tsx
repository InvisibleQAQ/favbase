import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

export interface ChartLegendItemProps {
  /** Swatch color — the same value the matching arc uses. */
  color: string;
  label: string;
  /** Pre-formatted figure for this series. */
  value: string;
  /** Printed after the value (e.g. a share); the caller owns its markup. */
  aside?: ReactNode;
  /** Emphasises the label when the row doubles as the selected control. */
  selected?: boolean;
}

/**
 * One legend row: swatch, name, figure, optional aside.
 *
 * Phrasing content only (every node is a `span`), because callers use this as
 * a `Tab` label and `Tab` renders a `<button>`. Minimal ships the plural
 * `<ul>/<li>` version; a list cannot be a `tablist`, and this page's legend
 * *is* the platform selector, so the rows stay caller-owned and this component
 * renders one row's content.
 */
export function ChartLegendItem({
  color,
  label,
  value,
  aside,
  selected = false,
}: ChartLegendItemProps) {
  return (
    <Box
      component="span"
      sx={{
        width: 1,
        display: 'grid',
        columnGap: 1,
        alignItems: 'center',
        gridTemplateColumns: '12px minmax(0, 1fr) auto auto',
      }}
    >
      <Box
        component="span"
        aria-hidden="true"
        sx={{ width: 12, height: 12, flexShrink: 0, borderRadius: '50%', bgcolor: color }}
      />
      <Typography
        component="span"
        variant="body2"
        noWrap
        title={label}
        sx={{
          minWidth: 0,
          color: 'text.primary',
          fontWeight: selected ? 'fontWeightSemiBold' : undefined,
        }}
      >
        {label}
      </Typography>
      <Typography component="span" variant="subtitle2" sx={{ color: 'text.primary' }}>
        {value}
      </Typography>
      {aside}
    </Box>
  );
}
