# favbase Agent Skill

`SKILL.md` is the single source bundled into `favbase-cli` and installed for
Claude Code/Codex. It documents commands and recovery behavior; it never reads
the collection itself.

Keep exit codes and prerequisites aligned with `packages/favbase-cli`. Reconnect
copy must use the CLI's canonical wording: an authenticated bridge skips alarm
waiting; cold reconnect is about 30 seconds on Chrome 120+ or 60 seconds on
Chrome 116-119; longer failures run `favbase doctor`. Never promise `~35 s`,
claim every browser reconnects within 30 seconds, or include a real Bridge Token.
