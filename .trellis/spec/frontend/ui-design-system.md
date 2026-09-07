# App UI Design System

> Executable frontend contract for Favbase `app.html`. Visual rationale, the
> adaptation matrix and the reference evidence live in
> `docs/25_app-ui-minimal-alignment-manual-2026-09-01.md` (Step 0-10, the
> current route). `docs/23_favbase-app-minimal-dashboard-v7-adaptation-plan-zh-CN.md`
> is the first round and is history only — docs/25 section 3.1 overturned most
> of its conclusions. There is no root `DESIGN.md`; earlier revisions of this
> line and of `entrypoints/app/index.html` pointed at one that was never
> written (docs/25 appendix D-1).

## 1. Scope

This specification applies to the React/MUI app under `entrypoints/app/**`.
It does not apply to WXT content-script Shadow DOM interfaces.

The system adapts the Minimal Dashboard v7 operational skeleton to Favbase's
own content, routes, product language and states. It is not a copy of the
reference product's business model or palette.

## 2. Source Owners

| Concern | Owner |
| --- | --- |
| Static colors, fonts, schemes | `entrypoints/app/theme/theme-config.ts` |
| Semantic palette roles | `entrypoints/app/theme/core/palette.ts` |
| Typography variants | `entrypoints/app/theme/core/typography.ts` |
| Elevation | `entrypoints/app/theme/core/shadows.ts`, `custom-shadows.ts` |
| MUI defaults | `entrypoints/app/theme/core/components.tsx` |
| Theme creation | `entrypoints/app/theme/create-theme.ts` |
| Shell variables | `entrypoints/app/layouts/core/css-vars.ts`, `dashboard/css-vars.ts` |
| Shared item card | `entrypoints/app/components/collection/collection-card.tsx` |
| Chart primitives | `entrypoints/app/components/chart/` |
| Shared collection page | `entrypoints/app/components/collection/collection-page-scaffold.tsx` |

Do not restate global tokens in page components. Change the owner and let
consumers inherit it.

## 3. Technology Contract

- React 19.
- MUI 9 CSS-variable theme (`@mui/material` 9.x; manifest `minimum_chrome_version` 117 is
  MUI 9's browser floor).
- No system props on `Box`/`Stack`/`Typography`/`Grid`/`Link`: layout and color go through
  `sx`. `Typography color="text.secondary"` type-checks in v9 but applies no style — use
  `sx={{ color: 'text.secondary' }}`.
- Emotion through MUI only.
- `minimal-shared` for `varAlpha`, palette channels and font helpers.
- Iconify through the existing offline registry.
- Hash routing only. Chrome extension pages must not use browser path routing.

Do not add a second component system.

### Heavyweight UI vendors

A package that ships its own DOM layer or stylesheet (`simplebar-react`,
`sonner`) gets exactly one owner directory under `entrypoints/app/components/`.
Callers import the owner's barrel, never the package. `lib/**` and
`entrypoints/app/hooks/**` never see either name.

The guard is one shared table — `VENDOR_RULES` in
`tests/ui-vendor-boundaries.test.ts` — not one guard file per package. Adding a
vendor is one row. Two files enforcing one rule is the rule rotting in one of
them. Each row is asserted in both directions: no importer outside the owner,
and at least one importer inside it, so a rule guarding a package nobody uses
cannot silently stop meaning anything.

The owner barrel re-exports only what callers need. `components/snackbar/`
exports `toast` but deliberately not `Toaster`: a second, unskinned region
would silently swallow half the app's toasts.

## 4. Palette

### Static values

Favbase keeps its coral brand hue and uses the Minimal v7 neutral ramp:

~~~text
primary.lighter      #FEE9E1
primary.light        #FDA48A
primary.main         #FC7E5B
primary.dark         #C4502E
primary.darker       #7A2714
primary.contrastText #1F1B17

grey.50            #FCFDFD
grey.100           #F9FAFB
grey.200           #F4F6F8
grey.300           #DFE3E8
grey.400           #C4CDD5
grey.500           #919EAB
grey.600           #637381
grey.700           #454F5B
grey.800           #1C252E
grey.900           #141A21
~~~

`primary` is **one ramp shared by both schemes** (docs/25 Step 2): the dark
scheme's old `primary.lighter #3A2A24` re-ink is gone, because a per-scheme
constant cannot follow a preset. The appearance drawer's six primary presets
(`theme/with-settings/color-presets.ts`) replace the whole ramp, and two values
are derived from whatever `main`/`darker`/`light` the preset brings:
`contrastText` by `pickContrastText` (ink `#1F1B17` or white, whichever clears
WCAG on `main` — docs/25 D14) and `text.accent` by `accentTextFor` (light
`primary.darker`, dark `primary.light`). Never hard-code a brand shade that a
preset is supposed to move; wash with
`varAlpha(theme.vars.palette.primary.mainChannel, 0.08 / 0.16)` and ink with
`text.accent`.

### Semantic roles

Component code uses semantic variables:

~~~tsx
color: theme.vars.palette.text.primary
color: theme.vars.palette.text.secondary
color: theme.vars.palette.text.accent
bgcolor: theme.vars.palette.background.default
bgcolor: theme.vars.palette.background.paper
bgcolor: theme.vars.palette.background.neutral
borderColor: theme.vars.palette.divider
~~~

The app canvas is exact and scheme-specific:

~~~text
background.default (light)  #FFFFFF
background.default (dark)   #141A21
~~~

One setting moves it: the appearance drawer's high-contrast option repaints the
**light** canvas with `grey.200` (`#F4F6F8`) and swaps `customShadows.card` for
`z1` (`with-settings/update-core.ts`); the dark canvas is unchanged. Read the
canvas through `background.default`, never through a literal.

Forbidden in component code:

~~~tsx
color: '#1C252E'
bgcolor: '#FFFFFF'
bgcolor: 'grey.100'
backgroundColor: 'rgba(0,0,0,.08)'
~~~

Use `varAlpha(theme.vars.palette.<channel>, alpha)` for transparency.

### Dark mode

`colorSchemes.light` and `colorSchemes.dark` are both mandatory. Dark mode
is not optional just because the free reference is light-only.

- Default: `#141A21`
- Paper: `#1C252E`
- Neutral: `#222B34` (quieter than Minimal's `#28323D`, which drops the dark
  youtube tile to 2.95:1 — docs/25 C-2)
- Text primary: `#FFFFFF`
- Text secondary: `#919EAB` (grey 500; disabled is grey 600 `#637381`)
- Link/action text: `#FDA48A` — that is `text.accent`, i.e. the *preset's*
  `primary.light`, not a constant

The ink values are Minimal's dark ramp (white / grey 500 / grey 600, docs/25
D12). Earlier revisions of this list carried the docs/23 values `#F4F6F8` /
`#C4CDD5`, which the theme has never set (corrected 2026-09-04, docs/25
Step 10); `theme-config.ts` `scheme.dark` is the only owner.

