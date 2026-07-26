# 17. Architecture Cohesion and Coupling Audit (2026-07-25)

## Scope and Decision Frame

This is a static architecture audit of `lib/`, `entrypoints/`, related tests,
`CONTEXT.md`, existing architecture reports, and active Trellis tasks. It records
current problems but does not change runtime code or prescribe final TypeScript
interfaces.

- **Assumption exposed**: the goal is to find current, evidence-backed ownership
  and dependency problems, not to make every directory or import style uniform.
- **Blind spot**: no fault-injection build was run against a live extension. The
  frequency of Port disconnects and simultaneous app-page database clients is
  `[UNKNOWN]`; the failure paths themselves are present in source.
- **Direction challenged**: high cohesion does not mean centralizing all constants,
  adding facades, or hiding imports behind barrels. A candidate is accepted only
  when moving ownership reduces facts, branches, or failure policies at callers.

### Severity Rubric

- **HIGH**: can publish a false durable fact, permanently lose recoverable work, or
  violate database atomicity across a shared system boundary.
- **MEDIUM**: duplicates a business rule or forks a read model so behavior and tests
  can diverge as the system evolves.
- **LOW**: exposes an abstraction or runtime-context leak with known maintenance or
  test cost, but no proven current data loss.

## Executive Assessment

**Taste rating: mediocre.** The repository has several useful deep modules, but
three critical seams lie about ownership:

1. platform adapters declare a final content state before the ingest module has
   made content durable;
2. durable Collection Items spawn non-durable Embedding and Tagging promises;
3. a single PGlite connection is exposed through a transport that cannot guarantee
   message delivery or transaction ownership across clients.

These are not file-organization complaints. They are state-machine and system-
boundary errors. Fixing lower-severity import structure first would be polishing
the wrong layer.

## Findings by Severity

### HIGH-1: Collection ingest publishes `chunked` before content and chunks are durable

**Files**

- `lib/ingest/ingest.ts:54-87,123-139,252-289,322-345`
- `lib/github/github-sync-service.ts:223-245`
- `lib/x/x-sync-service.ts:192-205`
- `lib/zhihu/zhihu-sync-service.ts:184-199`
- `lib/youtube/youtube-sync-service.ts:262-276`
- `lib/collections/processing-coverage.ts:39-53`
- `lib/embedding/indexing.ts:170-191`
- `lib/ingest/ingest.test.ts:51-222`

**Problem**

`IngestItem` requires each platform adapter to provide a final `contentState`.
GitHub, X, Zhihu, and YouTube therefore declare `chunked` from the existence of raw
text. `ingestCollection` then commits that state with the item row before running
`persistItemContent` outside the transaction.

The actual sequence is:

1. insert the Collection Item with `content_state='chunked'`;
2. commit the metadata transaction;
3. write `item_contents`;
4. rebuild chunks in a separate transaction.

`persistItemContent` does not move the item through `has_content` or set `chunked`
after success. If either content or chunk persistence fails, the item can remain
durably `chunked` without the data that state promises.

The retry path is also broken. `result.inserted` excludes pre-existing items, and
the content phase iterates only `result.inserted`. The next sync sees the failed row
as pre-existing and never retries its content. Downstream modules trust the false
fact: Processing Coverage counts `chunked` as settled and Embedding-eligible, while
`embedPlatformItem` accepts `chunked` and can return it when no chunks exist.

The root cause is ownership inversion. A platform adapter knows whether raw content
was fetched; only the persistence module knows whether content and chunks became
durable.

**Solution direction**

Make one content-persistence module own the transition order and recovery policy.
Platform adapters should report raw content facts, not a final state they cannot
guarantee. Publish `chunked` only after chunk persistence succeeds, and make reruns
able to recover existing Collection Items whose content is incomplete.

The exact intermediate state and transaction shape require a separate design. The
single-connection constraint that prevents nested `replaceItemChunks` transactions
must remain intact.

**Benefits**

- **Locality**: raw text, content persistence, chunk persistence, state transition,
  and retry policy meet at one implementation.
