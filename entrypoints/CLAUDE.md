# WXT Entrypoints

Entrypoints are thin runtime wiring. Domain policy stays under `lib/`; entrypoints
construct dependencies and register browser listeners inside the owning WXT main function.

## Background

- `background.ts` uses `defineBackground({ type: 'module', main() })` and synchronously registers
  PortBridge, schedulers, browser listeners, and the typed background dispatcher. ESM is required:
  Agent Bridge shares Chat/AI dependencies, and WXT's single-file IIFE bundling produced a dangling
  third-party initializer that crashed the Service Worker before the database relay could respond.
- Agent Bridge wiring injects `initReadDbProxy(ensureOffscreen)` into `AgentBridgeClient`; the
  function initializes only on the first tool call. This Background-only leaf uses
  `drizzle-orm/pg-proxy`; importing `drizzle-orm/pglite` or the database barrel pulls the full
  PGlite runtime into the Background module graph. Only scheduler `connectNow` crosses
  `BackgroundContext`.
- Do not open Agent Bridge WebSockets from app/content entrypoints, create reconnect timers here,
  or bypass `lib/background/message-protocol.ts` for cross-runtime commands.

## Contracts

- WXT entrypoint main functions are synchronous; asynchronous startup work is fire-and-forget with
  explicit rejection handling.
- MV3 wakeable listeners must be registered during initial evaluation of the background main
  function. Long-lived policy uses `chrome.alarms`, not `setTimeout`.
