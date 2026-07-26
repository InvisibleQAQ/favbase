// Straight from the pure discriminator module, not the `@/lib/collections`
// barrel: the barrel re-exports these through `collections-query`, which drags
// drizzle + `@/lib/database` into every static import graph that touches this
// registry (welcome.html has no database at all).
import type { CollectionPlatform } from '@/lib/collections/platforms';
import { COLLECTION_PLATFORMS } from '@/lib/collections/platforms';
import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';

import type { IconifyName } from './components/iconify/register-icons';

export interface CollectionPlatformConfig {
  id: CollectionPlatform;
  title: LocaleKeys;
  path: `/collections/${CollectionPlatform}`;
  icon: IconifyName;
}

const PLATFORM_META: Record<
  CollectionPlatform,
  Pick<CollectionPlatformConfig, 'title' | 'icon'>
> = {
  bilibili: { title: 'nav.bilibiliFavorites', icon: 'simple-icons:bilibili' },
  github: { title: 'nav.githubStars', icon: 'mdi:github' },
  bookmarks: { title: 'nav.bookmarks', icon: 'solar:bookmark-bold-duotone' },
  x: { title: 'nav.xBookmarks', icon: 'mdi:twitter' },
  zhihu: { title: 'nav.zhihuFavorites', icon: 'simple-icons:zhihu' },
  youtube: { title: 'nav.youtubePlaylists', icon: 'mdi:youtube' },
};

/** UI metadata for every persisted collection platform, in navigation order. */
export const collectionPlatformRegistry: CollectionPlatformConfig[] =
  COLLECTION_PLATFORMS.map((id) => ({
    id,
    path: `/collections/${id}`,
    ...PLATFORM_META[id],
  }));
