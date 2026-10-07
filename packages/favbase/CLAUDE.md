# favbase (Node package)

The Node half of the Agent Bridge (`docs/adr/0003`): a thin `favbase` CLI plus a long-lived
loopback Bridge Daemon that relays CLI requests (HTTP) to one authenticated extension connection
(WebSocket) on the same port. It is a transport pipe, not a Knowledge Tool registry, and it
provides no MCP server.

## Boundaries

- Import the wire contract only through `../../lib/agent-bridge/protocol`; never copy message
  schemas, never import `tool-registry.ts`. Tool and argument names appear only in `commands.ts`;
  `tests/agent-bridge-cli-aliases.test.ts` reconciles that table with `describeTools()`.
- WebSocket messages are strict objects, so no new field is additive there, optional or not.
  Daemon -> CLI `/status` is the only additive path (`normalizeStatus` keeps the fields it
  knows). Owner: `lib/agent-bridge/CLAUDE.md`.
- stdout carries JSON results only. Diagnostics go to stderr and never include the token;
  `/status` may grow diagnostics but never returns received or expected token material.
- Listen only on `127.0.0.1`. An extension peer is usable only after its hello token and
  extension ID match the WebSocket Origin. A CLI request needs the matching Bearer token and
  **no** `Origin` header: one carrying it is 403 before authentication, which closes the "web
  page fetches 127.0.0.1" path.
- Never signal a port occupant that did not answer `/health` as `favbase`.
- The update check is the CLI's only outbound request: a bare `GET /favbase/latest` to two
  registries, with no token, query or library data (`CONTEXT.md`). The CLI never installs
  anything; upgrading stays the user's action.
- No test may reach a registry. `cli.ts` is the only place the real `fetch` is wired, and tests
  never import it. `test-setup.ts` fails any test that touched global `fetch` (the check swallows
  failures, so a rejecting stub would pass in silence). Every spawn in `integration.test.ts`
  must carry `FAVBASE_NO_UPDATE_CHECK=1`; the one deliberate exception is the process-lifetime
  case, which runs the check against a local tarpit.
