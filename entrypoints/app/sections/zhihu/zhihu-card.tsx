import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Avatar from '@mui/material/Avatar';
import Typography from '@mui/material/Typography';

import { formatDateTime } from '@/lib/i18n';
import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { TagRow } from '../../components/tags';
import type { ZhihuFavoriteItem, ZhihuItemType } from '@/lib/zhihu/zhihu-sync-service';
import type { TagRef } from '@/lib/tagging';

export interface ZhihuCardProps {
  favorite: ZhihuFavoriteItem;
  /** undefined = tag UI hidden entirely; [] = no tags yet, edit button only. */
  tags?: TagRef[];
  onEditTags?: (anchor: HTMLElement) => void;
}

/** Content-type badge locale keys (exhaustive over ZhihuItemType). */
const TYPE_LABEL_KEY: Record<ZhihuItemType, LocaleKeys> = {
  answer: 'zhihu.type.answer',
  article: 'zhihu.type.article',
  pin: 'zhihu.type.pin',
  zvideo: 'zhihu.type.zvideo',
};

export function ZhihuCard({ favorite, tags, onEditTags }: ZhihuCardProps) {
  // Subscribe to locale changes so formatDateTime / type labels re-render.
  const { t } = useTranslation();

  const handleClick = () => {
    window.open(favorite.originalUrl, '_blank');
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
          {/* Author avatar + name + content-type badge */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Avatar src={favorite.avatarUrl ?? undefined} sx={{ width: 32, height: 32 }}>
              <Iconify icon="simple-icons:zhihu" width={18} />
            </Avatar>
            <Typography
              variant="subtitle2"
              sx={{ fontWeight: 600, minWidth: 0, flex: '1 1 auto' }}
              noWrap
              title={favorite.authorName}
            >
              {favorite.authorName}
            </Typography>
            <Chip
              size="small"
              variant="outlined"
              label={t(TYPE_LABEL_KEY[favorite.type])}
              sx={{ flexShrink: 0 }}
            />
          </Box>

          {/* Title — 2-line clamp */}
          <Typography
            variant="subtitle2"
            title={favorite.title}
            sx={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              wordBreak: 'break-word',
            }}
          >
            {favorite.title}
          </Typography>

          {/* Excerpt — 3-line clamp */}
          {favorite.excerpt && (
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                wordBreak: 'break-word',
              }}
            >
              {favorite.excerpt}
            </Typography>
          )}

          {/* Cover thumbnail, if any */}
          {favorite.thumbnailUrl && (
            <Box
              component="img"
              src={favorite.thumbnailUrl}
              alt=""
              loading="lazy"
              sx={{ width: 1, height: 96, objectFit: 'cover', borderRadius: 1, display: 'block' }}
            />
          )}

          {/* Footer: collection membership + published time */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 'auto', pt: 0.5, minWidth: 0 }}>
            {favorite.collectionTitle && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                <Iconify icon="solar:bookmark-bold-duotone" width={14} sx={{ color: 'text.disabled', flexShrink: 0 }} />
                <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                  {favorite.collectionTitle}
                </Typography>
              </Box>
            )}
            {favorite.publishedAt && (
              <Typography variant="caption" sx={{ color: 'text.disabled', ml: 'auto', flexShrink: 0 }} noWrap>
                {formatDateTime(favorite.publishedAt.getTime())}
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
