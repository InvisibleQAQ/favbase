import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';

import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';
import { useTranslation } from '@/lib/i18n/use-translation';

import type { BackgroundJob } from '../../hooks/background-jobs-store';
import { useRunningJobs } from '../../hooks/background-jobs-store';
import { Iconify } from '../../components/iconify';

/** Platform logTag → nav display-name key (reuses existing nav.* copy). */
const PLATFORM_LABEL: Record<string, LocaleKeys> = {
  bilibili: 'nav.bilibiliFavorites',
  'github-stars': 'nav.githubStars',
  bookmarks: 'nav.bookmarks',
  'x-bookmarks': 'nav.xBookmarks',
  'zhihu-favorites': 'nav.zhihuFavorites',
  'youtube-playlists': 'nav.youtubePlaylists',
};

type Translate = (
  key: LocaleKeys,
  params?: Record<string, string | number>,
) => string;

export function backgroundJobDetail(job: BackgroundJob, t: Translate): string {
  const progress = job.progress;
  const done = progress && typeof progress === 'object' && 'done' in progress
    ? progress.done
    : null;
  const total = progress && typeof progress === 'object' && 'total' in progress
    ? progress.total
    : null;
  const hasProgress = typeof done === 'number' && typeof total === 'number' && total > 0;
  let detail: string;

  switch (job.kind) {
    case 'sync':
      detail = t('backgroundJobs.kind.sync');
      break;
    case 'extract':
      detail = t('backgroundJobs.kind.extract');
      break;
    case 'transcribe':
      detail = t('backgroundJobs.kind.transcribe');
      break;
    case 'embed':
      detail = hasProgress
        ? t('backgroundJobs.embedding', { done, total })
        : t('backgroundJobs.kind.embed');
      break;
    case 'tag':
      detail = hasProgress
        ? t('backgroundJobs.tagging', { done, total })
        : t('backgroundJobs.kind.tag');
      break;
  }

  if (job.phase === 'paused') {
    return t('backgroundJobs.phase.paused', { detail });
  }
  if (job.phase === 'pausing') {
    return t('backgroundJobs.phase.pausing', { detail });
  }
  return detail;
}

/**
 * Global unfinished-work reminder. Lives in
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
  const allPaused = jobs.every((job) => job.phase === 'paused');

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
          {`${platformLabel(job.platform)} · ${backgroundJobDetail(job, t)}`}
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
        icon={allPaused
          ? <Iconify icon="solar:pause-bold" width={14} />
          : <CircularProgress size={12} color="inherit" />}
        label={reminder}
        sx={{
          // 390px budget: menu button + theme switch + flag + GitHub leave
          // ~140px; the chip yields first and truncates instead of overlapping.
          maxWidth: { xs: 136, sm: 320 },
          minWidth: 0,
          flexShrink: 1,
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
