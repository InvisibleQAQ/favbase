import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Box from '@mui/material/Box';
import Avatar from '@mui/material/Avatar';
import Typography from '@mui/material/Typography';

import { formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { TagRow } from '../../components/tags';
import type { BookmarkItem } from '@/lib/bookmarks/bookmarks-sync-service';
import type { TagRef } from '@/lib/tagging';

/** MV3 local favicon endpoint (needs the `favicon` permission). Keeps favicon
 *  resolution on-device — no third-party favicon service is contacted. */
function faviconUrl(pageUrl: string): string {
  try {
    const u = new URL(chrome.runtime.getURL('/_favicon/'));
    u.searchParams.set('pageUrl', pageUrl);
    u.searchParams.set('size', '32');
    return u.toString();
  } catch {
    return '';
  }
}

export interface BookmarkCardProps {
  bookmark: BookmarkItem;
  /** undefined = tag UI hidden entirely (backward compatible); [] = no tags yet, edit button only. */
  tags?: TagRef[];
  onEditTags?: (anchor: HTMLElement) => void;
}

export function BookmarkCard({ bookmark, tags, onEditTags }: BookmarkCardProps) {
  // Subscribe to locale changes so formatDateTime re-renders.
  useTranslation();

  const handleClick = () => {
    window.open(bookmark.url, '_blank');
  };

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
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1, flex: '1 1 auto' }}>
          {/* Favicon + title */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Avatar
              src={faviconUrl(bookmark.url) || undefined}
              variant="rounded"
              sx={{ width: 32, height: 32, bgcolor: 'transparent' }}
            >
              <Iconify icon="solar:bookmark-bold-duotone" width={20} sx={{ color: 'text.secondary' }} />
            </Avatar>
            <Typography
              variant="subtitle2"
              title={bookmark.title}
              sx={{
                fontWeight: 600,
                minWidth: 0,
                wordBreak: 'break-word',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {bookmark.title}
            </Typography>
          </Box>

          {/* Footer: domain + added time */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 'auto', pt: 0.5 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 0 }} noWrap>
              {bookmark.domain}
            </Typography>
            {bookmark.dateAdded != null && (
              <Typography variant="caption" sx={{ color: 'text.disabled', ml: 'auto', flexShrink: 0 }} noWrap>
                {formatDateTime(bookmark.dateAdded)}
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
