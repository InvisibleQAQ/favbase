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
import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { varAlpha } from 'minimal-shared/utils';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { EMBEDDING_PROVIDERS, type EmbeddingProviderId, type EmbeddingProviderDef } from '@/lib/providers';
import type { EmbeddingUpdate } from '@/lib/hooks/useSettings';
import { testEmbeddingConnection, EMBEDDING_DIMENSIONS } from '@/lib/ai';

interface EmbeddingConfigCardProps {
  currentEmbeddingDef: EmbeddingProviderDef;
  currentEmbeddingApiKey: string;
  currentEmbeddingBaseUrl: string;
  currentEmbeddingModel: string;
  updateEmbedding: (update: EmbeddingUpdate) => void;
}

export function EmbeddingConfigCard({
  currentEmbeddingDef,
  currentEmbeddingApiKey,
  currentEmbeddingBaseUrl,
  currentEmbeddingModel,
  updateEmbedding,
}: EmbeddingConfigCardProps) {
  const { t } = useTranslation();
  const [showKey, setShowKey] = useState(false);

  const [isTesting, setIsTesting] = useState(false);
  const [testDimensions, setTestDimensions] = useState<number | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

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

  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    setTestDimensions(null);
    setTestError(null);

    try {
      const result = await testEmbeddingConnection({
        providerId: currentEmbeddingDef.id,
        apiKey: currentEmbeddingApiKey,
        baseUrl: currentEmbeddingBaseUrl,
        model: currentEmbeddingModel,
      });
      setTestDimensions(result.dimensions);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTesting(false);
    }
  }, [
    currentEmbeddingDef.id,
    currentEmbeddingApiKey,
    currentEmbeddingBaseUrl,
    currentEmbeddingModel,
  ]);

  return (
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

          {testDimensions !== null && testDimensions === EMBEDDING_DIMENSIONS && (
            <Grid size={{ xs: 12 }}>
              <Alert
                severity="success"
                icon={<Iconify icon="solar:check-circle-bold" width={22} />}
              >
                {t('settings.embedding.testSuccess', { dimensions: testDimensions })}
              </Alert>
            </Grid>
          )}

          {testDimensions !== null && testDimensions !== EMBEDDING_DIMENSIONS && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="warning">
                {t('settings.embedding.dimensionWarning', {
                  actual: testDimensions,
                  expected: EMBEDDING_DIMENSIONS,
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

          {/* Vector Index management (UI placeholder — no vector logic yet) */}
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
                { label: t('settings.embedding.indexedCount'), value: '—' },
                { label: t('settings.embedding.storageUsed'), value: '—' },
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

            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <Button
                variant="outlined"
                size="small"
                disabled
                startIcon={<Iconify icon="solar:restart-bold" width={18} />}
              >
                {t('settings.embedding.rebuildIncremental')}
              </Button>
              <Button
                variant="outlined"
                size="small"
                color="warning"
                disabled
                startIcon={<Iconify icon="solar:restart-bold" width={18} />}
              >
                {t('settings.embedding.rebuildFull')}
              </Button>
              <Button
                variant="text"
                size="small"
                color="error"
                disabled
                startIcon={<Iconify icon="solar:trash-bin-trash-bold" width={18} />}
              >
                {t('settings.embedding.clear')}
              </Button>
            </Stack>

            <Typography
              variant="caption"
              sx={{ display: 'block', mt: 2, color: 'text.secondary', fontStyle: 'italic' }}
            >
              {t('settings.embedding.notImplemented')}
            </Typography>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}
