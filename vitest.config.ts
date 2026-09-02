import { configDefaults, defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'happy-dom',
    // happy-dom has no ResizeObserver; Scrollbar (simplebar) and CustomPopover
    // both construct one on mount. See tests/setup/app-dom.ts.
    setupFiles: [path.resolve(__dirname, 'tests/setup/app-dom.ts')],
    // `packages/**` run under their own vitest (`pnpm -r test`). `.claude/**`
    // holds git worktrees: without this, a worktree's test files are collected
    // on top of this tree's own, tripling the file count and starving each run.
    exclude: [...configDefaults.exclude, 'packages/**', '.claude/**'],
  },
});
