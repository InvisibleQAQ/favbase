import type { TaggedItem } from '@/lib/tagging';
import { narrowBookmarkMeta, type BookmarkItem } from '@/lib/bookmarks/bookmarks-sync-service';
import { BookmarkCard } from './bookmark-card';

/**
 * Map a platform-agnostic TaggedItem back to the BookmarkItem shape BookmarkCard
 * expects. `platform_meta` narrowing is delegated to `narrowBookmarkMeta` — the
 * same decoder the bookmarks query uses, so the tag grid and the folder grid
 * show the same domain and date. The click-through URL comes from originalUrl,
 * never derived.
 */
function toBookmarkItem(item: TaggedItem): BookmarkItem {
  return {
    id: item.itemId,
    normalizedUrl: item.platformItemId,
    title: item.title,
    url: item.originalUrl,
    ...narrowBookmarkMeta(item.platformMeta, item),
  };
}

/** Bookmark card adapter for TaggedItemGrid's renderCard prop. */
export function TaggedBookmarkCard({
  item,
  onEditTags,
}: {
  item: TaggedItem;
  onEditTags: (anchor: HTMLElement) => void;
}) {
  return <BookmarkCard bookmark={toBookmarkItem(item)} tags={item.tags} onEditTags={onEditTags} />;
}
