import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'favbase',
    description: 'Turn your social media bookmarks into a searchable knowledge base',
    permissions: ['storage'],
    host_permissions: [
      'https://api.bilibili.com/*',
      'https://*.hdslb.com/*',
    ],
  },
});
