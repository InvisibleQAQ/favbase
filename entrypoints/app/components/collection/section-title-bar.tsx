import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';

import { Iconify } from '../iconify';

export interface SectionTitleBarProps {
  /** Route title — the page's single h1. Pass a <Skeleton> while loading. */
  title: ReactNode;
  /** Secondary line under the title (count / last-synced); omit to hide. */
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
 * Route heading shared by every collection page: h1 with its caption stacked
 * beneath, and the page's one contained action on the right. Reads first
 * (title → status → control) before any content row.
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
    <Box
      data-section="title"
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 2,
        flexWrap: 'wrap',
        mb: 3,
      }}
    >
      <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
        <Typography variant="h1" sx={{ wordBreak: 'break-word' }}>
          {title}
        </Typography>

        {caption != null && (
          <Typography data-slot="caption" variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {caption}
          </Typography>
        )}
      </Box>

      {syncButton != null &&
        (syncDisabled && syncDisabledTooltip ? (
          // MUI Tooltip needs a focusable wrapper around a disabled Button.
          <Tooltip title={syncDisabledTooltip}>
            <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0 }}>
              {syncButton}
            </Box>
          </Tooltip>
        ) : (
          <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0 }}>
            {syncButton}
          </Box>
        ))}
    </Box>
  );
}
