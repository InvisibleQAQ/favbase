import type { useBookmarkExtraction } from './use-bookmark-extraction';

import { varAlpha } from 'minimal-shared/utils';

import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import LinearProgress, { linearProgressClasses } from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { bookmarkDisplayName, bookmarkFaviconUrl } from './bookmark-display';

export interface BookmarkExtractionPanelProps {
  extraction: ReturnType<typeof useBookmarkExtraction>;
}

/**
 * Bookmarks-specific adapter for the shared scaffold's business-operation seam.
 * Pure progress display: extraction auto-chains after every bookmark fetch and
 * pause/resume belongs to the per-platform library gate — the paused copy here
 * only mirrors the shared job phase.
 */
export function BookmarkExtractionPanel({ extraction }: BookmarkExtractionPanelProps) {
  const { t } = useTranslation();
  const hasTotal = extraction.total > 0;
  const active = extraction.phase !== 'idle';
  const progress = hasTotal
    ? Math.min(100, Math.max(0, (extraction.done / extraction.total) * 100))
    : 0;

  return (
    <Box
      sx={(theme) => ({
        mb: 2.5,
        p: 2,
        border: '1px solid',
        borderRadius: 1,
        borderColor: varAlpha(theme.vars.palette.primary.mainChannel, 0.2),
        bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.06),
      })}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          mb: active ? 1.25 : 0,
        }}
      >
        <Avatar
          src={
            active && extraction.current
              ? bookmarkFaviconUrl(extraction.current.url) || undefined
              : undefined
          }
          variant="rounded"
          sx={(theme) => ({
            width: 36,
            height: 36,
            flexShrink: 0,
            color: theme.vars.palette.primary.main,
            bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.12),
          })}
        >
          <Iconify icon="solar:bookmark-bold-duotone" width={20} />
        </Avatar>

        <Box sx={{ minWidth: 0, flex: 1 }}>
          {active && extraction.current && (
            <Typography variant="subtitle2" title={extraction.current.title} noWrap>
              {bookmarkDisplayName(extraction.current.title, extraction.current.url)}
            </Typography>
          )}
          <Typography
            variant="body2"
            sx={{ color: active ? 'text.secondary' : 'text.primary' }}
          >
            {extraction.phase === 'paused'
              ? t('bookmarks.extractionPaused', {
                  done: extraction.done,
                  total: extraction.total,
                })
              : extraction.phase === 'pausing'
                ? t('bookmarks.extractionPausing')
                : extraction.running
                  ? t('bookmarks.extracting', {
                      done: extraction.done,
                      total: extraction.total,
                    })
                  : extraction.pendingCountError
                    ? t('bookmarks.pendingCountFailed')
                    : extraction.pendingCount == null
                      ? t('status.loading')
                      : t('bookmarks.pendingExtraction', {
                          count: extraction.pendingCount,
                        })}
          </Typography>
        </Box>

        {active && hasTotal && (
          <Typography
            variant="subtitle2"
            sx={{ flexShrink: 0, color: 'text.accent' }}
          >
            {Math.round(progress)}%
          </Typography>
        )}
      </Box>

      {active && (
        <LinearProgress
          variant={hasTotal ? 'determinate' : 'indeterminate'}
          value={hasTotal ? progress : undefined}
          sx={(theme) => ({
            height: 6,
            borderRadius: 0.5,
            bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.12),
            [`& .${linearProgressClasses.bar}`]: { borderRadius: 0.5 },
          })}
        />
      )}
    </Box>
  );
}
