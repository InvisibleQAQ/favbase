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

    expect(collectionsNav?.children?.map(({ title, path }) => ({ title, path }))).toEqual(
      collectionPlatformRegistry.map(({ title, path }) => ({ title, path })),
    );
  });
});
