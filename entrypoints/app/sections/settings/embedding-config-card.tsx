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
import { EMBEDDING_PROVIDERS, type EmbeddingProviderId, type EmbeddingProviderDef } from '@/lib/providers';
import type { EmbeddingUpdate } from '@/lib/hooks/useSettings';
import { testEmbeddingConnection } from '@/lib/ai';
import { initDbProxy } from '@/lib/database';
import {
  COMMON_EMBEDDING_DIMENSIONS,
  MAX_INDEXABLE_DIMENSIONS,
  getEmbeddingStats,
  rebuildPendingEmbeddings,
  type EmbeddingStats,
  type RebuildOutcome,
  type RebuildProgress,
} from '@/lib/embedding';
import { useHostPermission } from './use-host-permission';
import { permissionErrorKey } from './permission-error';

interface EmbeddingConfigCardProps {
  currentEmbeddingDef: EmbeddingProviderDef;
  currentEmbeddingApiKey: string;
  currentEmbeddingBaseUrl: string;
  currentEmbeddingModel: string;
  /** One of COMMON_EMBEDDING_DIMENSIONS, or undefined = auto (model native). */
  currentEmbeddingDimensions: number | undefined;
  updateEmbedding: (update: EmbeddingUpdate) => void;
}

export function EmbeddingConfigCard({
  currentEmbeddingDef,
  currentEmbeddingApiKey,
  currentEmbeddingBaseUrl,
  currentEmbeddingModel,
  currentEmbeddingDimensions,
  updateEmbedding,
}: EmbeddingConfigCardProps) {
  const { t } = useTranslation();
  const { ensure, dialog } = useHostPermission();
  const [showKey, setShowKey] = useState(false);

  const [isTesting, setIsTesting] = useState(false);
  const [testDimensions, setTestDimensions] = useState<number | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const [stats, setStats] = useState<EmbeddingStats | null>(null);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [rebuildProgress, setRebuildProgress] = useState<RebuildProgress | null>(null);
  const [rebuildOutcome, setRebuildOutcome] = useState<RebuildOutcome | null>(null);
  const [rebuildError, setRebuildError] = useState<string | null>(null);

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

  // Clear stale test feedback when the provider changes (mirrors llm-config-card),
  // so a success/warning Alert for provider A never lingers on provider B.
  const prevProviderRef = useRef(currentEmbeddingDef.id);
  useEffect(() => {
    if (prevProviderRef.current !== currentEmbeddingDef.id) {
      prevProviderRef.current = currentEmbeddingDef.id;
      setTestDimensions(null);
      setTestError(null);
    }
  }, [currentEmbeddingDef.id]);

  const canTest = !!(currentEmbeddingApiKey && currentEmbeddingModel);

  // Dimensions is a Select over COMMON_EMBEDDING_DIMENSIONS — the UI cannot
  // produce an invalid value. lib-layer resolveEmbeddingConfig keeps its own
  // filter for unsendable values (non-finite / <= 0) as the invariant.

  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    setTestDimensions(null);
    setTestError(null);

    try {
      const baseUrl = currentEmbeddingBaseUrl || currentEmbeddingDef.baseUrl;
      const perm = await ensure(baseUrl);
      if (!perm.ok) {
        setTestError(t(permissionErrorKey(perm.reason)));
        return;
      }
      const result = await testEmbeddingConnection({
        providerId: currentEmbeddingDef.id,
        apiKey: currentEmbeddingApiKey,
        baseUrl: currentEmbeddingBaseUrl,
        model: currentEmbeddingModel,
        // Probe with the configured truncation so the reported dimension
        // matches what indexing would actually do (undefined = native dim).
        dimensions: currentEmbeddingDimensions,
      });
      setTestDimensions(result.dimensions);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTesting(false);
    }
  }, [
    currentEmbeddingDef.id,
    currentEmbeddingDef.baseUrl,
    currentEmbeddingApiKey,
    currentEmbeddingBaseUrl,
    currentEmbeddingModel,
    currentEmbeddingDimensions,
    ensure,
    t,
  ]);

  // Manual rebuild: re-embed the 'chunked' backlog in this page's context.
  // Failure stops the loop (finished items stay 'embedded'), so clicking again
  // resumes with only the remainder — no cancel button or queue needed.
  const handleRebuild = useCallback(async () => {
    setIsRebuilding(true);
    setRebuildProgress(null);
    setRebuildOutcome(null);
    setRebuildError(null);

    try {
      // Not-configured is decidable locally: this prop IS the resolved apiKey
      // (`resolveEmbeddingConfig`), the same value rebuild derives `enabled`
      // from — so bail out first and never pop a host-permission dialog for a
      // provider that cannot embed anything anyway. The library keeps its own
      // gate as the invariant.
      if (!currentEmbeddingApiKey) {
        setRebuildOutcome({ status: 'not-configured' });
        return;
      }
      // Same CORS gate as the test-connection button: embeds are fetches from
      // this page, so the (custom) API origin must be granted first.
      const baseUrl = currentEmbeddingBaseUrl || currentEmbeddingDef.baseUrl;
      const perm = await ensure(baseUrl);
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
  }, [
    currentEmbeddingApiKey,
    currentEmbeddingBaseUrl,
    currentEmbeddingDef.baseUrl,
    ensure,
    fetchStats,
    t,
  ]);

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
              value={currentEmbeddingDef.id}
              onChange={(e) => updateEmbedding({ field: 'provider', value: e.target.value as EmbeddingProviderId })}
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
              value={currentEmbeddingApiKey}
              onChange={(e) => updateEmbedding({ field: 'apiKey', value: e.target.value })}
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
            {currentEmbeddingDef.regUrl && (
              <Button
                variant="outlined"
                size="small"
                href={currentEmbeddingDef.regUrl}
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
              placeholder={currentEmbeddingDef.baseUrl || t('settings.customBaseUrlPlaceholder')}
              value={currentEmbeddingBaseUrl}
              onChange={(e) => updateEmbedding({ field: 'baseUrl', value: e.target.value })}
            />
          </Grid>

          {/* Model */}
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label={t('settings.embeddingModel')}
              placeholder={currentEmbeddingDef.defaultModel}
              value={currentEmbeddingModel}
              onChange={(e) => updateEmbedding({ field: 'model', value: e.target.value })}
            />
          </Grid>

          {/* Dimensions (optional Matryoshka truncation, preset Select) */}
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              select
              fullWidth
              label={t('settings.embedding.dimensions')}
              value={currentEmbeddingDimensions ?? 'auto'}
              onChange={(e) =>
                updateEmbedding({
                  field: 'dimensions',
                  value: e.target.value === 'auto' ? undefined : Number(e.target.value),
                })
              }
              helperText={t('settings.embedding.dimensionsHelper', { limit: MAX_INDEXABLE_DIMENSIONS })}
            >
              {/* MUI Select treats '' as "no selection" and renders nothing, so
                  auto needs a real sentinel value instead of the empty string. */}
              <MenuItem value="auto">{t('settings.embedding.dimensionsAuto')}</MenuItem>
              {COMMON_EMBEDDING_DIMENSIONS.map((d) => (
                <MenuItem key={d} value={d}>{d}</MenuItem>
              ))}
            </TextField>
          </Grid>

          {/* Test Connection (wired to testEmbeddingConnection) */}
          <Grid size={{ xs: 12 }}>
            <Button
              variant="contained"
              onClick={handleTestConnection}
              disabled={isTesting || !canTest}
              startIcon={
                isTesting ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <Iconify icon="solar:check-circle-bold" width={20} />
                )
              }
            >
              {isTesting ? t('settings.testing') : t('settings.testConnection')}
            </Button>
          </Grid>

          {testDimensions !== null && testDimensions <= MAX_INDEXABLE_DIMENSIONS && (
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
