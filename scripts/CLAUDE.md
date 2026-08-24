# Build Verification Scripts

- `check-background-bundle.mjs` runs after the Chrome WXT build. It resolves the Service Worker
  from the generated manifest, rejects bundles above 2 MiB, and rejects known PGlite runtime
  markers. This is an artifact-level contract: source import checks cannot see every transitive
  dependency bundled by WXT.
- Scripts must be deterministic, offline, and side-effect free outside generated build output.
