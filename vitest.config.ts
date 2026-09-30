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
    // The default (available cores - 1, ~31 on this 32-core machine) lets
    // concurrent PGlite WASM start-ups and cold imports starve each other into
    // intermittent 5 s test / 10 s beforeAll timeouts. 8 is both stable and
    // faster (full run 67 s vs 112-142 s, measured 2026-09-30).
    // `VITEST_MAX_WORKERS` or `--maxWorkers` still override it.
    maxWorkers: 8,
  },
});
