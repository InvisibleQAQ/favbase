# Contributing to favbase

Issues and focused pull requests are welcome. Contributions ship under the project's
[GPL-3.0](./LICENSE) licence; there is no CLA.

**This file is a route, not a manual.** Every rule below names the file that owns it,
and the owner is authoritative. If this file and an owner disagree, the owner is right
and this file is the bug — please say so in your PR.

---

## Before you open a pull request

Install and build steps are in the README's [Development](./README.md#development)
table. Four things that table does not tell you:

**Run the checks cheapest-first**, so a failure costs you seconds instead of a full
build: focused `pnpm vitest run <paths>` → `pnpm compile` → `pnpm test` → `pnpm build`.
Owner: [`.trellis/spec/frontend/ui-design-system.md`](./.trellis/spec/frontend/ui-design-system.md) §16.

**There is no linter.** No ESLint, no Prettier, no commit hooks. Conventions that would
normally be lint rules are **vitest guard tests** instead, so a convention violation
reaches you as a failing test naming a `file:line` rather than as review feedback. If a
test you have never heard of goes red, read its failure message before changing it —
it is probably telling you a real rule.

**Commit messages are `<type>(<scope>): <description>`** — for example
`feat(youtube): add playlist membership links`. Nothing enforces it.

**A directory you create gets its own `CLAUDE.md` in the same commit**, describing what
that directory owns. Owner: the directory index in [`CLAUDE.md`](./CLAUDE.md). These
files are how both humans and AI assistants navigate the tree; a new directory without
one is an unlabelled room.

---

## Adding a collection platform

Adding a source — a video site, a code host, a microblog, a read-later service — is the
contribution this codebase is shaped around, and it is the one with a written route.

### What it actually costs

Measured from `youtube`, the thinnest complete platform:

| | |
| --- | --- |
| Files | 15 |
| Total lines | 2264 |
| — of which tests | 712 |
| — of which `CLAUDE.md` | 58 |
| Real implementation | ≈ 1494 lines |
| Locale keys | ≈ 40, in **both** `zh-CN` and `en` |

`bilibili` is 6448 lines. It is the documented outlier, not the target — it carries a
transcription pipeline, a nested detail route, and a deliberate opt-out from the shared
list hook. Do not use it as your reference implementation.

### Read in this order

1. **[`CONTEXT.md`](./CONTEXT.md)** — the vocabulary. *Collection Platform*,
   *Platform Sync*, *Source*, *Collection Item*, *Item Count* vs *Membership Count*.
   The spec below assumes these words and never redefines them, so skipping this makes
   the spec read as jargon.
2. **[`.trellis/spec/frontend/platform-onboarding.md`](./.trellis/spec/frontend/platform-onboarding.md)**
   — the route itself: the five decisions that must precede any code, the domain layer,
   the registries, the app UI, the credentials chain, verification, and definition of
   done. This is the authoritative document. Everything after this point in *this* file
   only tells you how to approach it.
3. **`lib/youtube/` and `entrypoints/app/sections/youtube/`** — the code to copy the
   shape of, alongside their `CLAUDE.md` files.

### The one habit that decides how this goes

**Do not write yourself a checklist.** The spec's central claim (§2, §5) is that the
repository generates your work queue for you. Build the `lib/<platform>/` layer first
while the compiler stays green, then add your platform id to `COLLECTION_PLATFORMS` and
run:

```bash
pnpm compile
pnpm vitest run tests/platform-completeness-contract.test.ts
```

The compiler names every exhaustive registry still missing your platform — reported on
the object literal you are meant to edit, not in some distant consumer. The contract
test reports everything types cannot see as one aggregated list. **That combined output
is your TODO list**, and it is correct on the day you read it. A checklist you copy by
hand starts going stale immediately, which is exactly how a platform ends up silently
absent from one corner of the product.

### What no machine will tell you

Spec §9 lists the items nothing catches — there are two, both silent when missed: no
error, no red test, just a subtly wrong product. Walk that section by hand before
opening your PR, and say in the PR description that you did.

### Not sure the platform is even feasible?

Open a [Platform Request](https://github.com/InvisibleQAQ/favbase/issues/new) issue
before writing code, titled `[Platform Request] <platform name>` — the extension links
to the same tracker from its own navigation.
Bring the favorites/bookmarks page URL and how a logged-out request behaves. *How the
platform authenticates* is question one of spec §3 and the decision most likely to sink
the effort; getting a second opinion on it costs one comment and can save a weekend.

---

## Everything else

[`docs/`](./docs/) holds architecture notes and implementation specs, some of which
record superseded plans. When an older document disagrees with the code, the source and
its tests are authoritative.
