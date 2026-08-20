import Typography from '@mui/material/Typography';

import { formatCompactNumber, formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { CollectionCard, CoverBadge } from '../../components/collection';
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

  const addedAtMs = video.addedAt ? Date.parse(video.addedAt) : NaN;

  return (
    <CollectionCard
      href={video.originalUrl}
      media={{
        src: video.thumbnailUrl,
        alt: video.title,
        aspect: '16/9',
        fallbackIcon: <Iconify icon="mdi:youtube" width={40} />,
        // Live streams / missing data report 0 — no badge rather than "0:00".
        overlay: video.durationSeconds > 0 ? (
          <CoverBadge>{formatDuration(video.durationSeconds)}</CoverBadge>
        ) : undefined,
      }}
      title={video.title}
      meta={
        <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
          {video.channelTitle}
        </Typography>
      }
      date={Number.isFinite(addedAtMs) ? formatDateTime(addedAtMs) : undefined}
      stats={
        <>
          <Iconify icon="solar:play-bold" width={14} sx={{ color: 'text.secondary' }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {formatCompactNumber(video.viewCount)}
          </Typography>
        </>
      }
      tags={tags ? <TagRow tags={tags} onEditTags={onEditTags} /> : undefined}
    />
  );
}
