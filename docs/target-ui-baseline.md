# Favbase Target UI Baseline

## 1. Scope And Result

This document records the current Favbase `app.html` UI before Minimal v7
adaptation. The baseline uses the user's existing Chrome profile because the
extension's cookies, local database, and live collection data are not present
in a clean browser profile.

- **[TARGET_FACT]** Runtime:
  `chrome-extension://ifnlocdgkmdkkokbgddfpjjpngddkopk/app.html`.
- **[TARGET_FACT]** Dashboard means the read-only Collection Analytics route
  `/`; it is not a processing console and not the Minimal demo dashboard.
- **[DECISION]** The images below are current-state evidence. They are not
  stable visual-regression goldens because they contain live, changing user
  data.
- **[DECISION]** Important product routes were captured. No additional pages or
  fake states are required for Phase 0.

## 2. Capture Environment

| Field | Value |
| --- | --- |
| OS | Windows 10 `10.0.19045` |
| Browser | Google Chrome `149.0.7827.104` |
| Device scale | DPR `1` |
| Browser locale | `zh-CN` |
| Application locale | `en` |
| Direction | LTR |
| Profile | User's active Chrome profile with extension cookies and local data |
| Time zone | Asia/Taipei (`+08:00`) |
| Data | Live local Collection Items; non-deterministic |

Target capture used Windows UI Automation to verify the exact hash route and
page `Document` dimensions. `PrintWindow` captured only the named Chrome
window; the result was cropped using the page Document's coordinates relative
to the window buffer. The viewport had to report the requested dimensions for
three consecutive samples before a file was written. This avoids adjacent
windows, dialogs, and multi-monitor DPI coordinates leaking into screenshots.

Two earlier screen-copy images were rejected after they included VS Code and a
Windows dialog. Every accepted target image listed below was captured again
with the window-buffer method.

## 3. Accepted Runtime Evidence

All capture times are 2026-08-26 in Asia/Taipei.

| Evidence | Route | Viewport | Theme | Visible state | Capture time |
| --- | --- | ---: | --- | --- | --- |
| [Collection Analytics](./ui-baseline/2026-08-26/target/analytics-data-dark-1920x1080.png) | `#/` | 1920x1080 | dark | live data; 5,928 items, 4/6 platforms, 0% tag coverage | 20:20:40 |
| [All Collections](./ui-baseline/2026-08-26/target/collections-data-dark-1920x1080.png) | `#/collections` | 1920x1080 | dark | live data; 5,928 items; selected All filter; X items visible | 20:21:16 |
| [All Collections 1440](./ui-baseline/2026-08-26/target/collections-data-dark-1440x900.png) | `#/collections` | 1440x900 | dark | same live library; four-column grid | 20:35:19 |
| [All Collections 1024](./ui-baseline/2026-08-26/target/collections-data-dark-1024x768.png) | `#/collections` | 1024x768 | dark | same live library; wrapped filters; three-column grid | 20:35:31 |
| [All Collections light](./ui-baseline/2026-08-26/target/collections-data-light-1920x1080.png) | `#/collections` | 1920x1080 | light | live data during jobs; 3,867 items; Bilibili items visible | 20:05:14 |
| [Bilibili Favorites](./ui-baseline/2026-08-26/target/collections-bilibili-data-dark-1920x1080.png) | `#/collections/bilibili` | 1920x1080 | dark | live platform data | 20:29:21 |
| [Browser Bookmarks](./ui-baseline/2026-08-26/target/collections-bookmarks-data-dark-1920x1080.png) | `#/collections/bookmarks` | 1920x1080 | dark | live platform data | 20:30:06 |
| [Chat](./ui-baseline/2026-08-26/target/chat-default-dark-1920x1080.png) | `#/chat` | 1920x1080 | dark | default Chat view | 20:34:45 |
| [Settings](./ui-baseline/2026-08-26/target/settings-default-dark-1920x1080.png) | `#/settings` | 1920x1080 | dark | AI Config / LLM Service; masked API key; disabled actions | 20:09:10 |

The changing totals are expected: one or two background jobs were visibly
unfinished during capture. This is direct evidence that the live dataset is
not a deterministic fixture and that cross-theme screenshots cannot be pixel
compared.

## 4. Source Owners

| Concern | Owner |
| --- | --- |
| Hash routes and lazy pages | `entrypoints/app/main.tsx`, `entrypoints/app/collection-platform-pages.ts` |
| Navigation data and order | `entrypoints/app/layouts/nav-config.tsx`, `entrypoints/app/collection-platform-registry.ts` |
| Shell composition | `entrypoints/app/layouts/dashboard/layout.tsx`, `entrypoints/app/layouts/core/layout-section.tsx` |
| Shell variables | `entrypoints/app/layouts/dashboard/css-vars.ts`, `entrypoints/app/layouts/core/css-vars.ts` |
| Header actions and active jobs | `entrypoints/app/layouts/dashboard/header-actions.tsx`, `background-jobs-indicator.tsx` |
| Theme mode | `entrypoints/app/theme/theme-provider.tsx` |
| Static design values | `entrypoints/app/theme/theme-config.ts` |
| Theme assembly and MUI defaults | `entrypoints/app/theme/create-theme.ts`, `entrypoints/app/theme/core/components.tsx` |
| Aggregate collection | `entrypoints/app/sections/collections/collections-view.tsx`, `collection-item-card.tsx` |
| Shared collection structure | `entrypoints/app/components/collection/**` |
| Collection Analytics | `entrypoints/app/sections/overview/overview-view.tsx` |
| Bilibili | `entrypoints/app/sections/bilibili/bilibili-view.tsx` |
| Browser Bookmarks | `entrypoints/app/sections/bookmarks/bookmarks-view.tsx` |
| Chat | `entrypoints/app/sections/chat/chat-view.tsx` |
| Settings | `entrypoints/app/sections/settings/settings-view.tsx` |

