# Agent Bridge

Owns the transport-neutral wire contract (`protocol.ts`), the adapter that exposes Chat's
read-only Knowledge Tools to agents (`tool-registry.ts`), and the Background SW connection
lifecycle (`client.ts`, `scheduler.ts`). The Node side is `packages/favbase`; extension storage is
`lib/storage/agent-bridge.ts`.

## Contracts

- `protocol.ts` is a leaf bundled into the npm CLI: it may depend only on Zod. `packages/favbase`
  imports it by relative path and must never import `tool-registry.ts`; Knowledge Tool facts stay
  extension-owned.
- `tool-registry.ts` derives every descriptor from `chatTools` and validates calls with the owning
  Zod schema. Never copy a tool name, description or schema here: Chat and the Agent Bridge must
  expose exactly the same set (`CONTEXT.md`), so the surface grows only by `chatTools` growing.
  `tool-registry.test.ts` pins the list.
- **"Strict" means no field is additive on the WebSocket.** Every envelope and payload is
  `z.strictObject`, and error codes and reject reasons are `z.enum`. A new optional field or enum
  member makes an older daemon decode `null` and close with `1002`; the extension records
  `connection-closed`, not a version error. A newer daemon's message fails here as
  `protocol-error`.
- Published CLIs keep their strict decoder for good, and the extension is the side that updates
  on its own. Sending anything new therefore needs gating on `welcome.serverVersion`, which is
  version negotiation: design it, do not slip it in (docs/30 #5, undecided).
- Two things may grow: `tools.result.result` is free JSON, so a Knowledge Tool's output can add
  fields; and daemon -> CLI `/status`, because `normalizeStatus` in
  `packages/favbase/daemon-client.ts` keeps only the fields it knows.
- `reject: version` is reserved: no daemon sends it, so `settings.agentBridge.errorVersion` cannot
  be reached. Which side its advice should blame is `[UNKNOWN]` until a v2 design exists.
- Decoding fails closed: an unknown type, wrong channel/version or malformed payload is `null`.
  There is no legacy unversioned wire shape.
- `AgentBridgeToolCallError` covers only `unknown-tool` and `invalid-args`. Leave tool execution
  failures unwrapped; the transport layer maps them.

## Connection lifecycle

- Extension pages never open the WebSocket. `AGENT_BRIDGE_CONNECT_NOW` only asks the scheduler to
  run now, and `connectNow()` only saves the wait for the next alarm: every path calls the same
  `tryConnect()`.
- The alarm period is 0.5 minutes: 30 s on Chrome 120+, clamped to 60 s on Chrome 116-119. The
  daemon's hello wait (`packages/favbase/bridge-server.ts`) must cover the 60 s case; only
  comments tie the two constants together. Disabled means zero Agent Bridge alarms.
- **No authentication backoff** (user decision, docs/30 #1). A refused token is retried on the
  next alarm like any other failure. The repair -- `favbase setup` replacing the daemon that
  holds the old token -- happens where the client cannot see it, so a backoff only kept a
  repaired pairing locked out. Do not add one back without giving `setup` a way to lift it.
- Every bad-token failure persists `lastAuthFailureAt`, and a valid welcome preserves it: it is
  the only extension-side evidence left after a recovery. A welcome echoing another token counts
  as a rejected token.
- Every way a connection ends goes through `disconnect()`, bad-token included. It drops the
  connection **before** the storage await: the daemon sends `reject` and closes at once, and the
  late close event must find no current connection, or it overwrites `bad-token` with
  `connection-closed`.
- The `connecting` write keeps `lastError`. Failures are retried on every alarm, and clearing it
  would blink the settings card's error and repair button each time. `close()` (disable,
  reconfigure) clears it.
- Port or token changes close the old transport before reconnecting, and connection-identity
  checks keep late callbacks from touching the replacement.
- Explicit close waits for an in-flight connect attempt to settle before it writes the final
  status; otherwise a delayed write restores a stale `connecting` after the socket is gone.

## Traps

- Everything reachable from `tool-registry.ts` -- `chatTools` and what it depends on -- lands in
  the Service Worker module graph, so it must be imported statically and through leaves, not
  barrels. The rules and their two guards are owned by `entrypoints/CLAUDE.md`.
- A deferred import there fails as a misleading `window is not defined` (Vite's `__vitePreload`
  masks Chrome's rejection), and vitest cannot see it: run `pnpm build`. Extend
  `tests/agent-bridge-background-bundle-contract.test.ts` when a new import link appears.
- `protocol.ts` and `tool-registry.ts` are enrolled in `tests/lib-import-smoke.test.ts`: they must
  load with no `chrome` global and no mocks.
