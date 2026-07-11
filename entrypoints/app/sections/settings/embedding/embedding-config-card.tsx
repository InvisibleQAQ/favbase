import { useCallback, useState } from 'react';
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

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../../components/iconify';
import { EMBEDDING_PROVIDERS, getEmbeddingProviderDef, type EmbeddingProviderId } from '@/lib/providers';
import type { UserSettings } from '@/lib/storage';
import { deriveEmbeddingDraft, type EmbeddingDraft } from '@/lib/hooks/useSettings';
import { testEmbeddingConnection, type TestEmbeddingResult } from '@/lib/ai';
import { COMMON_EMBEDDING_DIMENSIONS, MAX_INDEXABLE_DIMENSIONS } from '@/lib/embedding';
import { useHostPermission } from '../use-host-permission';
import { permissionErrorKey } from '../permission-error';
import { useConfigDraft } from '../use-config-draft';
import { SaveActions } from '../save-actions';
import { useEmbeddingStats } from './use-embedding-stats';
import { useEmbeddingRebuild } from './use-embedding-rebuild';
import { EmbeddingStatsPanel } from './embedding-stats-panel';

// Every field affects what the probe embeds (dimensions changes the reported
// truncation), so the whole draft is connection-relevant.
const EMBEDDING_CONNECTION_KEYS = [
  'provider',
  'apiKey',
  'baseUrl',
  'model',
  'dimensions',
] as const satisfies readonly (keyof EmbeddingDraft)[];

interface EmbeddingConfigCardProps {
  settings: UserSettings;
  saveEmbedding: (draft: EmbeddingDraft) => Promise<void>;
}

