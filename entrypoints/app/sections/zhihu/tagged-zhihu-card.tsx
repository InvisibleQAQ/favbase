import type { TaggedItem } from '@/lib/tagging';
import { narrowZhihuMeta, type ZhihuFavoriteItem } from '@/lib/zhihu/zhihu-sync-service';
import { ZhihuCard } from './zhihu-card';

/**
 * Map a platform-agnostic TaggedItem back to the ZhihuFavoriteItem shape
 * ZhihuCard expects. platformMeta narrowing is delegated to the sync-service
 * (SSOT); this adapter only supplies the envelope fields. The click URL comes
 * from item.originalUrl, never derived.
 */
function toZhihuFavoriteItem(item: TaggedItem): ZhihuFavoriteItem {
  return {
    id: item.itemId,
    platformItemId: item.platformItemId,
    title: item.title,
    originalUrl: item.originalUrl,
    publishedAt: item.publishedAt,
    ...narrowZhihuMeta(item.platformMeta, { authorName: item.authorName }),
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
