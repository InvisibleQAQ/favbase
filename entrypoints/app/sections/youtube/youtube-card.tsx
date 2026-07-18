import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardMedia from '@mui/material/CardMedia';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { varAlpha } from 'minimal-shared/utils';

import { formatCompactNumber, formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { TagRow } from '../../components/tags';
import { formatDuration } from '../../utils/format-duration';
import type { YoutubeVideoItem } from '@/lib/youtube/youtube-sync-service';
import type { TagRef } from '@/lib/tagging';

export interface YoutubeCardProps {
  video: YoutubeVideoItem;
  /** undefined = tag UI hidden entirely (backward compatible); [] = no tags yet, edit button only. */
  tags?: TagRef[];
  onEditTags?: (anchor: HTMLElement) => void;
}

export function YoutubeCard({ video, tags, onEditTags }: YoutubeCardProps) {
  // Subscribe to locale changes so formatCompactNumber/formatDateTime re-render.
  useTranslation();

  const handleClick = () => {
    window.open(video.originalUrl, '_blank');
  };

  const addedAtMs = video.addedAt ? Date.parse(video.addedAt) : NaN;

  return (
    <Card
      sx={(theme) => ({
        height: 1,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: theme.vars.customShadows.card,
        transition: 'box-shadow 0.2s',
        '&:hover': { boxShadow: theme.vars.customShadows.z8 },
      })}
    >
      <CardActionArea
        onClick={handleClick}
        sx={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
      >
        {/* 16:9 thumbnail + duration badge overlay */}
        <Box sx={{ position: 'relative' }}>
          {video.thumbnailUrl ? (
            <CardMedia
              component="img"
              image={video.thumbnailUrl}
              alt={video.title}
              loading="lazy"
              sx={{ aspectRatio: '16 / 9', objectFit: 'cover' }}
            />
          ) : (
            <Box
              sx={(theme) => ({
                aspectRatio: '16 / 9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.12),
              })}
            >
              <Iconify icon="mdi:youtube" width={40} sx={{ color: 'text.disabled' }} />
            </Box>
          )}

          {video.durationSeconds > 0 && (
            <Box
              sx={{
                position: 'absolute',
                bottom: 4,
                right: 4,
                // Scrim over the thumbnail — mode-independent by design.
                bgcolor: 'rgba(0,0,0,0.7)',
                color: '#fff',
                px: 0.75,
                py: 0.25,
                borderRadius: 0.5,
                fontSize: '0.75rem',
                lineHeight: 1.4,
              }}
            >
              {formatDuration(video.durationSeconds)}
            </Box>
          )}
        </Box>

        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5, flex: '1 1 auto' }}>
          {/* Title — 2-line clamp */}
          <Typography
            variant="subtitle2"
            title={video.title}
            sx={{
              fontWeight: 600,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {video.title}
          </Typography>

          <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
            {video.channelTitle}
          </Typography>

          {/* Footer: view count + added-to-playlist date */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 'auto', pt: 0.5 }}>
            <Iconify icon="solar:play-bold" width={14} sx={{ color: 'text.disabled' }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {formatCompactNumber(video.viewCount)}
            </Typography>

            {Number.isFinite(addedAtMs) && (
              <Typography variant="caption" sx={{ color: 'text.disabled', ml: 'auto' }} noWrap>
                {formatDateTime(addedAtMs)}
              </Typography>
            )}
          </Box>
        </Box>
      </CardActionArea>

      {/* Tag row — outside CardActionArea so chips/edit don't trigger navigation */}
      {tags && <TagRow tags={tags} onEditTags={onEditTags} />}
    </Card>
  );
}
