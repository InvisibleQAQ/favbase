import { useCallback, useEffect, useRef, useState } from 'react';
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
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import { varAlpha } from 'minimal-shared/utils';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { EMBEDDING_PROVIDERS, getEmbeddingProviderDef, type EmbeddingProviderId } from '@/lib/providers';
import type { UserSettings } from '@/lib/storage';
import { deriveEmbeddingDraft, type EmbeddingDraft } from '@/lib/hooks/useSettings';
import { testEmbeddingConnection } from '@/lib/ai';
import { initDbProxy } from '@/lib/database';
import {
  COMMON_EMBEDDING_DIMENSIONS,
  MAX_INDEXABLE_DIMENSIONS,
  getEmbeddingStats,
  rebuildPendingEmbeddings,
  resolveEmbeddingConfig,
  type EmbeddingStats,
  type RebuildOutcome,
  type RebuildProgress,
} from '@/lib/embedding';
import { useHostPermission } from './use-host-permission';
import { permissionErrorKey } from './permission-error';
import { useConfigDraft } from './use-config-draft';
import { SaveActions } from './save-actions';

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

  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testDimensions, setTestDimensions] = useState<number | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const [stats, setStats] = useState<EmbeddingStats | null>(null);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [rebuildProgress, setRebuildProgress] = useState<RebuildProgress | null>(null);
  const [rebuildOutcome, setRebuildOutcome] = useState<RebuildOutcome | null>(null);
  const [rebuildError, setRebuildError] = useState<string | null>(null);

  const derive = useCallback(
    (provider?: EmbeddingProviderId) => deriveEmbeddingDraft(settings, provider),
    [settings],
  );
  const d = useConfigDraft<EmbeddingDraft>({ derive, connectionKeys: EMBEDDING_CONNECTION_KEYS });
  const { draft, setField } = d;

  const currentDef = getEmbeddingProviderDef(draft.provider);

  // `initDbProxy()` is idempotent (joins main.tsx's in-flight init), so this
  // waits for DB readiness instead of racing `getDb()` on first paint.
  const fetchStats = useCallback(async (): Promise<EmbeddingStats | null> => {
    try {
      const db = await initDbProxy();
      return await getEmbeddingStats(db);
    } catch (err) {
      console.error('[settings] embedding stats load failed:', err);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchStats().then((s) => {
      if (!cancelled && s) setStats(s);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchStats]);

  // Stale test feedback never survives a connection-field edit (which here is
  // any field — the whole draft is connection-relevant).
  const prevConnSigRef = useRef(d.connSig);
  useEffect(() => {
    if (prevConnSigRef.current !== d.connSig) {
      prevConnSigRef.current = d.connSig;
      setTestDimensions(null);
      setTestError(null);
    }
  }, [d.connSig]);

  const canTest = !!(draft.apiKey && draft.model);

  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    setTestDimensions(null);
    setTestError(null);
    const testedSig = d.connSig;

    try {
      const baseUrl = draft.baseUrl || currentDef.baseUrl;
      const perm = await ensure(baseUrl);
      if (!perm.ok) {
        setTestError(t(permissionErrorKey(perm.reason)));
        return;
      }
      const result = await testEmbeddingConnection({
        providerId: draft.provider,
        apiKey: draft.apiKey,
        baseUrl: draft.baseUrl,
        model: draft.model,
        // Probe with the configured truncation so the reported dimension
        // matches what indexing would actually do (undefined = native dim).
        dimensions: draft.dimensions,
      });
      setTestDimensions(result.dimensions);
      // A probe that exceeds the HNSW index limit is NOT a verification —
      // saving that config would only produce un-indexable vectors.
      if (result.dimensions <= MAX_INDEXABLE_DIMENSIONS) {
        d.markVerified(testedSig);
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTesting(false);
    }
  }, [draft, d, currentDef.baseUrl, ensure, t]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await saveEmbedding(draft);
      d.markSaved();
    } finally {
      setIsSaving(false);
    }
  }, [saveEmbedding, draft, d]);

  // Manual rebuild: re-embed the 'chunked' backlog in this page's context.
  // It always runs against the SAVED config (what indexing actually uses),
  // never the unsaved draft. Failure stops the loop (finished items stay
  // 'embedded'), so clicking again resumes with only the remainder.
  const handleRebuild = useCallback(async () => {
    setIsRebuilding(true);
    setRebuildProgress(null);
    setRebuildOutcome(null);
    setRebuildError(null);

    try {
      const saved = resolveEmbeddingConfig(settings);
      // Not-configured is decidable locally (same `enabled` derivation the
      // rebuild uses internally) — bail out before popping a host-permission
      // dialog for a provider that cannot embed anything anyway.
      if (!saved.enabled) {
        setRebuildOutcome({ status: 'not-configured' });
        return;
      }
      // Same CORS gate as the test-connection button: embeds are fetches from
      // this page, so the (custom) API origin must be granted first.
      const perm = await ensure(saved.baseUrl);
      if (!perm.ok) {
        setRebuildError(t(permissionErrorKey(perm.reason)));
        return;
      }
      const db = await initDbProxy();
      const outcome = await rebuildPendingEmbeddings(db, undefined, setRebuildProgress);
      setRebuildOutcome(outcome);
    } catch (err) {
      setRebuildError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRebuilding(false);
      void fetchStats().then((s) => s && setStats(s));
    }
  }, [settings, ensure, fetchStats, t]);

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
              onTest={handleTestConnection}
              testDisabled={!canTest}
              testing={isTesting}
              onSave={handleSave}
              saveDisabled={!d.canSave}
              saving={isSaving}
              savedAt={settings.configSavedAt?.embedding}
              showTestHint={d.connectionDirty && !d.verified}
            />
          </Grid>

          {testDimensions !== null && testDimensions <= MAX_INDEXABLE_DIMENSIONS && d.verified && (
            <Grid size={{ xs: 12 }}>
              <Alert
                severity="success"
                icon={<Iconify icon="solar:check-circle-bold" width={22} />}
              >
                {t('settings.embedding.testSuccess', { dimensions: testDimensions })}
              </Alert>
            </Grid>
          )}

          {testDimensions !== null && testDimensions > MAX_INDEXABLE_DIMENSIONS && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="error">
                {t('settings.embedding.dimensionLimitError', {
                  actual: testDimensions,
                  limit: MAX_INDEXABLE_DIMENSIONS,
                })}
              </Alert>
            </Grid>
          )}

          {testError && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="error">
                {t('settings.embedding.testFailed', { error: testError })}
              </Alert>
            </Grid>
          )}

          {/* Vector Index: coverage stats + manual rebuild of the 'chunked' backlog */}
          <Grid size={{ xs: 12 }}>
            <Divider sx={{ my: 1 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2, mb: 2 }}>
              <Iconify icon="solar:database-bold-duotone" width={22} />
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {t('settings.embedding.vectorIndex')}
              </Typography>
            </Box>

            <Grid container spacing={2} sx={{ mb: 2 }}>
              {[
                {
                  label: t('settings.embedding.indexedCount'),
                  value: stats ? String(stats.embeddedChunks) : '—',
                },
                {
                  label: t('settings.embedding.totalChunks'),
                  value: stats ? String(stats.totalChunks) : '—',
                },
              ].map((stat) => (
                <Grid key={stat.label} size={{ xs: 6 }}>
                  <Box
                    sx={(theme) => ({
                      p: 2,
                      borderRadius: 2,
                      bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.08),
                    })}
                  >
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {stat.label}
                    </Typography>
                    <Typography variant="h6">{stat.value}</Typography>
                  </Box>
                </Grid>
              ))}
            </Grid>

            <Button
              variant="outlined"
              size="small"
              onClick={handleRebuild}
              disabled={isRebuilding}
              startIcon={
                isRebuilding ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <Iconify icon="solar:restart-bold" width={18} />
                )
              }
            >
              {t('settings.embedding.rebuild')}
            </Button>

            {isRebuilding && (
              <Box sx={{ mt: 2 }}>
                <LinearProgress
                  variant={rebuildProgress ? 'determinate' : 'indeterminate'}
                  value={
                    rebuildProgress && rebuildProgress.total > 0
                      ? (rebuildProgress.completed / rebuildProgress.total) * 100
                      : 0
                  }
                />
                {rebuildProgress && (
                  <Typography
                    variant="caption"
                    sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}
                  >
                    {t('settings.embedding.rebuildProgress', {
                      completed: rebuildProgress.completed,
                      total: rebuildProgress.total,
                    })}
                  </Typography>
                )}
              </Box>
            )}

            {rebuildOutcome?.status === 'completed' && (
              <Alert severity="success" sx={{ mt: 2 }}>
                {rebuildOutcome.total === 0
                  ? t('settings.embedding.rebuildNoPending')
                  : t('settings.embedding.rebuildDone', { count: rebuildOutcome.total })}
              </Alert>
            )}

            {rebuildOutcome?.status === 'not-configured' && (
              <Alert severity="info" sx={{ mt: 2 }}>
                {t('settings.embedding.rebuildNotConfigured')}
              </Alert>
            )}

            {rebuildError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {t('settings.embedding.rebuildFailed', { error: rebuildError })}
              </Alert>
            )}
          </Grid>
        </Grid>
      </CardContent>
    </Card>
    {dialog}
    </>
  );
}