## 5. Current Target Facts

### 5.1 Routing And Product Model

- **[TARGET_FACT]** `entrypoints/app/main.tsx` uses `createHashRouter` and owns
  `/`, `/collections`, platform collection routes, `/chat`, and `/settings`.
- **[TARGET_FACT]** The six platform leaves come from one
  `collectionPlatformRegistry`; the navigation does not maintain a copied
  second list.
- **[TARGET_FACT]** The `/` route is Collection Analytics backed by real local
  data. The runtime image shows Item Count, platform composition, tag coverage,
  Creator/Source rankings, and no operational controls.

### 5.2 Shell And Responsive Layout

- **[TARGET_FACT]** The pinned desktop nav is 280px, compact nav is 72px,
  mobile Drawer is 288px, desktop header is 72px, and mobile header is 64px.
- **[TARGET_FACT]** Desktop content inline padding is 40px through the existing
  dashboard CSS variable; smaller widths inherit MUI Container gutters.
- **[OBSERVATION]** The accepted 1440 and 1024 captures keep the pinned desktop
  sidebar. At 1024, filter chips wrap and the collection grid becomes three
  columns without visible page-level horizontal overflow.
- **[TARGET_FACT]** The active background-job reminder stays in the header
  across routes and correctly exposes that the capture data is changing.

### 5.3 Theme And Components

- **[TARGET_FACT]** Both light and dark schemes are assembled in
  `theme/create-theme.ts`; the persisted mode key is `favbase-color-mode` and
  the default mode is `system`.
- **[TARGET_FACT]** The current implementation uses coral primary, warm greys,
  DM Sans Variable + Barlow, `shape.borderRadius = 4`, and a 12px entry/dialog
  radius convention. These facts come from the implementation, not the stale
  Trellis UI values.
- **[OBSERVATION]** The aggregate collection uses shared search, platform
  filters, cards, pagination, tag editing, and loading/empty/error branches.
  Active navigation and selected chips use the coral selection language in
  both accepted themes.
- **[OBSERVATION]** Settings retains visible labels, a masked API key, disabled
  unavailable actions, secondary navigation, and a wide form region.

## 6. Reproduction

1. Open
   `chrome-extension://ifnlocdgkmdkkokbgddfpjjpngddkopk/app.html#/collections`
   in the existing Chrome profile that owns the extension data.
2. Record Chrome version, DPR, browser locale, application locale, theme, hash
   route, visible item count, and background-job count before capture.
3. Navigate using the app's own sidebar. Verify the address bar hash after each
   route change; wait for data and layout transitions to settle.
4. Set the page Document viewport to the requested size. Confirm the exact
   width and height three times at 400ms intervals.
5. Capture the Chrome window buffer, then crop the page Document using its
   coordinates relative to the window rectangle. Do not use a raw desktop
   screen rectangle in a multi-monitor/DPI environment.
6. Restore the original Chrome window bounds, route, and theme. Inspect every
   image for external windows, system dialogs, loading frames, and mismatched
   dimensions before accepting it.

Exact data values are not reproducible while jobs run. Reproduction means the
same route, viewport, theme, locale, component state, and layout behavior, not
the same Collection Item ordering or count.

## 7. Explicit Gaps

- **[UNKNOWN]** A real 390x844 target capture is unavailable from the user's
  desktop Chrome: Windows enforced an exact minimum page Document width of
  500px. No 500px image was renamed or cropped to pretend it was a 390px
  responsive viewport.
- **[UNKNOWN]** Target hover, focus-visible, menu/dialog, deterministic loading,
  empty, error, retry, long-text, and missing-media fixtures were not all
  isolated. The current production profile does not expose stable fixtures for
  those states, and Phase 0 does not fabricate them.
- **[UNKNOWN]** A zh-CN application-locale matrix was not captured; the accepted
  application locale is `en` even though the browser locale is `zh-CN`.
- **[UNKNOWN]** Extension console and network traces were not retained. No
  claim of a warning-free runtime is made; no visible fatal error overlay was
  observed in the accepted images.
- **[DECISION]** The accepted coverage is sufficient for Phase 0. Unimportant
  or nonexistent page equivalents are not blockers and are not added merely to
  mirror the reference product.
- **[DECISION]** Before committing, review target screenshots for real user
  metadata. They intentionally use live data and are not anonymized fixtures.