- Every fix a message names must run as written. A port problem says `CHANGE_PORT_HINT` (the
  settings card's setup command), never `favbase setup --port`: that is a usage error without
  `--token`.
- Two vocabularies. Code keeps the domain names (`CONTEXT.md`): `BridgeServer`, `/bridge`, Bridge
  Token. Whatever a user or an agent reads -- `--help`, stderr, doctor's troubleshooting,
  SKILL.md, the npm README -- says **Agent Skills** (the settings section) and **pairing token**.
  Deliberate exceptions: the README's opening line and `bridge-server.ts`'s rejected-hello line
  in `daemon.log`. Nothing enforces the split.
- SKILL.md and the npm README quote CLI behaviour by hand (exit-code tables, usage line, update
  notice, `--limit` range, alias synopses, `--args-file`). Tests compare each quote with the
  code: reword code and quotes together. SKILL.md side: `skills/favbase/CLAUDE.md`.
- `README.md` deliberately lists no platforms; it points at `favbase tools`. SKILL.md's two lists
  are guarded, a third copy on the npm page would not be.
- SKILL.md line endings are handled in exactly two places, because `inspectSkills` compares
  bytes: `canonicalSkillContent` makes the bundled copy LF once, at `main`'s entry, and the root
  `.gitattributes` checks the file out as LF. Normalize nowhere else, never the installed copy.
- tsup bundles the protocol leaf and `skills/favbase/SKILL.md` into `dist/cli.js`: the published
  CLI cannot depend on repository-relative paths.

## Traps

Each bullet starts with the file that owns it.

- `cli.ts` has no "am I the entrypoint?" guard, on purpose. Comparing `process.argv[1]` with
  `import.meta.url` silently disables the CLI (empty output, exit 0) behind a symlink, which is
  how `npm i -g` and `pnpm link --global` deliver the bin. Guard: `integration.test.ts`.
- `cli.ts` ends the process itself: flush stdout and stderr, then `process.exit`. The 1.5 s
  budget in `update-check.ts` bounds the promise, not the process: an aborted `fetch` leaves its
  TCP connect or TLS handshake running, which kept the process alive ~10 s, and an agent waits
  for the exit. Do not go back to `process.exitCode` alone, and keep the flush: without it a
  piped 8 MB stdout was cut to 64 KB.
- `cli.ts`, not covered: a stalled DNS lookup. libuv joins its threadpool on exit, so
  `process.exit` itself waits for `getaddrinfo` (~12 s measured). Only moving the query into a
  detached child would bound it.
- `update-check.ts` caches a failed query like a successful one, so a blocked network costs one
  budget a day, not one per command.
- `version.ts`: `compareVersions` returns `null` for anything but a plain `MAJOR.MINOR.PATCH`,
  and every caller must treat `null` as "do nothing". That keeps dev builds and test fixtures
  from replacing daemons or announcing updates.
- `cli-main.ts` dispatches in two phases: `plan` validates every argument, then `main` runs the
  command beside the update check. Put new argument validation in the `parse*` half, not `run*`:
  a usage error must not go online or touch the daemon.
- `cli-main.ts`: `setup` writes and prints the config and skills **before** it looks at the
  daemon, so a daemon failure there (exit 2) never costs the user the pairing.
- `cli-main.ts`: `call --args-file` exists because Windows PowerShell 5.1 strips the `"` inside
  native arguments. The file is decoded as strict UTF-8, since PS 5.1 writes UTF-16 or the ANSI
  code page by default and a lenient read produced garbage that still parsed. No stdin form: PS
  5.1 pipes ASCII to native programs.
- `exit-codes.ts` is the one place a failure becomes an exit code and its stderr lines; no command
  picks its own. A failure without a type is **exit 1** (shown to the user). Exit 2 is only for
  what `favbase doctor` can look into: `DaemonError` and the tool codes `extension-unavailable`,
  `extension-disconnected`, `timeout`.
- `exit-codes.ts`: only a `UsageError` ends with `Run favbase --help for usage.`; SKILL.md tells
  the agent to recognise a usage error by that line. `exit-codes.test.ts` reconciles the SKILL.md
  and README tables with this module.
- `doctor.ts` has one output path, whatever fails: probes never throw, a new check returns its
  failure as a value, and the full seven-key report is always printed. The failed section
  carries `problem`; the sections after it say `not checked, because ...` and are not probed.
- `doctor.ts`: `cli` and `skills` are advisory and never change `ok` or the exit code. `config`
  is projected field by field because `ResolvedConfig` holds the token.
- `args.ts`: a value flag given twice is a usage error. Last-wins turned
  `--agent claude --agent codex` into codex alone.
- `commands.ts`: `--limit` refuses anything below 1 in `buildAliasArgs`, before the daemon is
  touched; otherwise a usage error costs an auto-start plus an alarm wait and can report as exit
  2. The upper bound is deliberately not checked: the tool schema owns it.
- `commands.ts`: `AliasFlag` has no help text, so the CLI spells no range or default anywhere. Do
  not add per-flag prose back without also rendering it in `aliasUsageLine`.
- `daemon-client.ts`: `ensureDaemon` replaces a healthy daemon only when it is strictly older
  than this CLI; newer, equal or not comparable is kept, so two installed CLIs never take turns
  restarting it. Without the rule an upgraded CLI talks to old daemon code forever, because a
  connected extension suppresses the idle exit.
- `daemon-client.ts`: parallel commands right after an upgrade share one old daemon. The retry
  after a connection reset in `fetchHealth`, the tolerated reset or refused `/shutdown`, and
  `stopDaemon`'s `onlyPid` exist for that race; do not simplify them away.
- `daemon-client.ts`: `setup` is the only command that replaces a daemon holding another token
  (`adoptSetupToken`, given the token and port just written, never `resolveConfig`). If every
  command did, a shell with `FAVBASE_TOKEN` and one reading the file would keep replacing each
  other's daemon (docs/30 #1). So `unauthorized` names its fix per `tokenSource` and never says
  `daemon restart`.
- `bridge-server.ts`: the 75 s hello wait must cover the extension alarm's effective 60 s period
  on Chrome 116-119 (`AGENT_BRIDGE_POLL_MINUTES`, `lib/agent-bridge/scheduler.ts`). Only comments
  tie the two constants together.
- `bridge-server.ts`: the extension retries a refused token on every alarm, so a run of
  same-reason rejections is logged once while `/status` counts each. A later valid hello does not
  erase the last rejection evidence.
- `skill-install.ts` knows three roots: `~/.claude/skills`, `~/.agents/skills` (Codex user scope)
  and Codex's deprecated `$CODEX_HOME/skills`, which Codex still scans (cc-switch links a copy
  in). `installAgentSkills` overwrites every copy an agent already has and creates one only when
  it has none: Codex does not merge same-name skills, so a `.agents` twin beside a legacy copy
  would list favbase twice. The legacy root is never created.
