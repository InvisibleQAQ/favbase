# Build Verification Scripts

- `check-background-bundle.mjs` runs after the Chrome WXT build. It requires an ESM Service Worker,
  recursively follows local static/dynamic JS imports from the generated manifest entry, rejects a
  Background module graph above 2 MiB, rejects known PGlite or dangling-initializer markers, and
  rejects **any dynamic `import()` reachable from the Service Worker** — including one with a
  computed specifier (`import(url)`), which the graph walker cannot follow and which is reported as
  `<computed specifier>`. This is an artifact-level contract: source import checks cannot see every
  transitive dependency bundled by WXT.
- Why the dynamic-import rule (2026-08-31): the HTML specification disallows `import()` on
  `ServiceWorkerGlobalScope`, so Chrome rejects the call. Vite wraps every dynamic import in
  `__vitePreload`, whose `vite:preloadError` reporter re-throws through `window.dispatchEvent`, so
  the real cause surfaces as a misleading `window is not defined` (and, when the chunk carries a
  non-empty dep list, `document is not defined` from the preload branch first). Two Agent Bridge
  Knowledge Tools (`listTags`, `searchKnowledgeBase`) failed this way while `getItemContent`, which
  has no dynamic import, worked. Fix is always a static top-level import; `modulePreload: false`
  only hides the outer symptom, so it is deliberately NOT configured in `wxt.config.ts`.
  Source-level twin guard: `tests/agent-bridge-background-bundle-contract.test.ts`.
- Scripts must be deterministic, offline, and side-effect free outside generated build output.
