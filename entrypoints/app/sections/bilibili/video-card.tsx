import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';

import { t, formatCompactNumber } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';
import type { TranscribeErrorCode } from '@/lib/transcription/types';
import { Iconify } from '../../components/iconify';
import { CollectionCard, CoverBadge } from '../../components/collection';
import { TagRow } from '../../components/tags';
import { formatDuration } from '../../utils/format-duration';
import type { BiliFavVideo } from '@/lib/bilibili/types';
import type { TagRef } from '@/lib/tagging';
import type { VideoTranscribeState } from './use-video-transcribe';

function formatFavTime(favTime: number): string {
  if (!favTime) return '';

  const favDate = new Date(favTime * 1000);
  const now = new Date();
  const yearDiff = now.getFullYear() - favDate.getFullYear();

  if (yearDiff <= 0) {
    const mm = String(favDate.getMonth() + 1).padStart(2, '0');
    const dd = String(favDate.getDate()).padStart(2, '0');
    return t('card.favAt', { date: `${mm}-${dd}` });
  }

  return t('card.favYearsAgo', { years: yearDiff });
}

function translateStage(
  stage: string,
  stageParams?: Record<string, string | number>,
): string {
  if (!stage) return '';
  const key = `stage.${stage}` as LocaleKeys;
  return t(key, stageParams);
}

function translateError(
  code: TranscribeErrorCode,
  params?: Record<string, string | number>,
): string {
  const key = `error.${code}` as LocaleKeys;
  return t(key, params);
}

export const INVALID_ATTR = 9;

export interface VideoCardProps {
  video: BiliFavVideo;
  transcribeState?: VideoTranscribeState;
  onTranscribe?: () => void;
  onCancel?: () => void;
  disabled?: boolean;
  /** undefined = tag UI hidden entirely (backward compatible); [] = no tags yet, edit button only. */
  tags?: TagRef[];
  onEditTags?: (anchor: HTMLElement) => void;
}

export function VideoCard({
  video,
  transcribeState,
  onTranscribe,
  onCancel,
  disabled,
  tags,
  onEditTags,
}: VideoCardProps) {
  useTranslation();
  const isInvalid = video.attr === INVALID_ATTR;
  const cover = video.cover?.startsWith('//') ? `https:${video.cover}` : video.cover;
  const title = isInvalid ? t('card.invalidVideo') : video.title;

  return (
    <CollectionCard
      href={isInvalid ? undefined : `https://www.bilibili.com/video/${video.bvid}`}
      disabled={isInvalid}
      media={{
        src: cover,
        alt: title,
        aspect: '16/9',
        fallbackIcon: <Iconify icon="solar:video-library-bold-duotone" width={40} />,
        overlay: isInvalid ? undefined : (
          <>
            <CoverBadge align="left">
              <Iconify icon="solar:play-bold" width={12} />
              {formatCompactNumber(video.cnt_info.play)}
            </CoverBadge>
            <CoverBadge align="right">{formatDuration(video.duration)}</CoverBadge>
          </>
        ),
      }}
      title={title}
      meta={
        isInvalid ? undefined : (
          <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
            {video.upper.name}
          </Typography>
        )
      }
      date={isInvalid || !video.fav_time ? undefined : formatFavTime(video.fav_time)}
      tags={!isInvalid && tags ? <TagRow tags={tags} onEditTags={onEditTags} /> : undefined}
      footer={
        !isInvalid && transcribeState ? (
          <ActionBar
            state={transcribeState}
            onTranscribe={onTranscribe}
            onCancel={onCancel}
            disabled={disabled}
          />
        ) : undefined
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Action Bar (outside the link — it carries its own controls)
// ---------------------------------------------------------------------------

function ActionBar({
  state,
  onTranscribe,
  onCancel,
  disabled,
}: {
  state: VideoTranscribeState;
  onTranscribe?: () => void;
  onCancel?: () => void;
  disabled?: boolean;
}) {
  const { contentStatus, transcribing, progress, stage, stageParams, error, retryCountdown, indexed } = state;

  // Transcribing → progress display
  if (transcribing) {
    return (
      <Box sx={{ px: 2, pb: 1.5 }}>
        <LinearProgress variant="determinate" value={progress} sx={{ mb: 0.5 }} />
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
            {translateStage(stage, stageParams)} {progress}%
          </Typography>
          <Tooltip title={t('transcribe.cancel')}>
            <IconButton size="small" aria-label={t('transcribe.cancel')} onClick={onCancel} sx={{ p: 0.25 }}>
              <Iconify icon="mingcute:close-line" width={16} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    );
  }

  // Error → error message + retry
  if (error) {
    return (
      <Box sx={{ px: 2, pb: 1.5 }}>
        <Typography
          variant="caption"
          sx={(theme) => ({
            display: 'block',
            mb: 0.5,
            color: theme.vars.palette.error.dark,
            ...theme.applyStyles('dark', { color: theme.vars.palette.error.light }),
          })}
          noWrap
          title={translateError(error.code, error.params)}
        >
          {translateError(error.code, error.params)}
        </Typography>
        {retryCountdown > 0 ? (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('transcribe.rateLimit', { seconds: retryCountdown })}
          </Typography>
        ) : (
          <Chip
            label={t('transcribe.retry')}
            icon={<Iconify icon="solar:restart-bold" width={14} />}
            size="small"
            variant="outlined"
            onClick={onTranscribe}
            disabled={disabled}
            sx={{ height: 24 }}
          />
        )}
      </Box>
    );
  }

  // Has content → source badge (+ indexed badge when content_state = 'embedded')
  if (contentStatus === 'has_official' || contentStatus === 'has_asr') {
    const label = contentStatus === 'has_official' ? t('card.sourceCC') : t('card.sourceASR');
    return (
      <Box sx={{ px: 2, pb: 1.5, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        <Chip
          label={label}
          icon={<Iconify icon="solar:subtitles-bold-duotone" width={14} />}
          size="small"
          variant="outlined"
          sx={{ height: 24 }}
        />
        {indexed && (
          <Chip
            label={t('card.indexed')}
            icon={<Iconify icon="solar:database-bold-duotone" width={14} />}
            size="small"
            variant="outlined"
            sx={{ height: 24 }}
          />
        )}
      </Box>
    );
  }

  // Checking cache → reserve the row so the grid does not jump
  if (contentStatus === 'checking' || contentStatus === 'unknown') {
    return <Box sx={{ px: 2, pb: 1.5, height: 24 }} />;
  }

  // No content → transcribe button
  return (
    <Box sx={{ px: 2, pb: 1.5 }}>
      <Chip
        label={t('card.transcribe')}
        icon={<Iconify icon="solar:subtitles-bold-duotone" width={14} />}
        size="small"
        variant="outlined"
        onClick={onTranscribe}
        disabled={disabled}
        sx={{ height: 24 }}
      />
    </Box>
  );
}
