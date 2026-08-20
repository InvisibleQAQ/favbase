import Chip from '@mui/material/Chip';
import Avatar from '@mui/material/Avatar';
import Typography from '@mui/material/Typography';

import { formatDateTime } from '@/lib/i18n';
import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { CollectionCard } from '../../components/collection';
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

  return (
    <CollectionCard
      href={favorite.originalUrl}
      media={
        favorite.thumbnailUrl
          ? {
              src: favorite.thumbnailUrl,
              alt: '',
              aspect: '1/1',
              fallbackIcon: <Iconify icon="simple-icons:zhihu" width={24} />,
            }
          : undefined
      }
      header={
        <>
          <Avatar src={favorite.avatarUrl ?? undefined} sx={{ width: 24, height: 24 }}>
            <Iconify icon="simple-icons:zhihu" width={16} />
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
      body={
        favorite.excerpt ? (
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
        ) : undefined
      }
      meta={
        favorite.collectionTitle ? (
          <>
            <Iconify icon="solar:bookmark-bold-duotone" width={14} sx={{ color: 'text.secondary', flexShrink: 0 }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
              {favorite.collectionTitle}
            </Typography>
          </>
        ) : undefined
      }
      date={favorite.publishedAt ? formatDateTime(favorite.publishedAt.getTime()) : undefined}
      stamp={<Chip size="small" variant="outlined" label={t(TYPE_LABEL_KEY[favorite.type])} />}
      tags={tags ? <TagRow tags={tags} onEditTags={onEditTags} /> : undefined}
    />
  );
}
