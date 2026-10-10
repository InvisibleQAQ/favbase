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

Already onboarded: `bilibili`, `github`, `bookmarks`, `x`, `zhihu`, `youtube`,
`douyin`. **`youtube` is the reference implementation** — thinnest complete
platform (no content stage, no child route, credential-gated, multi-Source).
`bilibili` is the outlier; read §10 before copying anything from it. `douyin`
(docs/33) is the reference for two shapes nobody else has: a request that must
leave from the site's own page (injected transport, §4.1) and per-page
persistence with a resumable backfill (§4.6).

## 2. The two machine-checked halves

Adding a platform is not a checklist you carry in your head. Two mechanisms
already carry most of it, and the single most important technique in this file
is **making them generate your TODO list instead of writing one yourself**.

| Mechanism | What it catches | How you invoke it |
| --- | --- | --- |
| TypeScript exhaustive `Record<CollectionPlatform, T>` | Every registry that must gain a key. The error lands on the object literal, naming the missing property. | `pnpm compile` |
| `tests/platform-completeness-contract.test.ts` | What types cannot see: a lazy import resolving to nothing, a page that renders no `sections/` view, a view that skips `useCollectionBreadcrumbs`, `main.tsx` naming a platform, a hand-written `jobPlatform` in the auto-sync registry, `hooks/` importing `sections/`, a `childRoutes` or `hostPermissions` value that is computed instead of written out, an analytics axis absent from its own ranked list, platform knowledge leaking into a shared module (a separate case listing `file:line`: a quoted platform id, a literal-key read of `meta` / `platformMeta`, or a literal JSON-path key such as `->>'language'` in SQL text — anywhere in `lib/tagging/**`, `lib/embedding/**`, `lib/chat/**`, `lib/export/**`, `collection-analytics.ts`, `collection-processing-policy.ts` or `collections-query.ts`), a `startCollectionProcessingJobs` call anywhere in `entrypoints/app/**` but its definition and the Platform Sync funnel (a separate case in the same file, listing `file:line`), a `*AuthError` / `*RateLimitError` class under `lib/<platform>/` — declared, or a class expression bound to such a name — that does not extend `PlatformAuthError` / `PlatformRateLimitError` by that exact identifier (a separate case listing `file:line`, with a self-check that the detector bites; an alias or a wrapped base is flagged too), a hand-written job namespace anywhere in `entrypoints/app/**` — a string literal, or a same-module constant bound to one, as the first argument of `startJob` / `useJob` / `getJob` / `pauseJob` / `resumeJob` or as a `jobPlatform` property (a separate case listing `file:line`, with a self-check that the detector bites; a constant imported from another module is not followed), a missing `lib/<platform>/` directory, and — for a platform whose `readiness` is `'credentials'` — a missing link in the credentials chain (§8): the Connections card file, the `SETTINGS_NAV` connections section, `derive<Pascal>Draft` / `save<Pascal>` in `useSettings`, the `configSavedAt` key. Reports **all** failures as one aggregated list. | `pnpm vitest run tests/platform-completeness-contract.test.ts` |

Six more guards fire with no wiring on your part. Three of them reconcile an
artefact you still write by hand: the guard turns "silently absent" into a red
test, it does not do the work for you.

