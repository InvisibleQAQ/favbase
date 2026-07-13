import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';

import { Iconify } from '../iconify';

export interface SectionTitleBarProps {
  /** h5 title — pass a <Skeleton> while loading. */
  title: ReactNode;
  /** Caption next to the title (count / last-synced); omit to hide. */
  caption?: ReactNode;
  syncing: boolean;
  onSync: () => void;
  /** Pre-translated button labels — this component carries no i18n keys. */
  syncLabel: string;
  syncingLabel: string;
}

/** Title row shared by platform sections: title + caption + spacer + sync button. */
export function SectionTitleBar({
  title,
  caption,
  syncing,
  onSync,
  syncLabel,
  syncingLabel,
}: SectionTitleBarProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2, flexWrap: 'wrap' }}>
      <Typography variant="h5" sx={{ flexShrink: 0 }} noWrap>
        {title}
      </Typography>

      {caption != null && (
        <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0 }}>
          {caption}
        </Typography>
      )}

      <Box sx={{ flex: 1 }} />

      <Button
        variant="contained"
        size="small"
        startIcon={
          syncing ? (
            <CircularProgress size={16} color="inherit" />
          ) : (
            <Iconify icon="solar:restart-bold" width={18} />
          )
        }
        onClick={onSync}
        disabled={syncing}
      >
        {syncing ? syncingLabel : syncLabel}
      </Button>
    </Box>
  );
}
