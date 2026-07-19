import type { TaggedItem } from '@/lib/tagging';
import { narrowXMeta, type XBookmarkItem } from '@/lib/x/x-sync-service';
import { XCard } from './x-card';

/**
 * Map a platform-agnostic TaggedItem back to the XBookmarkItem shape XCard
 * expects. platformMeta narrowing is delegated to the sync-service (SSOT); this
 * adapter only supplies the envelope fields. The click URL comes from
 * item.originalUrl, never derived.
 */
function toXBookmarkItem(item: TaggedItem): XBookmarkItem {
  return {
    id: item.itemId,
    tweetId: item.platformItemId,
    title: item.title,
    originalUrl: item.originalUrl,
    publishedAt: null,
    ...narrowXMeta(item.platformMeta, { title: item.title, authorName: item.authorName }),
  };
}

/** X card adapter for TaggedItemGrid's renderCard prop. */
export function TaggedTweetCard({
  item,
  onEditTags,
}: {
  item: TaggedItem;
  onEditTags: (anchor: HTMLElement) => void;
}) {
  return <XCard bookmark={toXBookmarkItem(item)} tags={item.tags} onEditTags={onEditTags} />;
}
