# favbase (Node package)

This package is the Node half of the Agent Bridge (ADR 0003): a thin `favbase`
CLI plus a long-lived loopback Bridge Daemon. It accepts one authenticated
favbase extension connection over WebSocket and answers CLI requests over HTTP
on the same port. It is a transport pipe, not a Knowledge Tool registry, and it
provides no MCP server.

## Modules

- `cli.ts` is the bundled entrypoint: imports `../../skills/favbase/SKILL.md`
  as text, wires `process` I/O, and calls `main` unconditionally. It carries
  no "am I the entrypoint?" guard on purpose: nothing imports it, and any
  guard comparing `process.argv[1]` with `import.meta.url` disables the CLI
  silently (empty output, exit 0) once a symlink sits between them -- which is
  how `npm i -g` and `pnpm link --global` deliver the bin on every platform.
  `integration.test.ts` spawns it through a symlinked `dist/` to hold that.
  It is also the **only** place the real network is wired:
  `fetchLatestVersion: () => queryRegistries(fetch)`. And it ends the process
  itself: once `main` resolves it flushes stdout and stderr (an empty write's
  callback) and calls `process.exit`. Aborting the registry query does not
  cancel the TCP connect or TLS handshake that `fetch` started, and those held
  the process open up to ~10 s past the 1.5 s budget (undici's connect timeout;
  measured 10.8 s against a TLS tarpit, 5.1 s against a blackholed address).
  Don't go back to `process.exitCode` alone, and don't drop the flush: pipes
  are asynchronous on POSIX, and exiting without it cut a piped 8 MB stdout to
  64 KB (Linux, Node 22). `daemon run` reaches the exit only after its daemon
  has closed. `integration.test.ts` holds the lifetime. **Not covered**: a
  stalled DNS lookup. libuv joins its threadpool on exit, so `process.exit`
  itself waits for `getaddrinfo` (measured 12.2 s with an unanswered `.local`
  name). Because a failed check is cached, that costs a broken-DNS machine one
  slow command a day, plus every `doctor`. Only moving the query out of the
  process (a detached child, as update-notifier does) would bound it.
- `cli-main.ts` owns dispatch, usage text, exit codes (0 ok, 1 usage/config,
  2 daemon or extension unreachable, 3 Knowledge Tool error) and every command:
  alias commands, `tools`, `call`, `doctor`, `daemon run|start|stop|restart`,
  `setup`, `install-skill`. `doctor` adds structured troubleshooting checks and
  the canonical Chrome 120+ 30-second / Chrome 116-119 60-second cold-start
  wording. Foreground daemon logs receive one ISO-8601 prefix here. Data results
  go to stdout as JSON only. Dispatch is two phases (docs/27 Step 2): `plan`
  parses and validates every argument and picks the command's update policy
  (`none` for `--version`, usage and `daemon *`; `always` for `doctor`; `daily`
  for the rest), then `main` starts the update check and runs the command
  alongside it, awaiting it last. An argument failure is thrown by `plan`, so
  it never goes online and never prints the notice -- keep new argument
  validation in the `parse*` half, not the `run*` half. `doctor` also reports
  `cli` (current / outdated / unknown, with a `reason` when unknown) and
  `skills` (per agent root: current / stale / missing) on **both** its output
  paths, the config-error one included; neither changes `ok` or the exit code
  (docs/27 D11). Its stderr skill line appears only when a copy is stale (it
  names those agents: `install-skill --agent claude,codex`, never a bare
  `install-skill`) or every copy is missing (it mentions `--dir`); an outdated
  CLI is told to upgrade first, because `stale` has no direction.
- `version.ts` is the one version primitive: `compareVersions` understands
  plain `MAJOR.MINOR.PATCH` only and returns `null` for anything else
  (`0.0.0-dev`, `test`, prereleases, empty). Every caller treats `null` as "do
  nothing", which is what keeps dev builds and test fixtures from replacing
  daemons or announcing updates.