Every app UI change is checked in both schemes.

### Platform identity

`theme.vars.palette.platform[platform]` is the only platform-color source.

- Allowed: platform glyph and platform-owned data graphic.
- Forbidden: body text, panel background, selected navigation, focus ring.
- GitHub and X resolve to current-scheme text ink in the palette owner.
- All six keys remain explicit in `PLATFORM_PALETTE_LIGHT/DARK` so the
  completeness AST test can read them.

Brand-colored platforms must retain at least 3:1 contrast on
`background.default` and `background.neutral`.

## 5. Typography

DM Sans Variable is the UI family. Barlow is the display family.

| Variant | Contract |
| --- | --- |
| h1 | Barlow 700, 28px |
| h2 | Barlow 700, 24px |
| h3 | Barlow 600, 20px |
| h4 | DM Sans 600, 16px |
| h5 | DM Sans 600, 14px |
| h6 | DM Sans 600, 14px |
| subtitle1 | DM Sans 600, 16px |
| subtitle2 | DM Sans 600, 14px |
| body1 | DM Sans 400, 16px |
| body2 | DM Sans 400, 14px |
| caption | DM Sans 400, 12px |
| button | DM Sans 600, 14px |

Rules:

- No viewport-fluid type.
- No component-local font family.
- No body text below 12px.
- Dynamic numbers use tabular numerals.
- Each route has one semantic `h1`.
- MUI subtitle variants map to `p` so item titles are not false headings.
- All variants use zero letter spacing; sizes do not scale with the viewport.

## 6. Shape And Elevation

`theme.shape.borderRadius = 8` is the base. Page code grades **down** from it
with a numeric `sx` unit; every step **up** is derived by the theme owner and is
not written in a page (docs/25 Step 1, section 3.1 — docs/23's "8px everywhere"
is overturned):

Page-local units:

- `0.5` unit (4px): embedded media, progress and compact marks.
- `0.75` unit (6px): compact rows and tooltips.
- `1` unit (8px): buttons, fields and panels.
- `2` units (16px): only to match an adjacent Card.
- `50%`: circular or naturally pill-shaped controls only.

Theme-derived surfaces (`core/components/`, do not restate):

| Surface | Radius | Source |
| --- | --- | --- |
| Card, Dialog paper, Skeleton `rounded` | 16px | base x2 |
| Popover / Menu / Autocomplete paper | 10px | base x1.25, `mixins.paperStyles(dropdown)` |
| Avatar `rounded` | 12px | base x1.5 |
| Tooltip, MenuItem | 6px | base x0.75 |
| Chip | 8px small / 10px medium | literal in `chip.tsx`, not base-derived |

Elevation: **both schemes cast a real shadow.** `customShadows.card` is never
`'none'` — light casts the grey 500 channel, dark casts the black channel
(`core/custom-shadows.ts`). docs/23's dark "divider hairline plus `card: 'none'`"
is overturned (docs/25 Step 1); a dark Card that only has a hairline reads as a
flat region, not a card. Floating overlays use `dropdown` or `dialog`.
Clickable cards may raise to `z16` on hover. `MuiCard` reads its radius and
shadow through `var(--card-radius, ...)` / `var(--card-shadow, ...)`, so a
single card can be flattened by setting those two variables on it instead of
re-declaring the surface.

Never combine a full Card border with a broad Card shadow. Never put a Card
inside another Card.

## 7. MUI Defaults

`theme/core/components/` owns one file per MUI family (`index.ts` spreads
them). Values below are the resolved contract after docs/25 Step 1. Most of
them are locked in `theme/theme-contract.test.ts` — but not all: that test
reads Card/CardHeader/CardContent, Button, Chip, Dialog(+Title/Content/
Actions), Drawer, the four input families, InputLabel, List, Menu/MenuItem,
Paper, Popover, Skeleton, Stack, TextField, Tooltip and Typography, and
**does not** assert `MuiTabs`/`MuiTab`, `MuiAvatar` or `MuiTableCell`
(corrected 2026-09-04; the earlier "every one of them is locked" was false).
Treat the three unasserted families as source-of-truth-by-reading until
someone adds the rows:

- `MuiCard`: 16px radius and a real `customShadows.card` in **both** schemes,
  each behind a CSS-var hook (`--card-radius` / `--card-shadow`); no border, no
  background image.
- `MuiCardHeader`: `spacing(3, 3, 0)`; `slotProps.title` is `h6`,
  `slotProps.subheader` is `body2` with `mt: 0.5`.
- `MuiCardContent`: 24px padding.
- `MuiButton`: `color="inherit"` and `disableElevation` by default; four size
  variants with minimum heights 30 / 36 / 48 / 56 (`small` / `medium` /
  `large` / `xLarge`). `contained inherit` inverts the scheme; `outlined` and
  `text` primary ink is `text.accent`.
