import Box from '@mui/material/Box';
import Avatar from '@mui/material/Avatar';
import Typography from '@mui/material/Typography';

import { formatCompactNumber, formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import type { IconifyName } from '../../components/iconify/register-icons';
import { CollectionCard } from '../../components/collection';
import { TagRow } from '../../components/tags';
import type { XBookmarkItem } from '@/lib/x/x-sync-service';
import type { TagRef } from '@/lib/tagging';

export interface XCardProps {
  bookmark: XBookmarkItem;
  /** undefined = tag UI hidden entirely (backward compatible); [] = no tags yet, edit button only. */
  tags?: TagRef[];
  onEditTags?: (anchor: HTMLElement) => void;
}

/** Blank lines inside a tweet would clamp into an orphaned "…" row. */
export function normalizeTweetText(text: string): string {
  return text.replace(/\n{2,}/g, '\n').trim();
}

function StatItem({ icon, value }: { icon: IconifyName; value: number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
      <Iconify icon={icon} width={14} sx={{ color: 'text.secondary' }} />
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {formatCompactNumber(value)}
      </Typography>
    </Box>
  );
}

export function XCard({ bookmark, tags, onEditTags }: XCardProps) {
  // Subscribe to locale changes so formatCompactNumber/formatDateTime re-render.
  useTranslation();

  // The first media item is the entry's cover (compact card).
  const thumb = bookmark.media.find((m) => m.url)?.url ?? null;
  const text = normalizeTweetText(bookmark.text || bookmark.title);

  return (
    <CollectionCard
      href={bookmark.originalUrl}
      media={
        thumb
          ? {
              src: thumb,
              alt: '',
              aspect: '1/1',
              fallbackIcon: <Iconify icon="mdi:twitter" width={24} />,
            }
          : undefined
      }
      header={
        <>
          <Avatar src={bookmark.avatarUrl ?? undefined} sx={{ width: 24, height: 24 }}>
            <Iconify icon="mdi:twitter" width={16} />
          </Avatar>
          <Box sx={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <Typography variant="caption" sx={{ fontWeight: 600 }} noWrap title={bookmark.authorName}>
              {bookmark.authorName}
            </Typography>
            {bookmark.authorHandle && (
              <Typography
                variant="caption"
                sx={{ color: 'text.secondary' }}
                noWrap
                title={`@${bookmark.authorHandle}`}
              >
                {`@${bookmark.authorHandle}`}
              </Typography>
            )}
          </Box>
        </>
      }
      title={text}
      titleLines={3}
      date={bookmark.publishedAt ? formatDateTime(bookmark.publishedAt.getTime()) : undefined}
      stats={
        <>
          <StatItem icon="mdi:heart-outline" value={bookmark.likeCount} />
          <StatItem icon="mdi:repeat-variant" value={bookmark.retweetCount} />
          <StatItem icon="mdi:comment-outline" value={bookmark.replyCount} />
        </>
      }
      tags={tags ? <TagRow tags={tags} onEditTags={onEditTags} /> : undefined}
    />
  );
}
