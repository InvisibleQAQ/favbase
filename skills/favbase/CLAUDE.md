# favbase Agent Skill

Two files, two readers. `SKILL.md` is the Skill: the single source, bundled into the `favbase` CLI
and installed for Claude Code / Codex. `INSTALL.md` is the **Agent Setup Guide** (`CONTEXT.md`,
`docs/adr/0005`) and is NOT a Skill.

## SKILL.md

- Edit it only in a release commit, published in the same sitting (owner:
  `packages/favbase/CLAUDE.md`, `## Release`). `npx skills add InvisibleQAQ/favbase -g` copies the
  file as it stands on `main`, and doctor compares copies byte for byte: an edit that lands ahead
  of npm gives every npx user a `stale` copy describing a CLI they do not have.
- The root `.gitattributes` pins it to LF for the same reason: the skills tool git-clones this
  repository, and a clone under `core.autocrlf=true` would be CRLF, i.e. `stale`.
- `metadata.version` must equal `packages/favbase/package.json`'s `version`; bump both in the
  release commit. It sits under `metadata` and is quoted because the Agent Skills spec has no
  top-level `version` and `metadata` values are strings. doctor does not read it.
- Much of its prose is a hand-written copy of extension or CLI facts (platform lists, the
  `--limit` range, one synopsis line per alias, the exit-code table, quoted CLI lines). Shipped
  markdown cannot derive, so tests reconcile it: reword freely, but keep the shape a test anchors
  on or change the test with it. Guards: `tests/agent-bridge-cli-aliases.test.ts`, and
  `exit-codes.test.ts`, `cli-main.test.ts`, `cli-main-doctor.test.ts` in `packages/favbase`.
- The frontmatter `description`'s platform list is what an agent selects the skill by. A platform
  missing there means the agent never reaches for favbase when the user asks about it.
- No guard: Workflow step 4's `item_exists` / `found` meanings mirror `getItemContent`'s
  description in `lib/chat/tools.ts`. Change both or neither.
- The exit-code table is the agent's error handling, and `packages/favbase/exit-codes.ts` decides
  which failure lands in which row. The test checks anchors only: when a failure changes code,
  reread the row as an agent would (silent-failure guide, Gotcha 5).
- Reconnect copy uses the CLI's `EXTENSION_LATENCY_HINT` verbatim. Never promise `~35 s`, claim
  every browser reconnects within 30 seconds, or include a real token.
- **Update notices** must keep telling the agent to finish the request, relay the notice, and
  never run `npm install` or `install-skill` itself: upgrading is the user's action, and a bare
  `install-skill` would write every agent's copy.
- Self-reference: an agent holding an older copy cannot read an instruction added now. A new
  instruction only helps once the next release has made that copy stale.

## INSTALL.md

- An agent with nothing installed yet fetches it from `main` by raw URL (`AGENT_SETUP_GUIDE_URL`
  in `lib/repo.ts`). Users paste that URL into their own prompts, so this path and the `main`
  branch cannot move.
- It is read from `main` while `npm install -g favbase` installs the last release, so it may only
  say what holds for every published version: no exit codes, no CLI behaviour. For failures it
  defers to what ships with the installed CLI (the installed SKILL.md, `favbase doctor`,
  `favbase --help`).
- After installing the CLI it must **stop** and ask the user to paste the pairing command from
  Settings > Connections > Agent Skills. It must never contain a runnable `favbase setup` command
  of its own: the token exists only inside the running extension.
- Guard: `tests/agent-bridge-cli-aliases.test.ts`.

## Both files

- `npx skills add` copies this whole directory, so this file and INSTALL.md land in the user's
  skill folder too.
- Both are read by a user or an agent, so they use the user-facing vocabulary: **Agent Skills**
  for the settings section, **pairing token** for the secret (owner:
  `packages/favbase/CLAUDE.md`, `## Boundaries`). Agent Bridge and Bridge Token stay in code and
  in notes like this one.
