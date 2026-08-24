import { defineConfig } from 'wxt';
import { LLM_PROVIDERS, EMBEDDING_PROVIDERS, ASR_PROVIDERS } from './lib/providers';
import {
  COLLECTION_PLATFORMS,
  type CollectionPlatform,
} from './lib/collections/platforms';

// See https://wxt.dev/api/config.html

/** Base URL → host match pattern (`scheme://host/*`), dropping the port. */
function toHostPattern(baseUrl: string): string | null {
  if (!baseUrl) return null;
  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

// Built-in provider domains, derived from lib/providers.ts (single source of
// truth) so adding a provider keeps its host contract explicit. Bookmark
// extraction's required <all_urls> permission currently subsumes these hosts.
const providerHostPermissions = [
  ...new Set(
    [...LLM_PROVIDERS, ...EMBEDDING_PROVIDERS, ...ASR_PROVIDERS]
      .map((p) => toHostPattern(p.baseUrl))
      .filter((p): p is string => p !== null),
  ),
];

/** Built-in platform origins, kept in build configuration rather than app runtime. */
export const PLATFORM_HOST_PERMISSIONS = {
  bilibili: [
    'https://*.bilibili.com/*',
    'https://api.bilibili.com/*',
    'https://*.hdslb.com/*',
    'https://*.bilivideo.com/*',
    'https://*.bilivideo.cn/*',
  ],
  github: ['https://api.github.com/*'],
  // Bookmark content extraction deliberately needs broad access and sends credentials:'omit'.
  bookmarks: ['<all_urls>'],
  // X auth headers are captured from the logged-in web client's own requests.
  x: ['*://x.com/*'],
  // Zhihu uses extension-context fetch with credentials:'include'.
  zhihu: ['https://www.zhihu.com/*', 'https://api.zhihu.com/*'],
  // YouTube public playlists use the official Data API with an API key.
  youtube: ['https://www.googleapis.com/*'],
} as const satisfies Record<CollectionPlatform, readonly string[]>;

/** Final platform permission list; the manifest spreads this single Adapter. */
export const PLATFORM_HOST_PERMISSION_LIST = COLLECTION_PLATFORMS.flatMap(
  (platform) => PLATFORM_HOST_PERMISSIONS[platform],
);

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'favbase',
    description: 'Turn your social media bookmarks into a searchable knowledge base',
    minimum_chrome_version: '116',
    permissions: [
      'storage',
      'unlimitedStorage',
      // alarms: MV3-safe periodic + debounced WebDAV sync triggers (SWs sleep,
      // so setTimeout can't be used). See lib/sync/scheduler.ts.
      'alarms',
      'offscreen',
      'declarativeNetRequest',
      'cookies',
      // webRequest (observational, non-blocking): capture the X web client's
      // own auth headers on *://x.com/* to read bookmarks. See lib/x/x-auth.ts.
      'webRequest',
      // bookmarks: read the local bookmark tree (ingestion). favicon: MV3
      // _favicon API to render bookmark icons locally (no third-party leak).
      'bookmarks',
      'favicon',
    ],
    host_permissions: [
      ...PLATFORM_HOST_PERMISSION_LIST,
      ...providerHostPermissions,
    ],
    // <all_urls> also covers user-entered API and WebDAV origins. The runtime
    // helper only checks or restores required host access after rejection/revocation.
    declarative_net_request: {
      rule_resources: [
        { id: 'bilibili_headers', enabled: true, path: 'rules.json' },
      ],
    },
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});
