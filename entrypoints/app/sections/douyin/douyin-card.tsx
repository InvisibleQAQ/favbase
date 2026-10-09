import Avatar from '@mui/material/Avatar';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';

import { formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { CollectionCard, CollectionCardRow, CoverBadge } from '../../components/collection';
import { Label } from '../../components/label';
import { TagRow } from '../../components/tags';
import { formatDuration } from '../../utils/format-duration';
import type { DouyinItem } from '@/lib/douyin/douyin-sync-service';
import type { TagRef } from '@/lib/tagging';

export interface DouyinCardProps {
  favorite: DouyinItem;
  /** undefined = tag UI hidden entirely; [] = no tags yet, edit button only. */
  tags?: TagRef[];
  onEditTags?: (anchor: HTMLElement) => void;
}

/**
 * One Douyin favorite on the shared `CollectionCard` shell: cover with a
 * duration badge (videos), author header, the post text as a three-line
 * title, publish time, a "photos" stamp for image posts (图文 / 实况), and —
 * once a video's Content is its transcript — the CC / ASR source badge in
 * the footer, outside the link (the bilibili card's `info` chip, same
 * semantics: "has a transcript"). The cover is a CDN URL as Douyin returned
 * it; a failed load falls back to the platform glyph (the shell's own
 * fallback).
 */
export function DouyinCard({ favorite, tags, onEditTags }: DouyinCardProps) {
  // Subscribe to locale changes so formatDateTime / the stamp re-render.
  const { t } = useTranslation();
  const durationSeconds = favorite.durationMs ? Math.round(favorite.durationMs / 1000) : 0;
  const transcribed = favorite.subtitleSource === 'official' || favorite.subtitleSource === 'asr';

  return (
    <CollectionCard
      href={favorite.originalUrl}
      media={{
        src: favorite.coverUrl,
        alt: '',
        aspect: '16/9',
        fallbackIcon: <Iconify icon="simple-icons:tiktok" width={40} />,
        overlay:
          favorite.mediaKind === 'video' && durationSeconds > 0 ? (
            <CoverBadge>{formatDuration(durationSeconds)}</CoverBadge>
          ) : undefined,
      }}
      header={
        <>
          <Avatar src={favorite.avatarUrl ?? undefined} sx={{ width: 24, height: 24 }}>
            <Iconify icon="simple-icons:tiktok" width={16} />
          </Avatar>
          <Typography
            variant="caption"
            sx={{ fontWeight: 600, flex: '1 1 auto', minWidth: 0 }}
            noWrap
            title={favorite.authorName}
          >
            {favorite.authorName}
          </Typography>
        </>
      }
      title={favorite.title}
      titleLines={3}
      date={favorite.publishedAt ? formatDateTime(favorite.publishedAt.getTime()) : undefined}
      stamp={
        favorite.mediaKind === 'note' ? (
          <Label variant="soft">{t('douyin.mediaKind.note')}</Label>
        ) : undefined
      }
      tags={tags ? <TagRow tags={tags} onEditTags={onEditTags} /> : undefined}
      footer={
        transcribed ? (
          <CollectionCardRow sx={{ gap: 0.5 }}>
            <Chip
              label={t(favorite.subtitleSource === 'official' ? 'card.sourceCC' : 'card.sourceASR')}
              icon={<Iconify icon="solar:subtitles-bold-duotone" width={14} />}
              size="small"
              color="info"
            />
          </CollectionCardRow>
        ) : undefined
      }
    />
  );
}