- `update-check.ts` is the CLI-currency check (docs/27 D12). `queryRegistries`
  asks `registry.npmjs.org` and `registry.npmmirror.com` for `/favbase/latest`
  concurrently within one 1.5 s budget, takes the highest release, and never
  throws; its `fetch` is a required argument. `checkCliCurrency` applies the
  policy: honours `FAVBASE_NO_UPDATE_CHECK` (any value but `0`; skips the
  cache too), reads `<FAVBASE_HOME>/update-check.json` for `daily` (fresh = age
  in `[0, 24 h)`), and caches a failed query like a successful one so a blocked
  network costs one budget a day. `updateNotice` is the one stderr line; its
  wording is quoted in SKILL.md and README (see Boundaries).
- `test-setup.ts` (vitest `setupFiles`) replaces global `fetch` with a recorder
  and fails any test that called it: the update check swallows failures by
  design, so a merely rejecting stub would let a test go online in silence.
- `args.ts` is the argv parser (`--flag value`, `--flag=value`, boolean set,
  `--`); `commands.ts` is the alias table (`search`/`tags`/`get`/`coverage` → Knowledge
  Tool + argument names) and the only place tool names appear. A
  `positive-integer` flag (only `--limit`) refuses anything below 1 in
  `buildAliasArgs`, so `--limit 0`, `--limit -5` and `--limit=` are exit 1
  before the daemon is touched -- otherwise a usage error costs an auto-start
  plus an alarm wait and, with the extension away, reports as exit 2. That
  order holds only because `buildAliasArgs` is an argument to `runTool`;
  `cli-main.test.ts` pins it with a paired config. The upper bound is
  deliberately **not** checked here: the tool schema owns it. `AliasFlag` has
  no help text, so the CLI spells no range or default anywhere; `--help` shows
  a flag only as `[--limit <top_k>]`. The `help` field it had until docs/27
  Step 6 was never rendered and was deleted (D9) -- don't add prose per flag
  back without also rendering it in `aliasUsageLine`.
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
  any request with an `Origin` header is 403 before authentication. A known
  bad-token rejection makes waited status return immediately; an unchanged
  pairing cannot recover by waiting another hello deadline.
- `daemon-client.ts` is the CLI side: health probe, detached auto-spawn
  (`node cli.js daemon run`, stdio to `~/.favbase/daemon.log`), bounded wait,
  `rpcCall`, `fetchStatus`, `stopDaemon` (shutdown route, pid kill only for a
  process that identified itself as favbase over `/health`). Status decoding
  validates the peer shape and supplies null/zero diagnostics for older daemons.
  `ensureDaemon` replaces a healthy daemon whose `/health` version is **older**
  than `cliVersion` (docs/27 D14): logs both versions on stderr, reuses
  `stopDaemon`, spawns, and returns `replaced: { from, to }` (doctor shows it).
  Newer, equal or not comparable is kept -- newest wins, so two installed CLIs
  never take turns restarting it. Without this an upgraded CLI would talk to
  old daemon code forever, since a connected extension stops the idle exit. A
  failed stop is rethrown as a `DaemonError` naming both versions (exit 2), not
  swallowed; note `stopDaemon` answers a token mismatch by killing the pid the
  daemon reported, exactly as `daemon restart` does. Parallel commands right
  after an upgrade all find the same older daemon, and the first shutdown pulls
  it from under the rest; measured on real processes, that failed some of them
  with exit 2 until three rules went in: `fetchHealth` looks once more after a
  connection reset (a closing daemon resets what it had accepted, and reporting
  that as `foreign` told the user to pick another port); `stopDaemon` treats a
  reset or refused `/shutdown` as "already on its way out" and lets its exit
  wait decide; and the replacement passes the pid it found, so `stopDaemon`
  never stops a fresh daemon another command started in between.
