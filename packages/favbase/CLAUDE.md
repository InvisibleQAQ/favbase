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
- `cli-main.ts` owns dispatch, usage text and every command:
  alias commands, `tools`, `call`, `doctor`, `daemon run|start|stop|restart`,
  `setup`, `install-skill`. `setup` writes the config and the skills and
  prints them before it looks at the daemon (`adoptSetupToken`, see
  `daemon-client.ts`), so a daemon failure there (exit 2) never costs the user
  the pairing. `runDoctor` only probes, assembles and prints (see
  `doctor.ts`). Foreground daemon logs receive one ISO-8601 prefix here. Data results
  go to stdout as JSON only. No command picks its own exit code: every failure
  goes through `exit-codes.ts` and is printed by `printFailure`;
  `reportFailure` only adds the daemon log's timestamps. Dispatch is two phases (docs/27 Step 2): `plan`
  parses and validates every argument and picks the command's update policy
  (`none` for `--version`, usage and `daemon *`; `always` for `doctor`; `daily`
  for the rest), then `main` starts the update check and runs the command
  alongside it, awaiting it last. An argument failure is thrown by `plan`, so
  it never goes online and never prints the notice -- keep new argument
  validation in the `parse*` half, not the `run*` half. `call` takes its JSON
  object from `--args` or `--args-file <path>` (not both), both through one
  `parseJsonObject`. The file exists because Windows PowerShell 5.1 does not
  escape embedded `"` in native arguments, so `--args '{"a":1}'` arrives as
  `{a:1}`; only the inline error carries that hint. `parseCall` reads the file
  synchronously (`plan` is synchronous, and `CliIo` has no fs seam -- tests use
  real temp files) as strict UTF-8: `TextDecoder` drops one BOM (PS 5.1's
  `-Encoding utf8` writes one) and `fatal` refuses PS 5.1's defaults -- UTF-16
  from `>`, and from `Set-Content` the ANSI code page. Under code page 936 a
  lenient read turned a GBK query into U+FFFD plus a Hangul syllable that
  still parsed (measured). No stdin form: PS 5.1 pipes text to native programs
  in `$OutputEncoding`, ASCII by default.
