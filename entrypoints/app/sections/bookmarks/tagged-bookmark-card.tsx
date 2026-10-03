import { toBookmarkItem } from '@/lib/bookmarks/bookmarks-sync-service';
import { taggedCard } from '../../components/tags';
import { BookmarkCard } from './bookmark-card';

/** Bookmark card adapter for TaggedItemGrid's renderCard prop. */
export const TaggedBookmarkCard = taggedCard(BookmarkCard, 'bookmark', toBookmarkItem);
