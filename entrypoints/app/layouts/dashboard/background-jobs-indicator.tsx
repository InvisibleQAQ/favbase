import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';

import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';
import { useTranslation } from '@/lib/i18n/use-translation';

import type { BackgroundJob } from '../../hooks/background-jobs-store';
import { useRunningJobs } from '../../hooks/background-jobs-store';

/** Platform logTag → nav display-name key (reuses existing nav.* copy). */
const PLATFORM_LABEL: Record<string, LocaleKeys> = {
  bilibili: 'nav.bilibiliFavorites',
  'github-stars': 'nav.githubStars',
  bookmarks: 'nav.bookmarks',
  'x-bookmarks': 'nav.xBookmarks',
  'zhihu-favorites': 'nav.zhihuFavorites',
  'youtube-playlists': 'nav.youtubePlaylists',
};

/** embed/tag report {done,total}; sync/transcribe report null (indeterminate). */
type Progress = { done?: number; total?: number } | null;

/**
 * Global "background work in progress — don't close this page" reminder. Lives in
 * the always-mounted dashboard header, so it stays visible across every route
 * while any platform's sync/embed/tag job runs (the jobs themselves survive route
 * switches via the module-level backgroundJobs store; this only surfaces them).
 *
 * The chip label stays a bare count; the tooltip breaks it down per job —
 * platform + kind, with {done}/{total} for embed/tag once reported. Renders
 * nothing when idle.
 */
export function BackgroundJobsIndicator() {
  const { t } = useTranslation();
  const jobs = useRunningJobs();

  if (jobs.length === 0) return null;

  const reminder = t('backgroundJobs.reminder', { count: jobs.length });

  const kindLabel = (job: BackgroundJob): string => {
    const p = job.progress as Progress;
    const hasProgress = !!p && typeof p.total === 'number' && p.total > 0;
    switch (job.kind) {
      case 'sync':
        return t('backgroundJobs.kind.sync');
      case 'transcribe':
        return t('backgroundJobs.kind.transcribe');
      case 'embed':
        return hasProgress
          ? t('backgroundJobs.embedding', { done: p!.done ?? 0, total: p!.total! })
          : t('backgroundJobs.kind.embed');
      case 'tag':
        return hasProgress
          ? t('backgroundJobs.tagging', { done: p!.done ?? 0, total: p!.total! })
          : t('backgroundJobs.kind.tag');
      default:
        return job.kind;
    }
  };

  const platformLabel = (platform: string): string => {
    const key = PLATFORM_LABEL[platform];
    return key ? t(key) : platform;
  };

  const title = (
    <Box>
      <Typography variant="caption" sx={{ display: 'block', fontWeight: 600 }}>
        {reminder}
      </Typography>
      {jobs.map((job) => (
        <Typography key={`${job.platform}:${job.kind}`} variant="caption" sx={{ display: 'block' }}>
          {`${platformLabel(job.platform)} · ${kindLabel(job)}`}
        </Typography>
      ))}
    </Box>
  );

  return (
    <Tooltip title={title}>
      <Chip
        size="small"
        color="warning"
        variant="outlined"
        icon={<CircularProgress size={12} color="inherit" />}
        label={reminder}
        sx={{
          maxWidth: { xs: 160, sm: 320 },
          '& .MuiChip-label': {
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        }}
      />
    </Tooltip>
  );
}
