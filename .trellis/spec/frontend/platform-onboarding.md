# Platform Onboarding

> Executable contract for adding **Collection Platform** N+1. This file is the
> route, not the retelling: the reasoning behind the current shape lives in the
> multi-platform audits (`docs/13`–`docs/17`, `docs/20`) and in each owner
> directory's `CLAUDE.md`. Domain vocabulary — **Collection Platform**,
> **Platform Sync**, **Source**, **Collection Item**, **Pipeline Run**,
> **Processing Coverage** — is defined once in the root `CONTEXT.md` and is
> never redefined here.

## 1. Scope & Trigger

Read this before touching anything when you are:

- adding a Collection Platform (the seventh, and every one after it);
- changing what a platform's **Platform Sync** means — auth shape, Source shape,
  content shape, sort key, or downstream eligibility;
- removing a platform;
- adding a field that *every* platform must declare.

Out of scope: visual conventions (`ui-design-system.md`), locale mechanics
(`i18n-conventions.md`), the PGlite RPC bridge (`lib/database/CLAUDE.md`).

Already onboarded: `bilibili`, `github`, `bookmarks`, `x`, `zhihu`, `youtube`.
**`youtube` is the reference implementation** — thinnest complete platform (no
content stage, no child route, credential-gated, multi-Source). `bilibili` is
the outlier; read §10 before copying anything from it.

## 2. The two machine-checked halves

Adding a platform is not a checklist you carry in your head. Two mechanisms
already carry most of it, and the single most important technique in this file
is **making them generate your TODO list instead of writing one yourself**.

| Mechanism | What it catches | How you invoke it |
| --- | --- | --- |
| TypeScript exhaustive `Record<CollectionPlatform, T>` | Every registry that must gain a key. The error lands on the object literal, naming the missing property. | `pnpm compile` |
| `tests/platform-completeness-contract.test.ts` | What types cannot see: a lazy import resolving to nothing, a page that renders no `sections/` view, a view that skips `useCollectionBreadcrumbs`, `main.tsx` naming a platform, a hand-written `jobPlatform`, `hooks/` importing `sections/`, a `childRoutes` or `hostPermissions` value that is computed instead of written out, an analytics axis absent from its own ranked list, a platform literal leaking into `collection-processing-policy.ts`, a missing `lib/<platform>/` directory, and — for a platform whose `readiness` is `'credentials'` — a missing link in the credentials chain (§8): the Connections card file, the `ConnSection` union member, the `connNavItems` rail entry, `derive<Pascal>Draft` / `save<Pascal>` in `useSettings`, the `configSavedAt` key. Reports **all** failures as one aggregated list. | `pnpm vitest run tests/platform-completeness-contract.test.ts` |

Five more guards fire with no wiring on your part. Three of them reconcile an
artefact you still write by hand: the guard turns "silently absent" into a red
test, it does not do the work for you.

| Guard | Contract | You still hand-write |
| --- | --- | --- |
| `tests/lib-import-smoke.test.ts` | `lib/<platform>/` MUST contain **exactly one** non-test `*-sync-service.ts`, and it MUST `import()` cleanly with no `chrome` global and zero `vi.mock` — i.e. no `@/lib/storage` (or any module with a `chrome.*` load side effect) in its static graph. | — |
| `tests/http-fetch-deadline-guard.test.ts` | No bare `fetch(` anywhere in `lib/**`. Use `fetchWithDeadline` (`lib/http/`). | — |
| `tests/platform-env-constants-guard.test.ts` | No bare numeric `SCREAMING_CASE` module constant in `lib/<platform>/`. Every policy number goes through `envNumber('VITE_<PLATFORM>_<NAME>', default)` **and** is registered in that test's `EXPECTED_ENV_CONSTANTS` table with its exact fallback. | your platform's block in `.env.example` — tracked and secret-free, one documented line per key, checked both ways |
| `tests/platform-completeness-contract.test.ts` — marquee coverage | Every platform's `PLATFORM_META.title` appears as a pill in `entrypoints/welcome/sections/capability-marquee.tsx`. | the pill. Those rows are hand-authored on purpose (docs/26 D5) — the interleaving of platform and capability pills is a design decision, so coverage is checked, never generated |
| `tests/agent-bridge-cli-aliases.test.ts` | `skills/favbase/SKILL.md` carries **two** platform lists and both are reconciled: the `` `<platform>` is one of … `` sentence against the ids, and the frontmatter `description` against the in-app names (`PLATFORM_META.title` through the en locale). | both lists. Shipped markdown derives nothing, and the frontmatter one is what an external agent *selects the skill by* — miss it and the agent never reaches for favbase when the user asks about your platform |

