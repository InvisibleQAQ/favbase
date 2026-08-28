import type { Theme, SxProps } from '@mui/material/styles';

import { varAlpha } from 'minimal-shared/utils';

/** The plain style object an `sx` callback returns (no `@mui/system` dependency). */
type SxObject = ReturnType<Extract<SxProps<Theme>, (theme: Theme) => unknown>>;

/**
 * The one segmented-control look shared by the Settings top tabs and the
 * per-tab section rail. Selected = paper surface lifted by a hairline and ink
 * text at weight 600; unselected = transparent and secondary text. Readable in
 * both schemes without a shadow and without coral text.
 */
export function segmentedTabsSx(
  theme: Theme,
  opts: { compact?: boolean; tabMinHeight?: number } = {},
): SxObject {
  return {
    p: 0.5,
    borderRadius: 1,
    bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.08),
    '& .MuiTabs-indicator': { display: 'none' },
    '& .MuiTabs-flexContainer': { gap: 0.5 },
    '& .MuiTab-root': {
      minHeight: opts.tabMinHeight ?? 48,
      borderRadius: 0.5,
      border: '1px solid transparent',
      justifyContent: opts.compact ? 'center' : 'flex-start',
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.vars.palette.text.secondary,
      transition: theme.transitions.create(['color', 'background-color', 'border-color'], {
        duration: theme.transitions.duration.shortest,
      }),
      '&:hover': { color: theme.vars.palette.text.primary },
      '&.Mui-selected': {
        color: theme.vars.palette.text.primary,
        fontWeight: theme.typography.fontWeightSemiBold,
        bgcolor: theme.vars.palette.background.paper,
        borderColor: theme.vars.palette.divider,
      },
    },
  };
}
