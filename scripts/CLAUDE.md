# Build Verification Scripts

`check-background-bundle.mjs` is the second half of `pnpm build`: it walks the built Chrome
Service Worker's module graph and fails the build on a size overrun, PGlite markers, dangling
initializers or a dynamic `import()`. It is an artifact-level contract, because source import
checks cannot see every transitive dependency WXT bundles.

- Any dynamic `import()` reachable from the Service Worker fails the build, computed specifiers
  included. The HTML spec disallows `import()` on `ServiceWorkerGlobalScope`, and Vite's
  `__vitePreload` wrapper turns Chrome's rejection into a misleading `window is not defined` (or
  `document is not defined`).
- The fix is always a static top-level import. `modulePreload: false` only hides the outer
  symptom, so it is deliberately NOT configured in `wxt.config.ts`.
- vitest cannot see this class of failure; only `pnpm build` does. Source-level twin guard:
  `tests/agent-bridge-background-bundle-contract.test.ts`.
- Scripts here must be deterministic, offline, and side-effect free outside generated build
  output.