## 3. Decide before you write code

These five answers determine every table you will fill in. Getting one wrong is
a rewrite, not an edit.

| Question | Where the answer lands | Reference answers |
| --- | --- | --- |
| **Auth shape** — what must exist before the first sync can run? | the descriptor's `readiness` (`'credentials'` / `'login'` / `'local'`; `WELCOME_READINESS_BY_PLATFORM` derives from it), and whether you owe a Connections card (§8) | `credentials`: github, youtube · `login`: bilibili, x, zhihu · `local`: bookmarks |
| **Source shape** — does the platform expose containers (folders / playlists / collections)? | the descriptor's `dimensions` (`ranked` / `author` / `source`, `null` when the platform has no Source), whether a Collection Item may hold N memberships | multi-Source: bilibili, bookmarks, zhihu, youtube · single: github, x |
| **Content shape** — what text feeds Embedding, and is it available at sync time? | the `content` block of `IngestInput`, the `contentState` you declare, the descriptor's `contentKind` (§6.1), whether the pipeline gains a content stage | inline at sync: github README, zhihu answer, youtube description, x tweet · deferred: bookmarks extraction, bilibili transcription |
| **Sort key** — what is the platform's native "recency"? | the descriptor's `sortKey` (`PLATFORM_SORT_KEYS` derives from it) | `publishedAt` column, or a `platform_meta` field with `unixSeconds` / `iso8601` format |
| **Downstream eligibility** — are some persisted items ineligible for Content → Embedding → Tags? | `PLATFORM_DOWNSTREAM_ELIGIBILITY` (`null` when none) | only bilibili has one (taken-down videos) |

**No database migration is ever required.** `items.platform` is a plain `text`
column; its only constraint is `unique(platform, platform_item_id)`. The
`CHECK` on `items` covers `content_state`, not `platform`. A platform that
needs a new table is not a platform — escalate it.

## 4. Phase 1 — Domain layer first, discriminator second

`IngestInput.platform` and `getPlatformLastSyncedAt(platform)` both take a plain
`string`. That is deliberate: **you can build and green-test the entire
`lib/<platform>/` layer before adding the id to `COLLECTION_PLATFORMS`**, with
`tsc` staying green the whole time. Do it in that order — flipping the
discriminator first means working for a day against a red compiler and learning
nothing from it.

### 4.1 `lib/<platform>/<platform>-api.ts` — the remote layer

- No DB imports. No UI copy. No `t()`.
- Every request through `fetchWithDeadline`.
- **Never trust HTTP 200.** A 200 carrying non-JSON, or missing the array you
  expected, MUST throw with a body snippet. Swallowing it into an empty array
  is how a sync silently reports success and persists nothing. An `items: []`
  that the API genuinely returns is a legal zero result — let that through.
- Export structured error classes (`<P>AuthError`, `<P>RateLimitError`). They
  are the lib half of the i18n seam; the view maps them to locale keys.
- Pagination: serial, with a politeness delay. Numeric constants via
  `envNumber` (§2).
- Export the pure parsers (id/handle normalisers, duration parsers) so they can
  be unit-tested without a network.

### 4.2 `lib/<platform>/<platform>-sync-service.ts` — the only holder of schema knowledge

Exactly one such file per platform directory (`lib-import-smoke` asserts it).

Write side — **do not hand-roll any of this**:

```ts
import { ingestCollection } from '@/lib/ingest/ingest';
```

`ingestCollection` owns the transaction boundary, insert-only semantics,
`chunk(500)` batching, the platform-wide id-map re-select, the two-phase content
write, and ghost self-healing. You declare normalised rows
(`sources` / `authors` / `items` / `links`) plus an optional
`content: { textOf, chunk }`. Read `lib/ingest/CLAUDE.md` once, in full, before
your first `ingestCollection` call.