- `MuiInputBase`, `MuiInput`, `MuiFilledInput`, `MuiOutlinedInput`: single-line
  height is **derived**, not declared — a 24px line box plus `INPUT_PADDING`,
  giving outlined 56px medium / 40px small and base 32 / 28 (docs/25 D11,
  which overturned docs/23's 48/40). The theme sets no `minHeight`; label
  offsets come out of the same padding table; multiline stays content-driven.
- `MuiTextField`: outlined variant by default.
- `MuiTabs`: `variant="scrollable"`, `textColor="inherit"`,
  `indicatorColor="inherit"` (so the indicator is `currentColor` ink, not
  `primary.main`), `allowScrollButtonsMobile`. `MuiTab`: `disableRipple`,
  `iconPosition="start"`, `minWidth: 48`, `text.secondary` at rest, semibold
  when selected. MUI's own 48px minimum height is **left alone** — the theme
  does not restate it. `indicatorColor="custom"` selects the segmented-pill
  form (52px rows on a `background.neutral` track, indicator drawn as a z1
  pill); no app surface uses it today.
- `MuiOutlinedInput`: `shared.inputOutlined` hairline, `text.primary` when
  focused.
- `MuiSkeleton`: `animation="wave"` and `variant="rounded"` by default; the
  `rounded` placeholder is 16px on a `grey.400Channel` 0.12 fill.
- `MuiTableCell.head`: neutral surface, 14px semibold secondary text.
- `MuiPaper`: `elevation: 0` by default and `backgroundImage: 'none'`. A border
  belongs to `variant="outlined"` only (`shared.paperOutlined`); the root
  itself is edgeless.
- `MuiPopover`: `mixins.paperStyles(dropdown)` — 10px radius, dropdown shadow,
  `spacing(0.5)` paper inset, blurred 90% paper.
- `MuiDialog`: `fullWidth` + `maxWidth="sm"` defaults, dialog shadow, 16px
  radius, 16px viewport gutters.
- `MuiChip`: `variant="soft"` by default, with its own `deleteIcon`; radius 8px
  small / 10px medium.
- `MuiTooltip`: scheme-aware inverse surface, 6px radius, `arrow`, 400ms enter
  delay.
- `MuiTypography`: `variantMapping` maps `subtitle1` / `subtitle2` to `p`.
- `MuiStack`: `useFlexGap`.
- `MuiCssBaseline`: tabular figures, themed scrollbar, selection, caret and
  focus-visible ring.

Do not duplicate these rules in local `sx`.

## 8. Shell

Shell CSS-variable contract (`layouts/`; nav row geometry is owned by the nav,
see below):

~~~text
--layout-nav-vertical-width      300px vertical / 88px mini (ONE toggling variable)
--layout-nav-mobile-width        288px
--layout-header-desktop-height   72px
--layout-header-mobile-height    64px
--layout-header-blur             8px (scrolled only)
--layout-dashboard-content-pt    8px
--layout-dashboard-content-px    40px (lg+; 24px sm-md, 16px xs from Container)
--layout-dashboard-content-pb    64px
--layout-transition-duration     120ms
~~~

Nav geometry belongs to `components/nav-section/styles/css-vars.ts` (the ported
Minimal nav owns it; the retired `--layout-nav-item-height` /
`-child-item-height` / `-compact-item-size` must not come back):

~~~text
--nav-item-root-height   44px vertical / 56px mini
--nav-item-sub-height    36px vertical / 34px mini
--nav-icon-size          24px vertical / 22px mini
--nav-item-radius        8px base radius
--nav-bullet-size        12px
--nav-bullet-color       palette.divider
~~~

Variables are set on `:root` so `html { scroll-padding-top }` can follow the
Header height. The document is the only page scroll owner; the fixed rail
scrolls its own list (`Scrollbar` when vertical, a `hideScrollY` column when
mini, because a flyout must not be clipped). The Header container uses the same
content gutter from `DASHBOARD_CONTENT_QUERY` (`lg`).
`layouts/dashboard/css-vars.test.ts` locks the shell values and asserts the
retired names stay gone; `components/nav-section/css-vars.test.ts` locks the
nav values. Primary Grid spacing is 3 theme units (24px).

Three nav shapes: vertical rail (300px, titles + two group subheaders), mini
rail (88px, icon tiles whose children open a flyout on hover or `ArrowRight`),
mobile temporary Drawer (288px, always the vertical shape).
`sidebarPinnedStorage` maps to vertical/mini — key, default and watcher
unchanged.

Header right side, in order: background-job indicator, `ThemeModeButton`,
`LanguagePopover`, `SettingsButton` (appearance drawer), `GithubButton`. All
four buttons are `IconButton`s of the same size — no interactive control of a
different species sits in that row; the indicator is a status Chip and is the
element that yields width first at 390px. The desktop collapse control is **not** in the Header:
`NavToggleButton` is fixed to the rail's right edge and tracks
`--layout-nav-vertical-width` with the same easing.

Color mode is split on purpose (2026-09-05): the two-state button in the Header
writes only explicit `light` / `dark`, and `system` — `ThemeProvider`'s default —
stays reachable only from the drawer's three-way Mode block. A two-state control
cannot express a third state, and burying a high-frequency action two levels deep
was the worse trade. Touching the button therefore leaves `system` for good until
the drawer is opened, and the gear's dot lights up because `canReset` counts
"mode is not system"; both are intended, not defects. The button shows the
*target* mode (`custom:moon-color` on light, `custom:sun-color` on dark) and its
Tooltip/`aria-label` say what the click does; it is shared with the welcome top
bar as a leaf module — nothing from `components/settings`, so importing it does
not drag the provider layer into welcome's bundle.

Preserve:

- sidebar pin storage and watcher
- mobile Drawer, closed on pathname change; focus returns to the menu button
  through the Temporary Drawer exit-focus contract (section 12)
- Header background-job indicator, always mounted
- language control in the Header; light/dark button in the Header, `system` only in the appearance drawer
- route-derived navigation
- per-row active resolution (`isNavItemActive`: segment-boundary match plus
  `deepMatch` so a detail route stays on its platform leaf)
- icon-only Header/nav controls carry a translated `aria-label` and Tooltip

Navigation active state — one treatment at every depth:

~~~tsx
{
  color: 'var(--nav-item-root-active-color)',          // text.accent, WCAG-safe per preset
  backgroundColor: 'var(--nav-item-root-active-bg)',   // varAlpha(primary.mainChannel, 0.08)
  '&:hover': { backgroundColor: 'var(--nav-item-root-active-hover-bg)' }, // 0.16
}
~~~

`primary.main` is never nav text (2.5:1 on paper). Platform identity color is
allowed only on an **inactive** platform leaf's icon glyph; the active row's
accent ink wins.

Tree connectors: a 12px masked bullet per sub row plus a 2px spine drawn by
`NavCollapse`, both `palette.divider`; the spine stops half a bullet short of
the last row so the run closes as an L-corner.

Link and disclosure actions remain sibling controls: a row with children is an
`<a>` plus its own `aria-expanded` disclosure button, never one control that
means both.

## 9. Shared Collection Components

### CollectionPageScaffold

The scaffold remains the sole owner of:

1. page heading
2. pipeline and library gate
3. sync failure
4. search
5. configuration notice
6. platform operation
7. primary category
8. tag filters
9. secondary category
10. content phase

Do not move platform-specific data into the scaffold. Do not copy its phase
ladder into a platform page.

The only heading-owner exception is a platform-specific configuration gate
that returns before the scaffold (currently GitHub token and YouTube API
configuration). It must still render the same `SectionTitleBar` inside
`DashboardContent` before its platform `StateBox`; the gate page has exactly
one `h1`, and the state title remains a paragraph. Do not omit the route title
just because search, sync and the content phase are unavailable. Lock every
new pre-scaffold gate with the same assertion as
`sections/configuration-heading.test.tsx`.

`SectionTitleBar` renders the route's single `h1` (the `h1` variant: Barlow
700, 28px), optional secondary copy (`body2`, `text.secondary`) stacked below
it, and one medium contained action on the right. It owns the 24px bottom
margin; the rows under it (pipeline, banner, search, chip rows) all end with
the same 24px so the control stack reads as one rhythm. The sync three-state
(idle / syncing / hard-disabled with countdown label or gate tooltip) stays.

