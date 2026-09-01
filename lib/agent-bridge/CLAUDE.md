# Agent Bridge

This directory owns the transport-neutral wire contract, the adapter to Chat's
read-only Knowledge Tools, and the Background SW connection lifecycle. The Node
CLI package (`packages/favbase-cli`) consumes only the protocol leaf; extension storage is exposed by
`lib/storage/agent-bridge.ts`.

## Modules

- `protocol.ts` — strict `favbase-agent-bridge` v1 envelope, all seven message
  payload schemas, shared error codes, and `DEFAULT_AGENT_BRIDGE_PORT` (`17836`).
  This is a leaf bundled by `packages/favbase-cli` and may depend only on Zod.
- `tool-registry.ts` — derives agent-facing tool descriptors (JSON Schema 2020-12) from `chatTools`
  and validates every call with the owning Zod schema before execution. Tool
  names, descriptions, and schemas must never be copied here. Everything this
  module reaches loads in the Background Service Worker, where the HTML spec
  forbids dynamic `import()` — so `chatTools` and its `tag-queries` /
  `embedding/config` dependencies must be statically imported. Deferring them
  used to make `listTags` and `searchKnowledgeBase` fail with a misleading
  `window is not defined` (Vite's `__vitePreload` masking Chrome's rejection);
  guarded by `tests/agent-bridge-background-bundle-contract.test.ts` and
  `scripts/check-background-bundle.mjs`.
- `client.ts` — `BridgeTransport` seam + production `WebSocketTransport` and the
  connection state machine. Open sends hello; token-matched welcome authenticates;
  ping/call dispatch return pong/result. DB acquisition is injected and lazy.
- `scheduler.ts` — Background-only 30-second alarm, config watch, startup
  compensation, and `connectNow()`. Disable clears the alarm and closes the client.
  Alarm/startup/config-watch connect with trigger `'schedule'`; `connectNow()` is
  the only `'user'` caller, because its two entry points are human actions.

## Contracts

- Unknown message types, wrong channel/version, and malformed payloads decode
  to `null`; there is no legacy unversioned Agent Bridge wire shape.
- `AgentBridgeToolCallError` distinguishes `unknown-tool` from `invalid-args`.
  Tool execution failures remain untouched for the transport layer to map.
- Both production modules are enrolled in `tests/lib-import-smoke.test.ts` and
  must load without a `chrome` global or mocks.
- The Node package imports `protocol.ts` through the reviewed relative path and
  must never import `tool-registry.ts`; Knowledge Tool facts stay extension-owned.
- Authentication backoff is persisted in `local:agent-bridge-status`, capped at
  five minutes, and reset by a valid welcome, deliberate reconfiguration, or an
  explicit user connect-now. An in-memory-only counter is invalid because MV3
  suspension would erase it.
- `tryConnect(trigger)` has exactly two triggers and no parallel `forceConnect()`.
  `'user'` skips the `nextRetryAt` gate and clears `authFailureCount`/`nextRetryAt`
  in the same write that sets `connecting`, so a later failure restarts at the
  30-second base instead of continuing the exponent. Backoff exists to protect the
  daemon from automatic retries; a human action is new information and must pierce
  it — otherwise toggling the feature off and on is the user's only escape.
- Port/token changes close the old transport before reconnecting. Connection
  identity guards prevent late callbacks from changing replacement state.
- Explicit close waits for an in-flight connect attempt to settle before writing
  the final disabled/disconnected status; a delayed storage write cannot restore
  stale `connecting` state after the socket is gone.
- `AGENT_BRIDGE_CONNECT_NOW` only asks the scheduler to reuse `tryConnect('user')`;
  extension pages never open the WebSocket themselves.
- Remote close and transport error both route through `disconnect()`, so every
  path that abandons a connection also closes its transport.

## Tests

- `protocol.test.ts` — message registry completeness, encode/decode, constants,
  failure result variant, and malformed-envelope rejection.
- `tool-registry.test.ts` — exact three-tool surface, JSON Schema Draft 2020-12,
  validated rejection, and DB context forwarding.
- `client.test.ts` — fake transport hello/welcome/call/ping/close, stable error
  mapping, malformed frames, persistent backoff, user-triggered backoff pierce and
  base-delay restart, and reconfiguration race.
- `scheduler.test.ts` — enable/disable, alarm/startup/connect-now routing,
  `'schedule'` vs `'user'` trigger assignment, and disabled means zero Agent Bridge
  alarms.
