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
  // The repository SKILL.md is the single source; it ships inside the CLI so
  // `favbase setup` / `install-skill` never depend on the repo being present.
  loader: {
    '.md': 'text',
  },
  define: {
    __FAVBASE_CLI_VERSION__: JSON.stringify(packageVersion),
  },
});
