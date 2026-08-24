# Agent Bridge

This directory owns the transport-neutral wire contract and the adapter to
Chat's read-only Knowledge Tools. The Node MCP package consumes the protocol
leaf; extension scheduling, storage, settings UI, and the production WebSocket
client remain later phases.

## Modules

- `protocol.ts` — strict `favbase-agent-bridge` v1 envelope, all seven message
  payload schemas, shared error codes, and `DEFAULT_AGENT_BRIDGE_PORT` (`17836`).
  This is a leaf bundled by `packages/favbase-mcp` and may depend only on Zod.
- `tool-registry.ts` — derives MCP-compatible tool descriptors from `chatTools`
  and validates every call with the owning Zod schema before execution. Tool
  names, descriptions, and schemas must never be copied here.

## Contracts

- Unknown message types, wrong channel/version, and malformed payloads decode
  to `null`; there is no legacy unversioned Agent Bridge wire shape.
- `AgentBridgeToolCallError` distinguishes `unknown-tool` from `invalid-args`.
  Tool execution failures remain untouched for the transport layer to map.
- Both production modules are enrolled in `tests/lib-import-smoke.test.ts` and
  must load without a `chrome` global or mocks.
- The Node package imports `protocol.ts` through the reviewed relative path and
  must never import `tool-registry.ts`; Knowledge Tool facts stay extension-owned.

## Tests

- `protocol.test.ts` — message registry completeness, encode/decode, constants,
  failure result variant, and malformed-envelope rejection.
- `tool-registry.test.ts` — exact three-tool surface, JSON Schema Draft 2020-12,
  validated rejection, and DB context forwarding.