Every collection route carries ancestry: `Home > Collections > platform`, and
one level deeper where the URL genuinely is (bilibili's folder). The trail is
built by `entrypoints/app/hooks/use-collection-breadcrumbs.ts` from
`collection-platform-registry.ts` — pages never hand-write crumbs, and the
platform crumb therefore always reads like the sidebar item that leads to it.
A configuration gate that short-circuits before the scaffold passes the same
`links` as the loaded page: same route, same trail. Crumb hrefs are
router-relative (`'/'`, `'/collections'`).

The trailing crumb is the navigation node's name, which is not always the
page's `h1` verbatim (`/collections` reads `Collections` in the trail and
`All Collections` as the heading). That is deliberate: the crumb names the
place, the heading names the page. What is forbidden is two names for the same
platform — `collections.sidebarTitle` was aligned to `nav.bilibiliFavorites`
for exactly that reason.

Only a real URL level becomes a crumb. A folder that is a chip filter with an
"All" option (bookmarks) does not, even though its id sits in the path.

### Page states

`StateBox` is the one dashed state surface: 1px dashed `divider`, centered
column, 16px gaps, 320px minimum height. Its title is a `subtitle1`
paragraph, never a heading; its description is `body2` in `text.secondary`.
`ErrorState` (48px error glyph + one outlined retry), `NoMatchesState`
(description only) and the tag no-match state all render through it. State
copy never uses `text.disabled`: an empty result is information.

Platform empty/auth/configuration states follow the same anatomy: 48px
`text.secondary` glyph, structured `title`/`description`/`action` props, and no
caller-owned top/bottom gap. Multi-action groups center and wrap at narrow
widths. Do not use a 64px platform-colored glyph or custom Typography children
to make one platform state visually louder than its siblings.

### Filter chip rows

`ChipRowShell` owns the header icon slot and renders it in `text.secondary`.
Consumers pass only the glyph and size:

~~~tsx
// Correct: one shared color owner.
<CollapsibleChipRow icon={<Iconify icon="mdi:tag" width={18} />} {...props} />

// Wrong: page-local brand/accent color, often below 3:1 on the light canvas.
<CollapsibleChipRow
  icon={<Iconify icon="mdi:tag" width={18} sx={{ color: 'primary.main' }} />}
  {...props}
/>
~~~

Platform identity belongs on item glyphs and platform-owned data graphics, not
filter-row decoration. `chip-row.test.tsx` locks the single icon slot; source
review must find no platform page overriding its color.

Chip variants: the theme's `MuiChip` default is `soft`, so a chip that wants
the ordinary skin writes no `variant` at all. Only two things override it —
`FilterChip` when selected (`filled` + `color="primary"`), and the collapse
toggle in `CollapsibleChipRow` (`outlined`, because it is an action on the row
rather than another selectable value, and the source says so). Tag chips, stat
chips and type stamps all ride the default. `chip-row.test.tsx` locks both
`FilterChip` states.

### CardGrid

The shared Grid uses `CARD_GRID_SPACING = 3` (24px) and the single breakpoint
map `CARD_GRID_SIZE`:

~~~tsx
{ xs: 12, sm: 6, md: 4, lg: 3 }
~~~

`CardGridSkeleton` puts eight platform-chosen `CollectionCardSkeleton`s on that
same track; platforms do not draw their own skeleton cards.

### CollectionCard

`CollectionCard` remains the only item shell:

- real outbound anchor
- 16:9 top cover, 72px side thumbnail or no media
- failed-media fallback
- 24px content padding (`MuiCardContent` rhythm)
- two/three-line title clamp
- `1fr auto` metadata/date row
- tags and footer outside the anchor, laid out by `CollectionCardRow` (the
  only owner of the inset for rows outside the link)