- **Leverage**: all text-native platforms inherit the same truthful failure and
  recovery behavior without repeating state decisions.
- **Test surface**: add new-item failures at both content upsert and chunk rebuild,
  then rerun ingest and assert recovery, truthful Processing Coverage, and no early
  Embedding eligibility. Existing ingest tests cover delayed-content replacement
  failure, not this new-item path.

**Deletion test**

Deleting final-state selection from `IngestItem` removes four premature platform
decisions and one unrecoverable branch. The complexity moves to the only module
capable of resolving it; it does not spread back to callers.

### HIGH-2: Embedding and Tagging work has no durable owner

**Files**

- `entrypoints/app/hooks/background-jobs-store.ts:15-38,89-181`
- `entrypoints/app/sections/github-stars/use-github-stars.ts:135-139`
- `entrypoints/app/sections/x/use-x-bookmarks.ts:121-123`
- `entrypoints/app/sections/zhihu/use-zhihu-favorites.ts:107-109`
- `entrypoints/app/sections/youtube/use-youtube-playlists.ts:114-118`
- `lib/tagging/tagging-service.ts:63-147`
- `lib/embedding/indexing.ts:276-362`
- `lib/database/schema.ts:1-8`
- `.trellis/spec/frontend/processing-queue.md`
- `.trellis/tasks/07-22-dashboard-platform-progress/prd.md`
- `CONTEXT.md`

**Problem**

The durable fact is a Collection Item with persisted chunks. The downstream work
is only a list of IDs captured by `startJob` or `trackJobRun` in `app.html` memory.
The job store keeps state across Hash Router mounts, but its Maps and Promises die
when the page closes. The store comment says resume semantics live in queues, while
the database schema contains no processing task or control tables and no queue
implementation exists.

For four text-native platforms, the sync hook immediately calls `tagNewItems` and
`embedNewItems`. Closing `app.html` after ingest commits but before those loops
finish loses the remaining work identity. Embedding has a manual rebuild path, but
that does not make the automatic lifecycle durable. Tagging has no equivalent
global reconciliation path, so interrupted items can remain untagged indefinitely.

This is also a cohesion failure: every platform hook owns the same two-lane fork,
while `background-jobs-store` owns live presentation state but is forced to imply
recovery semantics it cannot provide.

The planned Processing Queue contract correctly identifies the deep module needed,
but two design defects must be corrected before implementation:

- HIGH-1 must be fixed first, or the queue will persist work from false `chunked`
  facts.
- `CONTEXT.md` explicitly says the Dashboard does not present Processing Coverage
  or operational task progress, while the active PRD and queue spec place lane
  progress and controls on the Dashboard. That domain ownership conflict is not a
  harmless wording difference.

**Solution direction**

Implement one durable Processing Queue module that owns eligibility, idempotent
task creation, lane state, leases, pause intent, recovery, and settlement for both
Embedding and Tagging. Keep `background-jobs-store` only as a live UI adapter over
durable state. Platform ingest and transcription should expose one durable-content
seam and should not own provider work lifecycles.

Place operational progress in the product surface that owns processing operations;
do not silently redefine the Dashboard domain while implementing the queue.

**Benefits**

- **Locality**: processing eligibility, recovery, pause, retry, and lane outcomes
  live in one module instead of six platform adapters and an in-memory store.
- **Leverage**: every current and future platform gains the same restart and
  failure semantics.
- **Test surface**: queue tests can simulate page close, lease expiry, restart,
  duplicate enqueue, provider failure, and independent lane progress without
  mounting platform pages.

**Deletion test**

After the durable seam exists, deleting direct `tagNewItems`/`embedNewItems` calls
from platform hooks removes duplicate lifecycle ownership. No platform-specific
queue logic should replace them.

### HIGH-3: The Database RPC seam cannot guarantee delivery or cross-client transactions

**Files**

