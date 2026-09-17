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

Keep exit codes and prerequisites aligned with `packages/favbase`. Reconnect
copy must use the CLI's canonical wording, verbatim -- `cli-main-doctor.test.ts`
compares this file against `EXTENSION_LATENCY_HINT`: an already connected
extension skips alarm waiting; cold reconnect is about 30 seconds on Chrome 120+
or 60 seconds on Chrome 116-119; longer failures run `favbase doctor`. Never
promise `~35 s`, claim every browser reconnects within 30 seconds, or include a
real token.

Both files here are read by a user or an agent, so they follow the CLI's
user-facing vocabulary (`packages/favbase/CLAUDE.md`, Boundaries): **Agent
Skills** for the settings section, **pairing token** for the secret. The domain
names -- Agent Bridge, Bridge Token -- stay in code and in notes like this one.
