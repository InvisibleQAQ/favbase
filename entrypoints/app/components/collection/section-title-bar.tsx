import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';

import { Iconify } from '../iconify';

export interface SectionTitleBarProps {
  /** h5 title (rendered as the page's h1) — pass a <Skeleton> while loading. */
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
   *  cooldown or the library gate). Optional — adapters without it omit it. */
  syncDisabled?: boolean;
  /** Pre-translated label shown while `syncDisabled` (e.g. a countdown). Falls
   *  back to `syncLabel` when omitted. */
  syncDisabledLabel?: string;
  /** Pre-translated tooltip explaining WHY the button is disabled (e.g. the
   *  library-gate pause hint). Rendered only while `syncDisabled`. */
  syncDisabledTooltip?: string;
}

/**
 * Title row shared by platform sections: title + caption + spacer + optional
 * sync button. The title keeps its h5 look but is the page's single h1.
 */
export function SectionTitleBar({
  title,
  caption,
  syncing = false,
  onSync,
  syncLabel,
  syncingLabel,
  syncDisabled = false,
  syncDisabledLabel,
  syncDisabledTooltip,
}: SectionTitleBarProps) {
  const syncButton = onSync ? (
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
  ) : null;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2, flexWrap: 'wrap' }}>
      <Typography variant="h5" component="h1" sx={{ flexShrink: 0 }} noWrap>
        {title}
      </Typography>

      {caption != null && (
        <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0 }}>
          {caption}
        </Typography>
      )}

      <Box sx={{ flex: 1 }} />

      {syncButton != null &&
        (syncDisabled && syncDisabledTooltip ? (
          // MUI Tooltip needs a focusable wrapper around a disabled Button.
          <Tooltip title={syncDisabledTooltip}>
            <Box component="span" sx={{ display: 'inline-flex' }}>
              {syncButton}
            </Box>
          </Tooltip>
        ) : (
          syncButton
        ))}
    </Box>
  );
}
