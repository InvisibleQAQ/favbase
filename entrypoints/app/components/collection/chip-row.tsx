import type { ReactElement, ReactNode } from 'react';
import type { Theme, SxProps } from '@mui/material/styles';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';

export interface ChipRowShellProps {
  /** Header icon, e.g. an <Iconify width={20}> — caller controls color. */
  icon: ReactNode;
  /** Pre-translated header title. */
  title: string;
  /** Optional extra header content, e.g. a clear-filter button. */
  headerExtra?: ReactNode;
  /** Chip row content — chips, skeletons, or an empty-state caption. */
  children: ReactNode;
  /** Optional overrides merged after the default `mb: 3` outer spacing. */
  sx?: SxProps<Theme>;
}

/** Filter chip row shell: icon + bold subtitle header above a wrapping chip row. */
export function ChipRowShell({ icon, title, headerExtra, children, sx }: ChipRowShellProps) {
  return (
    <Box sx={[{ mb: 3 }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        {icon}
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        {headerExtra}
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{children}</Box>
    </Box>
  );
}

export interface FilterChipProps {
  label: string;
  selected: boolean;
  onClick: () => void;
  /** Chip leading icon, e.g. a language color dot. */
  icon?: ReactElement;
  /** Truncate long labels with an ellipsis beyond this width. */
  maxWidth?: number;
}

/** Filter chip: the coral stamp (filled primary, ink text) when selected, a hairline outline otherwise. */
export function FilterChip({ label, selected, onClick, icon, maxWidth }: FilterChipProps) {
  return (
    <Chip
      icon={icon}
      label={label}
      clickable
      onClick={onClick}
      color={selected ? 'primary' : 'default'}
      variant={selected ? 'filled' : 'outlined'}
      sx={
        maxWidth
          ? {
              maxWidth,
              '& .MuiChip-label': {
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
            }
          : undefined
      }
    />
  );
}
