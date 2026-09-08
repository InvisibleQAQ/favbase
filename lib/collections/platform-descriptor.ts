/**
 * Domain-side Platform Descriptor: the per-platform facts that are pure data
 * and belong to no single runtime — background-job namespace, welcome readiness
 * shape, what the Content stage produces, build-time host permissions, native
 * sort key, Collection Analytics dimensions. Six registries a new platform used
 * to declare one at a time are one exhaustive `Record` here, so a missing
 * platform is a compile error on this object literal that names the platform
 * (docs/26 Step 2).
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
 * 2. **`lib/collections/index.ts` never re-exports these symbols.** That barrel
 *    also re-exports `collections-query`, which drags drizzle +
 *    `@/lib/database` into everything that imports the barrel — so a descriptor
 *    reachable *as a barrel export* is a descriptor that welcome.html and the
 *    Node build config end up loading PGlite to read. The rule constrains the
 *    barrel's public surface, not this module's consumers: modules that are
 *    themselves in the barrel may of course import the descriptor, and
 *    `collection-analytics`, `platform-sort-keys` and `processing-coverage` all
 *    do. Those importers already pay for drizzle; nothing flows back this way,
 *    because rule 1 keeps this file's own graph at `./platforms`.
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

/**
 * What a platform's Content stage actually produces. The stage is one shared
 * `content_state` column, but "content" means a different artefact per platform,
 * and a model reporting Processing Coverage has to name the real one — "1100 of
 * 1180 videos transcribed", not "1100 completed content acquisition".
 *
 * Semantic ids, not display strings: the localized names live in app-side
 * `LocaleKeys`, which `lib/` must not import (docs/26 D3), and a hand-written
 * per-platform sentence in a tool description is exactly what
 * `lib/chat/tools.test.ts` rejects. The model maps `transcript` to 「转录」 itself.
 */
export type PlatformContentKind =
  | 'transcript'
  | 'readme'
  | 'page-text'
  | 'post-text'
  | 'body-text'
  | 'description';

export interface PlatformDescriptor {
  /** Background-job namespace: `{jobPlatform}:sync|embed|tag|extract`. */
  readonly jobPlatform: string;
  readonly readiness: PlatformReadiness;
  readonly contentKind: PlatformContentKind;
  /** Manifest `host_permissions` this platform contributes, in order. */
  readonly hostPermissions: readonly string[];
  readonly sortKey: PlatformSortKey;
  readonly dimensions: PlatformDimensions;
}

export const PLATFORM_DESCRIPTORS = {
  bilibili: {
    jobPlatform: 'bilibili',
    readiness: 'login',
    // Subtitles when the video has them, ASR transcription otherwise.
    contentKind: 'transcript',
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
    contentKind: 'readme',
    hostPermissions: ['https://api.github.com/*'],
    sortKey: { source: 'meta', field: 'starredAt', format: 'iso8601' },
    dimensions: { ranked: ['language', 'repositoryOwner'], author: 'repositoryOwner', source: null },
  },
  bookmarks: {
    jobPlatform: 'bookmarks',
    readiness: 'local',
    contentKind: 'page-text',
    // Bookmark content extraction deliberately needs broad access and sends credentials:'omit'.
    hostPermissions: ['<all_urls>'],
    sortKey: { source: 'publishedAt' },
    dimensions: { ranked: ['domain', 'folder'], author: 'domain', source: 'folder' },
  },
  x: {
    jobPlatform: 'x-bookmarks',
    readiness: 'login',
    contentKind: 'post-text',
    // X auth headers are captured from the logged-in web client's own requests.
    hostPermissions: ['*://x.com/*'],
    sortKey: { source: 'publishedAt' },
    dimensions: { ranked: ['author'], author: 'author', source: null },
  },
  zhihu: {
    jobPlatform: 'zhihu-favorites',
    readiness: 'login',
    // Answers, articles, videos and pins all normalize to one Markdown body.
    contentKind: 'body-text',
    // Zhihu uses extension-context fetch with credentials:'include'.
    hostPermissions: ['https://www.zhihu.com/*', 'https://api.zhihu.com/*'],
    sortKey: { source: 'publishedAt' },
    dimensions: { ranked: ['author', 'collection'], author: 'author', source: 'collection' },
  },
  youtube: {
    jobPlatform: 'youtube-playlists',
    readiness: 'credentials',
    contentKind: 'description',
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
