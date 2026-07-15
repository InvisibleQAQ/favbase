import type { TaggedItem } from '@/lib/tagging';
import type { XBookmarkItem } from '@/lib/x/x-sync-service';
import type { XMedia } from '@/lib/x/x-api';
import { XCard } from './x-card';

/** Narrow the loose platformMeta.media into XMedia[] (drop malformed entries). */
function narrowMedia(raw: unknown): XMedia[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is XMedia =>
        !!m &&
        typeof m === 'object' &&
        typeof (m as XMedia).type === 'string' &&
        typeof (m as XMedia).url === 'string',
    )
    .map((m) => ({ type: m.type, url: m.url }));
}

/**
 * Map a platform-agnostic TaggedItem back to the XBookmarkItem shape XCard
 * expects. platformMeta was written by x-sync-service with { text, authorHandle,
 * authorName, avatarUrl, media[], likeCount, retweetCount, replyCount, lang };
 * missing fields get safe defaults (defensive narrowing, mirroring
 * toGithubRepoItem). The click URL comes from item.originalUrl, never derived.
 */
function toXBookmarkItem(item: TaggedItem): XBookmarkItem {
  const meta = item.platformMeta;
  return {
    id: item.itemId,
    tweetId: item.platformItemId,
    title: item.title,
    text: typeof meta.text === 'string' ? meta.text : item.title,
    authorName: typeof meta.authorName === 'string' ? meta.authorName : item.authorName,
    authorHandle: typeof meta.authorHandle === 'string' ? meta.authorHandle : '',
    avatarUrl: typeof meta.avatarUrl === 'string' && meta.avatarUrl ? meta.avatarUrl : null,
    originalUrl: item.originalUrl,
    media: narrowMedia(meta.media),
    likeCount: typeof meta.likeCount === 'number' ? meta.likeCount : 0,
    retweetCount: typeof meta.retweetCount === 'number' ? meta.retweetCount : 0,
    replyCount: typeof meta.replyCount === 'number' ? meta.replyCount : 0,
    lang: typeof meta.lang === 'string' ? meta.lang : '',
    publishedAt: null,
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
