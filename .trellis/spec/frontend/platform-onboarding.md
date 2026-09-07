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
| `tests/platform-completeness-contract.test.ts` | What types cannot see: a lazy import resolving to nothing, a page that renders no `sections/` view, a view that skips `useCollectionBreadcrumbs`, `main.tsx` naming a platform, a hand-written `jobPlatform`, `hooks/` importing `sections/`, a host-permission list that is not an array literal, a platform literal leaking into `collection-processing-policy.ts`. Reports **all** failures as one aggregated list. | `pnpm vitest run tests/platform-completeness-contract.test.ts` |

Three more guards fire automatically for a new platform directory:

| Guard | Contract |
| --- | --- |
| `tests/lib-import-smoke.test.ts` | `lib/<platform>/` MUST contain **exactly one** non-test `*-sync-service.ts`, and it MUST `import()` cleanly with no `chrome` global and zero `vi.mock` — i.e. no `@/lib/storage` (or any module with a `chrome.*` load side effect) in its static graph. |
| `tests/http-fetch-deadline-guard.test.ts` | No bare `fetch(` anywhere in `lib/**`. Use `fetchWithDeadline` (`lib/http/`). |
| `tests/platform-env-constants-guard.test.ts` | No bare numeric `SCREAMING_CASE` module constant in `lib/<platform>/`. Every policy number goes through `envNumber('VITE_<PLATFORM>_<NAME>', default)` **and** is registered in that test's `EXPECTED_ENV_CONSTANTS` table with its exact fallback. |

## 3. Decide before you write code

These five answers determine every table you will fill in. Getting one wrong is
a rewrite, not an edit.

| Question | Where the answer lands | Reference answers |
| --- | --- | --- |
| **Auth shape** — what must exist before the first sync can run? | `WELCOME_READINESS_BY_PLATFORM` (`'credentials'` / `'login'` / `'local'`), and whether you owe a Connections card (§8) | `credentials`: github, youtube · `login`: bilibili, x, zhihu · `local`: bookmarks |
| **Source shape** — does the platform expose containers (folders / playlists / collections)? | `PLATFORM_DIMENSIONS`, `SOURCE_DIMENSION`, whether a Collection Item may hold N memberships | multi-Source: bilibili, bookmarks, zhihu, youtube · single: github, x |
| **Content shape** — what text feeds Embedding, and is it available at sync time? | the `content` block of `IngestInput`, the `contentState` you declare, whether the pipeline gains a content stage | inline at sync: github README, zhihu answer, youtube description, x tweet · deferred: bookmarks extraction, bilibili transcription |
| **Sort key** — what is the platform's native "recency"? | `PLATFORM_SORT_KEYS` | `publishedAt` column, or a `platform_meta` field with `unixSeconds` / `iso8601` format |
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

### 6.1 Checked by the completeness contract (13 entries, 11 files)

| File | Symbol | You declare |
| --- | --- | --- |
| `lib/collections/platform-eligibility.ts` | `PLATFORM_DOWNSTREAM_ELIGIBILITY` | `SQL` predicate, or `null`. The rule itself lives in `lib/<platform>/`; this table only registers it. |
| `lib/collections/collection-analytics.ts` | `PLATFORM_DIMENSIONS` | the ranked dimension kinds this platform contributes |
| `lib/collections/collection-analytics.ts` | `AUTHOR_DIMENSION` | which kind is the **Creator** axis |
| `entrypoints/app/collection-platform-registry.ts` | `PLATFORM_META` | `{ title: LocaleKeys, icon: IconifyName }` |
| `entrypoints/app/collection-platform-pages.ts` | `COLLECTION_PAGE_LOADERS` | `lazy(() => import('./pages/<platform>'))` |
| `entrypoints/app/collection-platform-pages.ts` | `COLLECTION_PAGE_CHILD_ROUTES` | explicit array literal; `[]` for a flat platform |
| `entrypoints/app/collection-platform-auto-sync.ts` | `AUTO_SYNC_PLATFORM_BY_COLLECTION` | `{ runSync, ...<p>AutoSyncPolicy }` — **`runSync` required, `jobPlatform` forbidden** (it is derived) |
| `entrypoints/app/hooks/collection-job-platform.ts` | `JOB_PLATFORM_BY_COLLECTION` | the background-job namespace string |
| `entrypoints/app/sections/collections/collection-item-card.tsx` | `CARD_ADAPTERS` | the `Tagged<P>Card` component |
| `entrypoints/app/theme/core/palette.ts` | `PLATFORM_PALETTE_LIGHT` | brand hue, or `text.light.primary` for a black-logo brand |
| `entrypoints/app/theme/core/palette.ts` | `PLATFORM_PALETTE_DARK` | same, dark scheme |
| `entrypoints/welcome/landing.ts` | `WELCOME_READINESS_BY_PLATFORM` | `'credentials'` / `'login'` / `'local'` |
| `wxt.config.ts` | `PLATFORM_HOST_PERMISSIONS` | explicit array literal of match patterns |