Read side — also shared:

```ts
import { pagedItemsQuery, getPlatformLastSyncedAt } from '@/lib/database/collection-queries';
import { escapeLike } from '@/lib/database/sql-utils';
```

Your file contributes only the WHERE conditions, the ORDER BY, and `mapRow`.

Chunking: `charSplit` from `@/lib/embedding/char-split` — a **leaf import**, not
the `@/lib/embedding` barrel (the barrel has a `chrome.storage` load side effect
and will break import-smoke).

Also export `narrow<P>Meta(meta: unknown, fallbacks)` from this file. It is the
single owner of the defensive `platform_meta` narrowing, shared by `mapRow` here
and by the tagged-card adapter in `sections/`. Two copies of that narrowing is a
defect, not a convenience.

### 4.3 Invariants you inherit and must not break

- **Insert-only** (`.trellis/spec/frontend/database-bridge.md`'s ADR, enforced by
  `ingestCollection`): `items` / `authors` / `item_sources` use
  `onConflictDoNothing`, first-write-wins. The single exception is `sources`,
  which upserts to refresh `title` / `lastFetchedAt` (this is how a renamed
  folder flows in).
- **`contentState`**: declare `'chunked'` only when you actually hand over text;
  declare `'no_content'` when the text is genuinely empty. **Never `'pending'`**
  unless the platform has a real deferred-content pipeline — `'pending'` is what
  feeds auto-transcribe.
- **Multi-Source membership**: one Collection Item + N links. `platform_meta`
  may carry a first-seen Source for display and sorting, but every *filter* goes
  through `item_sources`. **Item Count** and **Membership Count** are different
  numbers (`CONTEXT.md`); do not blur them.
- The sync-service takes a `CooperativeCheckpoint` and calls it only at
  *claim-the-next-page / claim-the-next-item* boundaries. The in-flight request
  and the final DB write always finish. Pause is not cancel.

### 4.4 Tests

An in-memory PGlite guard test for the sync-service (equivalence of the ingest
result, dedup, membership) and a pure-function test for the API parsers. Both
run before the platform exists anywhere else.

## 5. Phase 2 — Flip the discriminator, harvest the TODO list

```ts
// lib/collections/platforms.ts
export const COLLECTION_PLATFORMS = [ /* … */, '<platform>' ] as const;
```

Then:

```bash
pnpm compile                                                   # red: every exhaustive Record you owe
pnpm vitest run tests/platform-completeness-contract.test.ts    # red: one aggregated list of the rest
```

Those two outputs are your work queue for §6–§7. Burn them down; do not
transcribe them into a side document that will rot.

## 6. Phase 3 — The registries

The facts a platform used to declare one file at a time are now eleven fields
across two **Platform Descriptors** (ADR 0004). Both are exhaustive
`Record<CollectionPlatform, …>`, so an undeclared platform is a compile error on
the object literal that names the platform — and the whole point is that it
lands there, in the file you are meant to edit, instead of in whatever consumer
happened to index it first. Four registries stay where they are, because their
values are not data.

### 6.1 The domain descriptor — `lib/collections/platform-descriptor.ts`

`PLATFORM_DESCRIPTORS`. The build config loads this file in Node by relative
path, so **its only value import may be `./platforms`** and the `lib/collections`
barrel never re-exports it (§11 — both rules exist to keep it loadable). The
second rule is about the barrel's *exports*, not the descriptor's consumers:
three modules that are themselves in the barrel import the descriptor, which is
fine, because the first rule keeps its own graph at one leaf.

| Field | You declare | Read by |
| --- | --- | --- |
| `jobPlatform` | the background-job namespace, unique across platforms (`{jobPlatform}:sync｜embed｜tag｜extract`) | `jobPlatformForCollection`, and the background-jobs indicator's label — a join onto `PLATFORM_META.title` (§6.2) |
| `readiness` | `'credentials'` / `'login'` / `'local'` (§3) | `WELCOME_READINESS_BY_PLATFORM`, the welcome landing route |
| `hostPermissions` | an explicit array literal of match patterns, in the order you want them in the manifest | `PLATFORM_HOST_PERMISSION_LIST`, spread into `wxt.config.ts` `host_permissions` |
| `sortKey` | `{ source: 'publishedAt' }`, or `{ source: 'meta', field, format }` (§3) | `PLATFORM_SORT_KEYS`, re-exported from `platform-sort-keys.ts` |
| `contentKind` | the English semantic id for what your Content stage actually produces — `transcript`, `readme`, `page-text`, `post-text`, `body-text`, `description`, or a new member of the union if yours is genuinely a different artefact | the `getProcessingCoverage` Knowledge Tool, which returns it as `content.kind` and derives its own description from the distinct set |
| `dimensions` | `{ ranked, author, source }` — the ordered Collection Analytics facets, which one carries the **Creator** axis, and which one carries the **Source** membership (`source: null` when the platform has no Source) | the Dashboard composition and breakdown cards, read inline |

