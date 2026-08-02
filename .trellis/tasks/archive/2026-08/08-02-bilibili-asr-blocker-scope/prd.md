# Bilibili ASR blocker scope

## Goal

Prevent one Bilibili video that needs ASR from stopping transcription for later videos that have usable official subtitles. Videos that genuinely need ASR remain pending and resume after ASR configuration is available.

## User Value

With no ASR key configured, Bilibili collection processing continues for videos that can finish through official subtitles. The UI still identifies that ASR-dependent videos are waiting and does not claim that every video is blocked.

## Confirmed Facts

- `AutoTranscribePipeline` processes one shared Bilibili session serially.
- `runTranscriptionPipeline` checks the cache, then official subtitles, and only returns `ASR_INVALID_KEY` when no official subtitles are available and ASR configuration is empty.
- On `ASR_INVALID_KEY` with no key, `AutoTranscribePipeline` currently awaits `waitForAsrKey()` before claiming any later queue item; this is the root cause of the platform-wide stall.
- `CollectionConfigurationNotice` receives `autoTranscribe.state.phase === 'configuration_required'` as a platform-level `asrBlocked` signal. That signal currently represents only the item being awaited, not all Bilibili videos.
- Existing behavior must retain the blocked item and retry it automatically after the settings watcher observes a usable ASR key.
- Existing ordinary failures, quota pauses, rate-limit pauses, library-gate checkpoints, and post-transcription Embed/Tags dispatch must remain unchanged.

## Requirements

- When a video returns `ASR_INVALID_KEY` and no ASR key is configured, park that video as ASR-blocked instead of awaiting it inline.
- Continue draining later queued videos, including videos resolved successfully through official subtitles.
- Keep each parked video counted as remaining work; do not mark it as skipped or as an ordinary error.
- Start at most one ASR configuration watcher for the session. When configuration becomes available, requeue all parked videos and retry them through the existing transcription path.
- Keep the session alive while parked videos exist, including after Fetch closes the producer.
- Expose an explicit ASR-blocked signal independent from the active phase/current video so the Collection warning remains truthful while other videos continue.
- Do not hide the normal transcription progress panel while another video is actively being processed.
- Preserve the current auto-resume behavior for a session containing only ASR-blocked work.
- Add regression tests covering: blocked item followed by official-subtitle success, multiple blocked items with one watcher, retry after configuration, and session completion only after parked work drains.
- Update affected `CLAUDE.md` files and task documentation without duplicating implementation details.

## Acceptance Criteria

- Given `[needs-ASR, has-official-subtitles]` and no ASR key, the second video is transcribed before configuration changes; the first remains pending.
- Given multiple ASR-dependent videos and no key, `waitForAsrKey` is called once, all remain pending, and all retry after one configuration event.
- After all parked videos retry successfully, `remaining` reaches zero and the session ends with `done`.
- The Collection configuration notice is visible whenever at least one parked ASR item exists, even if the current phase is processing another video.
- The normal operation/progress panel remains visible while non-blocked videos are being processed.
- Existing auto-transcribe pipeline tests and the full project verification pass.

## Out Of Scope

- Changing official-subtitle discovery or Bilibili API behavior.
- Treating invalid configured credentials, quota exhaustion, rate limits, or network failures as missing configuration.
- Persisting parked ASR work across app-page shutdown; durable queue recovery remains a separate concern.

## Open Questions

- None. The requested behavior and existing retry contract define the required scope.
