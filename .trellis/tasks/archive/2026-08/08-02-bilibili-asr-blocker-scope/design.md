# Technical Design

## Architecture

Keep the behavior in the platform-independent `AutoTranscribePipeline`; the Bilibili adapter already reports the authoritative distinction between official subtitles and ASR fallback through `ASR_INVALID_KEY`.

- Add `asrBlocked: boolean` to `AutoTranscribeState`. It describes whether the session has parked one or more videos because ASR is not configured; it is independent from `phase` and `currentVideoId`.
- Inside `createSession`, keep a private `blockedAsr` list alongside the producer queue.
- On `ASR_INVALID_KEY` with no configured key, move the current item to `blockedAsr`, leave `stats.remaining` unchanged, set the blocker signal, and continue the loop.
- Start one `waitForAsrKey()` promise per session. On resolution, prepend all parked items to the queue, clear `asrBlocked`, wake the runner, and let the existing checkpoint and transcription retry path process them.
- `waitForItem()` remains open after producer close while parked items exist, so a Fetch-complete session cannot finish before configuration-dependent work drains.
- Preserve the existing `configuration_required` phase when no other item is available. When another item is available, the next claim sets the normal `transcribing` phase while `asrBlocked` remains true.

## UI Data Flow

`bilibili-view.tsx` passes `autoTranscribe.state.asrBlocked` to `CollectionConfigurationNotice`. The existing phase-based operation suppression remains valid for a session with only blocked work; when later items are active, phase is `transcribing`, so the progress panel remains visible. The shared notice stays provider-agnostic.

## Compatibility

- `AutoTranscribeAdapter` methods and the Bilibili transcription handler do not change.
- Existing ordinary failure, quota, rate-limit, checkpoint, dedupe, and progress statistics semantics stay intact.
- The new state field is initialized in the pipeline's canonical initial state; test fixtures that construct a full state add the field.
- No storage schema, migration, dependency, or durable queue behavior is introduced.

## Failure and Concurrency

- A session creates at most one ASR watcher while parked items exist; multiple missing-key responses share it.
- A configured but invalid key still follows the existing ordinary `ASR_INVALID_KEY` failure path because `hasAsrKey()` is true.
- A watcher rejection wakes the runner and is surfaced through the existing pipeline error handling rather than silently completing.
- Parked items are requeued before newly appended items so the original producer order is restored when configuration becomes available.

## Verification

Unit tests cover the single blocked item compatibility path, blocked item followed by an official-subtitle success, multiple blocked items with one watcher, retry after configuration, and completion after parked work drains. Run the focused auto-transcribe tests, then the project type-check/lint/test commands.
