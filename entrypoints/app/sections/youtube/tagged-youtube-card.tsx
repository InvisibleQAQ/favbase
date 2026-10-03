import { toYoutubeVideoItem } from '@/lib/youtube/youtube-sync-service';
import { taggedCard } from '../../components/tags';
import { YoutubeCard } from './youtube-card';

/** YouTube card adapter for TaggedItemGrid's renderCard prop. */
export const TaggedYoutubeCard = taggedCard(YoutubeCard, 'video', toYoutubeVideoItem);