- `doctor.ts` is `favbase doctor` (docs/30 #3): one output path, whatever
  fails. `probeDoctor` runs the probes and never throws -- `inspectSkills` and
  the currency check never do, and `DoctorLink` walks config -> daemon
  (`ensureDaemon`, then a waiting `/status`) -> extension, stopping at the
  first failure with its **raw** error. `assembleDoctorReport` is pure: probe
  results -> the JSON, the `Failure` (or `null`) and the skill hint; `runDoctor`
  prints them in that order (JSON on stdout, then the hint, then the failure
  lines; `cli-main-doctor.test.ts` pins the order). Every report has the same
  seven keys, in order: `ok`, `cli`, `config`, `daemon`, `extension`,
  `skills`, `troubleshooting`. A section that failed carries `problem` (its
  error's message); the sections after it carry `not checked, because ...`
  (D5-a: without a daemon there is no extension state to read, so doctor
  never asks). A daemon whose `/status` failed keeps what `ensureDaemon` found
  (health, `spawned`, `replaced`) beside `problem`. A failed step's exit code
  and stderr lines are `describeError`'s, exactly what any other command
  prints: a `LocalFileError` or the idle `ConfigError` from the daemon step is
  exit 1 *with* the report, and a failure is reported under the step it came
  from, whatever its type. A daemon that answered without a connected
  extension is `extension-unavailable` (exit 2), its advice the troubleshooting
  list plus `EXTENSION_LATENCY_HINT`. `troubleshooting` is `[]` when ok; the
  five extension checks when not connected (the bad-token one names the fix,
  rerunning the settings card's setup command); on a failed step, its message
  and one reminder that the rest was not checked, then "run favbase doctor
  again" -- no Chrome advice unrelated to the cause. `config` is projected
  field by field because `ResolvedConfig` holds the token. `cli` (current /
  outdated / unknown, with a `reason` when unknown) and `skills` (per agent
  root: current / stale / missing, plus Codex's legacy root only while it holds
  a copy) never change `ok` or the exit code (docs/27 D11). The skill hint
  appears only when a copy is stale (it names those agents, each once however
  many of its copies are stale: `install-skill --agent claude,codex`, never a
  bare `install-skill`) or every listed copy is missing (it mentions `--dir`);
  an outdated CLI is told to upgrade first, because `stale` has no direction.
  `NOT_CONNECTED` lives here; `tools` uses it too. Its tests feed the assembly
  real `inspectSkills` output (temp homes) and synthetic probe results, and run
  `main(['doctor'])` only where no daemon is reached (no token) or against
  loopback servers on free ports: with the module mock gone, a token plus the
  default port would reach the developer's own daemon, and a token plus an
  empty port would spawn and wait out the 10 s spawn deadline.
- `exit-codes.ts` is the one place a failure becomes an exit code and its
  stderr lines (docs/30 #2): 0 ok, 1 usage/config/local problem, 2 daemon or
  extension did not answer, 3 Knowledge Tool error. `describeError` classifies
  what a command throws, `describeToolError` what the daemon answers for a
  Knowledge Tool. The default is **exit 1** (D3): a failure with no type of its
  own prints `favbase: <message>`, which every table reads as "show the user".
  Only a `UsageError` ends with `Run favbase --help for usage.` (the agent
  fixes its command); `ConfigError`, `LocalFileError` and the untyped name
  their fix or at least what went wrong. Exit 2 is only `DaemonError` and the
  tool codes `extension-unavailable` / `extension-disconnected` / `timeout`
  (D4: a timeout is not the agent's arguments; doctor, then one retry): the
  failures `favbase doctor` can look into. Until docs/30 #2 the default was
  exit 2, and each untyped failure sent the agent to a doctor that failed on
  the same error. `TOOL_ERRORS` is a `Record` over `BridgeCallErrorCode`, so a
  new code does not compile until it has an exit code; a code only a newer
  daemon knows is exit 3 with the message for the user. Every fix a message
  names must run as written: a port problem says `CHANGE_PORT_HINT` (the
  settings card's setup command), never `favbase setup --port`, which is a
  usage error without `--token`. `exit-codes.test.ts` reconciles every row of
  the two markdown tables (SKILL.md, the npm README) with this module; both
  ship with the CLI they describe. INSTALL.md, read from `main` by agents
  installing the last release, carries no table since docs/30 #4 (D6-a).
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
  `--`). A value flag given twice, in either spelling, is a usage error (exit
  1, before `plan`, so before the daemon); last-wins used to turn `--agent
  claude --agent codex` into codex alone. Boolean flags may repeat.
  `commands.ts` is the alias table (`search`/`tags`/`get`/`coverage` → Knowledge
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
  `DEFAULT_AGENT_BRIDGE_PORT`. It also owns `LocalFileError`, a config or skill
  file favbase cannot write, and `writingFile(path, steps)`, which turns any
  failure of one write's filesystem steps (a `stat` before it included) into
  one naming `path` and the OS reason (`cannot write <path>: EACCES: ...`). It
  wraps only the write sites -- `writeConfigFile`, `installSkill`,
  `refreshSkill`, and `createSkill`'s dangling-link look -- so doctor's
  read-only inspection is unaffected, and `spawnDaemon`'s open of
  `daemon.log`. Not a
  `ConfigError` on purpose: that one means the configuration itself is missing
  or invalid, and a file favbase cannot write is no invalid config. Before it, these failures reached the
  exit-2 fallback. `daemonIdleMinutes` parses `FAVBASE_DAEMON_IDLE_MINUTES`
  for the daemon and, before a spawn, for the CLI spawning it. `SETUP_HINT` and
  `CHANGE_PORT_HINT` are the two fixes that name the settings card.
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
  (`node cli.js daemon run`, stdio to `~/.favbase/daemon.log`; before it, a
  bad idle setting is refused here rather than only in the child, where it
  left a bare `spawn-failed` after the 10 s spawn wait, and a log it cannot
  open is a `LocalFileError` -- both exit 1, naming the fix), bounded wait,
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
  swallowed, and names both ways out -- end the pid by hand, or
  `CHANGE_PORT_HINT` -- since doctor would find the same daemon and another OS
  user's (`EPERM`) cannot be ended; note `stopDaemon` answers a token mismatch by killing the pid the
  daemon reported, exactly as `daemon restart` does. Parallel commands right
  after an upgrade all find the same older daemon, and the first shutdown pulls
  it from under the rest; measured on real processes, that failed some of them
  with exit 2 until three rules went in: `fetchHealth` looks once more after a
  connection reset (a closing daemon resets what it had accepted, and reporting
  that as `foreign` told the user to pick another port); `stopDaemon` treats a
  reset or refused `/shutdown` as "already on its way out" and lets its exit
  wait decide; and the replacement passes the pid it found, so `stopDaemon`
  never stops a fresh daemon another command started in between.
  `adoptSetupToken` is the token half of the same question, "is the daemon on
  this port usable?" (docs/30 #1). A daemon keeps the token it was spawned
  with, so after a token reset in the extension it refuses the extension's
  hello and every request under the new token. `setup` calls it with the
  token and port it just wrote (never `resolveConfig`: `FAVBASE_TOKEN` would
  outrank the file): an empty port and a daemon that accepts the token (one
  non-waiting `/status`) are left alone -- setup does not start a daemon
  doctor would start anyway -- and a 401 takes the version rule's own path,
  `stopToReplace` then `startDaemon` (stop that pid, spawn, poll `/health`).
  Only setup does this (D1): if every command replaced a daemon holding
  another token, a shell with `FAVBASE_TOKEN` and one reading the file would
  take turns replacing each other's daemon, the ping-pong the version rule
  avoids by letting the newest win. The `unauthorized` error (a 401 anywhere
  else) therefore names the fix per `tokenSource`: `env` says `FAVBASE_TOKEN`
  overrides the config file, `file` says to rerun the settings card's setup
  command -- never `daemon restart`, which under `FAVBASE_TOKEN` would start
  exactly that ping-pong by hand. Windows: the kill-then-respawn on the same
  port is covered by `integration.test.ts` on real processes, against a
  detached daemon started by `daemon start` -- the kind setup has to kill.
- `bridge-server.ts` owns `/bridge` Origin + Bridge Token hello authentication,
  descriptor state, heartbeat, pending calls, the 75-second bounded hello wait
  (covering the extension alarm's 60-second effective period on Chrome 116–119),
  peer activity and disconnect callbacks, cleanup, and daemon-lifetime rejected
  hello evidence (`count`/last reason/time). A rejection wakes peer waiters and
  logs reason/count only, never either token. The extension retries a refused
  token on every alarm (no backoff since docs/30 #1), so a run of same-reason
  rejections is logged once; an accepted hello ends the run, and `/status`
  still counts every rejection. It can listen itself (unit tests) or attach to
  the daemon's server.
- `skill-install.ts` writes SKILL.md to `~/.claude/skills/favbase/` and
  `~/.agents/skills/favbase/` (Codex user scope), or an explicit `--dir`.
  Codex also still scans its deprecated `$CODEX_HOME/skills` (Codex's rule:
  unset or empty `CODEX_HOME` means `~/.codex`) and shows a same-name skill
  from both, so a copy there that favbase ignored went stale unseen (cc-switch
  links one in). `personalRoots` is the one list of roots, in write and report
  order; the legacy root follows `.agents`. For each agent (`--agent`, `all`,
  `setup`) `installAgentSkills` overwrites every copy the agent already has,
  in any of its roots, and creates one in `skillRoot` **only when it has
  none**. So a legacy copy never gets a `.agents` twin: Codex does not merge
  same-name skills and would list favbase twice (following doctor's stale hint
  created one on a cc-switch machine, 2026-09-24), and the legacy root itself,
  directory included, is never created. A copy exists when `stat` finds it --
  links are followed, so a copy behind a directory link is written through it
  and a dangling link is absent. Only ENOENT/ENOTDIR mean absent; any other
  error, like every failed write, is a `LocalFileError` naming the copy
  (doctor calls that copy `stale`, and install-skill then names the error,
  exit 1). On such a machine doctor's `.agents` row stays `missing`
  for good; the hint must keep ignoring it, since not every copy is missing
  (`cli-main-doctor.test.ts` holds that). `inspectSkills` lists the legacy
  copy only when present, so a machine without one sees one entry per agent.
  Paths are neither resolved nor deduplicated: cc-switch's two links to one
  real file get written twice, harmlessly. Failures are collected copy by
  copy, not thrown (`SkillInstallResult`): every other copy is still tried,
  and a copy whose refresh failed still counts as the agent's, so none is
  created beside it. install-skill and setup then print what was written on
  stdout in their usual shape (`installed` / `skills`), one `favbase:
  <message>` stderr line per failure, and exit 1; setup has already written
  the config and still prints its `next:` line. `--dir` is one copy and still
  throws (no stdout). Creating a copy first looks at three paths, `skillRoot`,
  `<root>/favbase` and `<root>/favbase/SKILL.md`: a link there whose target
  does not exist is named with its target and the fix, and left alone --
  favbase never removes or rewrites it and never creates its target. Before,
  a dangling directory link (`~/.agents/skills` left by a removed tool) failed
  `mkdir` with a bare ENOTDIR, and a dangling SKILL.md file link was followed
  by `writeFile`, which created the file it pointed at. The look runs inside
  `writingFile`, so its own errors name the copy; the refusal is thrown
  outside it, so `writingFile` stays a plain OS-error wrapper and the message
  gets no second path. Ancestors above `skillRoot` are not looked at. Doctor
  is unchanged: a dangling root reads `missing`. `CODEX_HOME` arrives as a required `env` argument (`CliIo.env`);
  the module never reads `process.env` itself, so no unit test sees the real
  one (the spawned `doctor` runs in `integration.test.ts` read the real home
  and env, read-only, and assert nothing about `skills`).
  `inspectSkills` is its read-only twin for doctor: byte-for-byte comparison
  with the bundled SKILL.md -- it does not parse the copy's `metadata.version`
  (the version is for the agent and the user reading the file), no line-ending normalization of
  the installed copy (a CRLF re-save is `stale`; reinstalling fixes it). Missing file (ENOENT or
  ENOTDIR) is `missing`; any other read error is `stale`, since reinstalling is
  the one fix doctor can name. `--dir` copies are invisible to it by design.
  `parseSkillAgents` splits `--agent` on commas **or whitespace**: Windows
  PowerShell's npm `.ps1` shim delivers an unquoted `claude,codex` as
  `claude codex`. The parser absorbs that, so doctor's hint keeps printing the
  unquoted comma form (`cli-main.test.ts` holds both shapes).
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
- SKILL.md's line endings are pinned at two boundaries, because
  `inspectSkills` compares bytes. The bundled copy is canonicalized to LF once,
  at `main`'s entry (`canonicalSkillContent`): tsup bundles the working-tree
  file, and a CRLF bundle would make every LF copy `stale` forever. And the
  root `.gitattributes` checks `skills/favbase/SKILL.md` out as LF (docs/30
  #4): `npx skills add InvisibleQAQ/favbase#favbase-latest` git-clones it, and
  a clone under `core.autocrlf=true` -- Git for Windows' default -- is CRLF
  (measured). Don't normalize anywhere else, and never the installed copy.

## Commands

- `pnpm compile` - package type-check.
- `pnpm build` - produce `dist/cli.js`.
- `pnpm test` - build, then run unit tests (args/commands/config/rpc-server/
  daemon-client/daemon/cli-main/bridge-server, plus doctor: the report
  assembly as a pure function, table-driven over every daemon-step failure,
  and `foreign`/`unauthorized` through `main` against real loopback servers;
  plus version/skill-install/update-check, `exit-codes` (the classification
  table-driven, and the two markdown tables row by row) and `daemon-client-ensure`, whose
  fake loopback daemons exercise the real `fetchHealth`/`stopDaemon` with only
  `spawn` mocked, plus `process.kill` for a daemon holding another token) and
  the process integration suite (real CLI
  child processes, foreground and auto-spawned daemons, `ws` fake extension,
  setup replacing a daemon that holds the old token, and the CLI's wall-clock
  lifetime against a registry that never answers). A `setup` test must name a
  free port (`--port`, or a config file): setup looks at the daemon on the port
  it writes, and the default is the developer's own daemon, which it would
  stop for holding another token.

## Release

Published to npm as the unscoped package `favbase`. Its version line is
**independent of the root `package.json`**, which versions the Chrome extension
and never reaches npm (the root is `private: true`).

A version bump **is** a release: bump, publish and move `favbase-latest` in
one sitting, and never merge a bump you do not publish. The 0.2.0 and 0.2.1
release commits both said "Not published.", and for days `main` carried a
version and agent-facing markdown that npm did not (docs/30 #4). That
discipline does not stop `main`'s markdown from leading the release between
publishes -- nothing can -- which is why INSTALL.md describes no CLI behaviour
and `npx skills add` is pointed at `favbase-latest`, not `main`.

1. Bump `version` here **and** `metadata.version` in `skills/favbase/SKILL.md`
   (`tests/agent-bridge-cli-aliases.test.ts` fails when they differ). Never
   reuse a published version - npm keeps a tombstone
   even after an unpublish, and the 72-hour unpublish window is the only escape.
   Publish from a clean checkout of that bump commit.
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
5. `npm view favbase version` must print the `version` here; then
   `npm i -g favbase && favbase --version`. The global install is the
   regression check for the entry-point guard removed in docs/27 Step 0.5: a
   symlinked `bin` used to exit 0 with empty output.
6. `git push origin <bump commit>:refs/heads/favbase-latest` -- the commit you
   published from, as a fast-forward (never `--force`). `npx skills add
   InvisibleQAQ/favbase#favbase-latest` installs from it, so it must hold the
   SKILL.md the release bundles: `favbase install-skill --dir <tmp>` must write
   a file identical to `git show favbase-latest:skills/favbase/SKILL.md`.
   0.2.1 predates this step: its branch goes at `2fbcc16`, whose SKILL.md
   matches the 0.2.1 bundle byte for byte (checked 2026-09-27 against the
   registry tarball). That commit predates `.gitattributes`, so until the next
   release moves the branch, a Windows clone of it is CRLF and doctor calls it
   `stale` once.

Use `npm publish`, not `pnpm publish`: pnpm wants the OTP passed as `--otp`,
while the interactive 2FA prompt is the whole point. Nothing here depends on
pnpm's `workspace:` rewriting - `ws` and `zod` are pinned semver.

The published README is **this directory's** `README.md`, not the repository
root one. Installation instructions shown on the npm page live here.