### 6.2 Checked by the type system only

The contract test does not enumerate these, but they are exhaustive `Record`s,
so `pnpm compile` names them anyway:

| File | Symbol | Note |
| --- | --- | --- |
| `lib/collections/platform-sort-keys.ts` | `PLATFORM_SORT_KEYS` | `{ source: 'publishedAt' }` or `{ source: 'meta', field, format }` |
| `entrypoints/welcome/sections/platform-picker.tsx` | `HINT_KEYS` | one-line onboarding hint key |
| `entrypoints/app/theme/theme-config.ts` | `platform.light` / `platform.dark` | **only if the brand has a hue.** A black-logo brand is added to `Exclude<CollectionPlatform, 'github' \| 'x'>` instead, and maps to ink in `palette.ts`. |

`PLATFORM_META.icon` is typed `IconifyName = keyof typeof allIcons`, so a glyph
you have not added to `entrypoints/app/components/iconify/icon-sets.ts` is a
**compile error in `collection-platform-registry.ts`** — a different file from
the one you forgot to edit. Add the offline SVG body first; there is no CDN.

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

`WELCOME_READINESS_BY_PLATFORM` is contract-checked, but **nothing verifies that
a platform declaring `'credentials'` has anywhere to enter them.** Five
hand-written edits, zero cross-checks:

1. `lib/storage/settings-schema.ts` — the `UserSettings` fields, the zod
   entries, and the `configSavedAt` key union.
2. `lib/hooks/useSettings.ts` — `derive<P>Draft` + `save<P>`.
3. `entrypoints/app/sections/settings/settings-view.tsx` — extend the
   `ConnSection` union **and** add the `connNavItems` rail entry.
4. `entrypoints/app/sections/settings/<platform>-connection-card.tsx` — the card
   itself, using `useConfigDraft` + `SaveActions` + `SettingsPanel`, with a live
   probe that reuses a real API call.
5. `<platform>-sync-adapter.ts` — read the same settings keys in `probeReady`.

## 9. Phase 6 — The unguarded checklist

Everything above is caught by a compiler or a test. **The following is not.**
Each item is silent when missed: no error, no red test, just a subtly wrong
product. Verified against the code on 2026-09-06.

> **2026-09-07 — items 3 and 6 are now guarded** (docs/26 Step 1). They are
> struck through below rather than deleted; the whole section is rewritten in
> docs/26 Step 3, and until then a reader must not be told "nothing catches
> this" about a rule that now has a test. A seventh item — the welcome
> capability marquee — was found during that review and is guarded too, so it
> never joins this list.