- equal height
- card elevation, neutral hover wash, inset focus ring (the card clips its
  children, so the baseline's offset ring is drawn 2px inside instead)
- disabled state: `data-disabled`, neutral surface, desaturated media, title
  in `text.secondary` — never a whole-card opacity that drops text contrast

`CollectionCardSkeleton({ media, header, lines })` mirrors that anatomy for
loading. Platform components assemble content. They do not restyle the shell.

## 10. Collection Analytics

Dashboard (`/`, `sections/overview/`) is read-only Collection Analytics.
Implemented state (docs/25 Step 6, 2026-09-03):

- Route title is the shared `SectionTitleBar` (h1 + subtitle caption), with no
  `links` (`/` is the root) and no sync action; the page renders no local
  `<header>`.
- One `Grid container spacing={3}`: four KPI cards `{xs:12,sm:6,md:3}`, the
  library-empty `StateBox` `{xs:12}`, the composition card
  `{xs:12,md:6,lg:4}`, the detail card `{xs:12,md:6,lg:8}`, top tags `{xs:12}`.
- **KPI cards bind `CollectionAnalyticsSnapshot` fields only**, mapped in one
  place (`buildKpis` in `overview-view.tsx`): `totalItems`, platforms with
  items over platform count, `usedTags`, `taggedItems / totalItems`. No data
  means `—`, never a fabricated `0%`. No sparkline and no trend arrow: nothing
  stores a time series, and inventing one lies about the user's own library.
  The card is Minimal's `AnalyticsWidgetSummary` minus ApexCharts — a 135deg
  gradient of two 48% brand tints over a `common.white` base (the base is what
  keeps the dark scheme from going muddy), `<color>.darker` ink, a 48px glyph
  pinned top-right, `subtitle2 component="p"` title and an
  `h3 component="p"` figure carrying `data-slot="kpi-value"`. An optional
  `caption component="p"` carries one honest secondary line (the coverage card's
  `dashboard.noTags` / `dashboard.taggedCount`) and carries **no `opacity`**:
  Minimal dims that line, but on this card's 48% tint over white a 0.72 alpha
  puts the ramps at 3.48-5.12:1 — success (the coverage card's own color),
  warning, primary and the preset4 primary all fall under the 4.5:1 floor in
  section 12. Full `<color>.darker` ink is 6.37-11.40:1; the 12px size already
  makes the line secondary.
- Composition card: `CardHeader` title, a 200px `DonutChart`
  (`components/chart/`) with `totalItems` in the hole, a dashed `Divider`, then
  six legend rows — stacked, not side by side, because the card is 4/12 at `lg`
  (~220px inside its padding). The legend **is** the detail selector: vertical
  `Tabs` (indicator hidden) whose `Tab` labels are `ChartLegendItem`
  (phrasing content only — `Tab` renders a `<button>`), each with a 12px
  `palette.platform[platform]` dot matching its own arc and a
  `data-slot="share-label"` share. Rows: `minHeight 44`, `borderRadius 0.75`,
  hover `action.hover`, selected `varAlpha(primary.mainChannel, 0.08)`. A
  `share === 0` platform draws no arc and still shows its row at `0%`. This is
  form (b) of the two vertical `Tabs` forms in section 11; it is not the
  Settings rail's underline skin and must not be "made consistent" with it.
- Detail card keeps the `tabpanel` wiring (`aria-labelledby` ↔ tab id) from a
  sibling card — ARIA relates them by id, not by nesting. `CardHeader` carries
  the 48px platform tile (`avatar`), the platform name (title), the item count
  (`subheader`) and the outlined platform link (`action`). Empty platform →
  `StateBox` (48px glyph); populated without dimensions → one secondary
  sentence; otherwise `AnalyticsDimensionRanking` lists, two-column from `lg`
  (the card is only 6/12 at `md`), bars in secondary ink
  (`grey.500Channel` 0.64), never platform color.
- Library empty (`totalItems === 0`) → `StateBox` with an outlined link to
  `/collections`, under the KPI row; the six legend rows stay visible with real
  zeros. Top tags render only when non-empty, and that condition lives in the
  orchestrator so no empty card is laid out.
- Card titles are `component="h2" variant="h4"` (16px, the same call as
  `sections/settings/settings-panel.tsx`, closest to Minimal's 17-18px card
  title inside the frozen Favbase scale). Ranking headings are
  `h6 component="h3"`. KPI titles are `<p>`: a metric label is not a section.
  Outline is h1 → h2 → h3 with no skips; the test locks `[1, 2, 2, 3, 2]`
  (the export card lives in Settings, docs/25 C-7).
- Loading is `role="status" aria-busy` with the same grid geometry; error is
  the shared `ErrorState`.
- Graphics never carry meaning alone: the donut is `aria-hidden` as a whole and
  every figure it shows is printed as text by a legend row or a KPI card. All
  figures are tabular (CssBaseline), no page-local `fontVariantNumeric`.
- `docs/ui-baseline/app-runtime-check.mjs` reads the live dashboard through
  `[data-slot="kpi-value"]`; changing the KPI DOM means changing that probe.

No fabricated KPI, chart, queue or account data. Cards are a form, not a
falsehood — docs/23's "no floating metric cards" was overturned by docs/25 §3.1;
what stays forbidden is inventing the numbers on them.

## 11. Settings, Chat, Tabs, And Overlays

### Settings

- Route title uses `SectionTitleBar` with a `links` trail (`breadcrumbs.home`
  then `settings.title`); one route, one `h1`. Crumb hrefs are router-relative
  (`'/'`) -- `RouterLink` adds the hash router's `#`, so a hand-written `'#/'`
  is a broken link, not a shortcut.
- `SettingsTabs({ value, onChange, tabs, ariaLabel })` and
  `SectionRail({ value, onChange, items, ariaLabel })` are the theme's default
  underline Tabs: no local `variant`, `scrollButtons`, indicator, or track
  styling, and no segmented pill skin. Labels stay on one line
  (`whiteSpace: 'nowrap'`) and overflow into a scroll; never compress four
  localized labels into equal-width tracks.
- Beyond that shared `whiteSpace`, `SectionRail` owns exactly two locals:
  orientation (`vertical` at `md+`, `horizontal` below) and, while vertical,
  `justifyContent: 'flex-start'` so the icon column lines up instead of
  centering every row on its own width.
  While vertical it is form (a) of the two vertical `Tabs` forms below: keep
  the underline, do not give it a selected wash.
- Every active rail item renders one `SettingsPanel({ title, description,
  children })`. The panel owns the single Card surface, a semantic `h2` title,
  and theme-owned CardHeader/CardContent spacing. Callers pass fields and
  states, never another Card.
- `SettingsPanel`, not global `MuiCardHeader` defaults, owns Settings heading
  semantics. Changing every CardHeader to `h2` silently changes unrelated
  pages and is forbidden.
- Draft, connection-test, save gating, deep-link, resume, permission, and error
  behavior remain outside visual owners.

~~~tsx
// Wrong: duplicate panel anatomy and globally inferred heading semantics.
<Card><CardHeader title={title} /><CardContent>{fields}</CardContent></Card>

// Correct: one Settings owner, explicit section semantics.
<SettingsPanel title={title} description={description}>{fields}</SettingsPanel>
~~~

Tests assert one route `h1`, one panel `h2`, no nested `.MuiCard-root`, compact
scrollable tab tracks, accessible tablist labels, the ancestry handed to the
title bar, and unchanged save/deep-link behavior. The rendered trail (`nav` plus
`aria-current="page"`) is locked once in `custom-breadcrumbs.test.tsx` and once
in `section-title-bar.test.tsx`; page tests that mock the title bar assert the
`links` data, never a mock's DOM.

### Chat

- The workspace is Minimal's chat card (`sections/chat/layout.tsx`): one
  elevated 16px surface holding three slots — rail, 72px header, main. The rail
  is permanent only at `lg+`; below `lg`, history uses a temporary Drawer. The
  card's height comes from the page, not from `flex: 1 1 0` (docs/25 Step 9).
- Conversation rail width is 320px and collapses to 96px (`CHAT_NAV_WIDTH` /
  `CHAT_NAV_COLLAPSE_WIDTH`, owned by `layout.tsx`); message, error, and
  composer share a 760px maximum reading track (`CHAT_READING_WIDTH`). Every
  grid/flex child on that path keeps `minWidth: 0`.
- The history Drawer paper uses `min(320px, calc(100vw - 32px))` and preserves
  the exit-focus contract in section 12.
- The user question takes Minimal's bubble (`p 1.5`, `maxWidth 320`,
  `borderRadius 1`, 16% brand wash); the assistant answer stays frameless
  across the full track. A 320px answer cannot hold a markdown table, and
  `ChatMarkdown` already paints code on `background.neutral`.
- The composer is a 56px-floor `InputBase` bar with a top divider. It carries no
  attachment / emoji / microphone control: Minimal's are decorative, and a
  button that does nothing is worse than no button.
- User messages remain plain text. Completed and streaming assistant messages
  both use `ChatMarkdown`; unclosed fenced code and links must render without
  throwing. Code and table containers own horizontal overflow.
- Tool activity is a named live status; source rows consume neutral/divider/
  action tokens and retain their protected outbound-open behavior.

### Vertical Tabs

There are exactly **two** sanctioned vertical `Tabs` forms, and they are
deliberately not the same skin (docs/25 Step 10, user decision 2026-09-04,
resolving the consistency review Step 7 deferred). Pick by what the rows *are*,
not by what the neighbouring page does:

**(a) Secondary navigation** — the theme's default underline Tabs, no local
visual override. `indicatorColor` stays `'inherit'`, so the indicator is
`currentColor` ink on the trailing edge, **not** `primary.main`; the resting
label is `text.secondary` and the selected one is `text.primary` semibold; there
is no wash. The only precedent is `sections/settings/section-rail.tsx`, which
owns just orientation and (while vertical) `justifyContent: 'flex-start'`.

**(b) A card's data rows that double as a segment selector** — indicator
hidden (`display: 'none'`), 4px row spacing set through `tabsClasses.list`
(MUI 9 has no `flexContainer` class; the theme's own horizontal `list` gap does
not apply to vertical), rows at `minHeight: 44` and `borderRadius: 0.75`, hover
`action.hover`, selected `varAlpha(theme.vars.palette.primary.mainChannel,
0.08)`. Each `Tab` label is phrasing content only (`Tab` renders a `<button>`)
— for example `ChartLegendItem` with its own color dot and share figure. The
only precedent is `sections/overview/analytics-platform-composition.tsx`.

**Do not unify them.** An underline next to a donut legend marks nothing the
arc and the dot do not already mark, and it fights the selected wash on the same
row. Conversely, moving the 8% brand wash onto the Settings rail would collide
with `components/nav-section`'s active treatment (identical wash and accent
ink), flattening an in-page secondary rail into something that reads like
primary navigation.

