import type { TaggedItem } from '@/lib/tagging';
import type { BiliFavVideo } from '@/lib/bilibili/types';
import { VideoCard } from './video-card';

/**
 * Map a platform-agnostic TaggedItem back to the minimal BiliFavVideo shape
 * VideoCard expects. platformMeta was written by videos-sync with
 * { cover, intro, duration, cnt_info, attr, type, fav_time }; missing fields
 * get safe defaults.
 */
function toBiliFavVideo(item: TaggedItem): BiliFavVideo {
  const meta = item.platformMeta;
  return {
    id: 0,
    type: typeof meta.type === 'number' ? meta.type : 0,
    title: item.title,
    cover: typeof meta.cover === 'string' ? meta.cover : '',
    intro: typeof meta.intro === 'string' ? meta.intro : '',
    duration: typeof meta.duration === 'number' ? meta.duration : 0,
    bvid: item.platformItemId,
    upper: { mid: 0, name: item.authorName, face: '' },
    cnt_info:
      (meta.cnt_info as BiliFavVideo['cnt_info'] | undefined) ?? {
        play: 0,
        collect: 0,
        danmaku: 0,
      },
    fav_time: typeof meta.fav_time === 'number' ? meta.fav_time : 0,
    attr: typeof meta.attr === 'number' ? meta.attr : 0,
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
