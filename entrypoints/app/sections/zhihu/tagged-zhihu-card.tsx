import type { TaggedItem } from '@/lib/tagging';
import type { ZhihuFavoriteItem, ZhihuItemType } from '@/lib/zhihu/zhihu-sync-service';
import { ZhihuCard } from './zhihu-card';

const ZHIHU_TYPES: readonly ZhihuItemType[] = ['answer', 'article', 'pin', 'zvideo'];

/**
 * Map a platform-agnostic TaggedItem back to the ZhihuFavoriteItem shape
 * ZhihuCard expects. platformMeta was written by zhihu-sync-service with
 * { type, excerpt, authorName, avatarUrl, thumbnailUrl, collectionId,
 * collectionTitle }; missing fields get safe defaults (defensive narrowing,
 * mirroring TaggedTweetCard). The click URL comes from item.originalUrl,
 * never derived.
 */
function toZhihuFavoriteItem(item: TaggedItem): ZhihuFavoriteItem {
  const meta = item.platformMeta;
  return {
    id: item.itemId,
    platformItemId: item.platformItemId,
    type: ZHIHU_TYPES.includes(meta.type as ZhihuItemType) ? (meta.type as ZhihuItemType) : 'answer',
    title: item.title,
    excerpt: typeof meta.excerpt === 'string' ? meta.excerpt : '',
    authorName: typeof meta.authorName === 'string' ? meta.authorName : item.authorName,
    avatarUrl: typeof meta.avatarUrl === 'string' && meta.avatarUrl ? meta.avatarUrl : null,
    originalUrl: item.originalUrl,
    thumbnailUrl:
      typeof meta.thumbnailUrl === 'string' && meta.thumbnailUrl ? meta.thumbnailUrl : null,
    collectionTitle: typeof meta.collectionTitle === 'string' ? meta.collectionTitle : '',
    publishedAt: null,
  };
}

/** Zhihu card adapter for TaggedItemGrid's renderCard prop. */
export function TaggedZhihuCard({
  item,
  onEditTags,
}: {
  item: TaggedItem;
  onEditTags: (anchor: HTMLElement) => void;
}) {
  return <ZhihuCard favorite={toZhihuFavoriteItem(item)} tags={item.tags} onEditTags={onEditTags} />;
}
