import type { TaggedItem } from '@/lib/tagging';
import type { BiliFavVideo } from '@/lib/bilibili/types';
import { narrowBiliVideoMeta } from '@/lib/bilibili/video-eligibility';
import { VideoCard } from './video-card';

/**
 * Map a platform-agnostic TaggedItem back to the minimal BiliFavVideo shape
 * VideoCard expects. `platform_meta` narrowing is delegated to
 * `narrowBiliVideoMeta`, the single owner of the shape videos-sync writes; this
 * adapter only adds the envelope fields the row itself carries.
 */
function toBiliFavVideo(item: TaggedItem): BiliFavVideo {
  return {
    ...narrowBiliVideoMeta(item.platformMeta),
    id: 0,
    title: item.title,
    bvid: item.platformItemId,
    upper: { mid: 0, name: item.authorName, face: '' },
  };
}

/**
 * Bilibili card adapter for TaggedItemGrid's renderCard prop. No transcribe
 * action bar — the tag-filtered grid is a knowledge-base view, not a folder view.
 */
export function TaggedVideoCard({
  item,
  onEditTags,
}: {
  item: TaggedItem;
  onEditTags: (anchor: HTMLElement) => void;
}) {
  return <VideoCard video={toBiliFavVideo(item)} tags={item.tags} onEditTags={onEditTags} />;
}
