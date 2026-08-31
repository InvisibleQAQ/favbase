import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import { varAlpha } from 'minimal-shared/utils';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../../components/iconify';
import type { EmbeddingStats, RebuildOutcome, RebuildProgress } from '@/lib/embedding';

export interface EmbeddingStatsPanelProps {
  stats: EmbeddingStats | null;
  isRebuilding: boolean;
  progress: RebuildProgress | null;
  outcome: RebuildOutcome | null;
  error: string | null;
  onRebuild: () => void;
}

/**
 * Vector Index section: coverage stats + manual rebuild of the 'chunked'
 * backlog. Pure presentational — all state comes from props.
 */
export function EmbeddingStatsPanel({
  stats,
  isRebuilding,
  progress,
  outcome,
  error,
  onRebuild,
}: EmbeddingStatsPanelProps) {
  const { t } = useTranslation();

  return (
    <>
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
                borderRadius: 1,
                bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.08),
              })}
            >
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {stat.label}
              </Typography>
              <Typography variant="h6" component="p">{stat.value}</Typography>
            </Box>
          </Grid>
        ))}
      </Grid>

      <Button
        variant="outlined"
        size="small"
        onClick={onRebuild}
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
            variant={progress ? 'determinate' : 'indeterminate'}
            value={progress && progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}
          />
          {progress && (
            <Typography
              variant="caption"
              sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}
            >
              {t('settings.embedding.rebuildProgress', {
                completed: progress.completed,
                total: progress.total,
              })}
            </Typography>
          )}
        </Box>
      )}

      {outcome?.status === 'completed' && (
        <Alert severity="success" sx={{ mt: 2 }}>
          {outcome.total === 0
            ? t('settings.embedding.rebuildNoPending')
            : t('settings.embedding.rebuildDone', { count: outcome.total })}
        </Alert>
      )}

      {outcome?.status === 'not-configured' && (
        <Alert severity="info" sx={{ mt: 2 }}>
          {t('settings.embedding.rebuildNotConfigured')}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {t('settings.embedding.rebuildFailed', { error })}
        </Alert>
      )}
    </>
  );
}
