# favbase-cli

This package is the Node half of the Agent Bridge (ADR 0003): a thin `favbase`
CLI plus a long-lived loopback Bridge Daemon. It accepts one authenticated
favbase extension connection over WebSocket and answers CLI requests over HTTP
on the same port. It is a transport pipe, not a Knowledge Tool registry, and it
provides no MCP server.

## Modules

- `cli.ts` is the bundled entrypoint: imports `../../skills/favbase/SKILL.md`
  as text, wires `process` I/O, and calls `main`.
- `cli-main.ts` owns dispatch, usage text, exit codes (0 ok, 1 usage/config,
  2 daemon or extension unreachable, 3 Knowledge Tool error) and every command:
  alias commands, `tools`, `call`, `doctor`, `daemon run|start|stop|restart`,
  `setup`, `install-skill`. Data results go to stdout as JSON only.
- `args.ts` is the argv parser (`--flag value`, `--flag=value`, boolean set,
  `--`); `commands.ts` is the alias table (`search`/`tags`/`get` → Knowledge
  Tool + argument names) and the only place tool names appear.
- `config.ts` resolves token/port: env `FAVBASE_TOKEN`/`FAVBASE_BRIDGE_PORT`,
  then `~/.favbase/config.json` (`FAVBASE_HOME` overrides the root), then
  `DEFAULT_AGENT_BRIDGE_PORT`.
- `daemon.ts` builds one `http.Server`, attaches `BridgeServer` to it for
  `/bridge`, mounts `createRpcHandler`, and owns listen/EADDRINUSE, idle exit
  (`FAVBASE_DAEMON_IDLE_MINUTES`, default 120, 0 disables) and shutdown. The
  idle timer is suppressed while an authenticated extension peer is connected;
  after peer disconnect it starts a fresh idle window.
- `rpc-server.ts` is the HTTP surface: `/health` (no auth, `{name,version,pid}`),
  `/status[?wait=1]`, `/rpc`, `/shutdown`. Bearer token is compared timing-safe;
  any request with an `Origin` header is 403 before authentication.
- `daemon-client.ts` is the CLI side: health probe, detached auto-spawn
  (`node cli.js daemon run`, stdio to `~/.favbase/daemon.log`), bounded wait,
  `rpcCall`, `fetchStatus`, `stopDaemon` (shutdown route, pid kill only for a
  process that identified itself as favbase over `/health`).
- `bridge-server.ts` owns `/bridge` Origin + Bridge Token hello authentication,
  descriptor state, heartbeat, pending calls, bounded hello wait, peer activity
  and disconnect callbacks, cleanup; it can listen itself (unit tests) or attach
  to the daemon's server.
- `skill-install.ts` writes SKILL.md to `~/.claude/skills/favbase/` and
  `~/.agents/skills/favbase/` (Codex user scope), or an explicit `--dir`.

## Boundaries

- Import the wire contract only through `../../lib/agent-bridge/protocol`; never
  copy message schemas or descriptions. Tool and argument names live only in
  `commands.ts`, and `tests/agent-bridge-cli-aliases.test.ts` at the repo root
  checks that table against `describeTools()`.
- stdout carries JSON results only; every diagnostic goes to stderr and never
  includes the Bridge Token.
- Listen only on `127.0.0.1`. A peer is usable only after its hello token and
  extension ID match the WebSocket Origin; a CLI request is served only with the
  matching Bearer token and no `Origin` header.
- Never kill a port occupant that did not answer `/health` as `favbase-cli`.
- tsup bundles the protocol leaf and `skills/favbase/SKILL.md` into
  `dist/cli.js`; the published CLI cannot depend on repository-relative paths.

## Commands

- `pnpm compile` - package type-check.
- `pnpm build` - produce `dist/cli.js`.
- `pnpm test` - build, then run unit tests (args/commands/config/rpc-server/
  daemon/cli-main/bridge-server) and the process integration suite (real CLI
  child processes, foreground and auto-spawned daemons, `ws` fake extension).
