import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'favbase',
    description: 'Turn your social media bookmarks into a searchable knowledge base',
    permissions: ['storage', 'offscreen', 'declarativeNetRequest'],
    host_permissions: [
      'https://api.bilibili.com/*',
      'https://*.hdslb.com/*',
      'https://*.bilivideo.com/*',
      'https://*.bilivideo.cn/*',
      'https://api.groq.com/*',
    ],
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
