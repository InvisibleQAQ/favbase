# Implementation Plan

## Ordered Work

1. Add failing pure/UI tests for Configuration Blocker derivation, combined rendering, routes, and scaffold placement.
2. Add failing Settings tests for all AI deep links and successful-save resume dispatch.
3. Add failing Tagging backlog tests for eligibility, platform isolation, disabled config, serial progress, and idempotent rerun.
4. Add failing processing-resume/lane tests for namespace translation and active-lane follow-up.
5. Implement the shared downstream eligibility fact and Tagging backlog.
6. Implement the platform processing resume Module and Settings save wrappers.
7. Implement the smart warning Module, scaffold slot, six platform adapters, and Bilibili ASR handoff without duplicate warning.
8. Add Chinese/English copy and update affected `CLAUDE.md` files.
9. Run focused tests after each green step, then formatting/type-check/build/full relevant tests.
10. Run Trellis check, design pre-flight, architecture re-check, and inspect `git diff`.

## Validation Commands

```powershell
pnpm.cmd test -- <focused test files>
pnpm.cmd test
pnpm.cmd compile
pnpm.cmd build
```

Use the repository's actual scripts from `package.json`; adjust command names only when inspection proves they differ.

## Risk and Rollback Points

- Query correctness in the new Tagging backlog is the primary data/behavior risk. Keep it read-only until each existing idempotent tag operation runs.
- Settings must resume only after persistence resolves; never trigger from draft/test state.
- Do not widen `CollectionPageScaffold` with settings data; only add the optional slot.
- If the combined notice causes adapter churn, retain the smart Module and slot rather than duplicating resolver logic in views.
- If lane collision tests expose duplicate follow-ups, deepen the scheduler at its `startBatchLane` interface instead of adding Settings-side guards.
