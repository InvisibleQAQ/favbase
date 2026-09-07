import { defineConfig } from 'wxt';
import { LLM_PROVIDERS, EMBEDDING_PROVIDERS, ASR_PROVIDERS } from './lib/providers';
import { PLATFORM_DESCRIPTORS } from './lib/collections/platform-descriptor';
import { COLLECTION_PLATFORMS } from './lib/collections/platforms';

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

/**
 * Final platform permission list; the manifest spreads this single Adapter.
 * Origins are declared per platform in the domain Platform Descriptor, which
 * this Node-side config loads by relative path (`@/` is unavailable here).
 * The flatMap order is part of the manifest contract: an installed MV3
 * extension asks the user to re-authorize the moment this set changes.
 */
export const PLATFORM_HOST_PERMISSION_LIST = COLLECTION_PLATFORMS.flatMap(
  (platform) => PLATFORM_DESCRIPTORS[platform].hostPermissions,
);

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'favbase',
    description: 'Turn your social media bookmarks into a searchable knowledge base',
    // 117: MUI v9's minimum supported Chrome (app.html). Also satisfies the
    // Agent Bridge floor (116+: WebSocket traffic extends the MV3 SW lifetime).
    minimum_chrome_version: '117',
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