### Overlay Defaults

`theme/core/components.tsx` owns these defaults:

- Popover: `mixins.paperStyles(dropdown)` — dropdown shadow, 10px radius, a
  `spacing(0.5)` (4px) inset on the **paper**, viewport-bounded.
- Menu: there is no `MuiMenu` override at all. Menu inherits that Popover
  paper, and the paper zeroes the inner list's vertical padding
  (`& .MuiList-root { paddingTop: 0; paddingBottom: 0 }`) so the 4px inset is
  the only gutter. Earlier revisions of this line credited the 4px to the list;
  it is the paper's (docs/25 C-4).
- Drawer: only `variant="temporary"` casts `customShadows.dropdown`; permanent
  shell navigation remains flat.
- Dialog: `fullWidth`, `maxWidth="sm"`, 16px viewport gutters, bounded dynamic
  height, 24px title/content/action rhythm, wrapping actions.
- Tooltip: inverse scheme surface, 6px radius, arrow, 400ms enter delay.

Theme contract tests assert these resolved values and distinguish temporary
from permanent Drawer owner state. Escape, focus trap, and focus restoration
remain MUI-native plus the explicit regression tests; do not mutate `aria-hidden`
or `inert` manually.

### One-shot Action Results

`components/snackbar/` is the single toast region, mounted once at the router
root (docs/25 Step 5). It is not a theme default; it is an owner, and the only
sanctioned door to `sonner` (`tests/ui-vendor-boundaries.test.ts`).

Split by lifetime, not by severity (docs/25 D6 plan A):

- **One-shot result** — save, sync, clear remote, export, copy: `toast.*`.
  Nothing is left behind in the card.
- **Persistent state** — saved-at badge, connection status, connection-test
  result, fetch progress, busy flags: stays inline where the user can re-read
  it. A test-connection Alert that vanishes after four seconds is a regression.

A result is reported once. Do not raise a toast and keep an inline Alert for the
same event. The failure copy is the most specific key that exists (section 2 of
`i18n-conventions.md`), and both the region and each toast's close button carry
a translated accessible name.

Callers assert against a mocked `components/snackbar` barrel, plus a negative
assertion that the card body kept nothing (`textContent).not.toContain(...)`,
no `.MuiAlert-root`). Mock the barrel, never `sonner`.

