import Avatar from '@mui/material/Avatar';
import Typography from '@mui/material/Typography';

import { formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { CollectionCard } from '../../components/collection';
import { TagRow } from '../../components/tags';
import type { BookmarkItem } from '@/lib/bookmarks/bookmarks-sync-service';
import type { TagRef } from '@/lib/tagging';
import { bookmarkFaviconUrl } from './bookmark-display';

export interface BookmarkCardProps {
  bookmark: BookmarkItem;
  /** undefined = tag UI hidden entirely (backward compatible); [] = no tags yet, edit button only. */
  tags?: TagRef[];
  onEditTags?: (anchor: HTMLElement) => void;
}

export function BookmarkCard({ bookmark, tags, onEditTags }: BookmarkCardProps) {
  // Subscribe to locale changes so formatDateTime re-renders.
  useTranslation();

  return (
    <CollectionCard
      href={bookmark.url}
      header={
        <>
          <Avatar
            src={bookmarkFaviconUrl(bookmark.url) || undefined}
            variant="rounded"
            sx={{ width: 20, height: 20, bgcolor: 'transparent' }}
          >
            <Iconify icon="solar:bookmark-bold-duotone" width={16} sx={{ color: 'text.secondary' }} />
          </Avatar>
          <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
            {bookmark.domain}
          </Typography>
        </>
      }
      title={bookmark.title}
      date={bookmark.dateAdded != null ? formatDateTime(bookmark.dateAdded) : undefined}
      tags={tags ? <TagRow tags={tags} onEditTags={onEditTags} /> : undefined}
    />
  );
}
