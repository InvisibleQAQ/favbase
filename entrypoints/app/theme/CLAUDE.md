# app/theme

This directory owns the single MUI v7 CSS-variable theme used by `app.html`
and `welcome.html`. Pages consume semantic `theme.vars` tokens; they must not
copy palette, typography, radius, or elevation values into local `sx`.

## Owners

- `theme-config.ts` — primitive colors/fonts plus scheme-owned `text` and
  `background` values, platform identity colors, and the
  `data-color-scheme` selector.
- `core/palette.ts` — derives channels and assembles the MUI palette. The
  custom `platform` palette has one explicit key per `COLLECTION_PLATFORMS`
  entry; GitHub and X use scheme text ink.
- `core/typography.ts` — DM Sans Variable UI text and Barlow display text;
  fixed 28/24/20/16/14/12px scale with zero letter spacing.
- `core/shadows.ts` and `core/custom-shadows.ts` — MUI elevation and custom
  overlay tokens. Light cards use a low-strength card shadow; dark cards use a
  divider hairline and `card: 'none'`. Only dropdowns/dialogs cast strong
  floating shadows.
- `core/components.tsx` — shared defaults for buttons, cards, inputs, tabs,
  chips, papers, overlays, skeletons, tables, and `CssBaseline`.
- `create-theme.ts` — combines both color schemes and sets the base radius to
  8px.
- `theme-provider.tsx` — `ThemeVarsProvider` + `CssBaseline`; keep
  `defaultMode="system"` and `favbase-color-mode` synchronized with
  `public/theme-init.js`.

## Token contract

The neutral ramp is the Minimal v7 cold-grey ramp (`grey.50` through
`grey.900`); Favbase keeps the coral brand hue and platform identity tokens.
Scheme surfaces are:

| role | light | dark |
| --- | --- | --- |
| `background.default` | `#FFFFFF` | `#141A21` |
| `background.paper` | `#FFFFFF` | `#1C252E` |
| `background.neutral` | `#F4F6F8` | `#222B34` |
| `text.primary` | `#1C252E` | `#F4F6F8` |
| `text.secondary` | `#637381` | `#C4CDD5` |
| `text.accent` | `#7A2714` | `#FDA48A` |

Use `theme.vars.palette.text.*`, `background.*`, `divider`, `action.*`, and
`varAlpha(channel, alpha)`. `primary.main` is a brand block/icon signal, not
small text. Platform colors are restricted to platform glyphs and their own
analytics graphics; selection and navigation use the coral semantic roles.

## Component defaults

- Buttons have minimum heights 30/36/48px for small/medium/large and no
  elevation.
- Cards use an 8px radius and scheme-specific hairline/shadow treatment;
  `CardHeader` and `CardContent` use 24px spacing.
- InputBase, Input, FilledInput, and OutlinedInput provide 48px medium and
  40px small single-line targets. Multiline fields stay content-driven.
- Tabs and Tab use a 48px minimum target. Chips retain their native pill
  shape. Rounded Skeletons use the 8px base radius.
- Popover, Dialog, and Tooltip stay at or below 8px and consume their own
  dropdown/dialog elevation tokens. `CssBaseline` owns tabular numerals,
  scrollbar, selection, caret, and focus-visible rules.

When the base radius changes, page-local numeric `sx` values use `0.5` (4px)
for embedded media/progress, `0.75` (6px) for compact rows/tooltips, and `1`
(8px) for panels and surfaces. `50%` is reserved for circular/pill controls.

## Safety boundaries

- Keep both `colorSchemes.light` and `.dark`; test contrast and component
  states in both.
- Do not change the mode storage key, selector, ThemeProvider API, or MUI
  component props while editing theme tokens.
- Do not import this MUI theme into Shadow DOM content scripts; those use their
  own `--fb-*` token system.
