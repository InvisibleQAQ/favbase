import { toZhihuFavoriteItem } from '@/lib/zhihu/zhihu-sync-service';
import { taggedCard } from '../../components/tags';
import { ZhihuCard } from './zhihu-card';

/** Zhihu card adapter for TaggedItemGrid's renderCard prop. */
export const TaggedZhihuCard = taggedCard(ZhihuCard, 'favorite', toZhihuFavoriteItem);
