import { useState, useCallback, useEffect, useRef } from 'react';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Autocomplete from '@mui/material/Autocomplete';

import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import Divider from '@mui/material/Divider';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { LLM_PROVIDERS, getProviderDef, type LLMProviderId } from '@/lib/providers';
import type { UserSettings } from '@/lib/storage';
import { deriveLlmDraft, type LlmDraft } from '@/lib/hooks/useSettings';
import { testLlmConnection, fetchAvailableModels, type TestConnectionResult } from '@/lib/ai';
import { useHostPermission } from './use-host-permission';
import { permissionErrorKey } from './permission-error';
import { useConfigDraft } from './use-config-draft';
import { SaveActions } from './save-actions';

const LLM_CONNECTION_KEYS = [
  'provider',
  'apiKey',
  'model',
  'customBaseUrl',
  'customProtocol',
] as const satisfies readonly (keyof LlmDraft)[];

interface LlmConfigCardProps {
  settings: UserSettings;
  saveLlm: (draft: LlmDraft) => Promise<void>;
}

export function LlmConfigCard({ settings, saveLlm }: LlmConfigCardProps) {
  const { t } = useTranslation();
  const { ensure, dialog } = useHostPermission();
  const [showKey, setShowKey] = useState(false);

  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);

  const derive = useCallback(
    (provider?: LLMProviderId) => deriveLlmDraft(settings, provider),
    [settings],
  );
  const runTest = useCallback(
    async (dr: LlmDraft): Promise<TestConnectionResult> => {
      const baseUrl = dr.provider === 'custom' ? dr.customBaseUrl : getProviderDef(dr.provider).baseUrl;
      const perm = await ensure(baseUrl);
      // Denial surfaces as testError via the hook's catch — same rendering as before.
      if (!perm.ok) throw new Error(t(permissionErrorKey(perm.reason)));
      return testLlmConnection({
        providerId: dr.provider,
        apiKey: dr.apiKey,
        model: dr.model,
        customBaseUrl: dr.customBaseUrl,
        customProtocol: dr.customProtocol,
      });
    },
    [ensure, t],
  );
  const d = useConfigDraft<LlmDraft, TestConnectionResult>({
    derive,
    connectionKeys: LLM_CONNECTION_KEYS,
    runTest,
    save: saveLlm,
  });
  const { draft, setField } = d;

  const currentProviderDef = getProviderDef(draft.provider);
  const isCustomProvider = draft.provider === 'custom';

  // The fetched model list follows the provider (test alerts follow the
  // connection signature inside useConfigDraft).
  const prevProviderRef = useRef(draft.provider);
  useEffect(() => {
    if (prevProviderRef.current !== draft.provider) {
      prevProviderRef.current = draft.provider;
      setRemoteModels([]);
      setModelFetchError(null);
    }
  }, [draft.provider]);

  const handleFetchModels = useCallback(async () => {
    setIsFetchingModels(true);
    setModelFetchError(null);

    try {
      const baseUrl = isCustomProvider ? draft.customBaseUrl : currentProviderDef.baseUrl;
      const perm = await ensure(baseUrl);
      if (!perm.ok) {
        setModelFetchError(t(permissionErrorKey(perm.reason)));
        return;
      }
      const result = await fetchAvailableModels({
        providerId: draft.provider,
        apiKey: draft.apiKey,
        customBaseUrl: draft.customBaseUrl,
      });
      setRemoteModels(result.models);
    } catch (err) {
      setModelFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsFetchingModels(false);
    }
  }, [draft.provider, draft.apiKey, draft.customBaseUrl, isCustomProvider, currentProviderDef.baseUrl, ensure, t]);

  const canTest = !!(draft.apiKey && draft.model);

  return (
    <>
    <Card>
      <CardHeader
        title={t('settings.llmCard.title')}
        subheader={t('settings.llmCard.description')}
      />
      <CardContent>
        <Grid container spacing={3}>
          {/* Provider */}
          <Grid size={{ xs: 12 }}>
            <TextField
              select
              fullWidth
              label={t('settings.llmProvider')}
              value={draft.provider}
              onChange={(e) => d.switchProvider(e.target.value as LLMProviderId)}
            >
              {LLM_PROVIDERS.map((p) => (
                <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
              ))}
            </TextField>
          </Grid>

          {/* Base URL */}
          <Grid size={{ xs: 12, md: isCustomProvider ? 6 : 12 }}>
            <TextField
              fullWidth
              label={t('settings.baseUrl')}
              placeholder={t('settings.customBaseUrlPlaceholder')}
              value={isCustomProvider ? draft.customBaseUrl : currentProviderDef.baseUrl}
              onChange={isCustomProvider ? (e) => setField('customBaseUrl', e.target.value) : undefined}
              slotProps={{
                input: { readOnly: !isCustomProvider },
              }}
              sx={!isCustomProvider ? (theme) => ({ '& .MuiInputBase-input': { color: theme.vars.palette.text.secondary } }) : undefined}
            />
          </Grid>

          {isCustomProvider && (
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                select
                fullWidth
                label={t('settings.customProtocol')}
                value={draft.customProtocol}
                onChange={(e) => setField('customProtocol', e.target.value as 'openai' | 'claude')}
              >
                <MenuItem value="openai">OpenAI</MenuItem>
                <MenuItem value="claude">Claude</MenuItem>
              </TextField>
            </Grid>
          )}

          {/* API Key */}
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label={t('settings.apiKey')}
              type={showKey ? 'text' : 'password'}
              placeholder="sk-..."
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
            <Box sx={{ display: 'flex', gap: 1 }}>
              {currentProviderDef.regUrl && (
                <Button
                  variant="outlined"
                  size="small"
                  href={currentProviderDef.regUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ whiteSpace: 'nowrap', alignSelf: 'center' }}
                >
                  {t('settings.getKey')}
                </Button>
              )}
            </Box>
          </Grid>

          {/* Model with Autocomplete */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Autocomplete
              freeSolo
              options={remoteModels}
              value={draft.model}
              onInputChange={(_e, value) => setField('model', value)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t('settings.model')}
                  placeholder={currentProviderDef.defaultModel || t('settings.modelPlaceholder')}
                />
              )}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Button
              variant="outlined"
              onClick={handleFetchModels}
              disabled={isFetchingModels || !draft.apiKey}
              startIcon={isFetchingModels ? <CircularProgress size={16} /> : undefined}
              sx={{ height: 56 }}
            >
              {isFetchingModels ? t('settings.fetchingModels') : t('settings.fetchModels')}
            </Button>
          </Grid>

          {remoteModels.length > 0 && (
            <Grid size={{ xs: 12 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t('settings.fetchModelsSuccess', { count: remoteModels.length })}
              </Typography>
            </Grid>
          )}

          {modelFetchError && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="error" variant="outlined">
                {t('settings.fetchModelsFailedDetail', { error: modelFetchError })}
              </Alert>
            </Grid>
          )}

          {/* Test Connection + Save + persistent saved badge */}
          <Grid size={{ xs: 12 }}>
            <SaveActions
              onTest={d.handleTest}
              testDisabled={!canTest}
              testing={d.isTesting}
              onSave={d.handleSave}
              saveDisabled={!d.canSave}
              saving={d.isSaving}
              savedAt={settings.configSavedAt?.llm}
              showTestHint={d.connectionDirty && !d.verified}
            />
          </Grid>

          {d.testResult && d.verified && (
            <Grid size={{ xs: 12 }}>
              <Alert
                severity="success"
                icon={<Iconify icon="solar:check-circle-bold" width={22} />}
              >
                {t('settings.testSuccessDetail', { message: d.testResult.message })}
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

          {/* Advanced Settings */}
          <Grid size={{ xs: 12 }}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle1" sx={{ mt: 2, mb: 1, fontWeight: 600 }}>
              {t('settings.advancedCard.title')}
            </Typography>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label={t('settings.temperatureLabel')}
              type="number"
              value={draft.temperature}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v >= 0 && v <= 2) setField('temperature', v);
              }}
              helperText={t('settings.temperatureDesc')}
              slotProps={{
                htmlInput: { step: 0.1, min: 0, max: 2 },
              }}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label={t('settings.maxTokens')}
              type="number"
              value={draft.maxTokens}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v > 0) setField('maxTokens', v);
              }}
              helperText={t('settings.maxTokensDesc')}
              slotProps={{
                htmlInput: { min: 1, step: 100 },
              }}
            />
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('settings.mode')}
              </Typography>
              <ToggleButtonGroup
                exclusive
                value={draft.prefMode}
                onChange={(_e, val) => { if (val) setField('prefMode', val); }}
                sx={{ gap: 1 }}
              >
                <ToggleButton value="quality" sx={{ px: 3 }}>
                  <Box sx={{ textAlign: 'left' }}>
                    <Typography variant="subtitle2">{t('settings.modeQuality')}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {t('settings.modeQualityDesc')}
                    </Typography>
                  </Box>
                </ToggleButton>
                <ToggleButton value="efficiency" sx={{ px: 3 }}>
                  <Box sx={{ textAlign: 'left' }}>
                    <Typography variant="subtitle2">{t('settings.modeEfficiency')}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {t('settings.modeEfficiencyDesc')}
                    </Typography>
                  </Box>
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
    {dialog}
    </>
  );
}
