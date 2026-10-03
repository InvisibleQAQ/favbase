# app/theme

This directory owns the single MUI v9 CSS-variable theme used by `app.html`
and `welcome.html`. Since docs/25 Step 1 (2026-09-01) the visual language is
Minimal Dashboard's `theme/core` port; Favbase keeps its brand tokens and a
short list of functional overrides. Step 2 (2026-09-01) adds Minimal's
`with-settings` layer: six primary presets (coral default) and a high-contrast
option, driven by the persisted `local:themeSettings` record. Pages consume
semantic `theme.vars` tokens and `theme.mixins.*`; they must not copy palette,
typography, radius, or elevation values into local `sx`.

## Owners

| file | owns |
| --- | --- |
| `theme-config.ts` | Primitive colors/fonts, scheme-owned `text` / `background` values (dark ink = white / grey 500 / grey 600; dark `neutral` stays `#222B34`, see C-2 below), `data-color-scheme` selector. It owns **no** platform colors since docs/26 Step 2: the `platform` block was a relay to `core/palette.ts` and now lives in `collection-platform-registry.ts` (`PLATFORM_META.palette`). Since Step 2 the scheme owns no brand shades (the dark `lighter` re-ink and the per-scheme accent constant are gone; the accent is derived, see `core/palette.ts`) |
| `core/palette.ts` | Minimal palette skeleton: channels, `action`, `divider` (grey 500 @ 0.2), `TableCell.border`, `shared` hairlines (`inputOutlined` .2 / `inputUnderline` .32 / `paperOutlined` .16 / `buttonOutlined` .32), `colorKeys` iteration order. Favbase adds `accentTextFor(primary, scheme)` + `createTextPalette(scheme, primary)` (the derived `text.accent`), one coral `primary` ramp shared by both schemes, and the `platform` palette — derived per scheme from `PLATFORM_META.palette` (`'ink'` resolves to that scheme's `text.primary`), never hand-listed |
| `with-settings/color-presets.ts` | `primaryColorPresets: Record<ThemeColorPreset, …>` — `default` = `themeConfig.palette.primary`, preset1–5 = Minimal's five ramps; `pickContrastText(main)` chooses ink `#1F1B17` or white per WCAG (docs/25 D14: ink for default/1/4/5, white for 2/3). Preset ids come from `lib/storage/theme-settings.ts`; a missing key fails compilation |
| `with-settings/update-core.ts` | `applySettingsToTheme(baseTheme, settingsState)`: swaps `primary` (channels) + `text` (via `createTextPalette`, so `text.accent` follows the preset) + `customShadows.primary` in both schemes; `contrast: 'high'` sets the light ground to grey 200 (`background.default` + channel) and both schemes' `customShadows.card` to `z1` (token-level stand-in for Minimal's `update-components.ts` body rule — Favbase's `MuiCssBaseline` function override cannot be merged with a second one). Pure; never mutates `baseTheme` |
| `core/opacity.ts` | `theme.vars.opacity.*`: `switchTrack` / `inputUnderline` system alphas, `filled.commonHoverBg`, `outlined.border`, `soft.{bg,hoverBg,paletteHoverBg,commonBg,commonHoverBg,border}`. `soft.paletteHoverBg` (0.24) is favbase's: the hover wash of a soft palette color; Minimal's `soft.hoverBg` (0.32) now only drives the grey `inherit` branch |
| `core/typography.ts` | Unchanged Favbase scale: DM Sans Variable UI text, Barlow display; fixed 28/24/20/16/14/12px, zero letter spacing (docs/25 D8). The only page call site whose font size moves with the viewport is the Dashboard KPI figure (Minimal `h4`: DM Sans 700, 20px -> 24px from `md`, docs/31 Step 5); the exception is written at the call site and does not enter the theme. Theme-internal, input text also moves: 15px, 16px below `sm` (`core/components/text-field.tsx` `INPUT_TYPOGRAPHY`, a theme-owned Minimal port from docs/25 Step 1) |
| `core/shadows.ts` | MUI 25-level elevation recolored to grey 500 (light) / black (dark) channel |
| `core/custom-shadows.ts` | `z1…z24`, `card`, `dialog`, `dropdown`, per-color shadows. Both schemes cast; `card` is never `'none'` |
| `core/mixins/` | `softStyles` / `filledStyles` / `menuItemStyles` / `paperStyles` (`background.ts`, `text.ts`, `global-styles-components.ts`), `maxLine` / `textGradient`, `bgBlur` / `bgGradient`, `hideScrollX/Y`, `scrollbarStyles`. `border.ts` (`borderGradient`) is not ported |
| `core/components/` | One file per MUI component family (`index.ts` spreads them). Minimal's MUI X and `@mui/lab` timeline entries are not ported. Every override is written as `root.variants` with `props: (ownerState) => boolean`; the contract test resolves them the same way MUI does |
| `create-theme.ts` | `baseTheme` assembles `colorSchemes.{light,dark}` = palette + shadows + customShadows + opacity, plus `mixins`, `components`, `typography`, `shape.borderRadius: 8`; `createTheme({ settingsState?, themeOverrides? })` runs `applySettingsToTheme` only when a settings state is given |
| `create-classes.ts` | `createClasses(name)` -> `favbase__<name>`: stable, prefixed slot class names for shared primitives, so a parent's `sx` can target a slot without depending on emotion's hashes. Sole owner of the `classesPrefix` join; used by `components/label/`, `components/scrollbar/`, `components/nav-section/styles/classes.ts` and `layouts/core/classes.ts` |
| `mode-transition.ts` | `setModeWithReveal(setMode, next, origin)` + `revealOriginFrom(el)`: the View Transitions circular reveal for a light/dark swap (`flushSync` inside `startViewTransition` so the "after" snapshot is the new scheme; instant fallback when the API is missing or reduced-motion is on; a skipped transition's `ready` rejection is swallowed). Companion `::view-transition-*(root)` rules live in `app/global.css`. Moved out of the deleted `layouts/dashboard/header-actions.tsx` in docs/25 Step 4. `ColorModeValue` is two-state since 2026-09-06 (`system` left the product) and the sole consumer is `layouts/components/theme-mode-button.tsx`, shared by the app Header and welcome's top bar |
| `theme-provider.tsx` | Reads `SettingsContext` **optionally** (`use(SettingsContext)` on the leaf `components/settings/context/settings-context.ts`, not the barrel) and `useMemo`s `createTheme({ settingsState })` on it — app.html gets the persisted preset/contrast, welcome.html and bare test renders get coral defaults. `ThemeVarsProvider` + `CssBaseline`; keep `defaultMode="light"` and `favbase-color-mode` synchronized with `public/theme-init.js`, which normalizes anything that is not `light`/`dark` — nothing stored yet, or a legacy `system` — to `light` **and writes it back**, because a stored value beats `defaultMode` (mode is not a settings-state field; `theme-contract.test.ts` runs that guard's real source) |
| `extend-theme-types.d.ts` | Module augmentation for palette / mixins / opacity / customShadows and the component `variant` / `color` / `size` extensions (Button `soft`/`xLarge`/`black`/`white`, Chip `soft`, Pagination `soft`, Fab, Badge, Avatar, Slider, Rating, Tabs `custom`) |

## Favbase overrides (marked `favbase override:` in source)

- `core/components/css-baseline.tsx` — whole file: tabular numerals, scrollbar, `::selection` (16% brand wash `varAlpha(primary.mainChannel, 0.16)` under `text.primary`), caret, `:focus-visible` ring (`primary.darker` / dark `primary.main`).
- `core/components/typography.tsx` — `variantMapping: { subtitle1: 'p', subtitle2: 'p' }` (one page, one h1).
- `core/components/button.tsx` — outlined / text `primary` ink is `text.accent`; border and hover wash follow `currentColor`. Contained palette buttons keep `main` on hover instead of MUI's `.dark` (2026-10-02): with an ink `contrastText`, `.dark` reads 3.69 (coral) / 2.26 (preset1) / 4.06 (preset4) / 2.60 (preset5), so hover now equals rest contrast for every color (error: 4.23 at both, white on `#E53935`, was 6.57 on `.dark` — the error ramp is sub-AA at rest, a token issue, not a hover one).
- `core/components/button-toggle.tsx` — a selected `color="primary"` ToggleButton inks `text.accent` instead of MUI's `primary.main` (coral 2.5:1 as text). The selected wash stays MUI's `main` at 8% / 16% hovered (floor 5.46 / 5.15, preset2 dark). The override sits in `colorVariants`, before the state variants, so a disabled selected toggle still takes `action.disabled` (same specificity, order decides; emitted CSS checked 2026-10-02: MUI's `primary-main` rule, then this one).
- `core/components/chip.tsx` — a clickable `filled` palette chip (the selected `FilterChip`) keeps `main` on `:hover` and `.Mui-focusVisible` instead of MUI's `.dark`, with `customShadows[color]` as the hover cue (2026-10-02, same fix and same numbers as the contained button: `.dark` under the ink `contrastText` reads 3.69 coral / 2.26 preset1 / 4.06 preset4 / 2.60 preset5). Nested under `&.MuiChip-clickable`, so it is three classes against MUI's two and wins regardless of order; the disabled `:not(.MuiChip-outlined)` rule is also three classes and is emitted after it, so a disabled chip stays grey (emitted CSS checked 2026-10-02). The hover shadow also outranks MUI's `:active` `shadows[1]` while pressed. An `onDelete`-only palette chip (no clickable class) still focuses to `.dark`; none exists in app.html.
- `core/mixins/global-styles-components.ts` — `softStyles(theme, 'primary')` text is `text.accent` (coral `dark` reads 3.99:1 on the 16% wash; C-3). Other colors keep Minimal's `dark` / dark-scheme `light`. A soft **palette** color hovers to `opacity.soft.paletteHoverBg` (24%) instead of Minimal's `soft.hoverBg` (32%, 2026-10-02): at 32% the soft ink falls to 4.28 (coral dark) / 4.30 (preset2 dark) over `background.neutral`, which is where a clickable chip on a hovered `CollectionCard` sits; 24% floors at 4.58 (preset2 dark on neutral; coral dark 4.99). The hover step is subtler (16% -> 24%). The grey `inherit` branch (soft inherit Button, unselected `FilterChip`) keeps 32%.
- `core/components/link.tsx` — `color: text.accent`.
- `core/components/dialog.tsx` — `defaultProps { fullWidth, maxWidth: 'sm' }`, paper `width calc(100% - 32px)` / `maxHeight calc(100dvh - 32px)`, actions `flexWrap + gap 12` (Minimal uses sibling margins).
- `core/components/tooltip.tsx` — `arrow: true, enterDelay: 400`; Minimal's arrowless `-4px` popper offset is not applied.
- `theme-config.ts` / `core/palette.ts` — coral `primary` (one ramp for both schemes), Favbase `error`, derived `text.accent`, dark `background.neutral` `#222B34`. `palette.platform.*` is derived from the app Platform Descriptor, so a brand hue is changed there, not here.
- `with-settings/` — preset `contrastText` picked by WCAG (D14), `text.accent` re-derived per preset, high contrast flattens `customShadows.card` to `z1` at token level (see Owners).

## Token contract

| role | light | dark |
| --- | --- | --- |
| `background.default` | `#FFFFFF` (`#F4F6F8` under high contrast) | `#141A21` |
| `background.paper` | `#FFFFFF` | `#1C252E` |
| `background.neutral` | `#F4F6F8` | `#222B34` |
| `text.primary` | `#1C252E` | `#FFFFFF` |
| `text.secondary` | `#637381` | `#919EAB` |
| `text.disabled` | `#919EAB` | `#637381` |
| `text.accent` | derived: active preset `primary.darker` (coral `#7A2714`) | derived: active preset `primary.light` (coral `#FDA48A`) |
| `divider` | grey 500 @ 0.2 | grey 500 @ 0.2 |

Use `theme.vars.palette.text.*`, `background.*`, `divider`, `shared.*`,
`action.*`, `theme.vars.opacity.*` and `varAlpha(channel, alpha)`.
`primary.main` is a brand block/icon signal, not small text; `text.accent` is
the only brand shade allowed as text. Platform colors are restricted to
platform glyphs and their own analytics graphics.

**Brand wash** (selected / active rows): `varAlpha(theme.vars.palette.primary.mainChannel, 0.08)`,
deepened to `0.16` on hover or for chip-like fills. `primary.lighter` is not a
background in app code — it is an opaque stage that would turn into a pale
block on the dark ground and would not follow the preset; the only remaining
consumer is Minimal's own `core/components/avatar.tsx` surplus badge. Consumers:
`components/nav-section/styles/css-vars.ts` (nav row active/hover), `sections/overview/overview-view.tsx`
(platform tab), `sections/chat/chat-view.tsx` (conversation row),
`sections/bilibili/bilibili-view.tsx` (`SortControl`).

- **C-2** (docs/25): Minimal's dark neutral `#28323D` drops youtube dark
  `#D94040` to 2.95:1, so `#222B34` stays; `core/palette.test.ts` locks every
  platform color at ≥ 3:1 on `default` and `neutral`.
- **C-4**: there is no `MuiMenu` override. Menu paper inherits `MuiPopover.paper`
  (`paperStyles(dropdown)`: 4px inset, dropdown shadow, 10px radius) and the
  inner list has zero vertical padding.
- **C-5** (docs/25, resolved in Step 2): every preset's derived accent clears
  4.5:1 — `darker` on white ≥ 8.74 (preset4) and on the high-contrast grey 200
  ≥ 8.07; `light` on `#141A21` ≥ 6.44 (preset2); on the 16% soft wash ≥ 5.15
  (preset2 dark). No preset needed the `dark`/`lighter` fallback stage.
- **D14**: `contrastText` per preset — default 6.74 ink, preset1 4.93 ink
  (Minimal's white is 3.47), preset2 6.34 white, preset3 5.03 white, preset4
  8.87 ink, preset5 4.66 ink (Minimal's white is 3.67).
- High contrast: `text.secondary` on grey 200 is 4.508:1 — the tightest pair in
  the theme; `theme-contract.test.ts` locks it at ≥ 4.5.

## Component defaults

- Button: `color="inherit"`, `disableElevation`; sizes 30/36/48/56 (`xLarge`)
  via `--padding-y/x` CSS vars; `soft` variant; `contained inherit` inverts the
  scheme (`filledStyles`). Color is picked by role at the call site (user
  decisions 2026-10-02): a primary action is `variant="contained"` +
  `color="primary"` (preset `main` + `contrastText`, hover stays on `main`); a
  secondary action is `variant="soft"` + `color="primary"` (16% `main` wash,
  24% hovered, `text.accent` ink — outlined primary is not used, because its
  light-scheme ink is the near-black `darker` stage under a faint border and
  still reads black and white); an inline clear link is `variant="text"` +
  `color="primary"`. Dialog dismissal and buttons inside a tinted Alert /
  notice keep `inherit`. The inverted `contained inherit` skin is not used for
  actions. The default is deliberately not flipped to `primary`: that would
  re-ink dismissal and container-tinted buttons too.
- ToggleButton: pass `color="primary"` on the `ToggleButtonGroup` (the group
  hands it to every child); the selected toggle then inks `text.accent` on an
  8% `main` wash (see Favbase overrides).
- Chip: default `variant="soft"`, radius 8 (small) / 10 (medium); `filled
  default` is the ink block; outlined default border `shared.buttonOutlined`.
  A clickable soft palette chip hovers on the 24% palette wash (see Favbase
  overrides); keyboard focus keeps the rest wash plus the CssBaseline ring —
  MUI's `.Mui-focusVisible` `.dark` paint is shadowed by the soft base
  re-emitted under `&.MuiChip-clickable` (same specificity, later; see the
  `chip.tsx` header). A clickable filled palette chip (selected `FilterChip`)
  stays on `main` on hover and focus, hover adding `customShadows[color]`; this
  one is an explicit override (see Favbase overrides), because its ink
  `contrastText` fails on `.dark`. Colored chips are picked by meaning at the
  call site (`ui-design-system.md` section 9).
- Card radius `var(--card-radius, 16px)`, shadow `var(--card-shadow,
  customShadows.card)`; CardHeader 24/24/0 with `h6` title and `body2`
  subheader (`mt: 0.5`); CardContent 24.
- Inputs: 24px line box + `INPUT_PADDING` — outlined medium 56 / small 40,
  base 32 / 28, filled label-aware; no `minHeight`. Outline `shared.inputOutlined`,
  focused `text.primary`. Label offsets derive from the same padding table.
- Overlays: Popover/Autocomplete/Menu paper = `paperStyles(dropdown)` (10px,
  4px inset, blurred 90% paper, two radial washes); Dialog 16px radius, 16px
  margin, `customShadows.dialog`; temporary Drawer paper = `paperStyles` + a
  directional `±40px 40px 80px -8px` shadow, permanent nav flat; Backdrop grey
  800 @ 0.48; Tooltip grey 800 / dark grey 700, radius 6.
- Tabs: `variant="scrollable"`, `textColor`/`indicatorColor="inherit"`,
  `allowScrollButtonsMobile`; Tab `disableRipple`, `iconPosition="start"`,
  `text.secondary` at rest, semibold selected, 48px MUI default height.
  `indicatorColor="custom"` is the segmented pill form. The horizontal `list`
  gap (40 / 24 below `sm`) is skipped for `orientation="vertical"`, so a
  vertical consumer owns its own row spacing; the two sanctioned vertical forms
  are fixed in `ui-design-system.md` section 11 ("Vertical Tabs") and must not
  be unified.
- Skeleton `animation="wave"`, `variant="rounded"` (16px). Stack `useFlexGap`.
  LinearProgress / CircularProgress default `color="inherit"`, bar radius 16.
- Table: dashed row borders, `TableCell.head` on `background.neutral`,
  container `scrollbarStyles`.

Page-local numeric `sx` radii use `0.5` (4px) for embedded media/progress,
`0.75` (6px) for compact rows/tooltips, `1` (8px) for panels, `2` (16px) only
when matching a Card. `50%` is reserved for circular/pill controls.

## Tests

- `theme-contract.test.ts` — `resolveStyle(component, slot, ownerState)` merges
  the slot's base style with every matching `variants` entry (function or
  object `props`) **per property**, so two variants that emit the same nested
  selector cascade instead of one replacing the other (shallow until
  2026-10-02; no existing assertion depended on it). `matchedStyles` exposes
  the same list in cascade order for assertions about order. Every locked
  value below reads the same way MUI does:
  `shared` + `opacity` vars, radii 16/10/16/6/8/10, input heights from
  `INPUT_PADDING`, real dark card shadow, directional temporary-drawer shadow,
  mixin registration, defaults (`inherit` button, `soft` chip, Dialog `sm`,
  Tooltip arrow, CardHeader `sx`, Skeleton wave/rounded, Stack flex gap),
  every contained palette button hovering on `main`, a selected `primary`
  ToggleButton inked `text.accent` (only `primary`; emitted before the
  `action.disabled` state rule), every clickable soft palette chip hovering
  on `opacity.soft.paletteHoverBg`, the grey soft hover (inherit button,
  `default` chip) still on `soft.hoverBg`, and every clickable filled palette
  chip on `main` for hover and focus-visible with `customShadows[color]` on
  hover (emitted before the disabled rule). `resolveStyle` reads only the
  favbase `styleOverrides`, never MUI's own root variants, so an interaction
  between the two (such as the chip focus cascade, or the filled override
  outranking MUI's `.dark` rules) is not testable here; both were confirmed
  from emitted CSS on 2026-10-02.
  WCAG block runs `it.each` over the six presets on the **resolved**
  `createTheme({ settingsState })` palettes: `text.accent` vs both grounds and
  the high-contrast ground, `primary.contrastText` vs `primary.main` (D14),
  `contrastText` vs the contained-primary hover stage (resolved from the button
  override, must be `main`), `contrastText` vs the filled-primary chip's hover
  and focus-visible stages (resolved from the chip override, both must be
  `main`), accent on the 16% soft wash (C-3/C-5), accent on
  the soft-primary button's hover wash over paper, `background.neutral` and
  the high-contrast light ground (alpha read from the
  `opacity.soft.paletteHoverBg` token the resolved style names; floor 4.58 at
  preset2 dark on neutral, coral dark neutral 4.99 — the tightest brand pair;
  setting the token back to 0.32 turns exactly those two cases red, 4.28 /
  4.30), soft `info` / `secondary` status-chip ink on the 16% wash over paper
  and neutral in both schemes (ink read from the resolved chip, `dark` / dark
  scheme `light`; floors info 4.66 light neutral, secondary 5.00 dark
  neutral), body text
  on the high-contrast ground (4.508), `palette[color].darker` on `palette[color].lighter` for all six
  colors — the `Label variant="inverted"` pair, floor 6.89:1 at success and
  7.95:1 for primary at preset4 (docs/25 Step 10; one pass covers both schemes
  because dark swaps the same pair and the ratio is symmetric) — plus the
  default theme's accent = coral `darker`/`light` and one primary ramp for both
  schemes. Imports only types from `@/lib/storage`, so it
  stays storage-free.
- `with-settings/update-core.test.ts` — default preset equals the base ramp /
  text / shadows; preset2 swaps `primary` (+ `118 53 220` channel and shadow)
  and derives `text.accent` `#200A69` / `#B985F4`; high contrast → light ground
  `#F4F6F8` + channel, dark ground unchanged, `card === z1` in both schemes;
  default contrast keeps the base card; `baseTheme` is not mutated.
- `with-settings/color-presets.test.ts` — key order, `default` equals
  `themeConfig.palette.primary`, five hex stages, `contrastText ∈ {ink, white}`
  with ≥ 4.5 on `main`, and the D14 pick table.
- `core/palette.test.ts` — scheme surfaces, Minimal grey ramp, dark ink,
  accent derivation (light `darker` / dark `light`), six-platform keys /
  channels / ≥ 3:1 contrast, `platform` survives `createTheme` as one CSS var
  per platform. Since docs/26 Step 2 it also locks **which** four platforms are
  hued and the eight brand hexes as literals — the values must survive their
  move into `PLATFORM_META.palette`, so they are not cross-checked against the
  registry they now come from.
- Provider wiring (bare `ThemeProvider` = coral, inside a preset2
  `SettingsProvider` = `#7635dc`) is covered by
  `components/settings/context/settings-provider.test.tsx`.

## Safety boundaries

- Keep both `colorSchemes.light` and `.dark`; test contrast and component
  states in both.
- Do not change the mode storage key, selector, ThemeProvider API, or MUI
  component props while editing theme tokens.
- Do not import this MUI theme into Shadow DOM content scripts; those use their
  own `--fb-*` token system.
- `paperStyles` embeds two `data:image/svg+xml;base64` washes in CSS
  `background-image`; the extension CSP restricts `script-src`/`object-src`
  only, so they load. Do not move them to `<img>` or fetch.
