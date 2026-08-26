# Minimal Dashboard v7.7.0 Reference UI Audit

## 1. Scope And Result

This document is the Phase 0 runtime and source audit for the Minimal Dashboard
reference used by Favbase. Evidence was captured on 2026-08-26 before any UI
adaptation work.

- **[REFERENCE_FACT]** Runtime: `http://localhost:8081/dashboard`.
- **[REFERENCE_FACT]** Source:
  `C:/Users/18368/Desktop/00_myCode/35_minimal/minimal-dashboard/minimal-dashboard v7.7.0/Vite.js (JavaScript，TypeScript)/minimal-vite-ts-main`.
- **[DECISION]** These screenshots document reference intent. They are not
  Favbase pixel-golden files and must never be used as such.
- **[DECISION]** Only the reference pages and states needed to establish layout,
  component, form, overlay, and state patterns were retained. Missing product
  equivalents were not invented.

Evidence labels in this document follow
`docs/22_ai-ui-reference-adaptation-best-practices.md` and
`docs/23_favbase-app-minimal-dashboard-v7-adaptation-plan-zh-CN.md`.

## 2. Capture Environment

| Field | Value |
| --- | --- |
| OS | Windows 10 `10.0.19045` |
| Browser | Google Chrome `149.0.7827.104` |
| Device scale | DPR `1` |
| Browser locale | `zh-CN` |
| Application locale | `en` |
| Reference version | Minimal `7.7.0` |
| Font | Public Sans Variable |
| Direction | LTR |
| Navigation | Vertical; responsive Drawer at narrow widths |
| Dashboard layout | Compact content width |
| Time zone | Asia/Taipei (`+08:00`) |
| Data | Reference repository mock data |

The accepted 1920 light capture was reproduced in a clean headless Chrome
profile with a 1920x1080 viewport, DPR 1, and a 5-second virtual-time budget.
The first attempt was rejected because its bitmap dimensions did not match its
name. A later motion-transition frame was also rejected. The retained file is
the settled frame after assets were cached.

## 3. Accepted Runtime Evidence

All capture times are 2026-08-26 in Asia/Taipei.

| Evidence | Route | Viewport | Theme | State | Capture time |
| --- | --- | ---: | --- | --- | --- |
| [Dashboard default](./ui-baseline/2026-08-26/reference/dashboard-default-light-1920x1080.png) | `/dashboard` | 1920x1080 | light | default, settled | 21:10:20 |
| [Dashboard dark](./ui-baseline/2026-08-26/reference/dashboard-default-dark-1920x1080.png) | `/dashboard` | 1920x1080 | dark | default, settled | 18:28:39 |
| [Dashboard 1440](./ui-baseline/2026-08-26/reference/dashboard-default-light-1440x900.png) | `/dashboard` | 1440x900 | light | default, desktop nav | 18:29:36 |
| [Dashboard 1024](./ui-baseline/2026-08-26/reference/dashboard-default-light-1024x768.png) | `/dashboard` | 1024x768 | light | default, Drawer trigger | 18:29:47 |
| [Dashboard 390](./ui-baseline/2026-08-26/reference/dashboard-default-light-390x844.png) | `/dashboard` | 390x844 | light | default, single-column reflow | 18:29:49 |
| [User cards](./ui-baseline/2026-08-26/reference/user-cards-default-light-1920x1080.png) | `/dashboard/user/cards` | 1920x1080 | light | grid default | 18:30:16 |
| [User card hover](./ui-baseline/2026-08-26/reference/user-cards-hover-light-1920x1080.png) | `/dashboard/user/cards` | 1920x1080 | light | hover | 18:32:32 |
| [User list](./ui-baseline/2026-08-26/reference/user-list-default-light-1920x1080.png) | `/dashboard/user/list` | 1920x1080 | light | table default | 18:32:36 |
| [Selected and focused row](./ui-baseline/2026-08-26/reference/user-list-selected-focus-light-1920x1080.png) | `/dashboard/user/list` | 1920x1080 | light | selected, focus-visible | 18:33:11 |
| [Delete dialog](./ui-baseline/2026-08-26/reference/user-list-delete-dialog-light-1920x1080.png) | `/dashboard/user/list` | 1920x1080 | light | modal open | 18:34:25 |
| [Row menu](./ui-baseline/2026-08-26/reference/user-list-row-menu-light-1920x1080.png) | `/dashboard/user/list` | 1920x1080 | light | menu open | 18:35:07 |
| [Filtered empty state](./ui-baseline/2026-08-26/reference/user-list-empty-filtered-light-1920x1080.png) | `/dashboard/user/list` | 1920x1080 | light | no matches | 18:35:14 |
| [Account form](./ui-baseline/2026-08-26/reference/account-general-form-light-1920x1080.png) | `/dashboard/user/account` | 1920x1080 | light | form default | 18:35:30 |
| [Settings Drawer](./ui-baseline/2026-08-26/reference/settings-drawer-open-dark-1920x1080.png) | `/dashboard` | 1920x1080 | dark | settings overlay open | 18:29:28 |
| [500 error](./ui-baseline/2026-08-26/reference/error-500-dark-1920x1080.png) | `/error/500` | 1920x1080 | dark | error | 18:28:35 |

