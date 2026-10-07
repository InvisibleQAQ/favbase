# app/theme

The single MUI v9 CSS-variable theme for `app.html` and `welcome.html`: a port
of Minimal Dashboard v7.7.0 `theme/core` and `with-settings` (primary colour
presets, high contrast) plus Favbase brand tokens. Pages consume `theme.vars.*`
and `theme.mixins.*`; they must not copy palette, typography, radius or
elevation values into local `sx`.

Every deviation from Minimal is marked `favbase override:` in source, with its
reason. Read those before "restoring" Minimal or MUI behaviour.

## Constraints

- Typography is a fixed scale, deliberately smaller than Minimal's, with no
  responsive scaling. Do not add `responsiveFontSizes` or copy Minimal's sizes.
  The one viewport-dependent page figure (Dashboard KPI,
  `[data-slot="kpi-value"]`) overrides at its call site and stays out of the
  theme.
- `text.accent` is the only brand shade allowed as text (links, outlined / text
  / soft `primary`, a selected toggle). `primary.main` is a block and icon
  signal; as small text it fails contrast. `text.accent` is derived from the
  active preset (`accentTextFor` in `core/palette.ts`), never hard-coded.
- One `primary` ramp serves both schemes; a preset swaps the whole ramp
  (`with-settings/update-core.ts`). `contrastText` is picked per preset by WCAG
  (`pickContrastText`), not Minimal's always-white, so some presets carry dark
  ink.
- Because `contrastText` can be dark ink, contained palette buttons and
  clickable filled palette chips stay on `main` on hover and focus instead of
  MUI's `.dark` (the ink fails on `.dark`). Do not "fix" the missing darken.
- A soft palette colour hovers on `opacity.soft.paletteHoverBg`, not Minimal's
  `soft.hoverBg`: at Minimal's alpha the soft ink drops below 4.5:1 over
  `background.neutral`. The grey `inherit` branch keeps `soft.hoverBg`.
- The brand wash for selected / active rows is
  `varAlpha(primary.mainChannel, 0.08)`, `0.16` on hover or for chip-like
  fills. `primary.lighter` is not a background in app code: it is opaque and
  turns into a pale block on the dark ground.
- Dark `background.neutral` deviates from Minimal on purpose: Minimal's value
  drops a platform colour below 3:1 (`core/palette.test.ts`).
- Platform colours are derived from `PLATFORM_META.palette` in
  `collection-platform-registry.ts`; change a brand hue there (its header
  comment says what must be re-validated), not here. Use them only for
  platform glyphs and their own analytics graphics.
- Button colour is chosen by role at the call site and the default stays
  `inherit`: primary action = `contained` + `primary`; secondary action =
  `soft` + `primary` (outlined primary is not used); inline clear link =
  `text` + `primary`; dialog dismissal and buttons inside a tinted Alert keep
  `inherit`. Do not flip the default to `primary`: that would re-ink dismissal
  and container-tinted buttons too.
- ToggleButton: pass `color="primary"` on the `ToggleButtonGroup`, which hands
  it to every child.
- Vertical Tabs have two sanctioned forms and must not be unified
  (`.trellis/spec/frontend/ui-design-system.md` §11 "Vertical Tabs"). The
  theme's horizontal `list` gap is skipped for `orientation="vertical"`, so a
  vertical consumer owns its row spacing.
- There is no `MuiMenu` override on purpose: Menu paper inherits
  `MuiPopover.paper`.
- High contrast is applied at token level (light ground + flattened
  `customShadows.card`), not through a second `MuiCssBaseline` override:
  `createTheme` would replace Favbase's function override instead of merging.
- `core/components/*` overrides are written as `root.variants` with
  `props: (ownerState) => boolean`; `theme-contract.test.ts` resolves them the
  way MUI does, so keep that form.
- Page-local `sx` radii are `0.5` / `0.75` / `1` only; larger radii (Card,
  Dialog, Popover, Skeleton) belong to the theme. `50%` is for circular or
  pill controls.
- Keep both `colorSchemes.light` and `.dark`; check contrast and component
  states in both.

## Colour mode

- Mode is two-state (`light` / `dark`) and defaults to light; `system` no
  longer exists.
- `defaultMode`, the `favbase-color-mode` storage key and the
  `data-color-scheme` selector must stay in sync with `public/theme-init.js`.
  That script normalizes any other stored value (nothing yet, or a legacy
  `system`) to `light` **and writes it back**, because a stored value beats
  `defaultMode`.
- `theme-provider.tsx` reads `SettingsContext` optionally, from the leaf file
  `components/settings/context/settings-context.ts` and not the barrel:
  welcome.html mounts no `SettingsProvider` and must get the coral defaults.
- `mode-transition.ts` depends on the `::view-transition-*(root)` rules in
  `app/global.css`.

## Pitfalls

- MUI v9 has no system props: layout and colour go through `sx`.
  `Typography color="text.secondary"` (dotted form) type-checks but emits no
  style; write `sx={{ color: 'text.secondary' }}`.
- Do not hand-type slot class strings; use the `*Classes` constants
  (`tabsClasses.list`). `MuiTabs-flexContainer` no longer exists and a rule
  written against it is silently dead CSS.
- Theme `defaultProps` differ from MUI's (Button `color="inherit"`, Chip
  `variant="soft"`, Tabs `scrollable`, Skeleton `rounded`, Stack
  `useFlexGap`): read the component file before adding props at a call site.
- `resolveStyle` in `theme-contract.test.ts` reads only Favbase
  `styleOverrides`, never MUI's own root variants. An interaction between the
  two (the chip focus cascade, the filled-chip override outranking MUI's
  `.dark` rule) cannot be tested there; verify it from emitted CSS.
- `paperStyles` embeds two `data:image/svg+xml;base64` washes in
  `background-image`; the extension CSP allows them. Do not move them to
  `<img>` or a fetch.
- Do not import this theme into Shadow DOM content scripts; those use their
  own `--fb-*` tokens.
- `createClasses` (`create-classes.ts`) is the only place the slot class
  prefix of shared primitives is joined.

## Guards

- `theme-contract.test.ts` — for every preset, WCAG 4.5:1 on: `text.accent`
  over both grounds and the high-contrast ground, `contrastText` over `main`
  and the button / chip hover and focus stages, soft ink over its washes, and
  the `Label variant="inverted"` pair. Also component defaults, radii, the
  mode key and the real `public/theme-init.js` source.
- `core/palette.test.ts` — platform colours at 3:1 on both grounds, and the
  brand hexes as literals (deliberately not cross-checked against the registry
  they come from).
- `with-settings/color-presets.test.ts`, `with-settings/update-core.test.ts` —
  the preset table and settings application.
