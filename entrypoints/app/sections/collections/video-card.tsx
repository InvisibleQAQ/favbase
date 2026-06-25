import Card from '@mui/material/Card';
import CardMedia from '@mui/material/CardMedia';
import CardActionArea from '@mui/material/CardActionArea';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';

import { t } from '@/lib/i18n';
import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';
import type { TranscribeErrorCode } from '@/lib/transcription/types';
import { Iconify } from '../../components/iconify';
import type { BiliFavVideo } from '@/lib/bilibili/types';
import type { VideoTranscribeState } from './use-video-transcribe';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatPlay(count: number): string {
  if (count >= 10000) return `${(count / 10000).toFixed(1)}万`;
  return String(count);
}

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

const INVALID_ATTR = 9;

export interface VideoCardProps {
  video: BiliFavVideo;
  transcribeState?: VideoTranscribeState;
  onTranscribe?: () => void;
  onCancel?: () => void;
  disabled?: boolean;
}

export function VideoCard({
  video,
  transcribeState,
  onTranscribe,
  onCancel,
  disabled,
}: VideoCardProps) {
  const isInvalid = video.attr === INVALID_ATTR;
  const cover = video.cover?.startsWith('//') ? `https:${video.cover}` : video.cover;

  const handleClick = () => {
    if (isInvalid) return;
    window.open(`https://www.bilibili.com/video/${video.bvid}`, '_blank');
  };

  return (
    <Card
      sx={(theme) => ({
        overflow: 'hidden',
        boxShadow: theme.vars.customShadows.card,
        transition: 'box-shadow 0.2s',
        ...(isInvalid && { opacity: 0.45, filter: 'grayscale(1)' }),
        '&:hover': {
          boxShadow: isInvalid ? undefined : theme.vars.customShadows.z8,
        },
      })}
    >
      <CardActionArea onClick={handleClick} disabled={isInvalid}>
        <Box sx={{ position: 'relative' }}>
          {cover ? (
            <CardMedia
              component="img"
              image={cover}
              alt={video.title}
              sx={{ height: 130, objectFit: 'cover' }}
            />
          ) : (
            <Box
              sx={(theme) => ({
                height: 130,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: theme.vars.palette.grey[100],
              })}
            >
              <Iconify icon="solar:video-library-bold-duotone" width={40} sx={{ color: 'text.disabled' }} />
            </Box>
          )}

          {!isInvalid && (
            <>
              <Box
                sx={{
                  position: 'absolute',
                  bottom: 4,
                  left: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.25,
                  bgcolor: 'rgba(0,0,0,0.7)',
                  color: '#fff',
                  px: 0.75,
                  py: 0.25,
                  borderRadius: 0.5,
                  fontSize: '0.75rem',
                  lineHeight: 1.4,
                }}
              >
                <Iconify icon="solar:play-bold" width={12} sx={{ color: '#fff' }} />
                {formatPlay(video.cnt_info.play)}
              </Box>
              <Box
                sx={{
                  position: 'absolute',
                  bottom: 4,
                  right: 4,
                  bgcolor: 'rgba(0,0,0,0.7)',
                  color: '#fff',
                  px: 0.75,
                  py: 0.25,
                  borderRadius: 0.5,
                  fontSize: '0.75rem',
                  lineHeight: 1.4,
                }}
              >
                {formatDuration(video.duration)}
              </Box>
            </>
          )}
        </Box>

        <Box sx={{ p: 1.5 }}>
          <Typography
            variant="subtitle2"
            noWrap
            title={isInvalid ? '已失效视频' : video.title}
            sx={{ fontWeight: 600, mb: 0.5 }}
          >
            {isInvalid ? '已失效视频' : video.title}
          </Typography>

          {!isInvalid && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                {video.upper.name}
              </Typography>
              {!!video.fav_time && (
                <Typography variant="caption" sx={{ color: 'text.disabled' }} noWrap>
                  · {formatFavTime(video.fav_time)}
                </Typography>
              )}
            </Box>
          )}
        </Box>
      </CardActionArea>

      {!isInvalid && transcribeState && (
        <ActionBar
          state={transcribeState}
          onTranscribe={onTranscribe}
          onCancel={onCancel}
          disabled={disabled}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Action Bar
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
  const { contentStatus, transcribing, progress, stage, stageParams, error, retryCountdown } = state;

  // Transcribing → progress display
  if (transcribing) {
    return (
      <Box sx={{ px: 1.5, pb: 1.5 }}>
        <LinearProgress
          variant="determinate"
          value={progress}
          sx={{ mb: 0.5, borderRadius: 1 }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
            {translateStage(stage, stageParams)} {progress}%
          </Typography>
          <Tooltip title={t('transcribe.cancel')}>
            <IconButton size="small" onClick={onCancel} sx={{ p: 0.25 }}>
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
      <Box sx={{ px: 1.5, pb: 1.5 }}>
        <Typography
          variant="caption"
          sx={{ color: 'error.main', display: 'block', mb: 0.5 }}
          noWrap
          title={translateError(error.code, error.params)}
        >
          {translateError(error.code, error.params)}
        </Typography>
        {retryCountdown > 0 ? (
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
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

  // Has content → source badge
  if (contentStatus === 'has_bilibili' || contentStatus === 'has_groq') {
    const label = contentStatus === 'has_bilibili' ? t('card.sourceCC') : t('card.sourceASR');
    const color = contentStatus === 'has_bilibili' ? 'info' : 'success';
    return (
      <Box sx={{ px: 1.5, pb: 1.5 }}>
        <Chip
          label={label}
          icon={<Iconify icon="solar:subtitles-bold-duotone" width={14} />}
          size="small"
          color={color}
          variant="outlined"
          sx={{ height: 24 }}
        />
      </Box>
    );
  }

  // Checking cache → small skeleton
  if (contentStatus === 'checking' || contentStatus === 'unknown') {
    return (
      <Box sx={{ px: 1.5, pb: 1.5, height: 24 }} />
    );
  }

  // No content → transcribe button
  return (
    <Box sx={{ px: 1.5, pb: 1.5 }}>
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