- `lib/database/bridges/types.ts:40-52`
- `lib/database/bridges/chrome-port-rpc.ts:24-100`
- `lib/background/port-bridge.ts:60-131`
- `lib/database/bridges/rpc-handler.ts:25-35,60-123`
- `lib/database/bridges/proxy-driver.ts:27-35,44-110,137-150`
- `.trellis/spec/frontend/database-bridge.md`
- `.trellis/tasks/06-24-refactor-harden-database-rpc-bridge-serialization-timeout-transaction-pending-cleanup/prd.md`

**Problem**

`RpcTransport.post()` returns `void`. The caller-side transport queues a request
only when its own Port is absent or throws. Once the message reaches the Background
PortBridge, a dead Offscreen Port is caught and the message is discarded during the
reconnect window. The response path also swallows delivery failure. Its comment
claims the caller will timeout and retry, but `PGliteSharedProxy` only rejects after
30 seconds; it contains no retry.

Blind retry would still be unsafe. `DatabaseRpcHandler` deletes the request ID from
`inFlight` even when response delivery fails and stores no completed response. A
write may have committed even though the caller saw a timeout, so replaying it can
execute the operation twice.

Transaction ownership is equally shallow. `PGliteSharedProxy` serializes
`BEGIN -> callback -> COMMIT|ROLLBACK` only inside one proxy instance. Multiple app
pages or other database clients can create separate proxies while sharing the same
Offscreen PGlite session. `DatabaseRpcHandler` dispatches every message
independently and has no server-side transaction owner, so another client's query
can run inside the first client's transaction.

A dropped `COMMIT` or `ROLLBACK` is worse: the local proxy times out and releases
its mutex, while the shared PGlite connection may remain in an open transaction.
The production frequency is `[UNKNOWN]`, but the protocol does not preserve the
documented atomicity contract. The bridges directory has no tests.

The active 06-24 PRD is stale: it says `transaction()` has no callers and
`initDbProxy()` is unused, both contradicted by current source. It also does not
cover relay message loss, response replay, or cross-client transaction ownership.

**Solution direction**

Move transaction serialization and ownership to the single shared handler side,
where all clients can be observed. Make transport acceptance and disconnect
failure explicit. If requests are replayable, retain request outcomes or otherwise
provide idempotency so a lost response cannot duplicate a committed write. Treat
`BEGIN` through settlement as one server-owned operation, not independent messages
protected by a client-local mutex.

**Benefits**

- **Locality**: delivery, replay, request identity, and transaction ownership are
  enforced where the single database connection actually lives.
- **Leverage**: every Drizzle query and transaction inherits the same correctness
  guarantees without caller-specific retries.
- **Test surface**: deterministic bridge tests can inject caller disconnect,
  Offscreen reconnect, lost response, lost commit, two proxies, and duplicate
  request IDs.

**Deletion test**

Deleting the per-proxy transaction mutex after server-side ownership exists removes
false isolation rather than spreading locks to consumers. Callers retain the normal
database transaction interface.

### MEDIUM-4: Tag filtering forks the Collection Item read model

**Files**

- `entrypoints/app/components/collection/collection-page-scaffold.tsx:108-109,217-228`
- `entrypoints/app/components/tags/tagged-item-grid.tsx:12-72,102-137`
- `lib/tagging/tagging-service.ts:220-280`
- `lib/collections/collections-query.ts:17-37,70-92,118-165`
- `lib/tagging/tagging-service.test.ts:384-466`
- `lib/collections/collections-query.test.ts:76-222`

**Problem**

When a platform page has no tag filter, its normal collection query owns paging,
platform-native recency, errors, and item mapping. Once tags are selected,
`CollectionPageScaffold` switches to `TaggedItemGrid`, which opens a second read
path through `tagging-service.getItemsByTags`.

The fork is already behaviorally different:

- it loads every matching row with no pagination;
- it sorts by database `createdAt`, not platform-native recency;
- it converts query errors into an empty result, making failure indistinguishable
  from no matches;
- platform card adapters must reconstruct platform item shapes from raw
  `platformMeta`.

The aggregate `getCollectionItems` query already supports tag filtering before
count, ordering, limit, and offset, but only for one tag. Instead of extending the
Collection Item query for AND semantics, the UI delegates item retrieval to the
optional Tagging module. The type direction confirms the inversion:
`CollectionItem` extends `TaggedItem`, so the core collection read model depends on
a feature module.

