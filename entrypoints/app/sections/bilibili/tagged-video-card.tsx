import type { PagedItemRow } from '@/lib/database/collection-queries';
import type { BiliFavVideo } from '@/lib/bilibili/types';
import { narrowBiliVideoMeta } from '@/lib/bilibili/video-eligibility';
import { taggedCard } from '../../components/tags';
import { VideoCard } from './video-card';

/**
 * Map a local `items` row back to the minimal BiliFavVideo shape VideoCard
 * expects. `platform_meta` narrowing is delegated to `narrowBiliVideoMeta`, the
 * single owner of the shape videos-sync writes; this adapter only adds the
 * envelope fields the row itself carries. It lives here rather than in
 * `lib/bilibili` because bilibili has no paged local query to share a `mapRow`
 * with: its folder grid browses the remote API (docs/32 D4).
 */
function toBiliFavVideo(row: PagedItemRow): BiliFavVideo {
  return {
    ...narrowBiliVideoMeta(row.platformMeta),
    id: 0,
    title: row.title,
    bvid: row.platformItemId,
    upper: { mid: 0, name: row.authorName, face: '' },
  };
}

/**
 * Bilibili card adapter for TaggedItemGrid's renderCard prop. No transcribe
 * action bar — the tag-filtered grid is a knowledge-base view, not a folder view.
 */
export const TaggedVideoCard = taggedCard(VideoCard, 'video', toBiliFavVideo);
