/**
 * Domain-side Platform Descriptor: the per-platform facts that are pure data
 * and belong to no single runtime — background-job namespace, welcome readiness
 * shape, build-time host permissions, native sort key, Collection Analytics
 * dimensions. Six registries a new platform used to declare one at a time are
 * one exhaustive `Record` here, so a missing platform is a compile error on this
 * object literal that names the platform (docs/26 Step 2).
 *
 * The UI half (`title` / `icon` / `palette` / `hint` / `childRoutes`) lives in
 * `entrypoints/app/collection-platform-registry.ts`: its types (`LocaleKeys`,
 * `IconifyName`) are app-side, and `lib/` must not depend on `entrypoints/`
 * (docs/26 D3).
 *
 * Two rules keep this module loadable everywhere (docs/26 iron rules 3 and 4):
 *
 * 1. **The only value import allowed here is `./platforms`.** `wxt.config.ts`
 *    loads this file in Node by relative path to build `host_permissions`; a
 *    value import reaching drizzle, `chrome.*` or JSX breaks the build with an
 *    error that does not point back here. Everything else is `import type`.
 * 2. **It never enters `lib/collections/index.ts`.** That barrel re-exports
 *    through `collections-query`, which drags drizzle + `@/lib/database` into
 *    every importer — welcome.html and the Node build config included.
 */
import type { CollectionAnalyticsDimensionKind } from './analytics-types';
import { COLLECTION_PLATFORMS, type CollectionPlatform } from './platforms';

/** What a person must do before a platform's first Platform Sync can run. */
export type PlatformReadiness = 'credentials' | 'login' | 'local';

/** Where a platform's native recency lives, and how that value is encoded. */
export type PlatformSortKey =
  | { readonly source: 'publishedAt' }
  | {
      readonly source: 'meta';
      readonly field: string;
      readonly format: 'unixSeconds' | 'iso8601';
    };

/**
 * The facets a platform's Collection Analytics exposes. `ranked` is the ordered
 * display list; `author` and `source` name which of those entries carries the
 * Creator axis and the Source membership. `source: null` means the platform has
 * no Source at all — an explicit null rather than an absent key, so "declared a
 * Source dimension the breakdown card never fills" stops being expressible.
 */
export interface PlatformDimensions {
  readonly ranked: readonly CollectionAnalyticsDimensionKind[];
  readonly author: CollectionAnalyticsDimensionKind;
  readonly source: CollectionAnalyticsDimensionKind | null;
}

export interface PlatformDescriptor {
  /** Background-job namespace: `{jobPlatform}:sync|embed|tag|extract`. */
  readonly jobPlatform: string;
  readonly readiness: PlatformReadiness;
  /** Manifest `host_permissions` this platform contributes, in order. */
  readonly hostPermissions: readonly string[];
  readonly sortKey: PlatformSortKey;
  readonly dimensions: PlatformDimensions;
}

export const PLATFORM_DESCRIPTORS = {
  bilibili: {
    jobPlatform: 'bilibili',
    readiness: 'login',
    hostPermissions: [
      'https://*.bilibili.com/*',
      'https://api.bilibili.com/*',
      'https://*.hdslb.com/*',
      'https://*.bilivideo.com/*',
      'https://*.bilivideo.cn/*',
    ],
    sortKey: { source: 'meta', field: 'fav_time', format: 'unixSeconds' },
    dimensions: {
      ranked: ['uploader', 'favoriteFolder'],
      author: 'uploader',
      source: 'favoriteFolder',
    },
  },
  github: {
    jobPlatform: 'github-stars',
    readiness: 'credentials',
    hostPermissions: ['https://api.github.com/*'],
    sortKey: { source: 'meta', field: 'starredAt', format: 'iso8601' },
    dimensions: { ranked: ['language', 'repositoryOwner'], author: 'repositoryOwner', source: null },
  },
  bookmarks: {
    jobPlatform: 'bookmarks',
    readiness: 'local',
    // Bookmark content extraction deliberately needs broad access and sends credentials:'omit'.
    hostPermissions: ['<all_urls>'],
    sortKey: { source: 'publishedAt' },
    dimensions: { ranked: ['domain', 'folder'], author: 'domain', source: 'folder' },
  },
  x: {
    jobPlatform: 'x-bookmarks',
    readiness: 'login',
    // X auth headers are captured from the logged-in web client's own requests.
    hostPermissions: ['*://x.com/*'],
    sortKey: { source: 'publishedAt' },
    dimensions: { ranked: ['author'], author: 'author', source: null },
  },
  zhihu: {
    jobPlatform: 'zhihu-favorites',
    readiness: 'login',
    // Zhihu uses extension-context fetch with credentials:'include'.
    hostPermissions: ['https://www.zhihu.com/*', 'https://api.zhihu.com/*'],
    sortKey: { source: 'publishedAt' },
    dimensions: { ranked: ['author', 'collection'], author: 'author', source: 'collection' },
  },
  youtube: {
    jobPlatform: 'youtube-playlists',
    readiness: 'credentials',
    // YouTube public playlists use the official Data API with an API key.
    hostPermissions: ['https://www.googleapis.com/*'],
    sortKey: { source: 'meta', field: 'addedAt', format: 'iso8601' },
    dimensions: { ranked: ['channel', 'playlist'], author: 'channel', source: 'playlist' },
  },
} as const satisfies Record<CollectionPlatform, PlatformDescriptor>;

/**
 * Project one per-platform record into another, in canonical platform order.
 * The single home for the `Object.fromEntries` cast every derived registry
 * would otherwise repeat; `source` is this descriptor map or the app-side
 * `PLATFORM_META`.
 *
 * `S` is deliberately unconstrained and the entry type is keyed by
 * `CollectionPlatform & keyof S`: a descriptor literal that is missing a
 * platform must fail on the literal alone (where `satisfies` names the missing
 * platform), not a second time in every consumer of a derived registry.
 * Passing a map that is not keyed by platform still fails — the callback's
 * parameter collapses to `never`.
 */
export function mapPlatforms<S, T>(
  source: S,
  project: (entry: S[CollectionPlatform & keyof S], platform: CollectionPlatform) => T,
): Record<CollectionPlatform, T> {
  return Object.fromEntries(
    COLLECTION_PLATFORMS.map((platform) => [
      platform,
      project(source[platform as CollectionPlatform & keyof S], platform),
    ]),
  ) as Record<CollectionPlatform, T>;
}
