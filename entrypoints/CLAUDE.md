# WXT Entrypoints

Entrypoints are thin runtime wiring. Domain policy stays under `lib/`; an
entrypoint constructs dependencies and registers browser listeners inside its
WXT main function.

## Constraints

- WXT entrypoint main functions are synchronous. Asynchronous startup work is
  fire-and-forget with explicit rejection handling.
- Do not open Agent Bridge WebSockets from app or content entrypoints, create
  reconnect timers in an entrypoint, or bypass
  `lib/background/message-protocol.ts` for cross-runtime commands.

## Background Service Worker (`background.ts`)

This file owns the Service Worker wiring rules; the message layer is in
`lib/background/CLAUDE.md`.

- PortBridge, schedulers and every MV3 wakeable listener must be registered
  synchronously during the first evaluation of the background main function,
  or the Service Worker is never woken by them. Long-lived policy uses
  `chrome.alarms`, not `setTimeout`.
- `background.ts` must stay `type: 'module'`: Agent Bridge shares the Chat / AI
  dependencies, and WXT's single-file IIFE bundle left a dangling third-party
  initializer that crashed the Service Worker before the database relay could
  respond.
- No PGlite in the Service Worker module graph. The Background reaches the
  database only through `initReadDbProxy` (`lib/database/read-proxy-db.ts`,
  built on `drizzle-orm/pg-proxy`), initialized on the first tool call.
- Nothing the Service Worker reaches may value-import `drizzle-orm/pglite`, the
  `@/lib/database` barrel or the `@/lib/collections` barrel (it re-exports
  `collections-query`, which drags in drizzle). Import the leaf file instead,
  e.g. `@/lib/collections/platform-descriptor`.
- No dynamic `import()` in any module the Service Worker reaches: the HTML
  specification forbids it on `ServiceWorkerGlobalScope`. The module graph
  also has a size cap.
- Guards for the module-graph rules above: `scripts/check-background-bundle.mjs`
  (run by `pnpm build`; `pnpm test` alone can stay green) and the source-level
  `tests/agent-bridge-background-bundle-contract.test.ts`, which only covers
  the import links it lists.
- Only the Agent Bridge scheduler's `connectNow` crosses `BackgroundContext`.
