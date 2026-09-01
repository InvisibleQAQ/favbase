# app/theme

This directory owns the single MUI v9 CSS-variable theme used by `app.html`
and `welcome.html`. Since docs/25 Step 1 (2026-09-01) the visual language is
Minimal Dashboard's `theme/core` port; Favbase keeps its brand tokens and a
short list of functional overrides. Pages consume semantic `theme.vars`
tokens and `theme.mixins.*`; they must not copy palette, typography, radius,
or elevation values into local `sx`.

## Owners

| file | owns |
| --- | --- |
| `theme-config.ts` | Primitive colors/fonts, scheme-owned `text` / `background` values (dark ink = white / grey 500 / grey 600; dark `neutral` stays `#222B34`, see C-2 below), platform identity colors, `data-color-scheme` selector |
| `core/palette.ts` | Minimal palette skeleton: channels, `action`, `divider` (grey 500 @ 0.2), `TableCell.border`, `shared` hairlines (`inputOutlined` .2 / `inputUnderline` .32 / `paperOutlined` .16 / `buttonOutlined` .32), `colorKeys` iteration order. Favbase adds `primaryDark` (dark `lighter` re-inked), `text.accent`, and the six-key `platform` palette |
| `core/opacity.ts` | `theme.vars.opacity.*`: `switchTrack` / `inputUnderline` system alphas, `filled.commonHoverBg`, `outlined.border`, `soft.{bg,hoverBg,commonBg,commonHoverBg,border}` |
| `core/typography.ts` | Unchanged Favbase scale: DM Sans Variable UI text, Barlow display; fixed 28/24/20/16/14/12px, zero letter spacing (docs/25 D8) |
| `core/shadows.ts` | MUI 25-level elevation recolored to grey 500 (light) / black (dark) channel |
| `core/custom-shadows.ts` | `z1…z24`, `card`, `dialog`, `dropdown`, per-color shadows. Both schemes cast; `card` is never `'none'` |
| `core/mixins/` | `softStyles` / `filledStyles` / `menuItemStyles` / `paperStyles` (`background.ts`, `text.ts`, `global-styles-components.ts`), `maxLine` / `textGradient`, `bgBlur` / `bgGradient`, `hideScrollX/Y`, `scrollbarStyles`. `border.ts` (`borderGradient`) is not ported |
| `core/components/` | One file per MUI component family (`index.ts` spreads them). Minimal's MUI X and `@mui/lab` timeline entries are not ported. Every override is written as `root.variants` with `props: (ownerState) => boolean`; the contract test resolves them the same way MUI does |
| `create-theme.ts` | Assembles `colorSchemes.{light,dark}` = palette + shadows + customShadows + opacity, plus `mixins`, `components`, `typography`, `shape.borderRadius: 8` |
| `theme-provider.tsx` | `useMemo(createTheme)` + `ThemeVarsProvider` + `CssBaseline`; keep `defaultMode="system"` and `favbase-color-mode` synchronized with `public/theme-init.js` |
| `extend-theme-types.d.ts` | Module augmentation for palette / mixins / opacity / customShadows and the component `variant` / `color` / `size` extensions (Button `soft`/`xLarge`/`black`/`white`, Chip `soft`, Pagination `soft`, Fab, Badge, Avatar, Slider, Rating, Tabs `custom`) |

## Favbase overrides (marked `favbase override:` in source)

- `core/components/css-baseline.tsx` — whole file: tabular numerals, scrollbar, `::selection` (`primary.lighter`), caret, `:focus-visible` ring (`primary.darker` / dark `primary.main`).
- `core/components/typography.tsx` — `variantMapping: { subtitle1: 'p', subtitle2: 'p' }` (one page, one h1).
- `core/components/button.tsx` — outlined / text `primary` ink is `text.accent`; border and hover wash follow `currentColor`. The docs/23 ink-block `contained primary` special case is deleted (app has no `<Button color="primary">`).
- `core/mixins/global-styles-components.ts` — `softStyles(theme, 'primary')` text is `text.accent` (coral `dark` reads 3.99:1 on the 16% wash; C-3). Other colors keep Minimal's `dark` / dark-scheme `light`.
- `core/components/link.tsx` — `color: text.accent`.
- `core/components/dialog.tsx` — `defaultProps { fullWidth, maxWidth: 'sm' }`, paper `width calc(100% - 32px)` / `maxHeight calc(100dvh - 32px)`, actions `flexWrap + gap 12` (Minimal uses sibling margins).
- `core/components/tooltip.tsx` — `arrow: true, enterDelay: 400`; Minimal's arrowless `-4px` popper offset is not applied.
- `theme-config.ts` / `core/palette.ts` — coral `primary` (dark `lighter` `#3A2A24`), Favbase `error`, `platform.*`, `text.accent`, dark `background.neutral` `#222B34`.

## Token contract

| role | light | dark |
| --- | --- | --- |
| `background.default` | `#FFFFFF` | `#141A21` |
| `background.paper` | `#FFFFFF` | `#1C252E` |
| `background.neutral` | `#F4F6F8` | `#222B34` |
| `text.primary` | `#1C252E` | `#FFFFFF` |
| `text.secondary` | `#637381` | `#919EAB` |
| `text.disabled` | `#919EAB` | `#637381` |
| `text.accent` | `#7A2714` | `#FDA48A` |
| `divider` | grey 500 @ 0.2 | grey 500 @ 0.2 |

Use `theme.vars.palette.text.*`, `background.*`, `divider`, `shared.*`,
`action.*`, `theme.vars.opacity.*` and `varAlpha(channel, alpha)`.
`primary.main` is a brand block/icon signal, not small text; `text.accent` is
the only brand shade allowed as text. Platform colors are restricted to
platform glyphs and their own analytics graphics.

- **C-2** (docs/25): Minimal's dark neutral `#28323D` drops youtube dark
  `#D94040` to 2.95:1, so `#222B34` stays; `core/palette.test.ts` locks every
  platform color at ≥ 3:1 on `default` and `neutral`.
- **C-4**: there is no `MuiMenu` override. Menu paper inherits `MuiPopover.paper`
  (`paperStyles(dropdown)`: 4px inset, dropdown shadow, 10px radius) and the
  inner list has zero vertical padding.

## Component defaults

- Button: `color="inherit"`, `disableElevation`; sizes 30/36/48/56 (`xLarge`)
  via `--padding-y/x` CSS vars; `soft` variant; `contained inherit` inverts the
  scheme (`filledStyles`).
- Chip: default `variant="soft"`, radius 8 (small) / 10 (medium); `filled
  default` is the ink block; outlined default border `shared.buttonOutlined`.
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
  `indicatorColor="custom"` is the segmented pill form.
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
  object `props`), so every locked value below reads the same way MUI does:
  contrast (text / accent / inherit-contained / soft-primary on the 16% wash),
  `shared` + `opacity` vars, radii 16/10/16/6/8/10, input heights from
  `INPUT_PADDING`, real dark card shadow, directional temporary-drawer shadow,
  mixin registration, defaults (`inherit` button, `soft` chip, Dialog `sm`,
  Tooltip arrow, CardHeader `sx`, Skeleton wave/rounded, Stack flex gap).
- `core/palette.test.ts` — scheme surfaces, Minimal grey ramp, dark ink,
  six-platform keys / channels / ≥ 3:1 contrast, `platform` survives
  `createTheme` as one CSS var per platform.

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
