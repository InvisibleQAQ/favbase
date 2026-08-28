import Button from '@mui/material/Button';

import { Iconify } from '../iconify';
import { StateBox } from './state-box';

export interface ErrorStateProps {
  /** Pre-translated failure heading (e.g. "Load failed"). */
  title: string;
  /** Error detail line — already localized by the caller. */
  message: string;
  /** Pre-translated retry button label. */
  retryLabel: string;
  onRetry: () => void;
}

/** Dashed error box with a retry action — shared query/sync failure state. */
export function ErrorState({ title, message, retryLabel, onRetry }: ErrorStateProps) {
  return (
    <StateBox
      icon={
        <Iconify icon="solar:danger-triangle-bold-duotone" width={48} sx={{ color: 'error.main' }} />
      }
      title={title}
      description={message}
      action={
        <Button variant="outlined" onClick={onRetry}>
          {retryLabel}
        </Button>
      }
    />
  );
}
