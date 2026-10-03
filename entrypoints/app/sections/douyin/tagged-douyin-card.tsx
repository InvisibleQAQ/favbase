import { toDouyinItem } from '@/lib/douyin/douyin-sync-service';
import { taggedCard } from '../../components/tags';
import { DouyinCard } from './douyin-card';

/** Douyin card adapter for TaggedItemGrid's renderCard prop. */
export const TaggedDouyinCard = taggedCard(DouyinCard, 'favorite', toDouyinItem);
