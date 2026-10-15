import { Link as RouterLink } from 'react-router-dom';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

import { formatCompactNumber } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { settingsPath } from '../../sections/settings/settings-nav';
import { Iconify } from '../iconify';
import type { TaggingBudgetHold } from '../../hooks/pipeline-segments';

export interface TaggingBudgetNoticeProps {
  /** From `useCollectionPipeline`; `null` renders nothing. */
  hold: TaggingBudgetHold | null;
}

/**
 * One passive status row in the scaffold's configuration-notice slot: automatic
 * tagging reached the daily limit the user set on their own key, how much it
 * spent today, how many items wait, and a link to raise the limit (docs/41 D8).
 *
 * Deliberately not the Configuration Blocker (docs/41 §3 rule 5): no Alert, no
 * warning colors, no `configurationBlocker.*` copy — nothing is misconfigured,
 * the user's own guard did its job. No `?resume=`: every LLM save already
 * resumes Tags on every platform.
 */
export function TaggingBudgetNotice({ hold }: TaggingBudgetNoticeProps) {
  // Subscribes to locale changes for `formatCompactNumber` as well.
  const { t } = useTranslation();
  if (!hold) return null;

  return (
    <Box
      role="status"
      data-tagging-budget-notice
      sx={{
        display: 'flex',
        alignItems: { xs: 'flex-start', sm: 'center' },
        flexDirection: { xs: 'column', sm: 'row' },
        gap: { xs: 0.5, sm: 1 },
        minWidth: 0,
        mb: 3,
      }}
    >
      {/* Two sentences on two lines: no separator to get wrong between zh and en. */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('taggingBudget.reached', { spent: formatCompactNumber(hold.spent) })}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('taggingBudget.pending', { count: hold.pending })}
        </Typography>
      </Box>
      {/* Inline-link role (ui-design-system §7): text variant, `text.accent` ink. */}
      <Button
        component={RouterLink}
        to={settingsPath('ai/llm')}
        color="primary"
        size="small"
        startIcon={<Iconify icon="solar:settings-bold-duotone" width={16} />}
        sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
      >
        {t('taggingBudget.adjust')}
      </Button>
    </Box>
  );
}