Three of those fields have a cost you cannot see from the object literal, so all
three are pinned in `lib/collections/platform-descriptor.test.ts`:

- **`hostPermissions` order is a manifest contract.** An installed MV3 extension
  whose `host_permissions` set changes asks its user to re-authorize. The test
  locks the flattened golden order, not just the membership.
- **`jobPlatform` must be unique.** Two platforms sharing a job lane means the
  second sync is discarded as a duplicate of the first.
- **`contentKind` must stay a machine id, never a display string.** It is the
  word a model uses for your platform's body text, and the localized names are
  app-side `LocaleKeys` that `lib/` cannot import (ADR 0004 D3). The closed
  union enforces this today; the test enforces it for the member you add. Do
  **not** write a per-platform sentence into the tool description instead —
  `lib/chat/tools.test.ts` rejects a hand-written list there, and that rejection
  is why this field exists.

### 6.2 The app descriptor — `entrypoints/app/collection-platform-registry.ts`

`PLATFORM_META`. It is a separate literal from §6.1 rather than one manifest
because its field types are app-owned — `LocaleKeys`, `IconifyName` — and
`lib/` must not depend on `entrypoints/` (ADR 0004).

| Field | You declare | Read by |
| --- | --- | --- |
| `title` | your `nav.*` locale key | `collectionPlatformRegistry` (sidebar, breadcrumb ancestry, chat source cards), the marquee coverage check and the SKILL.md description reconciliation (§2) |
| `icon` | an `IconifyName` | the same registry |
| `palette` | `{ light, dark }` brand hues, or `'ink'` for a black-logo brand (github, x), which resolves to the scheme's own text ink | `PLATFORM_PALETTE_LIGHT` / `PLATFORM_PALETTE_DARK` in `theme/core/palette.ts` |
| `hint` | the one-line onboarding hint locale key — a `welcome.picker.hint.*` key, not any `LocaleKeys` that compiles | the welcome platform picker |
| `childRoutes` | an explicit array literal of nested detail routes; `[]` for a flat platform | `COLLECTION_PAGE_CHILD_ROUTES`, spread into the router (§7.1) |

`icon` is typed `IconifyName = keyof typeof allIcons`, so a glyph you have not
added to `entrypoints/app/components/iconify/icon-sets.ts` is a **compile error
in this file** — a different file from the one you forgot to edit. Add the
offline SVG body first; there is no CDN.