> **Warning**: sonner defers every store update by a *macrotask* — see the
> "Prevent batching, temp solution" `setTimeout` in its `useSonner`. Inside
> `await act(async () => toast.success(...))` only microtasks flush, so the
> region renders empty and the assertion fails with no hint as to why. A test
> that renders the real `Snackbar` must await a `setTimeout(0)` inside the same
> `act` (see the `emit()` helper in `snackbar.test.tsx`).

## 12. Accessibility And States

- Text contrast: 4.5:1 minimum.
- Large text and meaningful graphics: 3:1 minimum.
- Primary interactive target: at least 44x44px.
- Icon-only controls: translated `aria-label` and tooltip.
- Visible focus in both schemes.
- Loading, empty, error and data states remain present.
- Async actions show loading/disabled feedback.
- Page horizontal overflow is forbidden.

### Temporary Drawer/Dialog Exit Focus

MUI 9 + React 19 transition ordering is protected by the existing contract:

1. Trigger and modal surface refs remain explicit.
2. `disableRestoreFocus: true` is paired with explicit restoration.
3. Blur a focused modal descendant in `ModalProps.onTransitionExited`.
4. Restore the visible trigger from the transition slot's `onExited`.
5. Never mutate `aria-hidden` or `inert` manually.

Keep its regression test when touching modal ownership.

Scope: those five steps apply when one component owns both refs, whether or not
it renders both elements. `NavMobile` holds them together; chat history now
splits the trigger (`chat-header.tsx`) from the Drawer (`chat-nav-drawer.tsx`)
and `chat-view.tsx` owns the trigger ref and passes it down — the contract is
about explicit refs, not about a single file. The appearance drawer is mounted at
the router root while its trigger sits in the Header, so there is no shared ref
and MUI's own restore-focus is used instead; the outcome the contract protects —
focus back on the trigger, no `aria-hidden` residue — is asserted in
`components/settings/drawer/settings-drawer.test.tsx`.

## 13. Motion

- Standard transition: 120-250ms.
- Motion communicates hover, focus, selection, loading or state change.
- Prefer transform, opacity and shadow.
- Respect `prefers-reduced-motion`.
- Theme View Transition is allowed because it communicates a global state
  change and already has a reduced-motion fallback.

No page-load choreography or decorative looping motion.

The desktop pin/unpin shell has one accepted geometry exception: nav
`width`/`padding` and content `padding-left` transition together for 120ms.
This user-triggered operation changes the real layout width, so replacing it
with `transform` would leave wrapping, Header alignment, and hit geometry
stale. The duration/easing remain owned by `dashboard/css-vars.ts`; revisit
only when a real Chrome performance trace demonstrates dropped frames.

## 14. Sx Pattern

Use composable arrays when a component exposes `sx`:

~~~tsx
sx={[
  (theme) => ({ color: theme.vars.palette.text.primary }),
  ...(Array.isArray(sx) ? sx : [sx]),
]}
~~~

## 15. Forbidden Patterns

| Pattern | Use instead |
| --- | --- |
| Raw neutral hex in component | semantic `theme.vars.palette` role |
| `rgba()` | `varAlpha(channel, alpha)` |
| `theme.palette.*` in variable theme code | `theme.vars.palette.*` |
| Local Card radius/shadow repeated everywhere | global MUI override |
| Border plus broad shadow | one elevation mechanism |
| Nested Cards | spacing, Grid, Stack or neutral section |
| Per-platform card shell | `CollectionCard` |
| Platform `if` color branch | `palette.platform[platform]` |
| `window.open` for Collection Item | real anchor |
| `createBrowserRouter` | `createHashRouter` |
| Block descendants inside Tab/Button | `component="span"` |
| Placeholder as field label | visible label |
| Demo account/KPI content | real Favbase data |
| Chart library (ApexCharts, recharts) | native SVG in `components/chart/` |
| Meaning carried by a graphic alone | print the figure as text too |
| `variant="outlined"` on a Chip to mean "not selected" | omit `variant` (theme default `soft`) |
| Hand-written breadcrumb array in a page | `useCollectionBreadcrumbs` |
| Unifying the two vertical `Tabs` forms | pick by row semantics (section 11) |

Scoped exception: the appearance drawer's option tiles (`OptionButton`,
`BaseOption`) keep Minimal's 1px 8% hairline together with a lifted shadow on
the selected state. "Border plus broad shadow" is a Card rule; these 64px tiles
need the edge to read as a tile at all, and docs/25 adopts Minimal's drawer
verbatim.

## 16. Verification

For shared app UI changes:

1. Run focused tests for changed owners.
2. Run full TypeScript compile.
3. Run full test suite and WXT build.
4. Run `git diff --check`.
5. Inspect 1440px and 390px representative routes.
6. Inspect light and dark modes.
7. Check console, focus, overflow, loading, empty and error states.
8. Run the Impeccable detector over changed UI files.

Runtime verification tooling is part of the shell contract, not a bystander.
`docs/ui-baseline/app-runtime-check.mjs` drives the built page over raw CDP and
addresses the shell by DOM shape, so any change to Header/rail/drawer
composition must update its selectors in the same change. docs/25 Step 4 moved
the rail toggle out of the Header and deleted the Header theme pill without
touching the script: `header button[aria-expanded]` and
`header input[type="checkbox"]` both went dead, and because each was called as
`?.click()` the run degraded to a silent no-op whose downstream assertion blamed
the layout instead. (A 2026-09-04 attempt brought the control back as a
`Switch` and did restore the script's `header input[type="checkbox"]` path — in
the working tree only. It was never committed, and the whole attempt, script
edit included, was reverted on 2026-09-05 when the shape decision changed to an
icon button; git therefore holds no trace of either, and the note here is the
only record. What landed instead is `ThemeModeButton`, which adds a control
without killing a selector: the reduced-motion
block still drives gear → drawer → Dark tile → close, and that path stays valid
because the drawer keeps the three-way Mode block over the same
`theme/mode-transition.ts` seam.) Selector lookups in that script now throw on a miss rather
than optional-chain past it, and the toggle's "exactly one `aria-expanded`
control outside `header` and `nav`" contract is mirrored in
`layouts/dashboard/layout.test.tsx` so the fast suite catches the drift first
(happy-dom cannot parse a `:not()` with a descendant combinator, so the unit
test filters in JS instead of reusing the selector string).

