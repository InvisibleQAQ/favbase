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

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'favbase',
    description: 'Turn your social media bookmarks into a searchable knowledge base',
    permissions: ['storage', 'unlimitedStorage', 'offscreen', 'declarativeNetRequest', 'cookies'],
    host_permissions: [...bilibiliHostPermissions, ...githubHostPermissions, ...providerHostPermissions],
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
