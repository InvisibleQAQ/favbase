# Decouple Bilibili Fetch From Downstream Processing

## Problem

Bilibili Favorites currently completes the full paginated fetch before starting
the transcription pipeline. The transcription pipeline then fetches the same
pages again. Embedding and Tagging only start after each transcription has
persisted durable content, so the initial fetch blocks the whole downstream
pipeline.

Browser Bookmarks already demonstrates the required behavior: each durable
content item immediately feeds independent Embed and Tag lanes while the
producer continues.

## Confirmed terminology and constraints

- A Fetch Pipeline Run produces persisted Collection Items incrementally.
- A Transcription Pipeline Run consumes persisted `pending` Bilibili items.
- Embed and Tag Pipeline Runs consume each item's durable transcript/chunks and
  are independent lanes; one lane must not wait for or cancel the other.
- A fetch failure after page N must not discard or cancel processing for items
  already persisted through page N.
- Do not run a second Bilibili pagination crawler merely to start transcription.
- Preserve the existing Bilibili page pacing, pause/resume gate, retry/error
  semantics, route lifetime, and per-item processing queue behavior.
- Keep ownership cohesive: Bilibili sync owns remote pagination and persistence;
  the generic processing queue owns Embed/Tag scheduling; platform-specific
  adapters only translate the boundary.

## Desired behavior

After the first fetched page is durably persisted, transcription may claim the
Collection Items newly inserted by this Fetch run while later pages continue
fetching. It must not scan or drain historical `pending` items at startup, and a
new Source membership for an already-persisted video must not trigger duplicate
transcription. Successful transcription must
continue to enqueue Embed and Tag independently, as it does for Bookmarks.
Fetch, Transcription, Embed, and Tag remain observable as separate Pipeline Runs
and may settle at different times.

## Scope

- Change the Bilibili sync/continuation seam so page-level persistence can signal
  newly available items without coupling the generic sync runner to app jobs.
- Delete the second full-page fetch and historical pending continuation from the
  Bilibili automatic transcription path; consume only the persisted item stream.
- Add focused regression tests proving processing begins before the fetch run
  finishes, and that a partial fetch still leaves persisted items processable.
- Update relevant directory documentation and processing-queue contract if the
  ownership or lifecycle contract changes.

## Non-goals

- Durable queue/restart after `app.html` closes; the current queue is explicitly
  page-runtime scoped.
- Changing Bilibili API pacing, ASR provider behavior, embedding provider limits,
  tag prompts, or UI visual design.
- Introducing a platform-wide generic queue abstraction solely for Bilibili.

## Decisions

- Process only Collection Items newly inserted by the active Fetch run. There
  is no initial historical backlog to reconcile for this task.
- Derive that set from the ingest result (`result.inserted` / `newItemIds`), not
  from every fetched video or from the item's `pending` state. A video already
  present in another Source is not new and must not be transcribed again.
- Use a page-level producer callback at the Bilibili sync adapter boundary;
  keep the generic `runFavoriteVideosSync` platform-agnostic and unaware of app
  jobs.
- Feed every emitted page batch into one page-runtime Bilibili Transcript inbox.
  The inbox owns serial consumption, deduplication, job progress, quota/rate
  handling, and settlement; later page batches append to the active run rather
  than creating another run.
- Keep the Transcript inbox in the app-layer Bilibili runtime. Do not add
  Bilibili/ASR behavior to the generic Embed/Tag processing queue, and do not
  make `lib/bilibili` import the app job store.
- The producer callback is fire-and-forget: Fetch does not await Transcript.
  If Fetch fails, the inbox drains every item already appended. A per-item
  Transcript failure marks/settles that item and continues without failing
  Fetch. Embed and Tag failures remain owned by their independent lanes and do
  not fail Fetch or Transcript.
- Preserve the page-runtime durability limit: closing `app.html` may discard
  queued work; durable restart/reconciliation is outside this task.
- A durable ASR quota guard pauses and retains the active Transcript session in
  the current `app.html` runtime. Reset retries the same item before later
  entries; it must not settle the session and strand items that will no longer
  appear in a future `result.inserted` set.
- Keep at most one Bilibili favorites-page request and one Transcript item in
  flight. Preserve the existing 7-10 second Fetch page delay and the existing
  Transcript subtitle/ASR pacing. The two lanes may overlap; do not add a
  cross-stage Bilibili request lock without evidence of an HTTP 412 regression.
- Preserve the existing independent serial limits for Embed and Tag.
- Remove the mount-time historical `pending` scan and the post-Fetch
  folder-based auto-transcription crawler. Automatic transcription is fed only
  by Collection Items newly inserted during the active Fetch run. Keep the
  manual single-video transcription path unchanged.
- One Fetch run opens one Transcript producer session. Page persistence appends
  to that session; Fetch success or failure closes the producer. The Transcript
  job remains one run while the producer is open, then drains queued items and
  settles independently.
- Start Transcript automatically after the first new item is persisted. Add no
  per-stage switch; retain the existing platform Library Gate as the single
  pause/resume control.
- If an item has no usable official subtitle and ASR is not configured, surface
  a user-visible configuration reminder instead of silently counting the item
  as skipped. Videos with usable official subtitles must continue without ASR.
- On the first item that actually requires missing ASR configuration, put only
  the Transcript lane into a recoverable configuration-wait state. Keep the
  current item and subsequent inbox entries queued; do not mark them failed or
  skipped. Fetch and already-running Embed/Tag work continue independently.
- Render a persistent actionable warning in the Bilibili transcription panel.
  Its action opens Settings directly at AI / ASR. Saving a valid ASR
  configuration in the same `app.html` runtime automatically resumes the
  retained Transcript item.
- When a manual Fetch originates from a selected Source route, fetch that Source
  first so its new items naturally enter Transcript first. Daily background
  Fetch retains natural Source order.
- For a user-triggered Fetch from a selected Source route, reorder the Fetch
  producer so that Source is fetched first; Transcript then inherits the same
  order without a second sorting rule. Daily background Fetch has no selected
  Source and retains the remote/natural Source order.

## Acceptance criteria

- [ ] The first page's newly inserted Collection Items enter Transcript before
  the full Fetch Pipeline Run settles.
- [ ] Later page batches append to the same serial Transcript run and grow its
  truthful `done / total` progress without starting concurrent transcription.
- [ ] A video already present through another Source creates only a membership
  and is not emitted as a new transcription target.
- [ ] Fetch failure closes its producer session; Transcript drains items already
  appended and reports its own outcome independently.
- [ ] Each successful transcript immediately feeds the existing independent
  Embed and Tag lanes without waiting for Fetch or the sibling lane.
- [ ] Automatic Transcript performs no favorites-page crawl and mount performs
  no historical `pending` continuation. Manual single-video transcription still
  works.
- [ ] Missing ASR is surfaced only when an item lacks usable official subtitles;
  the Transcript item is retained, the warning links directly to ASR settings,
  and saving configuration resumes it in the same runtime.
- [ ] Manual Fetch handles the selected Source first; daily Fetch keeps natural
  Source order.
- [ ] Existing Fetch and Transcript pacing, Library Gate behavior, route-lifetime
  job observation, Embed/Tag serialization, and bilingual UI remain intact.
- [ ] Focused failing-first tests, full tests, TypeScript compile, and build pass.