- `skill-install.ts`: on such a machine doctor's `.agents` row stays `missing` for good; doctor's
  skill hint must keep ignoring it.
- `skill-install.ts`: a copy exists when `stat` finds it (links followed); only ENOENT / ENOTDIR
  mean absent. A dangling link is reported with its target and left alone: never removed or
  rewritten, and its target is never created (a plain `writeFile` would create it).
- `skill-install.ts`: per-agent failures are collected copy by copy, not thrown; the other copies
  are still tried. `--dir` is one copy and still throws.
- `skill-install.ts`: `inspectSkills` compares bytes with the bundled SKILL.md. It parses no
  `metadata.version` and normalizes no line endings (a CRLF re-save is `stale`); an unreadable
  copy is `stale` too, since reinstalling is the one fix doctor can name. `--dir` copies are
  invisible to it by design.
- `skill-install.ts`: `parseSkillAgents` splits `--agent` on commas **or whitespace**. Windows
  PowerShell's npm `.ps1` shim delivers an unquoted `claude,codex` as `claude codex`; the parser
  absorbs that, so doctor's hint keeps printing the unquoted comma form.
- `skill-install.ts` gets `CODEX_HOME` through its `env` argument (`CliIo.env`) and never reads
  `process.env`, so no unit test sees the developer's real Codex home.
- Tests: a `setup` test must name a free port (`--port`, or a config file). Setup looks at the
  daemon on the port it writes, and the default is the developer's own daemon, which it would
  stop for holding another token.
- Tests: run `main(['doctor'])` only with no token, or against loopback servers on free ports. A
  token plus the default port reaches the developer's own daemon; a token plus an empty port
  spawns one and waits out the 10 s spawn deadline.
- `pnpm test` builds first: the integration suite spawns the real `dist/cli.js`.

## Release

Published to npm as the unscoped package `favbase`. Its version line is independent of the root
`package.json`, which versions the Chrome extension and never reaches npm.

**`main`'s `skills/favbase/SKILL.md` is always the one the latest npm release bundles** (user
decision; docs/30 #4 D7-b, `docs/adr/0003` amendment). `npx skills add InvisibleQAQ/favbase -g`
copies `main`'s SKILL.md, and doctor compares every copy byte for byte with the one the installed
CLI bundles. A `main` copy that runs ahead of npm reads `stale`, and it describes a CLI the user
does not have. So:

- A commit that changes SKILL.md is a release commit: it bumps the version (step 1) and is
  published in the same sitting. A CLI change that needs a SKILL.md edit ships in that release,
  not before it.
- A bump is a release: never merge a bump you do not publish.
- Nothing guards this (whether `main` matches npm is a network question), so step 6 is the
  check. A `favbase-latest` branch moved by each publish was proposed and declined; this rule is
  all that keeps the npx route sound.
- The rest of `main` -- CLI code, INSTALL.md -- may lead the release, which is why INSTALL.md
  describes no CLI behaviour.

1. Bump `version` in this directory's `package.json` **and** `metadata.version` in
   `skills/favbase/SKILL.md` (`tests/agent-bridge-cli-aliases.test.ts` fails when they differ).
   Never reuse a published version: npm keeps a tombstone even after an unpublish. Publish from a
   clean checkout of that bump commit.
2. `pnpm compile && pnpm test`. The gate is manual on purpose: a `prepublishOnly` hook would drag
   every publish through a suite that flakes under local CPU contention.
3. `npm publish --dry-run` and read the file list. It must be exactly 5 files: `package.json`,
   `README.md`, `LICENSE`, `dist/cli.js`, `dist/cli.js.map`. `files` lists only `dist`; npm adds
   the README and LICENSE on its own. `LICENSE` is a byte copy of the repository root's.
4. `npm publish`. `prepack` rebuilds, so no manual build first. A 2FA prompt is expected.
5. `npm view favbase version` must print the new version; then
   `npm i -g favbase && favbase --version`. The global install is the regression check for the
   symlinked bin (first `cli.ts` bullet under Traps).
6. Push the bump commit to `main`, then check the rule above: `favbase install-skill --dir <tmp>`
   (the CLI just installed from npm) must write a file identical to
   `git show origin/main:skills/favbase/SKILL.md`.

Use `npm publish`, not `pnpm publish`: pnpm wants the OTP passed as `--otp`, and the interactive
2FA prompt is the point. Nothing here depends on pnpm's `workspace:` rewriting. The page npm shows
is this directory's `README.md`, not the repository root's.
