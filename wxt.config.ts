import { defineConfig } from 'wxt';
import { LLM_PROVIDERS, EMBEDDING_PROVIDERS, ASR_PROVIDERS } from './lib/providers';

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
// truth) so adding a provider auto-covers its host. Custom domains go through
// optional_host_permissions + runtime authorization instead.
const providerHostPermissions = [
  ...new Set(
    [...LLM_PROVIDERS, ...EMBEDDING_PROVIDERS, ...ASR_PROVIDERS]
      .map((p) => toHostPattern(p.baseUrl))
      .filter((p): p is string => p !== null),
  ),
];

const bilibiliHostPermissions = [
  'https://*.bilibili.com/*',
  'https://api.bilibili.com/*',
  'https://*.hdslb.com/*',
  'https://*.bilivideo.com/*',
  'https://*.bilivideo.cn/*',
];

const githubHostPermissions = ['https://api.github.com/*'];

// X (Twitter) bookmarks: the private GraphQL endpoint on x.com. Auth headers
// (full Cookie + csrf + bearer) are captured from the logged-in web client's
// own requests via the background webRequest listener (see lib/x/x-auth.ts) and
// replayed verbatim — no DNR / Origin / Referer rewrite (a host-permitted
// extension-context fetch is treated as same-site, mirroring supermemory).
const xHostPermissions = ['*://x.com/*'];

// Zhihu favorites: web v4 items API (www.zhihu.com) + App API collections list
// (api.zhihu.com). Auth is bilibili-style — the extension-context fetch runs
// with `credentials:'include'` and the host permission makes the browser
// attach the user's real zhihu session cookies (no webRequest capture, no
// chrome.cookies, no Connections card). See lib/zhihu/zhihu-api.ts.
const zhihuHostPermissions = ['https://www.zhihu.com/*', 'https://api.zhihu.com/*'];

// YouTube public playlists: official Data API v3 with the user's own API key
// (public data needs no OAuth — see lib/youtube/youtube-api.ts).
const youtubeHostPermissions = ['https://www.googleapis.com/*'];

// Bookmark content extraction fetches arbitrary bookmarked sites from the
// background SW; app.html receives decoded HTML and parses it with an inert DOM.
// Keeping fetch outside a Document prevents third-party HTTP Link resource hints
// from being applied to app.html. Static
// <all_urls> is a deliberate ADR: install-time warning + longer CWS review
// accepted (SingleFile precedent) in exchange for zero runtime-grant UX.
// NOTE: host-permission fetches attach the user's cookies by default — the
// extraction fetch MUST use credentials:'omit' (see bookmark-page-fetch.ts).
const bookmarkContentHostPermissions = ['<all_urls>'];

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'favbase',
    description: 'Turn your social media bookmarks into a searchable knowledge base',
    permissions: [
      'storage',
      'unlimitedStorage',
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
      ...bilibiliHostPermissions,
      ...githubHostPermissions,
      ...xHostPermissions,
      ...zhihuHostPermissions,
      ...youtubeHostPermissions,
      ...bookmarkContentHostPermissions,
      ...providerHostPermissions,
    ],
    // Custom (user-entered) API domains are unknown at build time; grant them at
    // runtime via lib/permissions/host-access.ts (must run in a user gesture).
    optional_host_permissions: ['https://*/*'],
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
