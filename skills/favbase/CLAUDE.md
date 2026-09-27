# favbase Agent Skill

`SKILL.md` is the single source bundled into `favbase` and installed for
Claude Code/Codex. It documents commands and recovery behavior; it never reads
the collection itself. The one other way out is `npx skills add
InvisibleQAQ/favbase#favbase-latest -g` (root README; `docs/adr/0003`
amendment 2026-09-27): that branch is the commit the latest npm release was
published from, so the copy it installs is the one that CLI bundles, byte for
byte -- which is why the root `.gitattributes` pins this file to LF (a ref makes
the skills tool git-clone, and a clone under `core.autocrlf=true` would be CRLF,
i.e. `stale`). `main`'s copy leads the release and is never what a user should
install. The skills tool copies this whole directory, so this file and
INSTALL.md land in the user's skill folder too.

`INSTALL.md` is the **Agent Setup Guide** (CONTEXT.md; `docs/adr/0005`) and is
NOT a Skill: it is fetched over the network from `main` by an agent that has
nothing installed yet, walks it through `npm install -g favbase`, then **stops**
and asks the user to paste the pairing command from Settings > Connections >
Agent Skills. It must never construct a `favbase setup` command of its own --
the Bridge Token exists only inside the running extension. Its published URL
(`lib/repo.ts` `AGENT_SETUP_GUIDE_URL`) is a public contract: users paste it
into their own prompts, so this path and the `main` branch cannot move.
`tests/agent-bridge-cli-aliases.test.ts` reconciles the file's path, settings
section name, package name, setup command shape and default port, and fails on
a runnable setup command. It also fails on any `exit <n>` / `exit code <n>`:
this file is read from `main` while `npm install -g favbase` installs the last
release, so it may only say what holds for every published version (docs/30
#4, D6-a; `docs/adr/0005` amendment). Its exit-code table was the part that
did not: rows had to be checked by hand against two versions, and in 0.2.0 an
unwritable skill file read as "Chrome closed". For failures it now defers to
what ships with the installed CLI -- the SKILL.md step 4 writes, `favbase
doctor`, `favbase --help` -- plus one rule for the pasted setup command.

`SKILL.md`'s frontmatter carries `metadata.version`, the `favbase` release it
ships in (the Agent Skills spec has no top-level `version` field; `metadata`
values are strings, so it is quoted). It must equal
`packages/favbase/package.json`'s `version`, and
`tests/agent-bridge-cli-aliases.test.ts` fails when it does not: bump both in
the same release commit. doctor still compares copies byte for byte; it does
not read this field.

Keep exit codes and prerequisites aligned with `packages/favbase`. The
`--limit <min-max>` synopsis is contract-checked against the live `top_k`
schema (`packages/favbase/CLAUDE.md`, Boundaries), and each `favbase <alias>`
synopsis line -- here and in the npm README -- must name exactly the alias's
flags from `commands.ts`, and a positional placeholder exactly when it takes
one (docs/30 #13; same test file). Keep one synopsis line per alias. Workflow step 4's
`item_exists` / `found` meanings mirror `getItemContent`'s description in
`lib/chat/tools.ts` and have **no** guard: change both or neither.

The exit-code table is the agent's error handling (silent-failure guide,
Gotcha 5), and `packages/favbase/exit-codes.ts` is the one place that decides
which failure lands in which row (docs/30 #2).
`packages/favbase/exit-codes.test.ts` reconciles every row of this table and
the npm README's with it: the same codes, and each agent row's action. Exit 1 recognises a usage error by the CLI's closing line
`Run favbase --help for usage.` (fix the command, don't send the user to
`favbase setup`); any other exit-1 message goes to the user as is, because it
names the fix -- `favbase setup`, a path favbase could not write -- or at
least what went wrong (exit 1 is also where a failure without a type lands).
Exit 2 runs `favbase doctor` and acts on its `troubleshooting` list -- there
whatever fails since docs/30 #3, with the failed step's problem first -- and
retries once when it reports ok (a timeout). The row used to add "or its
stderr message when it prints no report" for 0.2.1's doctor, which printed one
line on a daemon failure; docs/30 #4 dropped it, because this copy now only
reaches the CLI it ships with (bundled, or through `favbase-latest`), and the
test refuses it back. Exit 3 names exactly the codes the agent fixes itself
(`invalid-args`, `unknown-tool`); every other goes to the user.
`packages/favbase/cli-main.test.ts` checks the usage line quoted here is the
one the CLI prints. The same file checks that this file and the npm README both carry
`--args-file <path>`, the form the CLI's failed-`--args` error points at
(Windows PowerShell 5.1 strips the JSON's double quotes). Reconnect
copy must use the CLI's canonical wording, verbatim -- `cli-main-doctor.test.ts`
compares this file against `EXTENSION_LATENCY_HINT`: an already connected
extension skips alarm waiting; cold reconnect is about 30 seconds on Chrome 120+
or 60 seconds on Chrome 116-119; longer failures run `favbase doctor`. Never
promise `~35 s`, claim every browser reconnects within 30 seconds, or include a
real token.

The **Update notices** section quotes the CLI's update notice with `<latest>` /
`<version>` placeholders; `packages/favbase/cli-main.test.ts` checks that quote
(and the npm README's) against the line the CLI really prints, so reword the
code and both quotes together (docs/27 Step 2). It tells the agent to finish
the request, then relay the notice and doctor's skill-copy lines, and never to
run `npm install` or `install-skill` itself (docs/27 D13): upgrading is the
user's action, a bare `install-skill` would write every agent's copy (D11 treats
one missing side as deliberate), and the skill already loaded for the session
would not change anyway. Mind the self-reference: an agent holding an **older**
copy of this file cannot read an instruction added now; a new instruction here
only helps once the next release has made this version stale.

Both files here are read by a user or an agent, so they follow the CLI's
user-facing vocabulary (`packages/favbase/CLAUDE.md`, Boundaries): **Agent
Skills** for the settings section, **pairing token** for the secret. The domain
names -- Agent Bridge, Bridge Token -- stay in code and in notes like this one.
