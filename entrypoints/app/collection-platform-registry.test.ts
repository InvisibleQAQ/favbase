import { describe, expect, it } from 'vitest';

import { COLLECTION_PLATFORMS } from '@/lib/collections';
import { collectionPlatformRegistry } from './collection-platform-registry';
import { navData } from './layouts/nav-config';

describe('collection platform registry', () => {
  it('covers every persisted collection platform in canonical order', () => {
    expect(collectionPlatformRegistry.map((platform) => platform.id)).toEqual(
      COLLECTION_PLATFORMS,
    );
    expect(collectionPlatformRegistry.map((platform) => platform.path)).toEqual(
      COLLECTION_PLATFORMS.map((platform) => `/collections/${platform}`),
    );
  });

  it('drives the Collections navigation children without a second platform list', () => {
    const collectionsNav = navData.find((item) => item.path === '/collections');
    const platformLeaves = collectionsNav?.children?.filter((child) => !child.external);

    expect(platformLeaves?.map(({ title, path }) => ({ title, path }))).toEqual(
      collectionPlatformRegistry.map(({ title, path }) => ({ title, path })),
    );
  });

  it('keeps Platform Request as the single trailing external action link', () => {
    const collectionsNav = navData.find((item) => item.path === '/collections');
    const externals = collectionsNav?.children?.filter((child) => child.external) ?? [];

    expect(externals).toHaveLength(1);
    expect(collectionsNav?.children?.at(-1)).toBe(externals[0]);
    expect(externals[0]?.title).toBe('nav.requestPlatform');
    // A full URL, not a route: active-route matching can never highlight it.
    expect(externals[0]?.path).toMatch(/^https:\/\/github\.com\/.+\/issues\/new\?/);
  });
});