The mock text, counts, carousel slide, and avatar records are fixture details,
not design contracts. The observable contract is the layout and component
state represented by each image.

## 4. Source Owners And Findings

| Concern | Source owner | Finding |
| --- | --- | --- |
| Dashboard route | `src/pages/dashboard/index.tsx` | Redirects the dashboard root to the app overview. |
| Dashboard composition | `src/sections/overview/app/view/overview-app-view.tsx` | Owns the hero, featured content, KPI cards, and charts visible in the default reference. |
| Dashboard shell variables | `src/layouts/dashboard/css-vars.ts` | Vertical nav 300px, mini nav 88px, horizontal nav 64px, content inline padding 40px, transition 120ms. |
| Core shell variables | `src/layouts/core/css-vars.ts` | Mobile Drawer 288px; header 64px mobile and 72px desktop; blur 8px. |
| Theme assembly | `src/theme/create-theme.ts` | Owns color schemes, typography, shape, shadows, and MUI component defaults. |
| Card defaults | `src/theme/core/components/card.tsx` | Card radius is two base units; CardHeader/CardContent use 24px spacing; card shadow comes from the theme. |
| Grid cards | `src/sections/user/view/user-cards-view.tsx` | Owns the repeated user-card grid composition. |
| Table states | `src/sections/user/view/user-list-view.tsx`, `src/sections/user/user-table-row.tsx` | Own filtering, selection, row menu, and delete-dialog state. |
| Form composition | `src/sections/account/account-general.tsx` | Owns account form grouping, labels, upload area, and actions. |
| Route constants | `src/routes/paths.ts` | Confirms `/dashboard/user/cards`, `/dashboard/user/list`, `/dashboard/user/account`, and `/error/500`. |

### 4.1 Layout

- **[REFERENCE_FACT]** The desktop shell is a stable header plus a vertical
  navigation rail; widths and header heights are centralized in layout CSS
  variables, not repeated page values.
- **[OBSERVATION]** At 1440px the vertical navigation remains present. At
  1024px it is replaced by a menu trigger. At 390px the content reflows into a
  single column without a horizontal page scrollbar.
- **[OBSERVATION]** Content uses consistent 40px desktop inline spacing and
  24px primary gaps. Large charts are allowed to span more columns than KPI
  cards.

### 4.2 Components And States

- **[REFERENCE_FACT]** Card radius, shadow, header padding, and content padding
  are theme-owned defaults. Page code may vary composition but should not
  restate those primitives.
- **[OBSERVATION]** Selection, hover, focus-visible, menu, dialog, filtered
  empty, form, and error states each have distinct visible hierarchy.
- **[OBSERVATION]** Overlays dim content without destroying shell context; form
  labels remain visible independently of placeholder text.
- **[DECISION]** Favbase may adapt spacing, hierarchy, state clarity, and owner
  boundaries. It must reject the reference's mock accounts, workspaces,
  notifications, green brand color, and unrelated product routes.

## 5. Reproduction

1. Start the reference from the source root and verify
   `http://localhost:8081/dashboard` returns HTTP 200.
2. Use Chrome 149, DPR 1, application locale `en`, LTR, vertical navigation,
   and the required theme.
3. Set the viewport to the dimensions in the evidence table. Wait for fonts,
   images, charts, and layout transitions to settle.
4. For list states, open `/dashboard/user/list`; select a row and move keyboard
   focus to its control, open the row overflow menu, choose Delete for the
   dialog, or enter a query with no matches for the empty state.
5. For the form, open `/dashboard/user/account`. For the settings overlay,
   open the gear control on `/dashboard`. For the error state, open
   `/error/500`.
6. Capture the page viewport only. Reject any bitmap whose actual dimensions,
   route, theme, or interaction state do not match its filename and metadata.

For the accepted 1920 default capture, the equivalent one-shot command is:

```powershell
$referenceProfile = Join-Path $env:TEMP 'minimal-phase0-reference'
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' `
  '--headless=new' '--disable-gpu' '--force-device-scale-factor=1' `
  '--window-size=1920,1080' '--virtual-time-budget=5000' `
  '--run-all-compositor-stages-before-draw' `
  "--user-data-dir=$referenceProfile" `
  '--screenshot=<absolute-output-path>' `
  'http://localhost:8081/dashboard'
```

## 6. Known Gaps

- **[UNKNOWN]** Motion start/end timing and reduced-motion behavior were not
  recorded as video; only settled screenshots are accepted.
- **[UNKNOWN]** Reference console and network logs were not retained with every
  screenshot. No claim of a warning-free runtime is made.
- **[UNKNOWN]** Loading, disabled, long-text, and missing-media states were not
  all isolated as deterministic stories. Phase 0 does not fabricate them.
- **[DECISION]** Additional Minimal pages are outside this baseline unless a
  later Favbase slice needs a specific source-backed pattern from them.

