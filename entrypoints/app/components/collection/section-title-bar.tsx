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
  syncing?: boolean;
  /** Omit the sync trio (onSync/syncLabel/syncingLabel) to render no sync button
   *  — e.g. sources that auto-sync on mount. */
  onSync?: () => void;
  /** Pre-translated button labels — this component carries no i18n keys. */
  syncLabel?: string;
  syncingLabel?: string;
  /** Hard-disable the sync button even when not syncing (e.g. an adapter
   *  cooldown). Optional — adapters without a cooldown omit it. */
  syncDisabled?: boolean;
  /** Pre-translated label shown while `syncDisabled` (e.g. a countdown). Falls
   *  back to `syncLabel` when omitted. */
  syncDisabledLabel?: string;
}

/** Title row shared by platform sections: title + caption + spacer + optional sync button. */
export function SectionTitleBar({
  title,
  caption,
  syncing = false,
  onSync,
  syncLabel,
  syncingLabel,
  syncDisabled = false,
  syncDisabledLabel,
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

      {onSync && (
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
          disabled={syncing || syncDisabled}
        >
          {syncing ? syncingLabel : syncDisabled ? (syncDisabledLabel ?? syncLabel) : syncLabel}
        </Button>
      )}
    </Box>
  );
}
