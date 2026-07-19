import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';

import { useTranslation } from '@/lib/i18n/use-translation';

import { useRunningJobCount } from '../../hooks/background-jobs-store';

/**
 * Global "background work in progress — don't close this page" reminder. Lives in
 * the always-mounted dashboard header, so it stays visible across every route
 * while any platform's sync/embed/tag job runs (the jobs themselves survive route
 * switches via the module-level backgroundJobs store; this only surfaces them).
 * Renders nothing when idle.
 */
export function BackgroundJobsIndicator() {
  const { t } = useTranslation();
  const count = useRunningJobCount();

  if (count === 0) return null;

  const label = t('backgroundJobs.reminder', { count });

  return (
    <Tooltip title={label}>
      <Chip
        size="small"
        color="warning"
        variant="outlined"
        icon={<CircularProgress size={12} color="inherit" />}
        label={label}
        sx={{
          maxWidth: { xs: 160, sm: 320 },
          '& .MuiChip-label': {
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        }}
      />
    </Tooltip>
  );
}
