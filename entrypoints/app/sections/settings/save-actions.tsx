import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';

import { useTranslation } from '@/lib/i18n/use-translation';
import { formatDateTime } from '@/lib/i18n';
import { Iconify } from '../../components/iconify';

interface SaveActionsProps {
  onTest: () => void;
  testDisabled: boolean;
  testing: boolean;
  onSave: () => void;
  saveDisabled: boolean;
  saving: boolean;
  /** Persistent badge source: `settings.configSavedAt[section]`. */
  savedAt: number | undefined;
  /** Draft has connection edits that need a successful test before saving. */
  showTestHint: boolean;
}

/** Shared action row for the three AI config cards: Test → Save → saved badge. */
export function SaveActions({
  onTest,
  testDisabled,
  testing,
  onSave,
  saveDisabled,
  saving,
  savedAt,
  showTestHint,
}: SaveActionsProps) {
  const { t } = useTranslation();

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          onClick={onTest}
          disabled={testDisabled || testing}
          startIcon={testing ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {testing ? t('settings.testing') : t('settings.testConnection')}
        </Button>
        <Button
          variant="contained"
          onClick={onSave}
          disabled={saveDisabled || saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {t('settings.save')}
        </Button>
        {savedAt !== undefined && (
          <Typography
            variant="body2"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'success.main', fontWeight: 600 }}
          >
            <Iconify icon="solar:check-circle-bold" width={18} />
            {t('settings.savedAt', { time: formatDateTime(savedAt) })}
          </Typography>
        )}
      </Box>
      {showTestHint && (
        <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'warning.main' }}>
          {t('settings.testBeforeSave')}
        </Typography>
      )}
    </>
  );
}
