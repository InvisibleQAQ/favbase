# Implementation Plan

1. Extend `AutoTranscribeState` and the canonical initial state with `asrBlocked`.
2. Refactor `AutoTranscribePipeline.createSession()` queue waiting to park missing-ASR items, share one configuration watcher, wake on requeue, and keep the session open until parked work drains.
3. Update the Bilibili collection view to use the independent blocker signal and update the affected directory documentation.
4. Add focused regression tests to `lib/auto-transcribe/pipeline.test.ts` and adjust complete-state fixtures.
5. Run the focused Vitest suite, type-check, lint, and the repository verification command; inspect the final diff for scope and documentation consistency.

Risk points:

- Queue wake-up races between Fetch append/close and ASR configuration resolution.
- `remaining` and `currentIndex` must not advance when an item is parked.
- A watcher must not be started per blocked video.
- A session with only parked items must not report `done` before the key is configured.
