import type { ComponentType } from 'react';

import type { CollectionItem, CollectionPlatform } from '@/lib/collections';

import type { TaggedCardProps } from '../../components/tags';

import { TaggedVideoCard } from '../bilibili/tagged-video-card';
import { TaggedBookmarkCard } from '../bookmarks/tagged-bookmark-card';
import { TaggedRepoCard } from '../github-stars/tagged-repo-card';
import { TaggedTweetCard } from '../x/tagged-tweet-card';
import { TaggedYoutubeCard } from '../youtube/tagged-youtube-card';
import { TaggedZhihuCard } from '../zhihu/tagged-zhihu-card';

const CARD_ADAPTERS: Record<CollectionPlatform, ComponentType<TaggedCardProps>> = {
  bilibili: TaggedVideoCard,
  github: TaggedRepoCard,
  bookmarks: TaggedBookmarkCard,
  x: TaggedTweetCard,
  zhihu: TaggedZhihuCard,
  youtube: TaggedYoutubeCard,
};

export function CollectionItemCard({
  item,
  onEditTags,
}: {
  item: CollectionItem;
  onEditTags: (anchor: HTMLElement) => void;
}) {
  const Adapter = CARD_ADAPTERS[item.platform];
  return <Adapter item={item} onEditTags={onEditTags} />;
}
