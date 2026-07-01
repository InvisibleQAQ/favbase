import { useState } from 'react';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import { varAlpha } from 'minimal-shared/utils';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { EMBEDDING_PROVIDERS, type EmbeddingProviderId, type EmbeddingProviderDef } from '@/lib/providers';
import type { EmbeddingUpdate } from '@/lib/hooks/useSettings';

interface EmbeddingConfigCardProps {
  embeddingEnabled: boolean;
  currentEmbeddingDef: EmbeddingProviderDef;
  currentEmbeddingApiKey: string;
  currentEmbeddingBaseUrl: string;
  currentEmbeddingModel: string;
  updateEmbedding: (update: EmbeddingUpdate) => void;
}

export function EmbeddingConfigCard({
  embeddingEnabled,
  currentEmbeddingDef,
  currentEmbeddingApiKey,
  currentEmbeddingBaseUrl,
  currentEmbeddingModel,
  updateEmbedding,
}: EmbeddingConfigCardProps) {
  const { t } = useTranslation();
  const [showKey, setShowKey] = useState(false);

  const disabled = !embeddingEnabled;

  return (
    <Card>
      <CardHeader
        title={t('settings.embeddingCard.title')}
        subheader={t('settings.embeddingCard.description')}
        action={
          <Switch
            checked={embeddingEnabled}
            onChange={(e) => updateEmbedding({ field: 'enabled', value: e.target.checked })}
            slotProps={{ input: { 'aria-label': t('settings.embeddingEnabled') } }}
          />
        }
      />
      <CardContent>
        <Grid container spacing={3}>
          {/* Provider */}
          <Grid size={{ xs: 12 }}>
            <TextField
              select
              fullWidth
              disabled={disabled}
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
              disabled={disabled}
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
                        disabled={disabled}
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
                disabled={disabled}
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
              disabled={disabled}
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
              disabled={disabled}
              label={t('settings.embeddingModel')}
              placeholder={currentEmbeddingDef.defaultModel}
              value={currentEmbeddingModel}
              onChange={(e) => updateEmbedding({ field: 'model', value: e.target.value })}
            />
          </Grid>

          {/* Test Connection (UI placeholder — no network logic yet) */}
          <Grid size={{ xs: 12 }}>
            <Button
              variant="contained"
              disabled={disabled}
              startIcon={<Iconify icon="solar:check-circle-bold" width={20} />}
            >
              {t('settings.testConnection')}
            </Button>
          </Grid>

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
                disabled={disabled}
                startIcon={<Iconify icon="solar:restart-bold" width={18} />}
              >
                {t('settings.embedding.rebuildIncremental')}
              </Button>
              <Button
                variant="outlined"
                size="small"
                color="warning"
                disabled={disabled}
                startIcon={<Iconify icon="solar:restart-bold" width={18} />}
              >
                {t('settings.embedding.rebuildFull')}
              </Button>
              <Button
                variant="text"
                size="small"
                color="error"
                disabled={disabled}
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