**Solution direction**

Make the Collection Item query the single owner of item retrieval, ordering,
pagination, and error semantics. Extend its filter input for the required tag AND
semantics. Keep Tagging responsible for tag generation and link mutation, not for a
parallel Collection Item browser.

**Benefits**

- **Locality**: one read model owns how Collection Items are selected and presented.
- **Leverage**: search, platform filters, tag filters, pagination, ordering, and
  future filters compose through one query path.
- **Test surface**: move AND-filter assertions to collection-query integration
  tests and add paging/native-order regressions; component tests only select UI
  phases and error presentation.

**Deletion test**

Deleting `TaggedItemGrid` as a data owner and removing `getItemsByTags` from the UI
path eliminates the duplicate query policy. Tag mutation and tag generation remain
cohesive inside Tagging.

### MEDIUM-5: Pure `platformMeta` codecs live inside heavy sync implementations

**Files**

- `entrypoints/app/sections/github-stars/tagged-repo-card.tsx:1-18`
- `entrypoints/app/sections/x/tagged-tweet-card.tsx:1-18`
- `entrypoints/app/sections/zhihu/tagged-zhihu-card.tsx:1-18`
- `entrypoints/app/sections/youtube/tagged-youtube-card.tsx:1-18`
- `lib/github/github-sync-service.ts:25-43,357-386`
- `lib/x/x-sync-service.ts:23-46,319-353`
- `lib/zhihu/zhihu-sync-service.ts:32-49,314-342`
- `lib/youtube/youtube-sync-service.ts:31-52,393-421`
- `lib/{github,x,zhihu,youtube}/narrow-meta.test.ts`

**Problem**

The aggregate and tag-filtered card adapters need pure operations that narrow JSONB
`platformMeta` into platform display fields. They value-import those operations
from full sync-service modules, which also import Drizzle, database entities,
ingest, network adapters, Markdown conversion, and in some cases the storage-bound
Embedding barrel.

The dependency direction is wrong. A display adapter needs a platform item model
and codec; it does not need synchronization implementation. X, Zhihu, and YouTube
codec tests require runtime/storage mocks because importing the pure function pulls
the heavy module graph into the test.

`docs/16_multi-platform-deepening-audit.md` correctly removed duplicate metadata
narrowing. The remaining issue is placement: one implementation now exists, but it
is exported from the wrong module.

**Solution direction**

Move each platform's display item type and defensive `platformMeta` codec into a
pure platform model module. Sync mapping and card adapters should both depend on
that model. The model must not depend on React, storage, database access, or network
adapters.

**Benefits**

- **Locality**: metadata shape, fallbacks, and type narrowing stay together.
- **Leverage**: sync mapping, aggregate cards, tag-filtered cards, exports, and
  future readers share one context-safe codec.
- **Test surface**: codec tests become pure imports without browser or storage mocks.

**Deletion test**

Removing codec and item-type exports from sync-service modules does not duplicate
them. One implementation moves to the platform model, and UI-to-sync dependency
edges disappear.

### MEDIUM-6: Provider settings cross the storage boundary without one validated resolver

**Files**

- `lib/storage/settings.ts:8-30,61-108`
- `lib/providers.ts:3-10,109-130,133-199`
- `lib/hooks/useSettings.ts:52-87`
- `lib/tagging/config.ts:15-41`
- `lib/embedding/config.ts:22-96`
- `lib/ai/index.ts:27-57,147-157,248-261`
- `entrypoints/app/sections/settings/llm-config-card.tsx:54-118`

**Problem**

Provider IDs enter through environment variables and persisted storage, but the
boundary uses TypeScript casts rather than runtime discriminators. Existing stored
JSON is trusted by the storage generic. `getProviderDef`, `getAsrProviderDef`, and
`getEmbeddingProviderDef` silently return the first adapter for an unknown ID.

That fallback can create a contradictory resolved configuration: the raw invalid
ID remains the selected `providerId`, while base URL, SDK type, or default model can
come from an unrelated first provider. Corrupted, hand-edited, or older settings
therefore fail far from the storage boundary.

