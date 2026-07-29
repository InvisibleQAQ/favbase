# app.html Sidebar Logo

## Goal

Replace the placeholder `F` tile in the upper-left app sidebar brand with the project's existing logo so the dashboard uses the same visual identity as the extension.

## Confirmed Facts

- The WXT `app.html` entrypoint is implemented under `entrypoints/app/`.
- The upper-left brand is rendered by `NavContent` in `entrypoints/app/layouts/dashboard/nav.tsx`.
- The current mark is a 36 x 36 primary-colored tile containing the letter `F`.
- The canonical project logo already exists at `public/icon/128.png` and is already referenced elsewhere in the app as `/icon/128.png`.
- Expanded/mobile navigation displays the adjacent `favbase` product name; collapsed desktop navigation displays only the mark.

## Requirements

- Replace only the placeholder `F` tile with the existing `/icon/128.png` logo.
- Keep the current 36 x 36 layout footprint and responsive pinned/unpinned behavior.
- Keep the adjacent `favbase` text and all navigation behavior unchanged.
- Treat the image as decorative because the adjacent product name or navigation context already identifies the app.
- Update `entrypoints/app/layouts/CLAUDE.md` to describe the sidebar brand logo.

## Acceptance Criteria

- The upper-left app sidebar renders `public/icon/128.png` instead of the letter `F` in expanded desktop, collapsed desktop, and mobile drawer variants.
- The brand row dimensions do not shift when the sidebar pin state changes.
- Existing navigation links, active states, collapse behavior, and sidebar pinning remain unchanged.
- Type checking and the focused dashboard navigation tests pass.

## Out of Scope

- Replacing other uses of the logo or changing extension icons.
- Removing or restyling the `favbase` wordmark.
- Changing sidebar dimensions, navigation behavior, theme colors, or routes.

## Open Questions

None. The user's original request and follow-up instruction to continue approve this narrowly scoped change.
