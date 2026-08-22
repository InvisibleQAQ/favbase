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

/** Child param segments that render the same lazy Page; flat platforms declare an explicit empty list. */
export const COLLECTION_PAGE_CHILD_ROUTES: Record<CollectionPlatform, readonly string[]> = {
  bilibili: [':mediaId'],
  github: [],
  bookmarks: [':folderId'],
  x: [],
  zhihu: [],
  youtube: [],
};

export interface CollectionPlatformRoute {
  platform: CollectionPlatform;
  path: `collections/${CollectionPlatform}` | `collections/${CollectionPlatform}/${string}`;
  Page: CollectionPage;
}

export const collectionPlatformRoutes: CollectionPlatformRoute[] = COLLECTION_PLATFORMS.flatMap(
  (platform): CollectionPlatformRoute[] => {
    const Page = COLLECTION_PAGE_LOADERS[platform];
    return [
      { platform, path: `collections/${platform}`, Page },
      ...COLLECTION_PAGE_CHILD_ROUTES[platform].map(
        (segment): CollectionPlatformRoute => ({
          platform,
          path: `collections/${platform}/${segment}`,
          Page,
        }),
      ),
    ];
  },
);
