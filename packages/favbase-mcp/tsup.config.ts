import { defineConfig } from 'tsup';

const packageVersion = process.env.npm_package_version;
if (!packageVersion) throw new Error('npm_package_version is required');

export default defineConfig({
  entry: ['cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  bundle: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  define: {
    __FAVBASE_MCP_VERSION__: JSON.stringify(packageVersion),
  },
});
