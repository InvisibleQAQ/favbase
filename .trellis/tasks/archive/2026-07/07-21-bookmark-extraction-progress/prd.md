# Redesign Bookmark Extraction Progress

## Goal

Replace the bookmarks page's tiny spinner-and-caption extraction status with a polished, theme-native progress presentation that communicates determinate progress clearly without changing extraction behavior.

## What I already know

- The UI lives in `entrypoints/app/sections/bookmarks/bookmarks-view.tsx` directly below `SectionTitleBar`.
- `useBookmarkExtraction()` exposes `running`, `done`, and `total`; the worker survives route changes.
- MUI is the project UI system and theme tokens must support light and dark modes.
- English and Simplified Chinese already have `bookmarks.extracting` with `done` and `total` interpolation.
- A shared `SyncProgressBar` exists, but it is intentionally minimal and used for collection syncing; blindly changing it would affect unrelated platforms.

## Assumptions (temporary)

- This task changes only the bookmark extraction status UI, not worker behavior.
- A compact full-width status panel with icon, label, numeric percentage, and linear progress bar fits the current flat stacked collection layout.
- Progress should be indeterminate when `total <= 0`, avoiding invalid division and false `0%` certainty.

## Open Questions

- None.

## Requirements (evolving)

- Render only while extraction is running, preserving current behavior.
- Use project MUI theme tokens; no hard-coded light-only colors.
- Keep all user-visible strings behind the existing i18n layer.
- Preserve the current `done/total` information.
- Handle unknown/zero totals without invalid percentage math.
- Keep the change local unless inspection proves a genuinely reusable abstraction.
- Use a compact full-width status panel with a theme-tinted background and border, extraction icon, translated status text, right-aligned percentage, and a 6px linear progress bar.

## Acceptance Criteria (evolving)

- [ ] Running extraction shows a clear progress treatment below the title bar.
- [ ] Known totals render a clamped determinate percentage from `done/total`.
- [ ] Unknown or zero totals render an indeterminate bar.
- [ ] English and Chinese locales render without missing keys.
- [ ] The component remains legible in light and dark themes using theme palette channels/tokens.
- [ ] Existing extraction lifecycle and page content branches are unchanged.

## Definition of Done

- Relevant tests are added or updated where practical.
- Lint and type-check pass for the affected code.
- `entrypoints/app/sections/bookmarks/CLAUDE.md` is updated because the documented UI behavior changes.
- No unrelated shared component behavior is changed.

## Out of Scope

- Extraction cancellation, retry, pause, ETA, or per-item filename display.
- Changes to extraction/background-job state.
- Redesigning progress UI across all collection platforms.
- Completion animation, ETA, current bookmark title, and persistent success state.

## Decision (ADR-lite)

**Context**: The current 12px spinner and caption are too weak to communicate measurable background work. The shared collection sync bar is deliberately generic and changing it would broaden the blast radius.

**Decision**: Implement a bookmark-local compact status panel. Use a determinate bar and percentage when the total is known, and an indeterminate bar with no fabricated percentage when it is not.

**Consequences**: The bookmark page gains stronger visual feedback without changing extraction state or unrelated platforms. A small amount of local presentation code is preferred over prematurely widening the shared progress component API.

## Technical Notes

- Relevant files inspected: `bookmarks-view.tsx`, bookmarks `CLAUDE.md`, shared `sync-progress-bar.tsx`, English/Chinese locale files.
- Relevant specs: `.trellis/spec/frontend/ui-design-system.md`, `component-guidelines.md`, and `i18n-conventions.md`.
- Existing `SyncProgressBar` is a reuse candidate only if its API can support the richer bookmark treatment without changing existing callers; current evidence favors a bookmark-local presentation.