`palette` is not the brand's own hex. The values come from the dataviz palette
validator (bilibili's `#FB7299` fails contrast at 2.4:1), `theme/core/palette.test.ts`
locks every one of them, and changing one requires re-running the validator.

### 6.3 The four heavy-value registries

Their values are `lazy()` thunks, React components, functions and drizzle `SQL`
— not data — so they stay in place and stay exhaustive (docs/26 D2). The
completeness contract checks each one for per-platform coverage.

| File | Symbol | You declare |
| --- | --- | --- |
| `entrypoints/app/collection-platform-pages.ts` | `COLLECTION_PAGE_LOADERS` | `lazy(() => import('./pages/<platform>'))` |
| `entrypoints/app/sections/collections/collection-item-card.tsx` | `CARD_ADAPTERS` | the `Tagged<P>Card` component |
| `entrypoints/app/collection-platform-auto-sync.ts` | `AUTO_SYNC_PLATFORM_BY_COLLECTION` | `{ runSync, ...<p>AutoSyncPolicy }` — **`runSync` required, `jobPlatform` forbidden** (it is derived from §6.1) |
| `lib/collections/platform-eligibility.ts` | `PLATFORM_DOWNSTREAM_ELIGIBILITY` | a `SQL` predicate, or `null`. The rule itself lives in `lib/<platform>/`; this table only registers it |

## 7. Phase 4 — App UI

### 7.1 `entrypoints/app/pages/<platform>.tsx`

A one-line re-export. The completeness contract walks
`COLLECTION_PAGE_LOADERS` → this page → its single `../sections/…` import to
find your view, so keep it trivial:

```tsx
import { RedditView } from '../sections/reddit/reddit-view';

export default function RedditPage() {
  return <RedditView />;
}
```

`main.tsx` is not edited. Ever. Routes are spread from
`collectionPlatformRoutes`, and the contract test fails if `main.tsx` contains
the string `collections/<platform>`.

A nested detail route (`/collections/bilibili/:mediaId`) is not declared here
either: it is the `childRoutes` field of the app descriptor (§6.2), from which
`collection-platform-pages.ts` derives `COLLECTION_PAGE_CHILD_ROUTES`. This file
stays a one-line re-export whether your platform has child routes or not.

### 7.2 `entrypoints/app/sections/<platform>/`

| File | Responsibility |
| --- | --- |
| `<platform>-sync-adapter.ts` | **The Platform Sync.** `run<P>Sync(onProgress, control)` is the single definition of what a sync means: credential resolution (missing config = silent no-op), the domain call, and the closing `startCollectionProcessingJobs({ jobPlatform, itemPlatform, itemIds: result.newItemIds })`. Also exports `<p>AutoSyncPolicy` (`probeReady`, optional `isSilentError`). The manual page and the daily coordinator call **this same function** — copying credential resolution or post-sync dispatch into either trigger is the defect this file exists to prevent. |
| `use-<platform>.ts` | Thin adapter over `useCollectionLibrary`. Inject `queryFn` / `facetsFn` / `lastSyncedFn` / `syncFn = run<P>Sync` / `classifyError` / `logTag`, then rename the generic fields to platform vocabulary. **Config gates live here**, wrapped around the generic `sync` — not inside `useCollectionLibrary`. Every injected function must be a stable reference (module-level or `useCallback`); they sit in effect dependency arrays. |
| `<platform>-view.tsx` | Assembles `CollectionPageScaffold` + `useCollectionPipeline` + `useCollectionBreadcrumbs`. Owns the i18n seam: structured sync error → locale key. |
| `<platform>-card.tsx` | Composes the shared `CollectionCard` shell. |
| `tagged-<platform>-card.tsx` | `TaggedItem` → your item shape, delegating narrowing to `narrow<P>Meta`. |
| `<platform>-grid-skeleton.tsx` | Shared `CardGridSkeleton` + `CollectionCardSkeleton`. |
| chips component | Shared `CollapsibleChipRow` adapter, if the platform has Sources. |
| `CLAUDE.md` | **Mandatory.** Root `CLAUDE.md` rule: a directory you create gets its own `CLAUDE.md` in the same commit. |

### 7.3 What the scaffold already owns — do not reimplement

`CollectionPageScaffold` owns the tag wiring, the **eight-branch content phase
ladder** (`resolveCollectionPhase`, whose branch order is the contract), the
grid/popover/pagination, and the fixed page order (title → pipeline → search →
configuration notice → primary category → tag chips → content). You inject
cards, chips, states, and **pre-translated copy** — the
`components/collection/` layer calls `t()` zero times.

`useCollectionPipeline` owns the coverage refresh key, the shared
`pipeline.*` labels, and the stage array. Views pass only the Fetch runtime
(`backgroundJobRuntime(syncJob, fetchedCountProgress)`) and an optional content
stage. **Never hand-write a stages array in a view.**

`useCollectionBreadcrumbs(platform)` owns the ancestry. The contract test fails
any view that does not call it. Pass the result to both `copy.breadcrumbs` and
to the `SectionTitleBar links` of any early-return branch (a configuration gate
sits on the same route and must keep the same trail and the same single `h1`).

## 8. Phase 5 — The credentials chain (only if readiness is `'credentials'`)

The descriptor's `readiness` is exhaustive, so you cannot forget to answer the
question — and since 2026-09-07 the completeness contract (§2) also checks that
a platform answering `'credentials'` has **somewhere to enter them**: for every
platform whose `readiness` is `'credentials'` it reads each anchor below by AST
or by `existsSync` and joins the gaps to its one aggregated list. **The guard
proves the structure exists, not that it is wired correctly.** The values are
still yours to get right, and the parts marked *unchecked* below have no guard
at all — an overstated guard would be worse than none, because it stops people
looking. Five hand-written edits:

1. `lib/storage/settings-schema.ts` — the `UserSettings` fields, the zod
   entries, and the `configSavedAt` key union. *Checked:* the `configSavedAt`
   key, because that union names platform ids exactly. *Unchecked:* the
   settings fields and the zod entries — those names are free-form, so any
   assertion on them would be a heuristic that passes on the wrong field.
2. `lib/hooks/useSettings.ts` — `derive<P>Draft` + `save<P>`. *Checked:* both
   names, and only where they form the module's declared **API** — a function
   declaration or a type-member signature (the Pascal form is derived from the
   platform id). A local `const save<Pascal>` returned as a shorthand property
   does **not** satisfy it, deliberately: this file holds all three shapes of
   the same name, and it is the `UseSettingsReturn` member that makes the
   function reachable from a card. What either one *does* is not read.
3. `entrypoints/app/sections/settings/settings-view.tsx` — extend the
   `ConnSection` union **and** add the `connNavItems` rail entry. *Checked:*
   both, one-directionally — platform ⊆ union. `'agent-bridge'` is legitimately
   in that union and is not a platform, so the reverse containment is not a
   defect.
4. `entrypoints/app/sections/settings/<platform>-connection-card.tsx` — the card
   itself, using `useConfigDraft` + `SaveActions` + `SettingsPanel`, with a live
   probe that reuses a real API call. *Checked:* that the file exists. Nothing
   asserts it renders, that the rail reaches it, or that it probes anything.
5. `<platform>-sync-adapter.ts` — read the same settings keys in `probeReady`.
   *Unchecked.* Reading the wrong key here is silent in the worst way: the
   guard stays green, the card saves, and the platform reports "not configured"
   forever.

## 9. Phase 6 — The unguarded checklist

Everything above is caught by a compiler or a test. **The following is not.**
Each item is silent when missed: no error, no red test, just a subtly wrong
product. Verified against the code on 2026-09-07.

| # | Location | Why nothing catches it — and why no descriptor can | Symptom if missed |
| --- | --- | --- | --- |
| 1 | user-facing English copy in the new view | `tests/i18n-no-hardcoded.test.ts` bans **CJK only**; an English string literal passes every gate. This is orthogonal to the registries — no per-platform field expresses "the copy in your view is translated" | untranslatable copy ships, and the zh locale silently degrades |

This section had six rows, then seven when a review found the welcome marquee,
then eight when the SKILL.md frontmatter turned out to be a *second*
hand-written list in a file already thought reconciled. Seven of those eight
were not dropped for brevity — each one got a guard, and each guard is named in
§2, §8 or §11: the background-jobs label and the analytics Source axis became
descriptor fields (§6.1, §6.2), the chat prompts derive their list from
`COLLECTION_PLATFORMS`, the marquee and both SKILL.md lists are reconciled,
`.env.example` is tracked, and the credentials chain is read anchor by anchor
(§8). Per-item history is docs/26 appendix A. Note what the survivor is — and
what the credentials chain was too: **not a fact about a platform.** That is
the boundary of what a *descriptor* can buy you. It is not, as the credentials
chain's removal from this table showed, the boundary of what a *guard* can:
"no descriptor field can hold it" and "nothing can check it" are different
claims, and the second one has to be argued separately every time.

## 10. Shape variance — what you may skip

Not every abstraction is mandatory. The distinction matters, because forcing a
platform into the wrong one produces worse code than opting out.

**Mandatory for every platform**, no exceptions: `ingestCollection`, the shared
read helpers, `CollectionPageScaffold`, `useCollectionPipeline`,
`useCollectionBreadcrumbs`, the shared `*-sync-adapter.ts` seam, both Platform
Descriptors and all four heavy-value registries (§6).

**Optional**: `useCollectionLibrary`. It models *one list + facets + manual
sync*. `bilibili` opts out — it has two coupled hooks (folders and videos), a
child route, and a transcription stage — and that opt-out is a documented scope
boundary (docs/15 HIGH-1), not debt. If your platform genuinely does not fit,
opt out of the hook; **do not** opt out of the scaffold or the registries.

## 11. Forbidden patterns

| Never | Enforced by |
| --- | --- |
| a platform literal or `platform_meta` field in `lib/collections/collection-processing-policy.ts` | completeness contract |
| a route line naming a platform in `main.tsx` | completeness contract |
| a hand-written `jobPlatform` in the auto-sync registry | completeness contract |
| any `entrypoints/app/hooks/**` module importing `sections/` | completeness contract |
| a value import other than `./platforms` in `lib/collections/platform-descriptor.ts` | `platform-descriptor.test.ts` reads its own imports by AST, and `lib-import-smoke` loads it with no `chrome` global. Break it and the build fails in `wxt.config.ts`, which never mentions the real culprit |
| re-exporting the descriptor from `lib/collections/index.ts` | review — that barrel goes through `collections-query`, so it drags drizzle and `@/lib/database` into every importer, welcome.html and the Node build config included |
| a bare `fetch(` in `lib/**` | `http-fetch-deadline-guard` |
| a bare numeric module constant in `lib/<platform>/` | `platform-env-constants-guard` |
| `@/lib/storage` (or any `chrome.*`-touching barrel) in the sync-service static graph | `lib-import-smoke` |
| a `t()` call inside `components/collection/**` | design contract (`components/collection/CLAUDE.md`) |
| duplicating credential resolution or post-sync dispatch across the manual and daily triggers | review — the shared `*-sync-adapter.ts` exists precisely to make this unnecessary |
| a new table or migration for a platform | §3 — escalate instead |
| a whole-module `vi.mock('…/collection-platform-registry', () => ({ … }))` factory | review — pass `async (importOriginal) => ({ ...(await importOriginal()), … })` and override the one export you are faking. A partial factory goes stale the moment the registry grows a field: docs/26 Step 2 added `palette`, the theme these tests render in reads it, and two suites died at import time with a stack in `theme/core/palette.ts` that never mentioned the mock. |

## 12. Verification order

Run these in order; each is cheaper than the next.

```bash
pnpm vitest run tests/platform-completeness-contract.test.ts tests/lib-import-smoke.test.ts
pnpm vitest run lib/<platform> entrypoints/app/sections/<platform>
pnpm compile
pnpm test
pnpm build
```

Then diff the manifest. Your platform legitimately adds `host_permissions`, so
this is not an equality check — it is a check that **nothing else moved**:

```bash
# baseline: on a clean tree, before you start (or from a fresh checkout of main)
pnpm build && cp .output/chrome-mv3/manifest.json /tmp/manifest-before.json
# at the end
pnpm build && diff /tmp/manifest-before.json .output/chrome-mv3/manifest.json
```

The only added lines may be your own `hostPermissions`, in
`COLLECTION_PLATFORMS` order. A reordered or reworded existing entry means every
installed extension asks its user to re-authorize.

Finally, walk §9 by hand — the one row no command above will tell you about —
and re-read the *unchecked* parts of §8: anchor 1's settings fields and zod
entries, and anchor 5's `probeReady`. The credentials-chain guard deliberately
covers neither.

## 13. Definition of done

- [ ] `pnpm compile`, `pnpm test`, `pnpm build` all green
- [ ] both Platform Descriptors (§6.1, §6.2) and the four heavy-value registries (§6.3) declare your platform
- [ ] the manifest diff adds only your own `host_permissions` (§12)
- [ ] `lib/<platform>/CLAUDE.md` and `entrypoints/app/sections/<platform>/CLAUDE.md` written
- [ ] root `CLAUDE.md` directory index gains both entries
- [ ] `entrypoints/app/CLAUDE.md` route list gains the new route
- [ ] zh-CN **and** en locale keys complete (`en.ts` is `Record<LocaleKeys, string>`, so a missing English key is a compile error — a key missing from *both* is not)
- [ ] every §9 row walked by hand and either done or consciously N/A
- [ ] `package.json` `version` bumped if this ships to the Chrome Web Store
