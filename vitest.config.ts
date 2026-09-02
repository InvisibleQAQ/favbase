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
    exclude: [...configDefaults.exclude, 'packages/**'],
  },
});
