# Collection Provider Configuration Warning

## Goal

Prevent Collection pages from appearing stalled when local processing cannot continue because the active ASR, Embedding, or LLM provider is not configured. Show an actionable warning directly below the shared search field and deep-link each missing capability to its Settings section.

## User Value

Users can distinguish a configuration blocker from slow processing, reach the exact configuration card, and understand which local Collection processing stage is waiting.

## Confirmed Facts

- All platform Collection pages render through `CollectionPageScaffold`; the canonical visible order currently places platform operations directly after search.
- `ProcessingCoverage` is the durable, platform-scoped source for completed and eligible Embed/Tags counts.
- An Embed or Tags configuration blocker is real only when coverage is ready, `total > done`, and the corresponding resolved provider config is disabled.
- Missing ASR alone is not a blocker because official subtitles can satisfy transcription without ASR. The existing auto-transcribe state `configuration_required` is the authoritative blocker signal after official subtitles fail.
- Provider configuration must reuse `resolveAsrConfig`, `resolveEmbeddingConfig`, and `resolveLlmConfig`; UI code must not inspect raw settings fields independently.
- Settings currently deep-links only ASR through `/settings?section=asr`. The same query contract must support `llm` and `embedding`.
- ASR waits for settings changes and resumes automatically. Embed currently completes a disabled backlog run as `0/0`; Tags returns `skipped` for disabled configuration. Neither automatically replays old pending work after configuration.
- Collection shared components contain no platform literals and no direct `t()` calls. New warning copy must stay outside that boundary or enter through a pre-translated slot.

## Requirements

- Render configuration guidance immediately below the Collection search field.
- Show guidance only for actual platform-local blockers, never merely because a key is absent.
- Support ASR, Embedding, and LLM/Tagging blockers independently and concurrently.
- Give every displayed blocker its own route to the matching AI Settings section.
- React to settings changes without a page reload.
- After a valid Embedding or LLM configuration is saved, automatically resume the current platform's unfinished Embed/Tags backlog without requiring a new remote sync.
- Do not create duplicate platform lanes when a save event arrives while the same backlog lane is already running; existing queue collision semantics remain authoritative.
- Preserve existing platform authentication/configuration gates, search behavior, pipeline controls, coverage semantics, route structure, dark mode, narrow layouts, and keyboard accessibility.
- Use existing MUI and Iconify conventions. Add no animation or frontend dependency.
- Provide Chinese and English copy.
- Update affected directory `CLAUDE.md` files without duplicating implementation details.

## Acceptance Criteria

- With ready coverage and incomplete embeddable items, no Embedding key shows an Embedding configuration action; a configured resolver hides it.
- With ready coverage and incomplete taggable items, no LLM key shows a Tagging/LLM configuration action; a configured resolver hides it.
- Bilibili shows the ASR action only while auto-transcribe is in `configuration_required`; a merely empty ASR key does not trigger it.
- Multiple simultaneous blockers remain understandable on desktop and narrow screens without duplicate alerts.
- Actions navigate to `/settings?section=asr`, `/settings?section=embedding`, and `/settings?section=llm`, and Settings selects the requested card.
- Loading or failed coverage does not produce a false Embed/Tags blocker.
- Existing Collection scaffold ordering tests, settings deep-link tests, locale type checks, and project verification pass.
- Saving Embedding configuration drains persisted `chunked` items for the visible platform; saving LLM configuration retries untagged eligible items for the visible platform.
- A configuration save while a lane is active leaves the active run intact and schedules at most one follow-up run after it settles.

## Out Of Scope

- Credential validation before the user reaches Settings; Settings retains its test-before-save protocol.
- Provider failure states such as invalid keys, quota exhaustion, rate limits, or network errors.
- Dashboard, Chat, content-script, and onboarding warnings.
- A new processing dashboard or per-stage control surface.
- Durable recovery after the app page closes. That belongs to the planned durable Processing Queue; this task resumes work within the current app-page runtime.

## Resolved Scope Decision

- Include automatic resume/replay of pending Embed and Tags work after the corresponding configuration is saved. The warning-only approach was rejected because it would hide the explanation while leaving the historical backlog untouched.