LLM precedence is also duplicated. `deriveLlmDraft` and
`resolveTaggingConfig` both implement user value -> environment value -> provider
default, and the latter explicitly says it mirrors the former. ASR and Embedding
already use resolvers in more places; LLM UI and runtime still maintain parallel
implementations.

**Solution direction**

Validate provider discriminators when raw settings and environment values enter the
system, then let each capability own one resolver for its actual fields and default
precedence. The settings UI and runtime adapters should consume the same resolved
facts. Do not force LLM, ASR, and Embedding into one giant generic config type; they
share validation mechanics, not all domain fields.

**Benefits**

- **Locality**: legal IDs, fallback policy, and precedence have one owner per
  capability.
- **Leverage**: settings tests, connection probes, Tagging, ASR, and Embedding agree
  on the same raw input.
- **Test surface**: boundary tests cover invalid environment IDs, invalid persisted
  IDs, old data, custom providers, and environment-bundle isolation.

**Deletion test**

Deleting LLM provider resolution from `deriveLlmDraft` leaves the UI with display
mapping only. Removing silent adapter fallback turns one hidden cross-module error
into one explicit boundary result rather than adding checks to every provider call.

### LOW-7: `useConfigDraft` forces single-connection cards to invent a provider

**Files**

- `entrypoints/app/sections/settings/use-config-draft.ts:49-83,110-116,150-176`
- `lib/hooks/useSettings.ts:42-50,90-112`
- `entrypoints/app/sections/settings/github-connection-card.tsx:28-31`
- `entrypoints/app/sections/settings/youtube-connection-card.tsx:28-31`

**Problem**

`useConfigDraft` combines two independent concerns in one interface:

- the test -> verify -> save state machine;
- switching among providers.

Its generic requires `T extends { provider: string }` and always returns
`switchProvider`. GitHub and YouTube have exactly one connection type, yet their
drafts must add synthetic `provider: 'github'` and `provider: 'youtube'` fields only
to satisfy the abstraction. The comments explicitly acknowledge this.

**Solution direction**

Keep draft verification, dirty-state, testing, and saving in the core hook. Make
provider switching an optional composition used only by multi-provider settings.

**Benefits**

- **Locality**: provider-switch knowledge stays in LLM, ASR, and Embedding flows.
- **Leverage**: future single-connection cards reuse the state machine without fake
  domain data.
- **Test surface**: core hook tests no longer require provider fixtures; provider
  switch invalidation is tested separately.

**Deletion test**

Removing the provider constraint deletes the two synthetic fields and unused
operations. No replacement branch is required in either connection card.

### LOW-8: The Embedding barrel mixes pure, database, AI, and storage-bound modules

**Files**

- `lib/embedding/index.ts:1-65`
- `lib/embedding/config.ts:1-4`
- `lib/embedding/CLAUDE.md`
- `lib/ingest/ingest.ts:22-23`
- `lib/github/github-sync-service.ts:32-37`
- `lib/x/x-sync-service.ts:41-46`
- `lib/bookmarks/bookmarks-sync-service.ts:36-38`
- `lib/embedding/config.test.ts:3-9`

**Problem**

`lib/embedding/index.ts` re-exports AI provider factories, storage-backed config,
pure chunkers, database indexing, and vector-store operations through one import
surface. Re-exporting `config.ts` reaches `@/lib/storage`, whose module initialization
touches extension storage.

Callers already understand and work around the hidden dependency graph. Ingest,
GitHub, X, and Bookmarks use leaf imports with comments warning that the barrel is
unsafe in storage-less contexts. Pure config tests mock storage even though the
resolver under test does not read it. A public interface that consumers must avoid
is a shallow module.

**Solution direction**

Expose a small number of cohesive interfaces by responsibility and runtime context:
pure content/chunk primitives, database indexing/vector operations, and
storage-bound runtime configuration. Do not replace the catch-all barrel with a
same-shaped facade.

**Benefits**

