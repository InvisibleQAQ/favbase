import { useState, useCallback, useEffect, useRef } from 'react';
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
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const derive = useCallback(
    (provider?: ASRProviderId) => deriveAsrDraft(settings, provider),
    [settings],
  );
  const d = useConfigDraft<AsrDraft>({ derive, connectionKeys: ASR_CONNECTION_KEYS });
  const { draft, setField } = d;

  const currentAsrDef = getAsrProviderDef(draft.provider);

  const prevConnSigRef = useRef(d.connSig);
  useEffect(() => {
    if (prevConnSigRef.current !== d.connSig) {
      prevConnSigRef.current = d.connSig;
      setTestSuccess(false);
      setTestError(null);
    }
  }, [d.connSig]);

  // Both ASR providers use built-in domains (static host_permissions), so no
  // useHostPermission gate is needed — unlike the LLM/Embedding cards.
  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    setTestSuccess(false);
    setTestError(null);
    const testedSig = d.connSig;

    try {
      await testAsrConnection({ providerId: draft.provider, apiKey: draft.apiKey });
      setTestSuccess(true);
      d.markVerified(testedSig);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTesting(false);
    }
  }, [draft.provider, draft.apiKey, d]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await saveAsr(draft);
      d.markSaved();
    } finally {
      setIsSaving(false);
    }
  }, [saveAsr, draft, d]);

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
              onTest={handleTestConnection}
              testDisabled={!draft.apiKey}
              testing={isTesting}
              onSave={handleSave}
              saveDisabled={!d.canSave}
              saving={isSaving}
              savedAt={settings.configSavedAt?.asr}
              showTestHint={d.connectionDirty && !d.verified}
            />
          </Grid>

          {testSuccess && d.verified && (
            <Grid size={{ xs: 12 }}>
              <Alert
                severity="success"
                icon={<Iconify icon="solar:check-circle-bold" width={22} />}
              >
                {t('settings.asrTestSuccess')}
              </Alert>
            </Grid>
          )}

          {testError && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="error">
                {t('settings.testFailedDetail', { error: testError })}
              </Alert>
            </Grid>
          )}
        </Grid>
      </CardContent>
    </Card>
  );
}
