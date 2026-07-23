import type { TaggedItem } from '@/lib/tagging';
import { narrowYoutubeMeta, type YoutubeVideoItem } from '@/lib/youtube/youtube-sync-service';
import { YoutubeCard } from './youtube-card';

/**
 * Map a platform-agnostic TaggedItem back to the YoutubeVideoItem shape
 * YoutubeCard expects. platformMeta narrowing is delegated to the sync-service
 * (SSOT); this adapter only supplies the envelope fields. The click URL comes
 * from item.originalUrl, never derived.
 */
function toYoutubeVideoItem(item: TaggedItem): YoutubeVideoItem {
  return {
    id: item.itemId,
    videoId: item.platformItemId,
    title: item.title,
    originalUrl: item.originalUrl,
    publishedAt: item.publishedAt,
    ...narrowYoutubeMeta(item.platformMeta, { authorName: item.authorName }),
  };
}

/** YouTube card adapter for TaggedItemGrid's renderCard prop. */
export function TaggedYoutubeCard({
  item,
  onEditTags,
}: {
  item: TaggedItem;
  onEditTags: (anchor: HTMLElement) => void;
}) {
  return <YoutubeCard video={toYoutubeVideoItem(item)} tags={item.tags} onEditTags={onEditTags} />;
}
