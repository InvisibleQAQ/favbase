import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';

export interface SyncProgressBarProps {
  /** 0–100 for a determinate bar; null/undefined renders indeterminate. */
  value?: number | null;
  /** Pre-translated progress caption (fetched count / cursor); omit to hide. */
  caption?: ReactNode;
}

/** Sync progress bar below the title bar. Determinate for bounded pagination,
 *  indeterminate for cursor pagination. */
export function SyncProgressBar({ value, caption }: SyncProgressBarProps) {
  return (
    <Box sx={{ mb: 2.5 }}>
      <LinearProgress
        variant={value == null ? 'indeterminate' : 'determinate'}
        value={value ?? undefined}
        sx={{ mb: 0.5, borderRadius: 0.5 }}
      />
      {caption != null && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {caption}
        </Typography>
      )}
    </Box>
  );
}
