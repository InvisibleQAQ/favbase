import type { TaggedItem } from '@/lib/tagging';
import type { YoutubeVideoItem } from '@/lib/youtube/youtube-sync-service';
import { YoutubeCard } from './youtube-card';

/**
 * Map a platform-agnostic TaggedItem back to the YoutubeVideoItem shape
 * YoutubeCard expects. platformMeta was written by youtube-sync-service with
 * { description, channelId, channelTitle, thumbnailUrl, durationSeconds,
 * viewCount, likeCount, addedAt, videoPublishedAt, playlistId, playlistTitle };
 * missing fields get safe defaults (defensive narrowing, mirroring
 * toXBookmarkItem). The click URL comes from item.originalUrl, never derived.
 */
function toYoutubeVideoItem(item: TaggedItem): YoutubeVideoItem {
  const meta = item.platformMeta;
  return {
    id: item.itemId,
    videoId: item.platformItemId,
    title: item.title,
    channelId: typeof meta.channelId === 'string' ? meta.channelId : '',
    channelTitle:
      typeof meta.channelTitle === 'string' && meta.channelTitle
        ? meta.channelTitle
        : item.authorName,
    thumbnailUrl:
      typeof meta.thumbnailUrl === 'string' && meta.thumbnailUrl ? meta.thumbnailUrl : null,
    durationSeconds: typeof meta.durationSeconds === 'number' ? meta.durationSeconds : 0,
    viewCount: typeof meta.viewCount === 'number' ? meta.viewCount : 0,
    likeCount: typeof meta.likeCount === 'number' ? meta.likeCount : 0,
    description: typeof meta.description === 'string' ? meta.description : '',
    originalUrl: item.originalUrl,
    addedAt: typeof meta.addedAt === 'string' && meta.addedAt ? meta.addedAt : null,
    videoPublishedAt:
      typeof meta.videoPublishedAt === 'string' && meta.videoPublishedAt
        ? meta.videoPublishedAt
        : null,
    publishedAt: null,
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
