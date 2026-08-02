# Technical Design

## Architecture and Ownership

### Configuration Blocker notice Module

Create a smart app Module outside `components/collection/`. Its interface accepts:

- `platform: CollectionPlatform`
- durable `ProcessingCoverage`
- `coverageStatus`
- optional authoritative `asrBlocked`

Its implementation subscribes to `useSettings`, resolves ASR/Embedding/LLM configuration through existing resolvers, derives actual Configuration Blockers, renders one compact MUI warning surface, and builds settings deep links carrying the source platform.

`CollectionPageScaffold` receives only an optional `configurationNotice: ReactNode` slot and places it immediately after Search. It retains zero provider knowledge and zero `t()` calls.

### Settings deep links and save orchestration

Expand the existing `section` query parser to all valid AI sections. Parse an optional Collection platform resume discriminator defensively.

Settings wraps only the LLM and Embedding save functions:

1. await the existing test-gated save;
2. on success, call the platform resume Module for Tags or Embed respectively;
3. on save failure, do not dispatch work.

ASR keeps its existing settings watch and retained-item resume behavior.

### Platform processing resume Module

Add a platform-aware app Module with one interface:

```ts
resumeCollectionProcessing(platform, capability): void
```

The implementation owns Collection platform to job namespace translation and delegates to the existing batch lane scheduler. Settings does not know job keys, DB queries, progress payloads, or collision semantics.

A pure `collection-job-platform.ts` Module owns the exhaustive Collection discriminator/job namespace translation shared by the resume and library-gate adapters. `collection-processing-jobs.ts` gains a backlog entry for one lane. Existing `startBatchLane` collision handling ensures a save arriving during an active lane schedules work after settlement instead of replacing the active Pipeline Run.

### Tagging backlog

Add `tagPlatformBacklog` to the Tagging domain Module. It:

1. resolves the LLM config and returns `0/0` without DB work if disabled;
2. queries deterministic platform-local Collection Item IDs that are downstream-eligible, `chunked|embedded`, and have no linked tag;
3. reuses `tagNewItems` for serial pacing, checkpoints, idempotency, progress, and failure isolation.

Share the downstream eligibility SQL fact with Processing Coverage so Bilibili invalid items are excluded consistently. Do not duplicate the `attr != 9` exception.

## Data Flow

```text
Collection ProcessingCoverage + provider resolvers
  -> Configuration Blocker notice
  -> /settings?section=<capability>&resume=<platform>
  -> existing test-before-save card
  -> save succeeds
  -> resumeCollectionProcessing(platform, capability)
  -> existing platform lane
  -> Embed backlog or Tagging backlog
  -> durable item events
  -> ProcessingCoverage refresh
```

## Compatibility

- Existing Collection routes and labels remain stable.
- The scaffold slot is optional, so omitted callers retain prior rendering.
- Existing platform authentication gates remain before the scaffold.
- Existing sync-time Embed/Tags dispatch keeps fresh-ID behavior.
- Paused library gates still own born-paused and resume semantics.
- No storage schema or migration is added.
- No dependency is added.

## Failure and Concurrency

- Coverage loading/error produces no warning, avoiding false blockers.
- Settings validation remains the credential-quality gate.
- Save failure prevents resume dispatch.
- Provider/DB failures retain existing lane failure behavior and remain visible in pipeline runtime state.
- One save dispatches one lane request. An active lane is not cancelled or replaced.
- This is page-runtime recovery only. Closing app.html still loses non-durable work identity; the durable Processing Queue remains separate architecture work.

## UI Direction

- Existing operational workspace, preserve mode.
- `DESIGN_VARIANCE: 2`, `MOTION_INTENSITY: 1`, `VISUAL_DENSITY: 7`.
- One outlined warning surface, not one banner per capability.
- Each blocker has concise text, pending count where durable, and one settings action.
- Responsive row stacking below `md`; no motion, glow, nested cards, or new palette.
- MUI theme colors, Iconify family, light/dark theme behavior, keyboard links, and non-wrapping action labels.

## Documentation

- `CONTEXT.md`: Configuration Blocker definition and relationship.
- Relevant directory `CLAUDE.md`: notice slot, resume Module, Tagging backlog, Settings deep-link/resume contract.
- No ADR: the choice is scoped, reversible, and follows existing app/runtime ownership rather than introducing a hard-to-reverse system decision.
