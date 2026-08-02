# Current Processing Configuration and Resume Evidence

## Sources

- `CONTEXT.md`
- `docs/17_architecture-cohesion-coupling-audit.md` HIGH-2
- `lib/collections/processing-coverage.ts`
- `lib/storage/resolve.ts`
- `lib/embedding/config.ts`
- `lib/embedding/indexing.ts`
- `lib/tagging/tagging-service.ts`
- `lib/auto-transcribe/pipeline.ts`
- `entrypoints/app/hooks/collection-processing-jobs.ts`
- `entrypoints/app/hooks/library-gate.ts`
- `entrypoints/app/components/collection/collection-page-scaffold.tsx`
- `entrypoints/app/sections/settings/settings-view.tsx`

## Confirmed Runtime Behavior

- ASR is optional until official subtitles fail. `configuration_required` is the only authoritative missing-ASR wait state, and its pipeline already watches settings and resumes.
- Embedding resolves `enabled` from the active provider key. A disabled batch backlog reports `0/0` and completes without scanning the DB.
- Tagging resolves the primary LLM config. A disabled item returns `skipped`; the current batch accepts only fresh item IDs and has no backlog scan.
- `ProcessingCoverage.embedding` and `.tagging` are durable platform-local read models. `total > done` is the evidence that eligible local work remains.
- `CollectionPageScaffold` owns the shared page order but deliberately has no i18n or platform settings knowledge.
- Settings supports only the ASR query deep link today.
- Before this task, `library-gate.ts` was the single owner of Collection platform to job namespace translation.

## Architecture Decision for This Task

Use three focused Modules:

1. A smart Collection configuration notice Module owns resolver-based blocker detection, translated copy, and settings links. Platform views pass coverage and the Bilibili ASR wait signal; the shared scaffold receives only a React slot.
2. A pure job-platform Module owns the exhaustive forward/reverse namespace translation. The platform-aware resume Module consumes it and exposes one Embed-or-Tags resume interface to Settings without importing the storage-backed gate.
3. The Tagging domain Module gains a platform backlog operation that owns untagged-item selection and serial retry. Settings never queries DB rows or loops items.

This improves locality without claiming durable queue semantics. The existing in-memory job store remains the live Pipeline Run adapter. `docs/17` HIGH-2 still requires a separate durable Processing Queue for page-close recovery.

## Post-Implementation Structure Check

- `collection-job-platform.ts` now owns generic Collection discriminator/job namespace translation with no storage, watcher, or job-gate side effects.
- `library-gate.ts` and `collection-processing-resume.ts` consume that pure Module. Importing recovery no longer registers the library gate merely to translate a string.

## Rejected Shapes

- Raw key checks in six platform views: duplicates provider precedence and can disagree with runtime resolvers.
- Inspecting the opaque pipeline React node inside the scaffold: makes presentation structure a data interface.
- Starting provider work directly from LLM/Embedding cards: leaks platform namespace, backlog selection, and lane collision knowledge into Settings UI.
- Resuming all six platforms after every save: creates surprising provider load and ignores the user's platform-local Configuration Blocker.
- Treating all missing ASR keys as blocked: falsely warns when official subtitles can complete content processing.