- `bridge-server.ts` owns `/bridge` Origin + Bridge Token hello authentication,
  descriptor state, heartbeat, pending calls, the 75-second bounded hello wait
  (covering the extension alarm's 60-second effective period on Chrome 116–119),
  peer activity and disconnect callbacks, cleanup, and daemon-lifetime rejected
  hello evidence (`count`/last reason/time). A rejection wakes peer waiters and
  logs reason/count only, never either token. It can listen itself (unit tests)
  or attach to the daemon's server.
- `skill-install.ts` writes SKILL.md to `~/.claude/skills/favbase/` and
  `~/.agents/skills/favbase/` (Codex user scope), or an explicit `--dir`.
  `inspectSkills` is its read-only twin for doctor: byte-for-byte comparison
  with the bundled SKILL.md, no version field, no line-ending normalization of
  the installed copy (a CRLF re-save is `stale`; reinstalling fixes it). Missing file (ENOENT or
  ENOTDIR) is `missing`; any other read error is `stale`, since reinstalling is
  the one fix doctor can name. `--dir` copies are invisible to it by design.
- `README.md` and `LICENSE` exist for the npm page and for GPL-3.0 conveyance:
  `files: ["dist"]` does not list them, but npm always ships a package
  directory's README and LICENSE, so `npm pack` carries 5 files, not 3.
  `LICENSE` is a byte copy of the repository root's; keep it that way. The
  README deliberately enumerates **no** platform list -- SKILL.md's two are the
  only hand-written ones and they are reconciled by
  `tests/agent-bridge-cli-aliases.test.ts`; a third copy on a published page
  would be unguarded, so the README points at `favbase tools`, whose schemas
  the extension generates.

## Boundaries

- Import the wire contract only through `../../lib/agent-bridge/protocol`; never
  copy message schemas or descriptions. Tool and argument names live only in
  `commands.ts`, and `tests/agent-bridge-cli-aliases.test.ts` at the repo root
  checks that table against `describeTools()`.
- SKILL.md names the Collection Platforms **twice**, and the extension's own
  tool descriptions derive the same list from `COLLECTION_PLATFORMS`. Shipped
  markdown cannot derive, so the same contract test reconciles both halves, both
  directions: the `` `<platform>` is one of … `` sentence against the platform
  ids, and the frontmatter `description`'s parenthesised list against the in-app
  names (`PLATFORM_META.title` through the en locale). The frontmatter one is
  what an agent *selects the skill by* — a platform missing there means the agent
  never reaches for favbase when the user asks about it, with nothing to notice.
  Reword either freely; keep the shape each test anchors on (a backticked id
  list; a comma-separated parenthesis) or update the test with it.
- The `top_k` range is hand-written in exactly one place outside the
  extension: SKILL.md's `--limit <min-max>` synopsis. The same contract test
  reconciles it against the live `searchKnowledgeBase` JSON Schema
  (`top_k.minimum`/`maximum`), and checks that a `positive-integer` flag's
  schema `minimum` is at least 1 (docs/27 Step 6). Keep the `min-max` shape.
- stdout carries JSON results only; every diagnostic goes to stderr and never
  includes the Bridge Token.
- The update check is the CLI's **only** outbound request: a bare
  `GET /favbase/latest` to the two registries, at most once a day outside
  `doctor`, carrying no token, query or library data (CONTEXT.md). Upgrading
  stays the user's action; the CLI never installs anything, and SKILL.md tells
  an agent to relay the notice, not to run `npm install` / `install-skill`.
  No test may reach a registry, and two guards say so: in-process,
  `test-setup.ts` fails any test that touched global `fetch`; for spawned
  processes, `integration.test.ts` sets `FAVBASE_NO_UPDATE_CHECK=1` in every
  spawn env and its `afterEach` fails if a temp `FAVBASE_HOME` gained an
  `update-check.json` (a check writes it even when offline). A new spawn must
  carry the opt-out. The one deliberate exception is the process-lifetime case:
  it runs the check, with a `--import` preload that routes the child's `fetch`
  to a local tarpit, in a home it keeps out of that guard.
- The update notice is quoted verbatim, with `<latest>` / `<version>`
  placeholders, in SKILL.md (an agent's instruction: finish the request, then
  relay it) and in this README. `cli-main.test.ts` checks both against the line
  the CLI actually prints; reword all three together.
- Two vocabularies, one boundary. Code keeps the domain names (`CONTEXT.md`):
  `BridgeServer`, `BridgeCallError`, `AgentBridge*`, the `/bridge` route, the
  Bridge Token. Everything a user or an agent *reads* uses the product's words:
  the settings section is **Agent Skills**, the secret is a **pairing token**, a
  port is just a port. That covers `--help`, every stderr diagnostic,
  `doctor`'s troubleshooting list, `SKILL.md` and the npm README -- the README's
  opening line naming the **Agent Bridge** as the architecture is the deliberate
  exception, and so is `bridge-server.ts`'s rejected-hello log line: it names a
  wire event, goes to `~/.favbase/daemon.log`, and its user-facing rendering is
  `doctor`'s first troubleshooting sentence, which does say pairing token.
  Nothing enforces the split; the doctor and integration suites only pin the
  strings they happen to assert.
- `/status` may add diagnostics, but it never returns received/expected token
  material. A later valid hello does not erase the last rejection evidence.
- Listen only on `127.0.0.1`. A peer is usable only after its hello token and
  extension ID match the WebSocket Origin; a CLI request is served only with the
  matching Bearer token and no `Origin` header.
- Never kill a port occupant that did not answer `/health` as `favbase`.
- tsup bundles the protocol leaf and `skills/favbase/SKILL.md` into
  `dist/cli.js`; the published CLI cannot depend on repository-relative paths.
- The bundled SKILL.md is canonicalized to LF once, at `main`'s entry
  (`canonicalSkillContent`). The repo has no `.gitattributes`, so a release
  built from a `core.autocrlf=true` checkout would bundle CRLF, and the
  byte-exact `inspectSkills` would then call every LF copy -- including the one
  `npx skills add` fetches from GitHub -- `stale` forever. Don't normalize
  anywhere else, and never the installed copy.

## Commands

- `pnpm compile` - package type-check.
- `pnpm build` - produce `dist/cli.js`.
- `pnpm test` - build, then run unit tests (args/commands/config/rpc-server/
  daemon-client/daemon/cli-main/bridge-server, including doctor diagnostics,
  plus version/skill-install/update-check and `daemon-client-ensure`, whose
  fake loopback daemons exercise the real `fetchHealth`/`stopDaemon` with only
  `spawn` mocked) and the process integration suite (real CLI
  child processes, foreground and auto-spawned daemons, `ws` fake extension,
  and the CLI's wall-clock lifetime against a registry that never answers).

## Release

Published to npm as the unscoped package `favbase`. Its version line is
**independent of the root `package.json`**, which versions the Chrome extension
and never reaches npm (the root is `private: true`).

1. Bump `version` here. Never reuse a published version - npm keeps a tombstone
   even after an unpublish, and the 72-hour unpublish window is the only escape.
2. `pnpm compile && pnpm test` - the gate is manual on purpose; a
   `prepublishOnly` hook would drag every publish through a suite that flakes on
   local CPU contention.
3. `npm publish --dry-run` and read the file list. It must stay at 5 files:
   `package.json`, `README.md`, `LICENSE`, `dist/cli.js`, `dist/cli.js.map`.
   Anything else means `files` or the packed defaults drifted.
4. `npm publish`. It triggers `prepack` (tsup rebuild) on its own, so no manual
   build first. Unscoped packages default to public access; `--access public` is
   noise. A 2FA challenge is expected - npm requires it for every publish, and
   there is no token that skips it here.
5. `npm view favbase version` then `npm i -g favbase && favbase --version`. The
   global install is the regression check for the entry-point guard removed in
   docs/27 Step 0.5: a symlinked `bin` used to exit 0 with empty output.

Use `npm publish`, not `pnpm publish`: pnpm wants the OTP passed as `--otp`,
while the interactive 2FA prompt is the whole point. Nothing here depends on
pnpm's `workspace:` rewriting - `ws` and `zod` are pinned semver.

The published README is **this directory's** `README.md`, not the repository
root one. Installation instructions shown on the npm page live here.
