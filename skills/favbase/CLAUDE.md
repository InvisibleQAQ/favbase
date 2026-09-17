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
copy must use the CLI's canonical wording: an authenticated bridge skips alarm
waiting; cold reconnect is about 30 seconds on Chrome 120+ or 60 seconds on
Chrome 116-119; longer failures run `favbase doctor`. Never promise `~35 s`,
claim every browser reconnects within 30 seconds, or include a real Bridge Token.
