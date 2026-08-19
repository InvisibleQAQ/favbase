import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

import {
  COLLECTION_PLATFORMS,
  type CollectionPlatform,
} from '@/lib/collections/platforms';

export type CollectionPage = LazyExoticComponent<ComponentType>;

/** Lazy page Adapter for every persisted Collection platform. */
export const COLLECTION_PAGE_LOADERS: Record<CollectionPlatform, CollectionPage> = {
  bilibili: lazy(() => import('./pages/bilibili')),
  github: lazy(() => import('./pages/github-stars')),
  bookmarks: lazy(() => import('./pages/bookmarks')),
  x: lazy(() => import('./pages/x')),
  zhihu: lazy(() => import('./pages/zhihu')),
  youtube: lazy(() => import('./pages/youtube')),
};

export interface CollectionPlatformRoute {
  platform: CollectionPlatform;
  path: `collections/${CollectionPlatform}`;
  Page: CollectionPage;
}

export const collectionPlatformRoutes: CollectionPlatformRoute[] = COLLECTION_PLATFORMS.map(
  (platform) => ({
    platform,
    path: `collections/${platform}`,
    Page: COLLECTION_PAGE_LOADERS[platform],
  }),
);
