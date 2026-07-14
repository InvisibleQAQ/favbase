import type { TaggedItem } from '@/lib/tagging';
import type { BookmarkItem } from '@/lib/bookmarks/bookmarks-sync-service';
import { BookmarkCard } from './bookmark-card';

/**
 * Map a platform-agnostic TaggedItem back to the BookmarkItem shape BookmarkCard
 * expects. platformMeta was written by bookmarks-sync-service with { domain,
 * dateAdded }; missing fields get safe defaults (defensive narrowing, mirroring
 * toGithubRepoItem). The click-through URL comes from originalUrl, never derived.
 */
function toBookmarkItem(item: TaggedItem): BookmarkItem {
  const meta = item.platformMeta;
  return {
    id: item.itemId,
    normalizedUrl: item.platformItemId,
    title: item.title,
    url: item.originalUrl,
    domain: typeof meta.domain === 'string' ? meta.domain : item.authorName,
    dateAdded: typeof meta.dateAdded === 'number' ? meta.dateAdded : null,
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
