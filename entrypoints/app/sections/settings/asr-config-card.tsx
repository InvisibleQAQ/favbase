import { useState, useCallback } from 'react';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { ASR_PROVIDERS, getAsrProviderDef, type ASRProviderId } from '@/lib/providers';
import type { UserSettings } from '@/lib/storage';
import { deriveAsrDraft, type AsrDraft } from '@/lib/hooks/useSettings';
import { testAsrConnection } from '@/lib/ai';
import { useConfigDraft } from './use-config-draft';
import { SaveActions } from './save-actions';

// `model` is deliberately not connection-relevant: the /models probe validates
// the credential, not a model name — editing the model never invalidates a test.
const ASR_CONNECTION_KEYS = ['provider', 'apiKey'] as const satisfies readonly (keyof AsrDraft)[];

interface AsrConfigCardProps {
  settings: UserSettings;
  saveAsr: (draft: AsrDraft) => Promise<void>;
}

export function AsrConfigCard({ settings, saveAsr }: AsrConfigCardProps) {
  const { t } = useTranslation();
  const [showKey, setShowKey] = useState(false);

  const derive = useCallback(
    (provider?: ASRProviderId) => deriveAsrDraft(settings, provider),
    [settings],
  );
  // Both ASR providers use built-in domains (static host_permissions), so no
  // useHostPermission gate is needed — unlike the LLM/Embedding cards.
  const runTest = useCallback(async (dr: AsrDraft) => {
    await testAsrConnection({ providerId: dr.provider, apiKey: dr.apiKey });
    return true as const;
  }, []);
  const d = useConfigDraft<AsrDraft, boolean>({
    derive,
    connectionKeys: ASR_CONNECTION_KEYS,
    runTest,
    save: saveAsr,
  });
  const { draft, setField } = d;

  const currentAsrDef = getAsrProviderDef(draft.provider);

  return (
    <Card>
      <CardHeader
        title={t('settings.asrCard.title')}
        subheader={t('settings.asrCard.description')}
      />
      <CardContent>
        <Grid container spacing={3}>
          <Grid size={{ xs: 12 }}>
            <TextField
              select
              fullWidth
              label={t('settings.asrProvider')}
              value={draft.provider}
              onChange={(e) => d.switchProvider(e.target.value as ASRProviderId)}
            >
              {ASR_PROVIDERS.map((p) => (
                <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label={t('settings.apiKey')}
              type={showKey ? 'text' : 'password'}
              placeholder={t('settings.apiKeyPlaceholder')}
              value={draft.apiKey}
              onChange={(e) => setField('apiKey', e.target.value)}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        edge="end"
                        onClick={() => setShowKey((v) => !v)}
                        size="small"
                      >
                        <Iconify
                          icon={showKey ? 'solar:eye-bold' : 'solar:eye-closed-bold'}
                          width={20}
                        />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label={t('settings.model')}
              placeholder={currentAsrDef.defaultModel}
              value={draft.model}
              onChange={(e) => setField('model', e.target.value)}
            />
          </Grid>

          <Grid size={{ xs: 12 }}>
            <SaveActions
              onTest={d.handleTest}
              testDisabled={!draft.apiKey}
              testing={d.isTesting}
              onSave={d.handleSave}
              saveDisabled={!d.canSave}
              saving={d.isSaving}
              savedAt={settings.configSavedAt?.asr}
              showTestHint={d.connectionDirty && !d.verified}
            />
          </Grid>

          {d.testResult && d.verified && (
            <Grid size={{ xs: 12 }}>
              <Alert
                severity="success"
                icon={<Iconify icon="solar:check-circle-bold" width={22} />}
              >
                {t('settings.asrTestSuccess')}
              </Alert>
            </Grid>
          )}

          {d.testError && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="error">
                {t('settings.testFailedDetail', { error: d.testError })}
              </Alert>
            </Grid>
          )}
        </Grid>
      </CardContent>
    </Card>
  );
}