| Guard | Contract | You still hand-write |
| --- | --- | --- |
| `tests/lib-import-smoke.test.ts` | `lib/<platform>/` MUST contain **exactly one** non-test `*-sync-service.ts`, and it MUST `import()` cleanly with no `chrome` global and zero `vi.mock` — i.e. no `@/lib/storage` (or any module with a `chrome.*` load side effect) in its static graph. | — |
| `tests/http-fetch-deadline-guard.test.ts` | No bare `fetch(` anywhere in `lib/**`. Use `fetchWithDeadline` (`lib/http/`). Exceptions are a file-level allowlist with a stated reason; the one platform exception is the Douyin injected transport (§4.1). | — |
| `tests/platform-sleep-guard.test.ts` | No hand-rolled wait in `lib/<platform>/`: a `setTimeout(...)` inside the arguments of `new Promise(...)` fails, listed as `file:line` (read by AST; both names match bare or off `globalThis` / `window` / `self`, through `as` / `!` wrappers; a `setTimeout` outside any `new Promise` is a timer callback and passes; an alias such as `const st = setTimeout` is not followed). Wait with `sleep` from `lib/http/backoff.ts`; retry transient errors with `withRetries` from `lib/http/retry.ts`. | — |
| `tests/platform-env-constants-guard.test.ts` | No bare numeric `SCREAMING_CASE` module constant in `lib/<platform>/`. Every policy number goes through `envNumber('VITE_<PLATFORM>_<NAME>', default)` **and** is registered in that test's `EXPECTED_ENV_CONSTANTS` table with its exact fallback. | your platform's block in `.env.example` — tracked and secret-free, one documented line per key, checked both ways |
| `tests/platform-completeness-contract.test.ts` — marquee coverage | Every platform's `PLATFORM_META.title` appears as a pill in `entrypoints/welcome/sections/capability-marquee.tsx`, and every pill's `platform` is the platform whose title it shows. | the pill: `labelKey`, a literal `icon` and `platform` (the `Pill` type makes the last two come together; `platform` only picks the glyph's identity color). Those rows are hand-authored on purpose (docs/26 D5) — the interleaving of platform and capability pills is a design decision, so coverage is checked, never generated |
| `tests/agent-bridge-cli-aliases.test.ts` | `skills/favbase/SKILL.md` carries **two** platform lists and both are reconciled: the `` `<platform>` is one of … `` sentence against the ids, and the frontmatter `description` against the in-app names (`PLATFORM_META.title` through the en locale). | both lists. Shipped markdown derives nothing, and the frontmatter one is what an external agent *selects the skill by* — miss it and the agent never reaches for favbase when the user asks about your platform |

## 3. Decide before you write code

These five answers determine every table you will fill in. Getting one wrong is
a rewrite, not an edit.

| Question | Where the answer lands | Reference answers |
| --- | --- | --- |
| **Auth shape** — what must exist before the first sync can run? | the descriptor's `readiness` (`'credentials'` / `'login'` / `'local'`; `WELCOME_READINESS_BY_PLATFORM` derives from it), and whether you owe a Connections card (§8) | `credentials`: github, youtube · `login`: bilibili, x, zhihu, douyin (a usable logged-in site tab, checked before the funnel) · `local`: bookmarks |
| **Source shape** — does the platform expose containers (folders / playlists / collections)? | the descriptor's `dimensions` (`ranked` / `author` / `source`, `null` when the platform has no Source), whether a Collection Item may hold N memberships | multi-Source: bilibili, bookmarks, zhihu, youtube, douyin (public folders; an item may belong to no Source at all) · single: github, x |
| **Content shape** — what text feeds Embedding, and is it available at sync time? | the `content` block of `IngestInput`, the `contentState` you declare, the descriptor's `contentKind` (§6.1), whether the pipeline gains a content stage | inline at sync: github README, zhihu answer, youtube description, x tweet · deferred: bookmarks extraction, bilibili transcription · **mixed, decided per item**: douyin — a transcribable video (`isTranscribableAweme`: `mediaKind === 'video' && durationMs > 0`) is deferred (`'pending'`, transcript), everything else is inline post text (docs/37 D1 / D-f; the mixed-model rules are in §4.4) |
| **Sort key** — what is the platform's native "recency"? | the descriptor's `sortKey` (`PLATFORM_SORT_KEYS` derives from it) | `publishedAt` column, or a `platform_meta` field with `unixSeconds` / `iso8601` format |
| **Downstream eligibility** — are some persisted items ineligible for Content → Embedding → Tags? | `PLATFORM_DOWNSTREAM_ELIGIBILITY` (`null` when none) | only bilibili has one (taken-down videos) |

**No database migration is ever required.** `items.platform` is a plain `text`
column; its only constraint is `unique(platform, platform_item_id)`. The
`CHECK` on `items` covers `content_state`, not `platform`. A platform that
needs a new table is not a platform — escalate it.

## 4. Phase 1 — Domain layer first, discriminator second

`IngestInput.platform` and the shared query builders in
`lib/database/collection-queries.ts` (§4.2) take a plain `string` platform.
That is deliberate: **you can build and green-test the entire
`lib/<platform>/` layer before adding the id to `COLLECTION_PLATFORMS`**, with
`tsc` staying green the whole time. (`getPlatformLastSyncedAt` takes a
`CollectionPlatform`, and that is why the lib layer never calls it: "last
synced" is read app-side by `useCollectionLibrary` from its `platform`, §7.2 —
docs/32 Step 9.) Do it in that order — flipping the
discriminator first means working for a day against a red compiler and learning
nothing from it.

### 4.1 `lib/<platform>/<platform>-api.ts` — the remote layer

- No DB imports. No UI copy. No `t()`.
- Every request through `fetchWithDeadline` — with one sanctioned exception,
  the **injected transport** (docs/33 D4, `lib/douyin/`). When the site only
  accepts a request its own page signed (Douyin's page SDK wraps `window.fetch`
  and adds `a_bogus` / `x-secsdk-web-signature`), `<p>-api.ts` defines a
  transport type that never throws (`DouyinTransport`: every failure is a
  `kind`) and classifies everything itself, so its tests use a fake transport.
  The implementation is a **separate chrome leaf in `lib/<p>/`** that neither
  `<p>-api.ts` nor the sync service imports (user decision 2026-10-03: a
  platform's request and timing code stays inside the `lib/<p>/` guards;
  import-smoke cannot see that edge, so a layering test does —
  `lib/douyin/douyin-tab.test.ts`). It stays under the sleep and env guards;
  the injected function's bare `fetch(` is one file-level row in
  `ALLOWED_BARE_FETCH`, and the deadline is still enforced — inside the page
  (`AbortSignal.timeout`) and outside it, with the same `timeoutMs` the lib
  hands the transport. The injected function must survive `toString()`: no
  closure, import, module constant or build helper; test the free identifiers
  and rebuild it from source, then check the production bundle once.
- **Never trust HTTP 200.** A 200 carrying non-JSON, or missing the array you
  expected, MUST throw with a body snippet. Swallowing it into an empty array
  is how a sync silently reports success and persists nothing. An `items: []`
  that the API genuinely returns is a legal zero result — let that through.
- **A cookie-session login rides the cookie jar, not a hand-built header.**
  Write `{ credentials: 'include' }` on every request that needs the user's
  site login; never copy a cookie value into `headers.Cookie`. The extension's
  host permission already makes the Background SW and app.html attach the
  site's jar — docs/29 E2 measured a SW `fetch(url)` with *no init at all*
  coming back logged in (F26), so the header only makes the login look like it
  depends on a Chromium forbidden-header exception. The only anonymous mode is
  `credentials: 'omit'`, and it also drops a hand-built `Cookie` header
  (`lib/x/x-api.ts:495`). Read cookies with `chrome.cookies` only for a
  no-network logged-in check or an id the URL needs (Bilibili's `mid`). Test the
  `init` each request function passes; pattern: `lib/bilibili/bilibili-api.test.ts`
  「Bilibili request credentials」. Existing exception, not re-litigated: X
  replays a captured web-client header set verbatim (`lib/x/x-api.ts:211`).
- Export structured error classes (`<P>AuthError`, `<P>RateLimitError`) that
  **extend `PlatformAuthError` / `PlatformRateLimitError`** from
  `lib/collections/sync-errors.ts` (import the file by path, never the
  `lib/collections` barrel), each with its own explicit `this.name`. They are
  the lib half of the i18n seam: the app classifies a failure by base class
  alone (`classifyCollectionSyncError`), so an error that extends `Error`
  directly shows up as raw English debug text. `<P>AuthError` takes
  `(message, reason)` with no default: `'rejected'` only when favbase had
  already confirmed it holds a credential before the request (PAT, API key,
  captured session, a local cookie that exists and has not expired) and the
  platform refused it; otherwise `'missing'` — the full rule is the doc comment
  on `AuthFailReason`. `<P>RateLimitError` carries `resetAt: Date | null`; a
  platform whose limit reports a reset must also lock the Fetch button in its
  view (§7.2). Which response counts as auth or rate limit stays the
  platform's call. Enforced by the completeness contract (§2).
- Pagination: serial, with a politeness delay. Numeric constants via
  `envNumber` (§2). The mechanism is shared in `lib/http/` — wait with
  `sleep`, compute delays with `jitteredDelayMs` / `backoffDelayMs`, retry
  transient errors with `withRetries` (`retry.ts`), quote bodies and parse
  non-JSON with `response-body.ts` (`bodySnippet` / `textSnippet` /
  `parseJsonBody`). The platform injects only which response retries, how
  long to wait, what to throw once retries are spent — and every number.
  Pattern: `fetchPageWithBackoff` in `lib/x/x-api.ts`. Adding a retry a
  platform does not have today is a rate-limit decision, not a refactor.
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
import {
  pagedItemsQuery,
  searchCondition,
  sourceMembership,
  sourceItemCounts,
  platformItemIds,
  type PagedItemRow,
} from '@/lib/database/collection-queries';
```

Your file contributes only the WHERE conditions, the ORDER BY, `mapRow`, and
which fields are searchable. The fragments every platform used to copy are
builders (docs/32 Step 9):

- `searchCondition(search, targets)` — trims, escapes the LIKE metacharacters
  (`escapeLike`), wraps in `%…%` and ORs an `ilike` over each target: a column,
  or a `platform_meta` field as `` sql`${items.platformMeta}->>'key'` ``. Blank
  search → no condition.
- `sourceMembership(platform, platformSourceId)` — the `item_sources` EXISTS
  filter of a multi-Source platform (every Source filter goes through the link
  table, §4.3). Empty id → no condition.
- `sourceItemCounts(db, platform)` — the Source chips' counts as
  `{ platformSourceId, title, count }`; map `platformSourceId` onto your facet
  key.
- `platformItemIds(db, platform)` — the platform's stored `platformItemId`
  set, for an incremental stop-on-known cutoff or a details-fill skip set.

The two optional filters return `undefined` when inactive, so push them
unconditionally — and keep your push order fixed: it decides the bind-param
numbering. There is no `getLastSyncedAt` to write; the page hook passes
`platform` and `useCollectionLibrary` reads the Platform Sync Record (§7.2).

Chunking: `paragraphSplit` from `@/lib/embedding/char-split` for text with
paragraph structure (Markdown, READMEs, descriptions, extracted pages — pass it
as `chunk: paragraphSplit`), or `charSplit` with `preferParagraph: false` for
sentence-only text like tweets. Either way a **leaf import**, not the
`@/lib/embedding` barrel (the barrel has a `chrome.storage` load side effect
and will break import-smoke).

Also export `narrow<P>Meta(meta: unknown, fallbacks)` from this file. It is the
single owner of the defensive `platform_meta` narrowing. Export the whole
`mapRow` too — `export function to<P>Item(row: PagedItemRow): <P>Item`, the
envelope fields plus a spread of `narrow<P>Meta` — because the tagged-card
adapter in `sections/` reuses that exact function (§7.2, `taggedCard`). Two
copies of the narrowing, or of the envelope mapping around it, is a defect, not
a convenience: the two read paths have drifted before (docs/32 Step 2's
`dateAdded` fallback), and until docs/32 Step 8 five tagged cards each carried a
line-for-line copy of their platform's `mapRow`.

### 4.3 Invariants you inherit and must not break

- **Insert-only** (recorded in `lib/ingest/CLAUDE.md`, enforced by
  `ingestCollection`; the ADR file that older headers used to cite was never
  in git — docs/32 appendix B): `items` / `authors` / `item_sources`
  use `onConflictDoNothing`, first-write-wins. The single exception among the
  ingest tables is `sources`, which upserts to refresh `title` /
  `lastFetchedAt` (this is how a renamed folder flows in). `lastFetchedAt` is
  each Source's freshness only — "when did this platform last sync" is the
  **Platform Sync Record** (`platform_sync_records`, docs/32 §5.1), a
  per-platform state row that insert-only does not apply to. You never write
  it: the Platform Sync funnel (§7.2) does.
- **`contentState`**: declare `'chunked'` only when you actually hand over text;
  declare `'no_content'` when the text is genuinely empty. **Never `'pending'`**
  unless the platform has a real deferred-content pipeline (§4.4) — `'pending'`
  is what feeds auto-transcribe.
- **Multi-Source membership**: one Collection Item + N links. `platform_meta`
  may carry a first-seen Source for display and sorting, but every *filter* goes
  through `item_sources`. **Item Count** and **Membership Count** are different
  numbers (`CONTEXT.md`); do not blur them.
- The sync-service takes a `CooperativeCheckpoint` and calls it only at
  *claim-the-next-page / claim-the-next-item* boundaries. The in-flight request
  and the final DB write always finish. Pause is not cancel.

### 4.4 Deferred content

Only when the platform's Content is **not in hand at sync time** — a web page
still has to be fetched, a video still has to be transcribed. Declare
`contentState: 'pending'` and pass no `content` block; the item's text arrives
later through a worker. If the text is in the sync response, this section does
not apply (§4.3).

**Template — bookmarks (chained after the sync).**

- The Sync Adapter starts the worker **after** `runPlatformSync` returns —
  outside the funnel, because fetching a bookmarked page is not contacting the
  platform: `startJob(jobPlatformForCollection(p), 'extract', runner)` with the
  default `'drop'` collision (a second chain while one runs is a no-op). The
  funnel closure returns `newItemIds: []`: the pending items have no text
  yet, and the worker dispatches each one itself (below); the funnel's
  backlog-only embed lane still picks up items an interrupted run left
  `'chunked'`.
- The worker `await control.checkpoint()`s before claiming each item, so the
  library gate can pause it between items.
- Each item settles through `settleItemContent(db, itemId, text, chunker)`
  (`lib/ingest/ingest.ts`; `paragraphSplit` for opaque text). It writes the
  content and chunk rows, then `'chunked'` — or `'no_content'` when nothing
  chunked — and returns whether chunk rows landed. It emits no domain event:
  the worker emits `item-content-updated` for every item it settles, so
  coverage and the cards refresh.
- Only on `true`: `enqueueCollectionProcessingItem({ jobPlatform:
  jobPlatformForCollection(p), itemPlatform: p, itemId })`, **per item**, not
  in one batch at the end. A page closed mid-run must not leave items that are
  chunked but never embedded.
- A permanent failure (dead link, non-HTML, empty shell) settles
  `'no_content'`; a transient one (5xx, 429, timeout) stays `'pending'` and
  heals on the next run. One item's failure never aborts the run.
- Code: `lib/bookmarks/bookmark-content-service.ts`,
  `sections/bookmarks/use-bookmark-extraction.ts`, the chained start in
  `sections/bookmarks/bookmarks-sync-adapter.ts`.

**Streaming variant — bilibili, douyin (during the sync, timestamped).**

- The Fetch producer feeds new items to a transcription pipeline while the
  sync is still paging. The pipeline is a module singleton holding its own
  state; the producer / dispatch mechanics are the shared
  `entrypoints/app/hooks/transcript-lane.ts` (one lane per pipeline, never
  serialized across platforms), whose `'transcribe'` job uses the `'queue'`
  collision so an automatic session waits behind a manual single-video
  transcription. The platform runtime keeps only eligibility and the mapping
  to `AutoTranscribeVideo`.
- The platform's `AutoTranscribeAdapter` answers `missingPrerequisite(error)`
  judged NOW (`'asr'` / `'platform-tab'` / `null`) and
  `waitForPrerequisite(error)`; the parked state reaches the Collection
  banner as `prerequisiteBlocked`. The ASR half is shared
  (`lib/storage/asr-prerequisite.ts`); rules in `lib/auto-transcribe/CLAUDE.md`.
- The text is timestamped subtitle rows, so the write is
  `persistExistingItemContent(db, platform, platformItemId, text,
  chunkSubtitleRows(rows), subtitleSource)`. It addresses the item by
  platform identity, records the subtitle source, and commits `has_content`
  before `chunked`. A successful write is followed by the same
  `item-content-updated` event and per-item `enqueueCollectionProcessingItem`.
- The persist → event → enqueue sequence is shared (docs/37 D-c):
  `transcribeAndPersist({ platform, videoId, title, persist, hooks })` in
  `lib/transcription/transcribe-and-persist.ts` sends `TRANSCRIBE_AUDIO`,
  refuses a response whose `data.videoId` is not byte-equal to the request
  (no write, no event, no lanes), calls the platform's `persist(videoId,
  rows, source): Promise<'chunked' | null>`, emits `item-content-updated`
  only on `'chunked'`, then hands the item to `startProcessing` and returns
  before Embed / Tag settle. A platform supplies the three bindings and
  nothing else; `lib/transcription/` never imports `lib/<platform>/`.
- Code: bilibili — `persistContentChunks` in `lib/bilibili/bili-sync-service.ts`,
  the thin binding `lib/bilibili/transcribe-utils.ts`,
  `sections/bilibili/auto-transcribe-runtime.ts`,
  `sections/bilibili/bilibili-processing-adapter.ts`; douyin —
  `persistDouyinTranscript` / `markDouyinError` / `getDouyinPendingVideos` in
  `lib/douyin/douyin-sync-service.ts`, `lib/douyin/auto-transcribe-adapter.ts`,
  `sections/douyin/auto-transcribe-runtime.ts` (also appends the stored
  `'pending'` backlog after a successful sync that started with no session
  running, docs/37 D7),
  `sections/douyin/douyin-processing-adapter.ts`.
- The Service Worker side is one handler per platform,
  `lib/<platform>/<platform>-transcription-handler.ts`, registered in
  `lib/background/transcription-handlers.ts` (docs/37 Step 2). It assembles
  `PipelineDeps` and calls the shared pipeline; it never imports the
  platform's sync service, `@/lib/database` or `@/lib/ingest` (the Service
  Worker graph has no PGlite — `tests/agent-bridge-background-bundle-contract.test.ts`
  plus the `pnpm build` bundle check). Media resolution may be lazy, inside
  the `extractAudioUrls` dep rather than ahead of the pipeline, so a cache
  hit or a missing ASR key costs the platform no request (douyin). The
  extractor returns a candidate URL list the shared downloader walks in
  order, and any `TranscribeErrorInfo` it throws passes through unchanged —
  platform-prerequisite codes (`DOUYIN_TAB_MISSING` …) are added to
  `TranscribeErrorCode`, the wire enum and both locales together
  (`lib/transcription/CLAUDE.md`).

**Mixed content model — one platform, inline and deferred items (douyin,
docs/37 Step 1).** When only some items are deferred, three rules keep the
two halves from corrupting each other:

- The gate is one in-memory predicate, applied where `contentState` is
  declared (`isTranscribableAweme` in `lib/douyin/douyin-media.ts`): true →
  `'pending'`, no text; false → the inline rule of §4.3. Gate with the
  predicate the worker actually uses, not with the media kind alone — an item
  that is `'pending'` but can never be transcribed (a video with no duration)
  stays `'pending'` forever and keeps re-entering the backlog.
- `content.textOf` returns `''` for every deferred item, even when the sync
  has a description in hand. The ghost sweep (§4.6) calls `textOf` for an
  item at `'has_content'` with no chunks, and a transcription interrupted
  between its content write and its chunk write is exactly that item:
  answering with the description overwrites the stored transcript with the
  post text and drops its `subtitle_source`. `''` makes the sweep re-chunk the
  stored transcript as is (timestamps lost, text kept). Guard:
  `lib/douyin/douyin-sync-service.test.ts` "a transcription cut short …".
- An empty transcript (no speech) must settle, not stay `'pending'`:
  `persistExistingItemContent` returns `null` for blank text and leaves the
  state alone, so the platform's `persist` falls back — douyin writes the post
  text through `persistExistingItemContent(…, charSplit(desc), null)`
  (`subtitle_source` null), and with no post text either settles
  `'no_content'` through `settleItemContent(db, itemId, '', chunker)`, which
  writes no text. Bilibili still leaves such a video `'pending'` (known gap,
  docs/37 D6). Two ingest entry points in one `persist` is deliberate; do not
  "unify" them — `persistExistingItemContent` stays the only writer of a
  transcript's text.
- The backlog query (`getDouyinPendingVideos`) reads `content_state =
  'pending'` and nothing else: the gate already guarantees what is in there.

**Which writer.** Opaque text → `settleItemContent`. A transcript (timestamped
chunks, a subtitle source to record) → `persistExistingItemContent`. Never pair
a content write with a hand-written `content_state` update; the content writer
under `settleItemContent` is module-private, so outside `lib/ingest` there is
no exported piece to build that pairing from.

**Job namespace.** Always `jobPlatformForCollection(platform)` (§11). The kinds
`'extract'` and `'transcribe'` already exist — use one of them, do not add a
kind.

**Not unified, on purpose** (docs/32 D5): each variant keeps its own progress
panel. Trigger timing (chained after the sync vs streamed during it), where the
state lives (a job plus DB counts vs a pipeline singleton) and the collision
policy (`'drop'` vs `'queue'`) genuinely differ, and one shared panel would
need a mode switch for each.

### 4.5 Tests

An in-memory PGlite guard test for the sync-service (equivalence of the ingest
result, dedup, membership) and a pure-function test for the API parsers. Both
run before the platform exists anywhere else.

### 4.6 Per-page persistence with a resumable backfill (douyin)

Only when one full sync is long enough that losing it to a failure is not
acceptable (Douyin: a paced walk of the whole favorites list, roughly
2 minutes per 100 favorites — docs/33 Step 3). Every other platform fetches
everything and calls `ingestCollection` once at the end.

- **Persist each page as it arrives** — one `ingestCollection` call per page.
- **Dispatch per page, not through the funnel.** The funnel only dispatches
  on success, so a run that fails at page 80 would leave 79 pages chunked and
  never embedded. The sync service reports each page's `contentPersisted`
  (`onPagePersisted`); the Sync Adapter calls `enqueueCollectionProcessingItem`
  per id — the **platformItemId**, not `items.id` — and returns
  `newItemIds: []` to the funnel. Same mechanics as §4.4's per-item dispatch.
- **Keep a breakpoint in app storage**, passed into the sync service and
  written back on every change (the lib stays storage-free): where the first
  full walk stopped, so the next run tops up the head and then resumes. Douyin
  keeps `{ resumeCursor, backfillDone }` under `local:douyin-backfill`; it has
  no reader outside its adapter, so it is a `local:` item, not a Platform Sync
  Record column. Validate the stored value at the lib boundary.
- **Sweep at least once per run.** A page cut short while its chunks are being
  written leaves the items it did not reach at `'has_content'`. Their text is
  not lost: `ingestCollection` stores a new item's text in the same
  transaction as its row (docs/33 D6, `lib/ingest/CLAUDE.md`), so any later
  call that carries `content` re-chunks them from `item_contents`, whatever
  its own `textOf` covers — a page-sized `textOf` never knows an earlier
  page's items. But the sweep only runs inside such a call, and an incremental
  run whose first page is wholly known makes none. Give every run one
  unconditional `ingestCollection` call with `content` (Douyin's is the Source
  upsert that opens the run, `textOf: () => ''`) and send what it heals through
  the same per-page dispatch (docs/33 D-g). Test both: a later run that ingests
  a different page, and a later run that ingests no page at all.

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

The facts a platform used to declare one file at a time are now twelve fields
across two **Platform Descriptors** (ADR 0004) — seven domain, five app. Both are exhaustive
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
| `descriptionField` | the `platform_meta` key holding an item description that your Content does **not** already carry — bilibili `'intro'` (the Content is the transcript), github `'description'` (the Content is the README) — or `null`. `null` is also right when the meta has a description key whose text the Content already holds: youtube's meta `description` is a truncated slice of its Content, so youtube is `null` | the "description" line of the tagging prompt (`tagPlatformItem`) |
| `dimensions` | `{ ranked, author, source, meta }` — the ordered Collection Analytics facets, which one carries the **Creator** axis, which one carries the **Source** membership (`source: null` when the platform has no Source), and which one is read straight out of `platform_meta` (`meta: { kind, field }`, e.g. github `{ kind: 'language', field: 'language' }`; `null` when none) | the Dashboard composition and breakdown cards, read inline; `meta` drives Collection Analytics' generic meta-dimension query |

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
| `palette` | `{ light, dark }` brand hues, or `'ink'` for a black-logo brand, which resolves to the scheme's own text ink | `platform` in `theme/core/palette.ts`, exposed as `theme.vars.palette.platform[id]` (platform glyphs in app.html and welcome.html, the analytics graphics) |
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
| `<platform>-sync-adapter.ts` | **The Platform Sync.** `run<P>Sync(onProgress, control)` is the single definition of what a sync means: credential resolution, then `await runPlatformSync(platform, control, async () => { …domain call…; return { fetched, inserted, newItemIds }; })` (`entrypoints/app/hooks/platform-sync.ts`). The funnel records the attempt in the Platform Sync Record, runs your closure, and on success dispatches the embed/tag lanes (`jobPlatform` derived) and records the success; on failure it records that and rethrows your error unchanged. **Anything you can check without the network goes BEFORE the funnel**: missing config is a silent `return`, a known-absent login throws the platform's own auth error class (the page's logged-out state keys off it) — neither is an attempt, so neither may leave a record (docs/32 §5.2). Put everything that contacts the platform inside the closure; work that follows a successful sync but is not the platform (bookmarks' page extraction) goes after it. Also exports `<p>AutoSyncPolicy` (`probeReady`, optional `isSilentError`). A `'credentials'` platform also exports `<p>Credentials(settings)` — the stored credential, or `null` (github `githubCredentials` → the token, youtube `youtubeCredentials` → `{ apiKey, channel }`); an empty string must come back as `null` too, because the wrapper tests `!== null` and `settings.githubToken ?? null` would hand it `''`, which type-checks and reads as configured — the single "is it configured" check: the run gate uses its value, `probeReady` compares it with `null`, and the page hook passes it to `useCredentialGatedLibrary` (§8 anchor 5). The manual page and the daily coordinator call **this same function** — copying credential resolution or post-sync dispatch into either trigger is the defect this file exists to prevent. |
| `use-<platform>.ts` | Thin adapter over `useCollectionLibrary`. Inject `queryFn` / `facetsFn` / `platform` / `syncFn = run<P>Sync` / `jobPlatform = jobPlatformForCollection(<platform>)`. `platform` is the Collection Platform whose "last synced" the hook reads from the Platform Sync Record (`getPlatformLastSyncedAt`; there is no lib `getLastSyncedAt` wrapper, docs/32 Step 9); `jobPlatform` is the background-job namespace, not a free-form log label. Write the id once — `const PLATFORM = '<id>'` — and derive both from it. A single-facet query is one module-level line, `const queryFn = facetQuery(get<P>Items, '<facetKey>')` (`entrypoints/app/hooks/facet-query.ts`): it maps the hook's `filter` to your query's facet key and drops a `null` filter / `''` search, and a misspelled key is a `tsc` error. Return the generic fields as they are — the view reads `items` / `filter` / `setFilter` / `facets` directly; there is no rename layer and no hand-written return interface (docs/32 Step 7). Add only what is genuinely the platform's own (X's cooldown and "N new this run"; bookmarks' route-controlled filter and mount sync). There is no error classifier to inject: `syncError` is already a `CollectionSyncError`, classified by base class (§4.1). **A `'credentials'` platform** returns `useCredentialGatedLibrary(<p>Credentials, config)` (`entrypoints/app/hooks/use-credential-gated-library.ts`) instead: it adds `configured` / `settingsLoading` and makes `sync` a silent no-op until configured. That gate is its own hook, never inside `useCollectionLibrary` (the generic tier reads no storage), and the resolver it takes is the adapter's — so the page gate, the run gate and `probeReady` cannot drift apart. Every injected function must be a stable reference (module-level or `useCallback`); they sit in effect dependency arrays. |
| `<platform>-view.tsx` | Assembles `CollectionPageScaffold` + `useCollectionPipeline` + `useCollectionBreadcrumbs`. `copy` carries only the platform's own strings (`title`, `breadcrumbs`, `caption`, `searchPlaceholder`, `noMatches`, `syncErrorText`); the caption's "last synced" part is `common.lastSynced`. The guide states come from `components/collection-states/` — `EmptyLibraryState` (pass `site` when opening the platform's site is how the library fills), `NotLoggedInState` (site-session platforms) and `NeedsConfigState` (`settings: SettingsLeaf`, plus `sync` when the credential was rejected rather than missing) — and take an `IconifyName`, `LocaleKeys` and a `SiteAction` / settings leaf, never translated strings; a state shaped differently from those three (bookmarks' button-less empty state, bilibili's retry) stays local. Owns the i18n seam as data, not a switch: a module-level `SyncErrorCopy` (i18n keys: `auth`, optional `authRejected`, `rateLimited`, optional `rateLimitedUntil`) passed to the shared `syncErrorMessage` (`entrypoints/app/hooks/collection-sync-error-message.ts`). If the platform's `<P>RateLimitError` carries a `resetAt`, lock the Fetch button until it: `useCountdown((now) => rateLimitRemainingMs(syncError, now))` into `syncDisabled` / `syncDisabledLabel` (`pipeline.fetchAvailableIn`). |
| `<platform>-card.tsx` | Composes the shared `CollectionCard` shell. |
| `tagged-<platform>-card.tsx` | One line: `export const Tagged<P>Card = taggedCard(<P>Card, '<prop>', to<P>Item);` (`entrypoints/app/components/tags/tagged-card.tsx`). `to<P>Item` is the `mapRow` your lib file exports (§4.2) — no envelope mapping is written here; `'<prop>'` is your card's item prop. A misspelled prop or a mapper that does not produce what the card takes is a `tsc` error at this call. |
| `<platform>-grid-skeleton.tsx` | Shared `CardGridSkeleton` + `CollectionCardSkeleton`. |
| chips | A single counted facet (a Creator or a Source — `name (count)`, an "All (total)" chip, single select) is `FacetChips` from `components/collection-states/`, passed `icon`, `title` (an i18n key), and `getKey` / `getName` accessors over your facet query's rows — no file of your own. A row shaped differently (a per-chip colour dot, no counts, a loading skeleton) composes `CollapsibleChipRow` itself. |
| `CLAUDE.md` | **Mandatory.** Platform directories are the named exception in the root `CLAUDE.md` maintenance rules (other new directories get one only when they carry a constraint the code does not show). Write what is different or surprising about this platform — constraints, pitfalls, deliberate decisions — not a file inventory and not a landing log. |

### 7.3 What the scaffold already owns — do not reimplement

`CollectionPageScaffold` owns the tag wiring, the **eight-branch content phase
ladder** (`resolveCollectionPhase`, whose branch order is the contract), the
grid/popover/pagination, and the fixed page order (title → pipeline → search →
configuration notice → primary category → tag chips → content). You inject
cards, chips, states, and **pre-translated platform copy** — the
`components/collection/` layer calls `t()` zero times.

The scaffold also owns the **chrome copy** that is identical on every platform:
the Fetch button's two labels, the error phases' title and retry, and the
sync-failed banner (`common.syncFailed` around your `syncErrorText`). It reads
them from `useCollectionChromeCopy` in `components/collection-states/` — the
translated sibling of `components/collection/` (docs/32 Step 6, user decision
2026-10-01). `CollectionPageCopy` has no field for any of them, so there is
nothing to pass and nothing to get wrong.

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
3. `entrypoints/app/sections/settings/settings-nav.ts` — add one section to the
   `connections` tab of `SETTINGS_NAV`, then add its case to the view's switch.
   Since 2026-09-16 that single row replaces the two hand-written lists this
   step used to name (a `ConnSection` union and a `connNavItems` array): the
   section id is also the URL segment of `/settings/connections/<id>`.
   *Checked:* the section, one-directionally — platform ⊆ the tab's section
   ids. `'agent-bridge'` is legitimately a section there and is not a platform,
   so the reverse containment is not a defect. The table has no value imports,
   so the guard imports it instead of parsing the view. `tsc` independently
   catches deleting *only* the row (`SettingsLeaf` is derived from the table
   and the switch is exhaustive); deleting the row **and** its case together is
   the hole this guard covers.
4. `entrypoints/app/sections/settings/<platform>-connection-card.tsx` — the card
   itself, using `useConfigDraft` + `SaveActions` + `SettingsPanel`, with a live
   probe that reuses a real API call. *Checked:* that the file exists. Nothing
   asserts it renders, that the rail reaches it, or that it probes anything.
5. `<platform>-sync-adapter.ts` — export `<p>Credentials(settings)` (the
   stored credential, or `null`) and read it in the run gate and in
   `probeReady`; the page hook reads the same function through
   `useCredentialGatedLibrary` (§7.2). *Unchecked.* A resolver that reads the
   wrong key is silent in the worst way: the guard stays green, the card saves,
   and the platform reports "not configured" forever. Since docs/32 Step 7 the
   three readers share that one function, so at least they can no longer
   disagree with each other.

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
read helpers and query builders (§4.2), `CollectionPageScaffold`, `useCollectionPipeline`,
`useCollectionBreadcrumbs`, the shared `*-sync-adapter.ts` seam and the
Platform Sync funnel inside it (`runPlatformSync`, §7.2), both Platform
Descriptors and all four heavy-value registries (§6).

**Optional**: `useCollectionLibrary`. It models *one list + facets + manual
sync*. `bilibili` opts out — it has two coupled hooks (folders and videos), a
child route, and a transcription stage — and that opt-out is a documented scope
boundary (docs/15 HIGH-1), not debt. If your platform genuinely does not fit,
opt out of the hook; **do not** opt out of the scaffold or the registries.

## 11. Forbidden patterns

| Never | Enforced by |
| --- | --- |
| a quoted platform id, a literal-key `meta` / `platformMeta` read (`meta.k`, `meta['k']`, or a `{ k } = meta` pattern), or a literal JSON-path key in SQL text (`->`, `->>`, `#>`, `#>>`), in a shared module (`lib/tagging/**`, `lib/embedding/**`, `lib/chat/**`, `lib/export/**`, `collection-analytics.ts`, `collection-processing-policy.ts`, `collections-query.ts`) — put the fact in the domain descriptor and read it by variable | completeness contract (a separate case listing `file:line`). The check is name-based: a local that holds descriptor data must not be called `meta`, and an alias (`const m = row.platformMeta; m.k`) is not followed |
| a route line naming a platform in `main.tsx` | completeness contract |
| a hand-written `jobPlatform` in the auto-sync registry | completeness contract |
| a job-namespace literal (or a constant bound to one) passed to the job store or as `jobPlatform` in `entrypoints/app/**` — derive it with `jobPlatformForCollection(platform)` | completeness contract (a separate case listing `file:line`) |
| any `entrypoints/app/hooks/**` module importing `sections/` | completeness contract |
| a value import other than `./platforms` in `lib/collections/platform-descriptor.ts` | `platform-descriptor.test.ts` reads its own imports by AST, and `lib-import-smoke` loads it with no `chrome` global. Break it and the build fails in `wxt.config.ts`, which never mentions the real culprit |
| re-exporting the descriptor from `lib/collections/index.ts` | review — that barrel goes through `collections-query`, so it drags drizzle and `@/lib/database` into every importer, welcome.html and the Node build config included |
| a bare `fetch(` in `lib/**` | `http-fetch-deadline-guard` |
| a `*AuthError` / `*RateLimitError` class in `lib/<platform>/` that extends `Error` (or nothing) instead of `PlatformAuthError` / `PlatformRateLimitError` | completeness contract — the app classifies by base class only |
| a per-platform sync-error classifier or `switch` over error kinds in a view | review — declare a `SyncErrorCopy` and call the shared `syncErrorMessage` |
| a `setTimeout` wait (`new Promise((r) => setTimeout(r, ms))`) in `lib/<platform>/` — use `sleep`, and `withRetries` for a retry loop | `platform-sleep-guard` |
| a bare numeric module constant in `lib/<platform>/` | `platform-env-constants-guard` |
| `@/lib/storage` (or any `chrome.*`-touching barrel) in the sync-service static graph | `lib-import-smoke` |
| a `t()` call inside `components/collection/**` | design contract (`components/collection/CLAUDE.md`). Translation lives in sibling smart modules the scaffold may import by name — `components/tags/` (renders its own translated chips, grid and popover), `components/library-gate/` and the leaf `components/collection-states/use-collection-chrome-copy.ts` — and nowhere else; a dumb component that needs copy takes it as a prop |
| duplicating credential resolution or post-sync dispatch across the manual and daily triggers | review — the shared `*-sync-adapter.ts` exists precisely to make this unnecessary |
| calling `startCollectionProcessingJobs` outside the Platform Sync funnel | completeness contract — the funnel is what records the Platform Sync; a direct call skips the record |
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
`COLLECTION_PLATFORMS` order, plus an API permission your platform genuinely
needs and documents next to the `permissions` array in `wxt.config.ts` —
appended last, never reordering an existing entry. Precedents: `webRequest`
(x), `bookmarks` / `favicon` (bookmarks), `cookies` / `declarativeNetRequest`
(bilibili), `scripting` (douyin, docs/33 D4: inject into the user's open tab).
A reordered or reworded existing entry means every installed extension asks
its user to re-authorize.

Finally, walk §9 by hand — the one row no command above will tell you about —
and re-read the *unchecked* parts of §8: anchor 1's settings fields and zod
entries, and anchor 5's `<p>Credentials` resolver (what `probeReady` reads).
The credentials-chain guard deliberately covers neither.

## 13. Definition of done

- [ ] `pnpm compile`, `pnpm test`, `pnpm build` all green
- [ ] both Platform Descriptors (§6.1, §6.2) and the four heavy-value registries (§6.3) declare your platform
- [ ] the manifest diff adds only your own `host_permissions` and any documented API permission (§12)
- [ ] `lib/<platform>/CLAUDE.md` and `entrypoints/app/sections/<platform>/CLAUDE.md` written
- [ ] root `CLAUDE.md` opening paragraph (platform count and id list) names the new platform — its directory index covers `lib/<platform>/` and `sections/<platform>/` generically, so it needs an entry only if the section directory is not named after the platform id
- [ ] zh-CN **and** en locale keys complete (`en.ts` is `Record<LocaleKeys, string>`, so a missing English key is a compile error — a key missing from *both* is not)
- [ ] every §9 row walked by hand and either done or consciously N/A
- [ ] `package.json` `version` bumped if this ships to the Chrome Web Store
