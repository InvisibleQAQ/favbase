# favbase Agent Skill

`SKILL.md` is the single source bundled into `favbase` and installed for
Claude Code/Codex. It documents commands and recovery behavior; it never reads
the collection itself.

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
a runnable setup command.

Keep exit codes and prerequisites aligned with `packages/favbase`. The
`--limit <min-max>` synopsis is contract-checked against the live `top_k`
schema (`packages/favbase/CLAUDE.md`, Boundaries). Workflow step 4's
`item_exists` / `found` meanings mirror `getItemContent`'s description in
`lib/chat/tools.ts` and have **no** guard: change both or neither. The exit-1
row tells an agent to recognise a usage error by the CLI's closing line
`Run favbase --help for usage.` (fix the command, don't send the user to
`favbase setup`); `packages/favbase/cli-main.test.ts` checks that line is quoted
here. The same file checks that this file and the npm README both carry
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
