import { Link as RouterLink } from 'react-router-dom';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { varAlpha } from 'minimal-shared/utils';

import {
  deriveConfigurationBlockers,
  type ProcessingCoverage,
  type TranscribePrerequisite,
} from '@/lib/collections';
import type { CollectionPlatform } from '@/lib/collections/platforms';
import { resolveEmbeddingConfig } from '@/lib/embedding/config';
import { useSettings } from '@/lib/hooks/useSettings';
import { useTranslation } from '@/lib/i18n/use-translation';
// Pure data (locale keys), like settings-nav: the platform's display name is a
// parameter of the copy, never a literal here.
import { PLATFORM_META } from '../../collection-platform-registry';
import { settingsPath } from '../../sections/settings/settings-nav';
import { resolveAsrConfig, resolveLlmConfig } from '@/lib/storage/resolve';

import { Iconify } from '../iconify';
import type { ProcessingCoverageStatus } from '../../hooks/pipeline-segments';

export interface CollectionConfigurationNoticeProps {
  platform: CollectionPlatform;
  coverage: ProcessingCoverage;
  coverageStatus: ProcessingCoverageStatus;
  /** The platform transcription state machine's wait signal (`AutoTranscribeState.prerequisiteBlocked`). */
  prerequisiteBlocked?: TranscribePrerequisite | null;
}

/**
 * Full-width configuration banner rendered right after the page search: a
 * title, one line per blocker and a Configure link for each provider blocker.
 * A `'platform-tab'` blocker is one line of copy and no link — nothing in
 * Settings fixes it; the user acts on the platform's own tab. A passive
 * `role="status"` region — never an alert: it describes the library, it does
 * not interrupt the user. Colors follow the catalog-card tokens: `warning.lighter`
 * ground (alpha wash in dark), ink text, `text.accent` links and icon — no coral
 * text, no white-on-coral.
 */
export function CollectionConfigurationNotice({
  platform,
  coverage,
  coverageStatus,
  prerequisiteBlocked = null,
}: CollectionConfigurationNoticeProps) {
  const { settings, loading } = useSettings();
  const { t } = useTranslation();
  const blockers = loading
    ? []
    : deriveConfigurationBlockers({
        coverage: coverageStatus === 'ready' ? coverage : null,
        prerequisiteBlocked,
        asrConfigured: Boolean(resolveAsrConfig(settings).apiKey),
        embeddingConfigured: resolveEmbeddingConfig(settings).enabled,
        llmConfigured: resolveLlmConfig(settings).enabled,
      });

  if (blockers.length === 0) return null;

  return (
    <Alert
      role="status"
      severity="warning"
      variant="outlined"
      sx={(theme) => ({
        mb: 2,
        alignItems: 'flex-start',
        color: theme.vars.palette.text.primary,
        backgroundColor: theme.vars.palette.warning.lighter,
        borderColor: theme.vars.palette.warning.light,
        '& .MuiAlert-icon': { color: theme.vars.palette.text.accent },
        '& .MuiAlert-message': { width: '100%' },
        ...theme.applyStyles('dark', {
          backgroundColor: varAlpha(theme.vars.palette.warning.mainChannel, 0.16),
        }),
      })}
    >
      <Typography variant="subtitle2" sx={{ mb: 0.75, fontWeight: 700 }}>
        {t('configurationBlocker.title')}
      </Typography>
      <Stack spacing={0.5}>
        {blockers.map((blocker) => (
          <Box
            key={blocker.capability}
            sx={{
              display: 'flex',
              alignItems: { xs: 'flex-start', sm: 'center' },
              flexDirection: { xs: 'column', sm: 'row' },
              gap: { xs: 0.25, sm: 1 },
              minWidth: 0,
            }}
          >
            {blocker.capability === 'platform-tab' ? (
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                {t('configurationBlocker.platformTab', { platform: t(PLATFORM_META[platform].title) })}
              </Typography>
            ) : (
              <>
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                  {blocker.capability === 'asr'
                    ? t('configurationBlocker.asr')
                    : t(`configurationBlocker.${blocker.capability}`, {
                        count: blocker.pending ?? 0,
                      })}
                </Typography>
                <Button
                  component={RouterLink}
                  to={`${settingsPath(`ai/${blocker.capability}`)}?resume=${platform}`}
                  size="small"
                  startIcon={<Iconify icon="solar:settings-bold-duotone" width={16} />}
                  sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                >
                  {t(`configurationBlocker.configure.${blocker.capability}`)}
                </Button>
              </>
            )}
          </Box>
        ))}
      </Stack>
    </Alert>
  );
}
