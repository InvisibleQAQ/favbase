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

/**
 * Brand identity color per scheme, or `'ink'` for a black-logo brand (github,
 * x) that resolves to the scheme's own text ink in `theme/core/palette.ts`.
 *
 * Values come from the dataviz palette validator (adjacent-pairs mode; all six
 * checks pass on both the ground and the neutral tile of each scheme — raw
 * brand hexes such as bilibili `#FB7299` fail contrast at 2.4:1). Changing one
 * REQUIRES re-running the validator and updating
 * `.trellis/tasks/08-20-analytics-platform-brand-colors/research/palette-validation.md`;
 * `theme/core/palette.test.ts` locks every value and its >= 3:1 contrast.
 */
export type PlatformBrandPalette = { readonly light: string; readonly dark: string } | 'ink';

/**
 * The app-side half of the Platform Descriptor (docs/26 D3): the per-platform
 * facts whose types are app-owned — `LocaleKeys` and `IconifyName` — so they
 * cannot live in `lib/collections/platform-descriptor.ts` next to the domain
 * five. Adding a platform is a compile error on this literal until all five
 * fields are declared.
 *
 * `title` / `icon` feed the navigation registry below; `palette` feeds the
 * theme's `platform` palette; `hint` feeds the welcome platform picker;
 * `childRoutes` feeds the router (an explicit `[]` for a flat platform).
 */
export interface CollectionPlatformMeta {
  title: LocaleKeys;
  icon: IconifyName;
  palette: PlatformBrandPalette;
  hint: LocaleKeys;
  childRoutes: readonly string[];
}

export const PLATFORM_META: Record<CollectionPlatform, CollectionPlatformMeta> = {
  bilibili: {
    title: 'nav.bilibiliFavorites',
    icon: 'simple-icons:bilibili',
    palette: { light: '#C2185B', dark: '#E8497F' },
    hint: 'welcome.picker.hint.bilibili',
    childRoutes: [':mediaId'],
  },
  github: {
    title: 'nav.githubStars',
    icon: 'mdi:github',
    palette: 'ink',
    hint: 'welcome.picker.hint.github',
    childRoutes: [],
  },
  bookmarks: {
    title: 'nav.bookmarks',
    icon: 'solar:bookmark-bold-duotone',
    palette: { light: '#B8760A', dark: '#BF8A10' },
    hint: 'welcome.picker.hint.bookmarks',
    childRoutes: [':folderId'],
  },
  x: {
    title: 'nav.xBookmarks',
    icon: 'mdi:twitter',
    palette: 'ink',
    hint: 'welcome.picker.hint.x',
    childRoutes: [],
  },
  zhihu: {
    title: 'nav.zhihuFavorites',
    icon: 'simple-icons:zhihu',
    palette: { light: '#1A73E8', dark: '#3B8BEA' },
    hint: 'welcome.picker.hint.zhihu',
    childRoutes: [],
  },
  youtube: {
    title: 'nav.youtubePlaylists',
    icon: 'mdi:youtube',
    palette: { light: '#C62828', dark: '#D94040' },
    hint: 'welcome.picker.hint.youtube',
    childRoutes: [],
  },
};

/** UI metadata for every persisted collection platform, in navigation order. */
export const collectionPlatformRegistry: CollectionPlatformConfig[] =
  COLLECTION_PLATFORMS.map((id) => {
    const { title, icon } = PLATFORM_META[id];
    return { id, path: `/collections/${id}`, title, icon };
  });

/**
 * The same registry keyed by discriminator, for the consumers that resolve one
 * platform at a time (chat source cards, the analytics composition legend and
 * detail card). It lives with the registry because every consumer that built
 * its own `new Map(...)` was building the identical map.
 */
export const collectionPlatformById: ReadonlyMap<CollectionPlatform, CollectionPlatformConfig> =
  new Map(collectionPlatformRegistry.map((config) => [config.id, config]));
