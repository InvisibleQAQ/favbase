import { toXBookmarkItem } from '@/lib/x/x-sync-service';
import { taggedCard } from '../../components/tags';
import { XCard } from './x-card';

/** X card adapter for TaggedItemGrid's renderCard prop. */
export const TaggedTweetCard = taggedCard(XCard, 'bookmark', toXBookmarkItem);
