# favbase-mcp

This package is the Node half of the Agent Bridge. It exposes MCP over stdio and
accepts one authenticated favbase extension connection over a loopback WebSocket.
It is a transport pipe, not a Knowledge Tool registry.

## Modules

- `cli.ts` owns environment validation, stderr-only diagnostics, stdio lifecycle,
  and stable `EADDRINUSE` exit behavior.
- `mcp-server.ts` maps dynamic `tools/list` and `tools/call` requests to the current
  extension peer. Before hello, listing returns no tools and calls wait only up to
  the bridge deadline.
- `bridge-server.ts` owns `127.0.0.1` listening, Origin + Bridge Token hello
  authentication, descriptor state, heartbeat, pending calls, and cleanup.
- `integration.test.ts` starts the built CLI with a real SDK stdio client and uses
  `ws` as a fake extension; it also locks bad-token and second-process behavior.

## Boundaries

- Import the wire contract only through `../../lib/agent-bridge/protocol`; never
  copy the port, message schemas, tool names, descriptions, or input schemas.
- stdout belongs exclusively to `StdioServerTransport`. Every diagnostic goes to
  stderr and must never include `FAVBASE_TOKEN`.
- Listen only on `127.0.0.1`. A peer is usable only after its hello token and
  extension ID match the WebSocket Origin.
- tsup must bundle the shared protocol leaf into `dist/cli.js`; the published CLI
  cannot depend on repository-relative source paths.

## Commands

- `pnpm compile` - package type-check.
- `pnpm build` - produce `dist/cli.js`.
- `pnpm test` - build, then run Node unit and process integration tests.
