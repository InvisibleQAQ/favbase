# Reorder App Sidebar Navigation

## Goal

Make Collections the first top-level item in the app.html sidebar and rename the Dashboard navigation label to Analytics.

## Confirmed Facts

- `app.html` is built from `entrypoints/app`; the top-level navigation source is `entrypoints/app/layouts/nav-config.tsx`.
- The analytics page keeps the existing `/` route and home icon.
- Sidebar labels use the shared `nav.dashboard` locale key in both supported locales.

## Requirements

- Put the existing Collections navigation branch before every other top-level sidebar item.
- Change the rendered `nav.dashboard` label from `Dashboard` to `Analytics` in both Chinese and English locales.
- Preserve all existing paths, icons, child navigation, preference ordering, active-state behavior, and external links.

## Acceptance Criteria

- `createNavData()` returns top-level paths beginning with `/collections`, then `/`.
- Translating `nav.dashboard` returns `Analytics` for both supported locales.
- Existing collection-platform navigation tests continue to pass.
- TypeScript compilation succeeds.

## Out of Scope

- Renaming the `nav.dashboard` locale key, dashboard route, component names, page title, or analytics implementation.
- Changing sidebar icons or collection child ordering.

## Open Questions

None.
