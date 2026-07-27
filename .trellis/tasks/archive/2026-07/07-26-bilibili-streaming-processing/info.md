# Technical Design

## Core data flow

```text
Fetch page -> durable ingest -> newly inserted Bili videos -> Transcript inbox
                                                        -> transcript persisted
                                                        -> Embed lane
                                                        -> Tag lane
```

No downstream stage receives a Fetch promise. It receives only durable facts.

## Module ownership

### Bilibili sync modules (`lib/bilibili`)

- `syncFavVideosToDb` returns the platform item ids from `ingestCollection`'s
  `result.inserted` in addition to existing counters.
- `runFavoriteVideosSync` persists each accepted page immediately. Its optional
  callback receives only the newly inserted videos after persistence succeeds.
- The callback is notification-only and not awaited. Callback failure is
  contained and cannot fail Fetch.
- A Source is marked history-complete only after all required pages settle.
  Therefore a later page failure leaves earlier pages durable but the next Fetch
  still retries the incomplete Source safely through insert-only ingest.

### Automatic transcription module (`lib/auto-transcribe`)

- `AutoTranscribePipeline` becomes a producer-fed serial state machine instead
  of fetching Collection pages itself.
- One session accepts appended `AutoTranscribeVideo` batches, deduplicates by
  normalized video id, exposes growing progress, closes when Fetch settles, and
  drains before completion.
- Existing per-item transcription, status listener, rate-limit retry, quota
  state, persistence, and post-processing behavior remain behind this module's
  interface.
- Missing ASR with an `ASR_INVALID_KEY` response is distinguished from an
  invalid configured key by resolving current settings. Missing configuration
  enters `configuration_required`, retains the current item, waits for a valid
  settings update, checkpoints the Library Gate, then retries the same item.

### Bilibili app runtime (`entrypoints/app/sections/bilibili`)

- A thin runtime adapter maps newly persisted `BiliFavVideo` values to
  `AutoTranscribeVideo` and owns the module-level pipeline singleton.
- `runBiliStreamingSync` opens one producer session, calls the lib Fetch module,
  appends each durable page batch, and closes the producer in `finally`.
- The first non-empty append dispatches one `bilibili:transcribe` job. If manual
  single-video observation currently owns that job key, the stream waits for it
  to settle and then dispatches without losing queued items.
- The old folder crawler and mount-time pending continuation are deleted.

### UI/configuration

- `AutoTranscribeBar` renders a persistent warning for
  `configuration_required`, with a command button to `/settings?section=asr`.
- `SettingsView` selects AI / ASR from that route query. Saving settings is
  observed through `settingsStorage.watch`, which resumes the waiting pipeline.
- No Transcript switch is introduced. The existing Library Gate remains the
  platform-level pause/resume control.

## Failure ownership

- Fetch errors close the producer and reject only the Fetch job.
- Transcript drains already appended items and owns per-item outcomes.
- Missing ASR is a recoverable wait, not failure/skipped.
- Quota pause is also recoverable inside the current page runtime: retain the
  session and retry the same item at reset. This replaces the old next-run
  pending scan, which no longer exists.
- Embed and Tag remain independent queue lanes and cannot fail Transcript.
- Closing `app.html` discards page-runtime work by existing contract.

## Failing-first test plan

1. Runner test: page 1 is persisted/published before page 2 fetch completes.
2. Runner test: page 2 failure retains/publishes page 1 and does not mark Source
   history complete.
3. Ingest adapter test: cross-Source existing video is absent from `newItemIds`.
4. Pipeline test: later batches extend one serial run; max active transcript is
   one and growing totals are observable.
5. Pipeline test: missing ASR retains and retries the same item after settings
   resolution; Fetch producer can append while waiting.
6. Runtime test: producer closes on Fetch failure and already appended items
   drain; no historical pending lookup or page fetch occurs.
7. Hook/registry tests: selected Source is first for manual Fetch; daily Fetch
   uses natural order; both use the same streaming runtime.
8. UI tests: configuration warning is actionable; settings deep link selects
   ASR; no per-stage switch appears.

## Verification

- Focused tests for sync runner, videos ingest, auto-transcribe pipeline/runtime,
  Bilibili hook, auto-sync registry, bar, and settings deep link.
- Full `pnpm test`, `pnpm compile`, and `pnpm build`.
- Review every touched directory `CLAUDE.md` and processing queue contract for
  stale crawler or post-Fetch wording.
