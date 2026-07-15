import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Box from '@mui/material/Box';
import Avatar from '@mui/material/Avatar';
import Typography from '@mui/material/Typography';

import { formatCompactNumber, formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import type { IconifyName } from '../../components/iconify/register-icons';
import { TagRow } from '../../components/tags';
import type { XBookmarkItem } from '@/lib/x/x-sync-service';
import type { TagRef } from '@/lib/tagging';

export interface XCardProps {
  bookmark: XBookmarkItem;
  /** undefined = tag UI hidden entirely (backward compatible); [] = no tags yet, edit button only. */
  tags?: TagRef[];
  onEditTags?: (anchor: HTMLElement) => void;
}

/** A single image/video thumbnail from the tweet's media list. */
function MediaThumb({ url }: { url: string }) {
  return (
    <Box
      component="img"
      src={url}
      alt=""
      loading="lazy"
      sx={{
        width: 1,
        height: 96,
        objectFit: 'cover',
        borderRadius: 1,
        display: 'block',
      }}
    />
  );
}

function StatItem({ icon, value }: { icon: IconifyName; value: number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
      <Iconify icon={icon} width={14} sx={{ color: 'text.disabled' }} />
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {formatCompactNumber(value)}
      </Typography>
    </Box>
  );
}

export function XCard({ bookmark, tags, onEditTags }: XCardProps) {
  // Subscribe to locale changes so formatCompactNumber/formatDateTime re-render.
  useTranslation();

  const handleClick = () => {
    window.open(bookmark.originalUrl, '_blank');
  };

  // Show at most the first media item as a thumbnail (compact card).
  const thumb = bookmark.media.find((m) => m.url)?.url;

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
          {/* Author avatar + name + @handle */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Avatar src={bookmark.avatarUrl ?? undefined} sx={{ width: 32, height: 32 }}>
              <Iconify icon="mdi:twitter" width={18} />
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }} noWrap title={bookmark.authorName}>
                {bookmark.authorName}
              </Typography>
              {bookmark.authorHandle && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                  {`@${bookmark.authorHandle}`}
                </Typography>
              )}
            </Box>
          </Box>

          {/* Tweet text — 3-line clamp */}
          {bookmark.text && (
            <Typography
              variant="body2"
              title={bookmark.text}
              sx={{
                color: 'text.primary',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {bookmark.text}
            </Typography>
          )}

          {/* First media thumbnail, if any */}
          {thumb && <MediaThumb url={thumb} />}

          {/* Footer: engagement stats + published time */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 'auto', pt: 0.5 }}>
            <StatItem icon="mdi:heart-outline" value={bookmark.likeCount} />
            <StatItem icon="mdi:repeat-variant" value={bookmark.retweetCount} />
            <StatItem icon="mdi:comment-outline" value={bookmark.replyCount} />

            {bookmark.publishedAt && (
              <Typography variant="caption" sx={{ color: 'text.disabled', ml: 'auto' }} noWrap>
                {formatDateTime(bookmark.publishedAt.getTime())}
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
