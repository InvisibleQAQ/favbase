# Build Verification Scripts

- `check-background-bundle.mjs` runs after the Chrome WXT build. It requires an ESM Service Worker,
  recursively follows local static/dynamic JS imports from the generated manifest entry, rejects a
  Background module graph above 2 MiB, and rejects known PGlite or dangling-initializer markers.
  This is an artifact-level contract: source import checks cannot see every transitive dependency
  bundled by WXT.
- Scripts must be deterministic, offline, and side-effect free outside generated build output.