The same rule applies to what the script *measures*. Its contrast audit folds
the ancestor chain's `opacity` into the foreground alpha (`cumulativeOpacity`)
instead of reading `getComputedStyle().color` at face value and skipping
anything under 0.5 — CSS `opacity` never reaches the computed color, so dimmed
text used to be scored at full ink and a faded caption could not fail. It still
reads only `background-color`, so text over a `background-image` gradient is
scored against the layer underneath; a card that paints its tint as a gradient
must have its ink checked by hand. The live-data probe asserts its own shape
(four `[data-slot="kpi-value"]` figures, six legend tabs) rather than recording
whatever the selector happened to find. Any audit that can only pass is not an
audit.

The whole Minimal alignment (docs/25 Step 0-10) was rechecked on 2026-09-04
from the main worktree at the Step 10 close-out: focused
`theme/theme-contract.test.ts` + `components/label/` passed (2 files /
45 tests); `pnpm compile` passed; `pnpm test` passed with the root suite at
194 files / 1,413 tests and the workspace package suite at 10 files /
55 tests; `pnpm build` passed with the background contract at 11 modules /
939,265 bytes and app chunks at 91,617 / 122,157 / 56,544 gzip bytes
(app / shared MUI `Container` / `jsx-runtime`, plus the chat route chunk at
54,162); `pnpm zip` produced `.output/favbase-0.0.5-chrome.zip` (17,563,875
bytes after the check pass's `index.html` comment edit, 17,563,798 before it —
the delta is that HTML comment, not code; packaging trial only, never
uploaded); `git diff --check` clean.

Chunk figures in docs/25's progress table are `gzip -c <chunk>` at the default
level. Compress *the file*, not stdin: `gzip -c file` writes the original name
into the header, so `cat file | gzip -c` reports 16 bytes less and the rows stop
being comparable. A one- or two-byte "drift" between adjacent rows is never
noise — gzip is deterministic. It means one of the two rows was measured on a
build that is not the tree it claims; check out the commit and rebuild before
explaining it away (that is how the Step 9 row's app/chat numbers were found to
predate its own commit).

The full suite is timing-sensitive under CPU contention: three of six
consecutive `pnpm test` runs went red with one to three failures at the Step 10
close-out, and one of two more at the check pass, always async ordering or a
5s `testTimeout` in `lib/**` (`lib/database/proxy-db.test.ts`,
`lib/database/db.test.ts`, `lib/bilibili/transcribe-utils.test.ts`) — a
different file each run, each passing in isolation in about 1.5s, and none of
them touched by that day's edits. A red full suite on a loaded machine is not a
verdict — re-run the failing file in isolation, and the suite idle, before
treating it as a regression.

The production build reports the existing PGlite direct-eval and large-chunk
warnings; these are dependency/build warnings, not new app console findings.
Runtime approval still requires the user's loaded extension profile and is not
inferred from these commands. The Step 10 screenshot baseline
(`docs/ui-baseline/2026-09-04/minimal-alignment/`) was **not** captured: the
running Chrome had no `--remote-debugging-port` (the `DevToolsActivePort` file
was left over from 09-01 and nothing listened on 9222), so
`app-runtime-check.mjs` could not attach. That step is handed to the user per
"Hand-off before finish-work" below rather than skipped silently.

### Runtime inspection uses the user's running Chrome

Runtime screenshots and measurements are taken in the user's own running
Chrome profile: it holds the real cookies, the local PGlite data and the
collected items, so cards, filters and pipelines render with real content.

Two transports have been used, and only one is currently available:

- **`docs/ui-baseline/app-runtime-check.mjs` (available).** Zero-dependency raw
  CDP over the `DevToolsActivePort` browser endpoint. It requires Chrome to be
  started with `--remote-debugging-port` and an `app.html` tab already open on
  the target build, attaches to that page, runs the theme x viewport x locale
  matrix plus the interaction contracts, and restores URL, theme, locale,
  sidebar preference and emulation overrides before detaching. A stale
  `DevToolsActivePort` file left by a previous Chrome session will hang the
  handshake — check the file's mtime before blaming the script.
- **`chrome-devtools` MCP (not available).** Earlier revisions of this section
  prescribed `list_extensions` -> `reload_extension` -> `new_page` ->
  `resize_page` / `emulate` / `take_screenshot`. That server is not present in
  the current agent environment, so no session should plan around it. A browser
  automation *skill* is also not a substitute here: Chrome forbids one
  extension from scripting another extension's `chrome-extension://` pages, and
  `<all_urls>` does not cover that scheme.

The script's matrix has no vertical/mini dimension yet: `configure()` accepts
`pinned` but `runGroup()` never forwards it, so a mini-rail group has to be
added before the rail can be captured in both shapes.

Do not launch a separate Chrome with a fresh profile for UI verification: it
has no data and no login, so it can only show empty and configuration states
and proves nothing about cards, grids or pipelines. The unpacked extension is
loaded from the active worktree's `.output/chrome-mv3`, so run `pnpm build`
and `reload_extension` before inspecting.

Representative routes: `/collections/bilibili` and `/collections/bookmarks`
(the two pages with platform-specific composition); the other platform pages
share the same scaffold template and only need a spot check.

### Hand-off before finish-work

A UI change is not finished when the agent's own screenshots pass. Before
`/trellis:finish-work` (and before any commit plan), the agent must:

1. Run `pnpm build` after the last source edit, so `.output/chrome-mv3` is
   the reviewed state — check the build timestamp against the newest source
   file and rebuild if it is older.
2. Tell the user the absolute local path of that unpacked build — always the
   working tree the change was made in, `<worktree>\.output\chrome-mv3`, not a
   path copied from an older run of this section (`C:\tmp\favbase-minimal-v7-phase2`
   was the Phase 2 worktree, not where later steps were built). After a rebuild
   the loaded extension needs a manual reload on `chrome://extensions`.
3. Stop and wait for the user's manual review of that build. Archive and
   session journal come after their verdict, never before.
