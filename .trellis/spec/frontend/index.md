# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory contains guidelines for frontend development. Fill in each file with your project's specific conventions.

---

## Git / Commit Policy (applies to EVERY session)

**AI 默认不 commit（default: no commit）.** When work is complete, stop in the uncommitted state and present the commit plan (file list + suggested `<type>(<scope>): <description>` message) — the user reviews the diff manually and commits themselves. The AI may run `git commit` ONLY when the user explicitly instructs it in the current conversation ("commit" / "提交"). This overrides any workflow step that reads as "the AI drives the commit" (old Phase 3.4 wording). `/trellis:finish-work` runs fine on an uncommitted working tree and never commits code. Never push; never add Claude attribution markers.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| Directory Structure | **Not created.** Module ownership lives in the root `CLAUDE.md` directory index plus each directory's own `CLAUDE.md` (`entrypoints/app/CLAUDE.md` for the app tree). docs/25 iron rule 5 cites this file; read those two instead | Not created |
| Component Guidelines | **Not created.** Component patterns are enforced per owner directory (`components/*/CLAUDE.md`) and, for shared app UI, by `ui-design-system.md` | Not created |
| Hook Guidelines | **Not created.** See `entrypoints/app/hooks/CLAUDE.md` and `lib/hooks/CLAUDE.md` | Not created |
| State Management | **Not created.** Storage keys and their owners are in `lib/storage/CLAUDE.md`; page state machines in their section `CLAUDE.md` | Not created |
| Quality Guidelines | **Not created.** The verification order docs/25 iron rule 8 cites this file for is docs/25 section 6 (global verification matrix) and section 16 of `ui-design-system.md`: focused `pnpm vitest run <paths>` -> `pnpm compile` -> `pnpm test` -> `pnpm build` | Not created |
| Type Safety | **Not created.** Runtime-boundary decoding rules live in the root `CLAUDE.md` cross-runtime protocol section | Not created |
| [i18n Conventions](./i18n-conventions.md) | i18n architecture, seam boundary, locale contracts | Active |
| [UI Design System](./ui-design-system.md) | MUI v9 theme, palette, typography, layout, shadows, icons, forbidden patterns | Active |
| Database Bridge | **File missing.** PGlite RPC proxy, transaction mutex, batch upsert, concurrency, pgvector similarity search — read `lib/database/CLAUDE.md` | File missing |
| Agent Bridge | **File missing.** Strict external v1 protocol, shared Knowledge Tool registry, favbase CLI + loopback Bridge Daemon (no MCP), authentication, bounded failures, skill install, and package contract — read `lib/agent-bridge/CLAUDE.md` + `packages/favbase-cli/CLAUDE.md` + `docs/adr/0003` | File missing |
| LLM Structured Output | **File missing.** generateObject capability branching, json_object prompt constraints, provider json_schema matrix — read `lib/ai/CLAUDE.md` | File missing |
| [Platform Onboarding](./platform-onboarding.md) | Executable contract for adding Collection Platform N+1: the decisions that must precede code, `lib/<platform>/` layering on the shared ingest pipeline, the 13+3 registries, the section adapters, the credentials chain, and the checklist nothing enforces. `tests/platform-completeness-contract.test.ts` stays the executable half; this file is the route through it | Active |
| Processing Queue | **File missing.** Page-runtime collection jobs, per-platform embedding lanes, pause/resume, retry, and progress contracts — read `entrypoints/app/hooks/CLAUDE.md` + `lib/embedding/CLAUDE.md` | File missing |
| Extension Host Permissions | **File missing.** Required broad bookmark access, withheld-permission recovery, and manifest validation — read `lib/permissions/CLAUDE.md` | File missing |

### Link audit, 2026-09-04 (docs/25 Step 10, appendix D-5), revised 2026-09-06

This directory contains four files: `index.md`, `i18n-conventions.md`,
`ui-design-system.md`, and `platform-onboarding.md` (written 2026-09-06). Of the
14 rows above, 3 resolve to a file; the other 11 resolve to nothing and are no
longer written as links.

- The first six rows were re-labelled **Not created** by decision: the facts
  they promised already have an owner (see each row), and the same rule enforced
  in two places is the rule rotting in one of them. Do not create them to make
  the table look complete — fix the owner instead.
- The last six rows (Database Bridge through Extension Host Permissions) were
  labelled `Active` next to a dead link until the check pass on 2026-09-04. A
  status column describes the guide, and "Active" for a file that is not on disk
  is simply false, so they now read **File missing** with the real owner named
  in the row. What stays `[UNKNOWN]` is only their *provenance*: whether they
  were once written and lost with a worktree teardown (at the time `.trellis/`
  was untracked, so git could not answer) or never existed. Do not upgrade a row
  back to `Active` without the file. **That blind spot is closed going forward**:
  since 2026-09-07 `.trellis/spec/` is version-controlled (`.gitignore` re-includes
  it out of both the repo rule and the machine-wide `core.excludesFile` rule), so
  a spec lost from here is recoverable from history. Nothing else under
  `.trellis/` is tracked.
- Neither label authorizes writing the missing file. If a domain rule needs a
  home, the answer is the owner `CLAUDE.md` named in its row, unless the rule
  genuinely spans layers the way `ui-design-system.md` and
  `i18n-conventions.md` do.
- **Platform Onboarding invoked exactly that exception on 2026-09-06** and is
  now `Active`. Adding a Collection Platform touches the lib domain layer, the
  shared ingest pipeline, 13 contract-checked registries across 11 files, the
  app section tree, welcome, Settings, the manifest, i18n and four guard tests —
  no single owner `CLAUDE.md` can hold the route through all of them. The file
  points at those owners rather than restating them; the moment it starts
  duplicating a rule an owner already enforces, delete that part of it.

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
