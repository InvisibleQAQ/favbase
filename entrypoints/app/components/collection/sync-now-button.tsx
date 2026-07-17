import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';

import { Iconify } from '../iconify';

export interface SyncNowButtonProps {
  syncing: boolean;
  onSync: () => void;
  /** Pre-translated button label — this component carries no i18n keys. */
  label: string;
  /** 'contained' for the primary empty-state action, 'outlined' otherwise. */
  variant?: 'contained' | 'outlined';
}

/** Manual "sync now" button used inside empty / not-logged-in states. */
export function SyncNowButton({ syncing, onSync, label, variant = 'outlined' }: SyncNowButtonProps) {
  return (
    <Button
      variant={variant}
      onClick={onSync}
      disabled={syncing}
      startIcon={
        syncing ? (
          <CircularProgress size={16} color="inherit" />
        ) : (
          <Iconify icon="solar:restart-bold" width={18} />
        )
      }
    >
      {label}
    </Button>
  );
}
