import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'favbase',
    description: 'Turn your social media bookmarks into a searchable knowledge base',
    permissions: ['storage', 'offscreen'],
    host_permissions: [
      'https://api.bilibili.com/*',
      'https://*.hdslb.com/*',
      'https://*.bilivideo.com/*',
      'https://*.bilivideo.cn/*',
      'https://api.groq.com/*',
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});
