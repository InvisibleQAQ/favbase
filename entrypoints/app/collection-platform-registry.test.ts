import { describe, expect, it } from 'vitest';

import { COLLECTION_PLATFORMS } from '@/lib/collections';
import { collectionPlatformRegistry } from './collection-platform-registry';
import { createNavData, type NavGroup } from './layouts/nav-config';

/** The Collections branch, wherever its group sits (docs/25 D16 grouping). */
function collectionsItem(groups: NavGroup[]) {
  return groups.flatMap((group) => group.items).find((item) => item.path === '/collections');
}

describe('collection platform registry', () => {
  it('groups the nav as Collections then General, Collections branch first', () => {
    expect(
      createNavData().map((group) => ({
        subheader: group.subheader,
        paths: group.items.map((item) => item.path),
      })),
    ).toEqual([
      { subheader: 'nav.groupCollections', paths: ['/collections'] },
      { subheader: 'nav.groupGeneral', paths: ['/', '/chat', '/settings'] },
    ]);
  });

  it('covers every persisted collection platform in canonical order', () => {
    expect(collectionPlatformRegistry.map((platform) => platform.id)).toEqual(
      COLLECTION_PLATFORMS,
    );
    expect(collectionPlatformRegistry.map((platform) => platform.path)).toEqual(
      COLLECTION_PLATFORMS.map((platform) => `/collections/${platform}`),
    );
  });

  it('drives the Collections navigation children without a second platform list', () => {
    const collectionsNav = collectionsItem(createNavData());
    const platformLeaves = collectionsNav?.children?.filter((child) => !child.external);

    expect(platformLeaves?.map(({ title, path, platform }) => ({ title, path, platform }))).toEqual(
      collectionPlatformRegistry.map(({ id, title, path }) => ({ title, path, platform: id })),
    );
  });

  it('places onboarding preferences first in canonical platform order', () => {
    const collectionsNav = collectionsItem(createNavData(['x', 'bilibili', 'github']));
    const platformPaths = collectionsNav?.children
      ?.filter((child) => !child.external)
      .map((child) => child.path);

    expect(platformPaths).toEqual([
      '/collections/bilibili',
      '/collections/github',
      '/collections/x',
      '/collections/bookmarks',
      '/collections/zhihu',
      '/collections/youtube',
    ]);
  });

  it('keeps Platform Request as the single trailing external action link', () => {
    const collectionsNav = collectionsItem(createNavData());
    const externals = collectionsNav?.children?.filter((child) => child.external) ?? [];

    expect(externals).toHaveLength(1);
    expect(collectionsNav?.children?.at(-1)).toBe(externals[0]);
    expect(externals[0]?.title).toBe('nav.requestPlatform');
    // A full URL, not a route: active-route matching can never highlight it.
    expect(externals[0]?.path).toMatch(/^https:\/\/github\.com\/.+\/issues\/new\?/);
  });
});
