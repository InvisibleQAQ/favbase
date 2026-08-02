import { Link as RouterLink } from 'react-router-dom';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { ProcessingCoverage } from '@/lib/collections';
import type { CollectionPlatform } from '@/lib/collections/platforms';
import { resolveEmbeddingConfig } from '@/lib/embedding/config';
import { useSettings } from '@/lib/hooks/useSettings';
import { useTranslation } from '@/lib/i18n/use-translation';
import { resolveAsrConfig, resolveLlmConfig } from '@/lib/storage/resolve';

import { Iconify } from '../iconify';
import type { ProcessingCoverageStatus } from '../../hooks/pipeline-segments';

export type ConfigurationCapability = 'asr' | 'embedding' | 'llm';

export interface ConfigurationBlocker {
  capability: ConfigurationCapability;
  pending?: number;
}

export interface DeriveConfigurationBlockersInput {
  coverage: ProcessingCoverage;
  coverageStatus: ProcessingCoverageStatus;
  asrBlocked: boolean;
  asrConfigured: boolean;
  embeddingConfigured: boolean;
  llmConfigured: boolean;
}

export function deriveConfigurationBlockers({
  coverage,
  coverageStatus,
  asrBlocked,
  asrConfigured,
  embeddingConfigured,
  llmConfigured,
}: DeriveConfigurationBlockersInput): ConfigurationBlocker[] {
  const blockers: ConfigurationBlocker[] = [];
  if (asrBlocked && !asrConfigured) blockers.push({ capability: 'asr' });
  if (coverageStatus !== 'ready') return blockers;

  const embeddingPending = (coverage.embedding.total ?? 0) - coverage.embedding.done;
  if (!embeddingConfigured && embeddingPending > 0) {
    blockers.push({ capability: 'embedding', pending: embeddingPending });
  }

  const taggingPending = (coverage.tagging.total ?? 0) - coverage.tagging.done;
  if (!llmConfigured && taggingPending > 0) {
    blockers.push({ capability: 'llm', pending: taggingPending });
  }
  return blockers;
}

export interface CollectionConfigurationNoticeProps {
  platform: CollectionPlatform;
  coverage: ProcessingCoverage;
  coverageStatus: ProcessingCoverageStatus;
  asrBlocked?: boolean;
}

export function CollectionConfigurationNotice({
  platform,
  coverage,
  coverageStatus,
  asrBlocked = false,
}: CollectionConfigurationNoticeProps) {
  const { settings, loading } = useSettings();
  const { t } = useTranslation();
  const blockers = loading
    ? []
    : deriveConfigurationBlockers({
        coverage,
        coverageStatus,
        asrBlocked,
        asrConfigured: Boolean(resolveAsrConfig(settings).apiKey),
        embeddingConfigured: resolveEmbeddingConfig(settings).enabled,
        llmConfigured: resolveLlmConfig(settings).enabled,
      });

  if (blockers.length === 0) return null;

  return (
    <Alert
      severity="warning"
      variant="outlined"
      sx={{ mb: 2, alignItems: 'flex-start', '& .MuiAlert-message': { width: '100%' } }}
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
            <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
              {blocker.capability === 'asr'
                ? t('configurationBlocker.asr')
                : t(`configurationBlocker.${blocker.capability}`, {
                    count: blocker.pending ?? 0,
                  })}
            </Typography>
            <Button
              component={RouterLink}
              to={`/settings?section=${blocker.capability}&resume=${platform}`}
              color="warning"
              size="small"
              startIcon={<Iconify icon="solar:settings-bold-duotone" width={16} />}
              sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              {t(`configurationBlocker.configure.${blocker.capability}`)}
            </Button>
          </Box>
        ))}
      </Stack>
    </Alert>
  );
}