- **Locality**: browser storage constraints stay in the runtime config module.
- **Leverage**: Offscreen, ingest, sync, and pure tests import stable context-safe
  interfaces.
- **Test surface**: pure resolvers and chunkers load without browser runtime mocks;
  database tests load only database adapters.

**Deletion test**

Several consumers already use leaf imports, proving that removing the catch-all
surface does not require duplicated logic. What must remain are cohesive public
modules, not one directory-wide import path.

## Active Task Reconciliation

| Task or document | Audit decision |
|---|---|
| `07-22-dashboard-platform-progress` and `processing-queue.md` | Tracks HIGH-2's intended queue, but HIGH-1 is a prerequisite. Correct the conflict with `CONTEXT.md` before placing operational controls on the Dashboard. |
| `06-24-refactor-harden-database-rpc-bridge...` | Re-open and rewrite its assumptions. Current transaction usage and proxy initialization make parts of the PRD stale, and HIGH-3 adds delivery, replay, and cross-client ownership requirements. |
| `07-10-refactor-centralize-all-default-values-into-lib-storage-defaults-module` | Reject the architecture direction as written. Moving provider metadata, API hard limits, database identity, and behavior timing into one storage module reduces cohesion and creates a high fan-out dependency. Centralize only facts that share ownership. |
| `docs/16_multi-platform-deepening-audit.md` | Do not repeat completed extraction of `ingestCollection`, `CollectionPageScaffold`, `charSplit`, or metadata-codec deduplication. HIGH-1 and MEDIUM-5 concern the remaining contract and placement errors. |

## Rejected or Deferred Candidates

- The theme dependency cycle is type-only. No runtime initialization cycle or user
  failure was proven, so it is not ranked above the accepted findings.
- Cross-context messages still use several TypeScript casts instead of runtime
  validation. Normal web pages cannot directly call extension messaging without
  `externally_connectable`; Main World `window.postMessage` remains untrusted, but
  this audit did not prove a higher-priority cohesion failure. Treat it as boundary
  hardening work, not a substitute for HIGH-1 through HIGH-3.
- High fan-in barrels such as database, i18n, and Tagging are not defects by count
  alone. Only the Embedding barrel is accepted because source comments and tests
  prove runtime-context leakage.
- Large platform sync files are not automatically bad. Platform API differences
  are real domain differences; splitting them without an ownership gain would add
  ceremony.

## Healthy Boundaries to Preserve

- `persistExistingItemContent` correctly publishes `has_content` before replacing
  chunks and advances to `chunked` only after success. HIGH-1 should make new-item
  ingest follow the same truthful-state principle without forcing nested
  transactions.
- The Bookmarks `content_state='pending'` extraction flow is resumable from durable
  item state and has failure-taxonomy integration tests. It is a useful local
  reference for HIGH-2, not a generic queue to copy unchanged.
- `getCollectionItems` already centralizes aggregate filtering, native ordering,
  pagination, and tag hydration. MEDIUM-4 should deepen this module rather than add
  another query facade.
- The shared ingest transaction removed repeated authors/items/sources/link write
  skeletons across platforms. Keep that reuse; correct its state contract instead
  of returning to platform-specific persistence.

## Recommended Exploration Order

| Priority | Finding | Reason |
|---|---|---|
| 1 | HIGH-1 | Establish truthful durable content facts before any queue consumes them. |
| 2 | HIGH-3 | The queue and all ingest work depend on reliable, isolated database writes. |
| 3 | HIGH-2 | Implement durable processing only after its eligibility and database seams are sound. |
| 4 | MEDIUM-6 | Resolve ownership before the defaults task moves the same configuration files. |
| 5 | MEDIUM-4 | Collapse the duplicate Collection Item read path and its divergent behavior. |
| 6 | MEDIUM-5 | Move pure platform models without changing synchronization behavior. |
| 7 | LOW-7 | Simplify the settings draft interface after provider resolution is settled. |
| 8 | LOW-8 | Replace the catch-all import surface after cohesive embedding boundaries are named. |

Do not batch these into one refactor. Each HIGH finding changes a different
correctness boundary and needs its own design, failing tests, and compatibility
review.