export function EmbeddingConfigCard({ settings, saveEmbedding }: EmbeddingConfigCardProps) {
  const { t } = useTranslation();
  const { ensure, dialog } = useHostPermission();
  const [showKey, setShowKey] = useState(false);

  const { stats, refresh } = useEmbeddingStats();
  const {
    isRebuilding,
    progress: rebuildProgress,
    outcome: rebuildOutcome,
    error: rebuildError,
    rebuild,
  } = useEmbeddingRebuild({ settings, ensure });

  const derive = useCallback(
    (provider?: EmbeddingProviderId) => deriveEmbeddingDraft(settings, provider),
    [settings],
  );
  const runTest = useCallback(
    async (dr: EmbeddingDraft): Promise<TestEmbeddingResult> => {
      const baseUrl = dr.baseUrl || getEmbeddingProviderDef(dr.provider).baseUrl;
      const perm = await ensure(baseUrl);
      // Denial surfaces as testError via the hook's catch — same rendering as before.
      if (!perm.ok) throw new Error(t(permissionErrorKey(perm.reason)));
      return testEmbeddingConnection({
        providerId: dr.provider,
        apiKey: dr.apiKey,
        baseUrl: dr.baseUrl,
        model: dr.model,
        // Probe with the configured truncation so the reported dimension
        // matches what indexing would actually do (undefined = native dim).
        dimensions: dr.dimensions,
      });
    },
    [ensure, t],
  );
  const d = useConfigDraft<EmbeddingDraft, TestEmbeddingResult>({
    derive,
    connectionKeys: EMBEDDING_CONNECTION_KEYS,
    runTest,
    // A probe that exceeds the HNSW index limit is NOT a verification —
    // saving that config would only produce un-indexable vectors.
    acceptResult: (r) => r.dimensions <= MAX_INDEXABLE_DIMENSIONS,
    save: saveEmbedding,
  });
  const { draft, setField } = d;

  const currentDef = getEmbeddingProviderDef(draft.provider);
  const canTest = !!(draft.apiKey && draft.model);

  // The two hooks stay mutually unaware; stats refresh after a rebuild is
  // wired here.
  const handleRebuild = useCallback(() => {
    void rebuild().finally(() => void refresh());
  }, [rebuild, refresh]);

  return (
    <>
    <Card>
      <CardHeader
        title={t('settings.embeddingCard.title')}
        subheader={t('settings.embeddingCard.description')}
      />
      <CardContent>
        <Grid container spacing={3}>
          {/* Provider */}
          <Grid size={{ xs: 12 }}>
            <TextField
              select
              fullWidth
              label={t('settings.embeddingProvider')}
              value={draft.provider}
              onChange={(e) => d.switchProvider(e.target.value as EmbeddingProviderId)}
            >
              {EMBEDDING_PROVIDERS.map((p) => (
                <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
              ))}
            </TextField>
          </Grid>

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

          {/* Get Key link */}
          <Grid size={{ xs: 12, md: 6 }}>
            {currentDef.regUrl && (
              <Button
                variant="outlined"
                size="small"
                href={currentDef.regUrl}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ whiteSpace: 'nowrap', alignSelf: 'center' }}
              >
                {t('settings.getKey')}
              </Button>
            )}
          </Grid>

          {/* Base URL */}
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label={t('settings.baseUrl')}
              placeholder={currentDef.baseUrl || t('settings.customBaseUrlPlaceholder')}
              value={draft.baseUrl}
              onChange={(e) => setField('baseUrl', e.target.value)}
            />
          </Grid>

          {/* Model */}
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label={t('settings.embeddingModel')}
              placeholder={currentDef.defaultModel}
              value={draft.model}
              onChange={(e) => setField('model', e.target.value)}
            />
          </Grid>

          {/* Dimensions (optional Matryoshka truncation, preset Select) */}
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              select
              fullWidth
              label={t('settings.embedding.dimensions')}
              value={draft.dimensions ?? 'auto'}
              onChange={(e) =>
                setField('dimensions', e.target.value === 'auto' ? undefined : Number(e.target.value))
              }
              helperText={t('settings.embedding.dimensionsHelper', { limit: MAX_INDEXABLE_DIMENSIONS })}
            >
              {/* MUI Select treats '' as "no selection" and renders nothing, so
                  auto needs a real sentinel value instead of the empty string. */}
              <MenuItem value="auto">{t('settings.embedding.dimensionsAuto')}</MenuItem>
              {COMMON_EMBEDDING_DIMENSIONS.map((dim) => (
                <MenuItem key={dim} value={dim}>{dim}</MenuItem>
              ))}
            </TextField>
          </Grid>

          {/* Test Connection + Save + persistent saved badge */}
          <Grid size={{ xs: 12 }}>
            <SaveActions
              onTest={d.handleTest}
              testDisabled={!canTest}
              testing={d.isTesting}
              onSave={d.handleSave}
              saveDisabled={!d.canSave}
              saving={d.isSaving}
              savedAt={settings.configSavedAt?.embedding}
              showTestHint={d.connectionDirty && !d.verified}
            />
          </Grid>

          {d.testResult && d.testResult.dimensions <= MAX_INDEXABLE_DIMENSIONS && d.verified && (
            <Grid size={{ xs: 12 }}>
              <Alert
                severity="success"
                icon={<Iconify icon="solar:check-circle-bold" width={22} />}
              >
                {t('settings.embedding.testSuccess', { dimensions: d.testResult.dimensions })}
              </Alert>
            </Grid>
          )}

          {d.testResult && d.testResult.dimensions > MAX_INDEXABLE_DIMENSIONS && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="error">
                {t('settings.embedding.dimensionLimitError', {
                  actual: d.testResult.dimensions,
                  limit: MAX_INDEXABLE_DIMENSIONS,
                })}
              </Alert>
            </Grid>
          )}

          {d.testError && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="error">
                {t('settings.embedding.testFailed', { error: d.testError })}
              </Alert>
            </Grid>
          )}

          {/* Vector Index: coverage stats + manual rebuild of the 'chunked' backlog */}
          <Grid size={{ xs: 12 }}>
            <EmbeddingStatsPanel
              stats={stats}
              isRebuilding={isRebuilding}
              progress={rebuildProgress}
              outcome={rebuildOutcome}
              error={rebuildError}
              onRebuild={handleRebuild}
            />
          </Grid>
        </Grid>
      </CardContent>
    </Card>
    {dialog}
    </>
  );
}