| # | Location | Why nothing catches it | Symptom if missed |
| --- | --- | --- | --- |
| 1 | `entrypoints/app/layouts/dashboard/background-jobs-indicator.tsx` — `PLATFORM_LABEL` | typed `Record<string, LocaleKeys>`, not `Record<CollectionJobPlatform, …>`; the lookup falls back with `key ? t(key) : platform` | the global do-not-close reminder shows the raw job namespace (`reddit-saved · syncing`) instead of the platform's name |
| 2 | `lib/collections/collection-analytics.ts` — `SOURCE_DIMENSION` | `Partial<Record<…>>`, and it is intentionally partial (github and x have no Source). Nothing cross-checks it against the contract-checked `PLATFORM_DIMENSIONS`. | you declare a Source dimension in `PLATFORM_DIMENSIONS`, and the Dashboard breakdown card silently never populates it |
| ~~3~~ | ~~`lib/chat/tools.ts` — three prompt literals~~ **GUARDED**: all three, plus a fourth in `lib/chat/prompts.ts` (`CHAT_SYSTEM_PROMPT`) that this table missed, now derive the list from `COLLECTION_PLATFORMS` | `lib/chat/tools.test.ts` › `model-facing platform list` checks all four model-facing surfaces: naming any platform obliges naming every platform | — |
| ~~3b~~ | ~~`skills/favbase/SKILL.md` — the same list, hand-written for the **external** agent~~ **GUARDED**. Shipped markdown cannot derive it, so it is reconciled instead | `tests/agent-bridge-cli-aliases.test.ts` › `favbase SKILL.md matches the live platform list` — set equality, both directions | — |
| 4 | the whole credentials chain (§8) | `'credentials'` in the readiness table implies a Connections card; no test asserts one exists | onboarding tells the user to add a key, and Settings offers nowhere to add it |
| 5 | user-facing English copy in the new view | `tests/i18n-no-hardcoded.test.ts` bans **CJK only**; an English string literal passes every gate | untranslatable copy ships, and the zh locale silently degrades |
| ~~6~~ | ~~`.env.local` platform block~~ **GUARDED**: `.env.example` is now tracked and secret-free, so document your platform's block there | `platform-env-constants-guard` requires `.env.example` to exist and to carry a line per `EXPECTED_ENV_CONSTANTS` key, both ways. (`.env.local` stays gitignored and is still only checked where present.) | — |

## 10. Shape variance — what you may skip

Not every abstraction is mandatory. The distinction matters, because forcing a
platform into the wrong one produces worse code than opting out.

**Mandatory for every platform**, no exceptions: `ingestCollection`, the shared
read helpers, `CollectionPageScaffold`, `useCollectionPipeline`,
`useCollectionBreadcrumbs`, the shared `*-sync-adapter.ts` seam, and all 13+3
registries.

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
| a bare `fetch(` in `lib/**` | `http-fetch-deadline-guard` |
| a bare numeric module constant in `lib/<platform>/` | `platform-env-constants-guard` |
| `@/lib/storage` (or any `chrome.*`-touching barrel) in the sync-service static graph | `lib-import-smoke` |
| a `t()` call inside `components/collection/**` | design contract (`components/collection/CLAUDE.md`) |
| duplicating credential resolution or post-sync dispatch across the manual and daily triggers | review — the shared `*-sync-adapter.ts` exists precisely to make this unnecessary |
| a new table or migration for a platform | §3 — escalate instead |

## 12. Verification order

Run these in order; each is cheaper than the next.

```bash
pnpm vitest run tests/platform-completeness-contract.test.ts tests/lib-import-smoke.test.ts
pnpm vitest run lib/<platform> entrypoints/app/sections/<platform>
pnpm compile
pnpm test
pnpm build
```

Then, by hand, walk §9 — the six items no command above will tell you about.

## 13. Definition of done

- [ ] `pnpm compile`, `pnpm test`, `pnpm build` all green
- [ ] `lib/<platform>/CLAUDE.md` and `entrypoints/app/sections/<platform>/CLAUDE.md` written
- [ ] root `CLAUDE.md` directory index gains both entries
- [ ] `entrypoints/app/CLAUDE.md` route list gains the new route
- [ ] zh-CN **and** en locale keys complete (`en.ts` is `Record<LocaleKeys, string>`, so a missing English key is a compile error — a key missing from *both* is not)
- [ ] every §9 row walked by hand and either done or consciously N/A
- [ ] `package.json` `version` bumped if this ships to the Chrome Web Store
