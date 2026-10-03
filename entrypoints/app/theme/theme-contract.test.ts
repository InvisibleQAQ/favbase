import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { varAlpha } from 'minimal-shared/utils';
import { chipClasses } from '@mui/material/Chip';
import { toggleButtonClasses } from '@mui/material/ToggleButton';

import type { ThemeContrast, ThemeColorPreset } from '@/lib/storage';

import { COLOR_MODE_STORAGE_KEY } from './theme-provider';
import { createTheme } from './create-theme';
import { themeConfig } from './theme-config';
import { customShadows } from './core/custom-shadows';
import { colorKeys } from './core/palette';
import { primaryColorPresets } from './with-settings/color-presets';
import { INPUT_PADDING, INPUT_TYPOGRAPHY } from './core/components/text-field';

const theme = createTheme();

const SCHEMES = ['light', 'dark'] as const;
// Type-only import from `@/lib/storage` keeps this test storage-free; the
// preset list is read from the theme owner (its `Record<ThemeColorPreset, …>`
// key set is locked to the persisted enum by the compiler).
const PRESETS = Object.keys(primaryColorPresets) as ThemeColorPreset[];
const PRIMARY_STAGES = ['lighter', 'light', 'main', 'dark', 'darker'] as const;

/** The theme app.html builds for a persisted preset / contrast pair. */
function themeFor(primaryColor: ThemeColorPreset, contrast: ThemeContrast = 'default') {
  return createTheme({ settingsState: { primaryColor, contrast, compactLayout: false } });
}

function paletteOf(built: ReturnType<typeof createTheme>, scheme: (typeof SCHEMES)[number]) {
  const palette = built.colorSchemes[scheme]?.palette;
  if (!palette) throw new Error(`missing ${scheme} scheme`);
  return palette;
}

/** A soft-variant alpha as the built scheme carries it (never a typed literal). */
function softAlpha(
  built: ReturnType<typeof createTheme>,
  scheme: (typeof SCHEMES)[number],
  key: 'bg' | 'hoverBg' | 'paletteHoverBg',
): number {
  const alpha = built.colorSchemes[scheme]?.opacity.soft[key];
  if (typeof alpha !== 'number') throw new Error(`missing ${scheme} opacity.soft.${key}`);
  return alpha;
}

/** WCAG 2.x relative luminance for the static theme hex values. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

/** `alpha` of `hex` composited over the opaque `base` (soft-variant wash). */
function blend(hex: string, alpha: number, base: string): string {
  const channel = (color: string, offset: number) => parseInt(color.slice(offset, offset + 2), 16);
  return `#${[1, 3, 5]
    .map((offset) => {
      const mixed = Math.round(alpha * channel(hex, offset) + (1 - alpha) * channel(base, offset));
      return mixed.toString(16).padStart(2, '0').toUpperCase();
    })
    .join('')}`;
}

type OwnerState = Record<string, unknown>;
type StyleFn = (params: { theme: typeof theme; ownerState: OwnerState } & OwnerState) => Record<string, unknown>;
type StyleValue = Record<string, unknown> | StyleFn;
type Variant = { props: OwnerState | ((props: OwnerState) => boolean); style: StyleValue };

function callStyle(style: StyleValue, ownerState: OwnerState): Record<string, unknown> {
  return typeof style === 'function' ? style({ theme, ownerState, ...ownerState }) : style;
}

function variantMatches(variant: Variant, ownerState: OwnerState): boolean {
  if (typeof variant.props === 'function') return variant.props(ownerState);
  return Object.entries(variant.props).every(([key, value]) => ownerState[key] === value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Per-property merge. Two variants that emit the same nested selector
 * (`&.Mui-selected`, `&:hover`) become two CSS rules that cascade property by
 * property; neither replaces the other wholesale.
 */
function mergeStyle(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const current = merged[key];
    merged[key] = isPlainObject(current) && isPlainObject(value) ? mergeStyle(current, value) : value;
  }
  return merged;
}

/**
 * The style objects a slot emits for `ownerState`, in cascade order: the base
 * object, then every `variants` entry whose `props` match.
 */
function matchedStyles(component: string, slot: string, ownerState: OwnerState = {}): Record<string, unknown>[] {
  const override = (theme.components as Record<string, { styleOverrides?: Record<string, StyleValue> }>)[component]
    ?.styleOverrides?.[slot];
  if (!override) return [];
  const { variants, ...base } = callStyle(override, ownerState) as { variants?: Variant[] } & Record<string, unknown>;
  const matched = (variants ?? []).filter((variant) => variantMatches(variant, ownerState));
  return [base, ...matched.map((variant) => callStyle(variant.style, ownerState))];
}

/**
 * Resolves a slot the way MUI does: the base style object, then every
 * matching variant, later entries winning per property. Minimal writes nearly
 * every override as a variant, so a plain lookup would read `undefined` for
 * radius, height or shadow.
 */
function resolveStyle(component: string, slot: string, ownerState: OwnerState = {}): Record<string, unknown> {
  return matchedStyles(component, slot, ownerState).reduce(mergeStyle, {});
}

describe('theme token contract', () => {
  it('propagates scheme-owned semantic tokens through both CSS-variable color schemes', () => {
    expect(theme.colorSchemes.light?.palette.text?.primary).toBe(themeConfig.scheme.light.text.primary);
    expect(theme.colorSchemes.light?.palette.text?.secondary).toBe(themeConfig.scheme.light.text.secondary);
    expect(theme.colorSchemes.light?.palette.background?.neutral).toBe(themeConfig.scheme.light.background.neutral);
    expect(theme.colorSchemes.dark?.palette.text?.primary).toBe(themeConfig.scheme.dark.text.primary);
    expect(theme.colorSchemes.dark?.palette.text?.secondary).toBe(themeConfig.scheme.dark.text.secondary);
    expect(theme.colorSchemes.dark?.palette.background?.paper).toBe(themeConfig.scheme.dark.background.paper);
    expect(theme.vars.palette.text.primary).toMatch(/^var\(--palette-text-primary/);
    expect(theme.vars.palette.background.default).toMatch(/^var\(--palette-background-default/);
  });

  it('exposes the Minimal shared hairlines and opacity tokens in both schemes', () => {
    expect(theme.colorSchemes.light?.palette.shared.inputOutlined).toMatch(/^rgba\(/);
    expect(theme.colorSchemes.dark?.palette.shared.paperOutlined).toMatch(/^rgba\(/);
    expect(theme.vars.palette.shared.buttonOutlined).toMatch(/^var\(--palette-shared-buttonOutlined/);
    expect(theme.vars.opacity.soft.bg).toMatch(/^var\(--opacity-soft-bg/);
    expect(theme.colorSchemes.light?.opacity.soft.bg).toBe(0.16);
    expect(theme.vars.opacity.soft.paletteHoverBg).toMatch(/^var\(--opacity-soft-paletteHoverBg/);
    expect(theme.colorSchemes.dark?.opacity.soft.paletteHoverBg).toBe(theme.colorSchemes.light?.opacity.soft.paletteHoverBg);
  });

  it.each(SCHEMES)('%s text and action colors meet WCAG contrast', (scheme) => {
    const colors = themeConfig.scheme[scheme];
    // `contained` + `inherit` (Minimal's default color) inverts the scheme:
    // `text.primary` under `background.paper`. Primary actions no longer use it
    // (they are `color="primary"`, asserted per preset below), but the skin exists.
    const containedBackground = colors.text.primary;
    const containedForeground = colors.background.paper;

    expect(contrastRatio(colors.text.primary, colors.background.default)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.text.secondary, colors.background.default)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(containedForeground, containedBackground)).toBeGreaterThanOrEqual(4.5);
  });

  // docs/25 Step 2: the high-contrast option swaps the light ground for grey 200.
  // `text.secondary` reads 4.508:1 there — the tightest pair in the theme.
  it('keeps body text readable on the high-contrast light ground', () => {
    const palette = paletteOf(themeFor('default', 'high'), 'light');
    expect(palette.background.default).toBe(themeConfig.palette.grey['200']);
    expect(contrastRatio(palette.text.primary, palette.background.default)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.text.secondary, palette.background.default)).toBeGreaterThanOrEqual(4.5);
  });

  // docs/25 C-5: `text.accent` is derived per preset (light `darker` / dark
  // `light`) and has to clear 4.5 on the ground of both schemes and on the
  // high-contrast ground, for every preset the drawer can select.
  it.each(PRESETS)('%s text.accent meets WCAG contrast on both grounds', (preset) => {
    for (const scheme of SCHEMES) {
      const palette = paletteOf(themeFor(preset), scheme);
      expect(
        contrastRatio(palette.text.accent, palette.background.default),
        `${preset} ${scheme} accent on default`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    const highContrast = paletteOf(themeFor(preset, 'high'), 'light');
    expect(
      contrastRatio(highContrast.text.accent, highContrast.background.default),
      `${preset} accent on the high-contrast ground`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  // docs/25 D14: `contrastText` is picked per preset (ink or white), never
  // copied from Minimal, so the brand stamp stays readable on every hue.
  it.each(PRESETS)('%s primary.contrastText meets WCAG contrast on primary.main', (preset) => {
    for (const scheme of SCHEMES) {
      const { primary } = paletteOf(themeFor(preset), scheme);
      expect(contrastRatio(primary.contrastText, primary.main), `${preset} ${scheme}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // 2026-10-02: primary actions are `contained` + `color="primary"`. MUI hovers
  // a contained button to `.dark`, where the ink `contrastText` falls to 3.69
  // (default) / 2.26 (preset1) / 4.06 (preset4) / 2.60 (preset5); the theme
  // keeps hover on a stage that has to clear 4.5 for every preset.
  it.each(PRESETS)('%s contained primary keeps contrastText readable on hover', (preset) => {
    const hover = resolveStyle('MuiButton', 'root', { variant: 'contained', color: 'primary' })['&:hover'] as
      | Record<string, unknown>
      | undefined;
    const stage = PRIMARY_STAGES.find((key) => theme.vars.palette.primary[key] === hover?.backgroundColor);
    if (!stage) throw new Error(`hover background is not a primary stage: ${String(hover?.backgroundColor)}`);
    expect(stage).toBe('main');
    for (const scheme of SCHEMES) {
      const { primary } = paletteOf(themeFor(preset), scheme);
      expect(contrastRatio(primary.contrastText, primary[stage]), `${preset} ${scheme}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // The selected `FilterChip` is a clickable filled primary chip: the same ink
  // `contrastText` on the same `main`, and MUI hovers and focuses it to `.dark`
  // exactly like the contained button (3.69 default / 2.26 preset1 / 4.06
  // preset4 / 2.60 preset5). Both states have to resolve to a stage that clears
  // 4.5 for every preset.
  it.each(PRESETS)('%s filled primary chip keeps contrastText readable on hover and focus', (preset) => {
    const clickable = resolveStyle('MuiChip', 'root', { variant: 'filled', color: 'primary', size: 'medium' })[
      `&.${chipClasses.clickable}`
    ] as Record<string, Record<string, unknown> | undefined> | undefined;
    for (const [state, style] of [
      ['hover', clickable?.['&:hover']],
      ['focus-visible', clickable?.[`&.${chipClasses.focusVisible}`]],
    ] as const) {
      const stage = PRIMARY_STAGES.find((key) => theme.vars.palette.primary[key] === style?.backgroundColor);
      if (!stage) throw new Error(`${state} background is not a primary stage: ${String(style?.backgroundColor)}`);
      expect(stage, state).toBe('main');
      for (const scheme of SCHEMES) {
        const { primary } = paletteOf(themeFor(preset), scheme);
        expect(
          contrastRatio(primary.contrastText, primary[stage]),
          `${preset} ${scheme} ${state}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // docs/25 C-3 / C-5: a soft primary chip is `text.accent` on a 16% wash of
  // the preset's `main` over paper. Coral `primary.dark` would read 3.99:1 in
  // light; the derived accent clears 4.5 for all six presets.
  it.each(PRESETS)('%s soft primary text meets WCAG contrast on the 16% wash', (preset) => {
    for (const scheme of SCHEMES) {
      const palette = paletteOf(themeFor(preset), scheme);
      const wash = blend(palette.primary.main, 0.16, palette.background.paper);
      expect(contrastRatio(palette.text.accent, wash), `${preset} ${scheme}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // 2026-10-02: secondary actions are `variant="soft"` + `color="primary"`, and
  // the B站 card's transcribe / retry chips ride the same palette branch.
  // Hovered, the wash rises to `opacity.soft.paletteHoverBg` (24%); the C-5 row
  // above only covers rest. Minimal's 32% fails on `background.neutral` (coral
  // dark 4.28, preset2 dark 4.30), and a chip on a hovered `CollectionCard`
  // always sits on neutral — so neutral and the high-contrast light ground are
  // grounds here, not just paper. Measured floor 4.58:1 (preset2 dark on
  // neutral). The alpha is read from the scheme token the resolved button
  // style names, never typed here.
  it.each(PRESETS)('%s soft primary text meets WCAG contrast on its hover wash over every ground', (preset) => {
    const soft = resolveStyle('MuiButton', 'root', { variant: 'soft', color: 'primary' });
    const hover = soft['&:hover'] as Record<string, unknown> | undefined;
    expect(soft.color).toBe(theme.vars.palette.text.accent);
    expect(hover?.backgroundColor).toBe(
      varAlpha(theme.vars.palette.primary.mainChannel, theme.vars.opacity.soft.paletteHoverBg),
    );
    const built = themeFor(preset);
    const cases = SCHEMES.flatMap((scheme) => {
      const palette = paletteOf(built, scheme);
      const alpha = softAlpha(built, scheme, 'paletteHoverBg');
      return [
        { label: `${scheme} paper`, palette, ground: palette.background.paper, alpha },
        { label: `${scheme} neutral`, palette, ground: palette.background.neutral, alpha },
      ];
    });
    const highContrast = themeFor(preset, 'high');
    const highPalette = paletteOf(highContrast, 'light');
    cases.push({
      label: 'high-contrast light ground',
      palette: highPalette,
      ground: highPalette.background.default,
      alpha: softAlpha(highContrast, 'light', 'paletteHoverBg'),
    });
    for (const { label, palette, ground, alpha } of cases) {
      const wash = blend(palette.primary.main, alpha, ground);
      expect(contrastRatio(palette.text.accent, wash), `${preset} ${label}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // B站 card badges (2026-10-02): "has a transcript" is soft `info`, "searchable"
  // soft `secondary`. They are never clickable, so only the 16% rest wash
  // matters, but the card under them hovers to `background.neutral`. The ink is
  // the resolved chip's own (`dark` in light, `light` in dark). Measured floors:
  // info 4.66 (light, neutral), secondary 5.00 (dark, neutral).
  it.each(['info', 'secondary'] as const)('soft %s status chip text meets WCAG contrast on paper and neutral', (key) => {
    const chip = resolveStyle('MuiChip', 'root', { variant: 'soft', color: key, size: 'small' });
    const darkSelector = Object.keys(theme.applyStyles('dark', { color: 'probe' }))[0];
    expect(chip.color).toBe(theme.vars.palette[key].dark);
    expect((chip[darkSelector] as Record<string, unknown> | undefined)?.color).toBe(theme.vars.palette[key].light);
    expect(chip.backgroundColor).toBe(varAlpha(theme.vars.palette[key].mainChannel, theme.vars.opacity.soft.bg));
    const inkStage = { light: 'dark', dark: 'light' } as const;
    for (const scheme of SCHEMES) {
      const palette = paletteOf(theme, scheme);
      const alpha = softAlpha(theme, scheme, 'bg');
      for (const ground of ['paper', 'neutral'] as const) {
        const wash = blend(palette[key].main, alpha, palette.background[ground]);
        expect(
          contrastRatio(palette[key][inkStage[scheme]], wash),
          `${key} ${scheme} on ${ground}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // docs/25 Step 10: `Label variant="inverted"` inks `palette[color].darker`
  // on `palette[color].lighter` — a deliberate reversal, not the "pale block as
  // selected background" the brand wash replaced. Two facts collapse the matrix:
  // (1) the dark scheme swaps foreground and background of the *same* pair, and
  // a contrast ratio is symmetric, so one pass covers both schemes; (2) only
  // `primary` moves with the preset, so the other five ramps are re-asserted
  // per preset for free. Measured floor 6.89:1 (success); primary's own floor is
  // 7.95:1 (preset4). The variant has no consumer yet — this is what keeps it
  // from shipping unreadable the day it gets one.
  it.each(PRESETS)('%s inverted label ink meets WCAG contrast on its own lighter stage', (preset) => {
    const palette = paletteOf(themeFor(preset), 'light');
    for (const key of colorKeys.palette) {
      expect(
        contrastRatio(palette[key].darker, palette[key].lighter),
        `${preset} ${key} darker on lighter`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('derives text.accent from the coral ramp and shares that ramp across both schemes', () => {
    expect(theme.colorSchemes.light?.palette.text.accent).toBe(themeConfig.palette.primary.darker);
    expect(theme.colorSchemes.dark?.palette.text.accent).toBe(themeConfig.palette.primary.light);
    // The dark scheme no longer re-inks `primary.lighter` (docs/25 Step 2):
    // app code washes with `varAlpha(primary.mainChannel, …)` instead.
    expect(theme.colorSchemes.dark?.palette.primary.lighter).toBe(themeConfig.palette.primary.lighter);
    expect(theme.colorSchemes.dark?.palette.primary).toEqual(theme.colorSchemes.light?.palette.primary);
  });

  it('routes soft primary through text.accent and keeps the other soft colors on their dark shade', () => {
    const primary = theme.mixins.softStyles(theme, 'primary');
    expect(primary.color).toBe(theme.vars.palette.text.accent);
    expect(primary.backgroundColor).toContain('--palette-primary-mainChannel');
    const info = theme.mixins.softStyles(theme, 'info');
    expect(info.color).toBe(theme.vars.palette.info.dark);
    expect(theme.mixins.paperStyles(theme, { dropdown: true }).borderRadius).toBe('10px');
  });
});

describe('theme geometry and component defaults', () => {
  it('uses the compact fixed type scale and an 8px base radius', () => {
    expect(theme.shape.borderRadius).toBe(8);
    expect(theme.typography.h1.fontSize).toBe('1.75rem');
    expect(theme.typography.h2.fontSize).toBe('1.5rem');
    expect(theme.typography.h3.fontSize).toBe('1.25rem');
    expect(theme.typography.h1.letterSpacing).toBe(0);
    expect(theme.typography.h2.letterSpacing).toBe(0);
    expect(theme.typography.h3.letterSpacing).toBe(0);
    expect(theme.typography.overline.letterSpacing).toBe(0);
  });

  it('keeps component defaults in the theme owner', () => {
    expect(theme.components?.MuiButton?.defaultProps).toMatchObject({ color: 'inherit', disableElevation: true });
    expect(theme.components?.MuiChip?.defaultProps?.variant).toBe('soft');
    expect(theme.components?.MuiPaper?.defaultProps?.elevation).toBe(0);
    expect(theme.components?.MuiDialog?.defaultProps).toMatchObject({ fullWidth: true, maxWidth: 'sm' });
    expect(theme.components?.MuiTooltip?.defaultProps).toMatchObject({ arrow: true, enterDelay: 400 });
    expect(theme.components?.MuiTextField?.defaultProps?.variant).toBe('outlined');
    expect(theme.components?.MuiFilledInput?.defaultProps?.disableUnderline).toBe(true);
    expect(theme.components?.MuiCardHeader?.defaultProps?.slotProps?.title).toEqual({ variant: 'h6' });
    expect(theme.components?.MuiCardHeader?.defaultProps?.slotProps?.subheader).toEqual({
      variant: 'body2',
      sx: { mt: 0.5 },
    });
    expect(theme.components?.MuiTypography?.defaultProps?.variantMapping?.subtitle1).toBe('p');
    expect(theme.components?.MuiTypography?.defaultProps?.variantMapping?.subtitle2).toBe('p');
    expect(theme.components?.MuiSkeleton?.defaultProps).toMatchObject({ animation: 'wave', variant: 'rounded' });
    expect(theme.components?.MuiStack?.defaultProps?.useFlexGap).toBe(true);
  });

  it('keeps button heights 30/36/48/56 as size variants', () => {
    expect(resolveStyle('MuiButton', 'root', { size: 'small' }).minHeight).toBe(30);
    expect(resolveStyle('MuiButton', 'root', { size: 'medium' }).minHeight).toBe(36);
    expect(resolveStyle('MuiButton', 'root', { size: 'large' }).minHeight).toBe(48);
    expect(resolveStyle('MuiButton', 'root', { size: 'xLarge' }).minHeight).toBe(56);
  });

  it('inks outlined/text primary buttons with text.accent and inverts the inherit contained button', () => {
    expect(resolveStyle('MuiButton', 'root', { variant: 'outlined', color: 'primary' }).color).toBe(
      theme.vars.palette.text.accent,
    );
    expect(resolveStyle('MuiButton', 'root', { variant: 'text', color: 'primary' }).color).toBe(
      theme.vars.palette.text.accent,
    );
    const contained = resolveStyle('MuiButton', 'root', { variant: 'contained', color: 'inherit' });
    expect(contained.color).toBe(theme.vars.palette.common.white);
    expect(contained.backgroundColor).toBe(theme.vars.palette.grey[800]);
  });

  // button.tsx favbase override: no palette color hovers to `.dark`, so a
  // contained button reads on hover exactly as it does at rest.
  it('keeps every contained palette button on main when hovered', () => {
    for (const key of colorKeys.palette) {
      const hover = resolveStyle('MuiButton', 'root', { variant: 'contained', color: key })['&:hover'] as
        | Record<string, unknown>
        | undefined;
      expect(hover?.backgroundColor, key).toBe(theme.vars.palette[key].main);
      expect(hover?.boxShadow, key).toBe(theme.vars.customShadows[key]);
    }
  });

  // button-toggle.tsx favbase override: MUI inks a selected `primary` toggle
  // with `primary.main` (coral 2.5:1 as text). Only `primary` is re-inked, and
  // the state variants after it still grey out a disabled toggle.
  it('inks a selected primary toggle with text.accent and leaves other colors to MUI', () => {
    const selected = `&.${toggleButtonClasses.selected}`;
    const disabled = `&.${toggleButtonClasses.disabled}`;
    const ownerState = { color: 'primary', size: 'medium' };
    const primary = resolveStyle('MuiToggleButton', 'root', ownerState);
    expect(primary[selected]).toMatchObject({
      color: theme.vars.palette.text.accent,
      borderColor: 'currentColor',
    });
    // Same specificity, so order decides a selected + disabled toggle: the
    // accent rule has to be emitted before the `action.disabled` one.
    const colorOf = (style: Record<string, unknown>, key: string) => (style[key] as { color?: unknown } | undefined)?.color;
    const emitted = matchedStyles('MuiToggleButton', 'root', ownerState);
    const accentAt = emitted.findIndex((style) => colorOf(style, selected) === theme.vars.palette.text.accent);
    const greyAt = emitted.findIndex((style) => colorOf(style, disabled) === theme.vars.palette.action.disabled);
    expect(accentAt).toBeGreaterThanOrEqual(0);
    expect(accentAt).toBeLessThan(greyAt);
    for (const color of ['standard', 'info'] as const) {
      const other = resolveStyle('MuiToggleButton', 'root', { color, size: 'medium' });
      expect((other[selected] as Record<string, unknown>).color, color).toBeUndefined();
    }
  });

  // global-styles-components.ts favbase override: a clickable soft palette
  // chip (B站 transcribe / retry) hovers to the same 24% palette wash as the
  // soft button. Keyboard focus is not overridden: the soft base re-emitted
  // under `&.MuiChip-clickable` already shadows MUI's `.Mui-focusVisible`
  // `.dark` rule (see chip.tsx). `resolveStyle` reads only favbase overrides,
  // never MUI's own root variants, so that interaction is not testable here.
  it('hovers a clickable soft palette chip on the palette hover wash', () => {
    const clickable = `&.${chipClasses.clickable}`;
    for (const key of colorKeys.palette) {
      const wash = varAlpha(theme.vars.palette[key].mainChannel, theme.vars.opacity.soft.paletteHoverBg);
      const chip = resolveStyle('MuiChip', 'root', { variant: 'soft', color: key, size: 'small' })[clickable] as
        | Record<string, Record<string, unknown> | undefined>
        | undefined;
      expect(chip?.['&:hover']?.backgroundColor, `${key} hover`).toBe(wash);
    }
  });

  // The palette wash is a favbase override; the grey `inherit` branch (soft
  // inherit Button, unselected `FilterChip` = soft `default` Chip) keeps
  // Minimal's `soft.hoverBg`.
  it('keeps the grey soft hover on soft.hoverBg', () => {
    const grey = varAlpha(theme.vars.palette.grey['500Channel'], theme.vars.opacity.soft.hoverBg);
    const button = resolveStyle('MuiButton', 'root', { variant: 'soft', color: 'inherit' })['&:hover'] as
      | Record<string, unknown>
      | undefined;
    expect(button?.backgroundColor).toBe(grey);
    const chip = resolveStyle('MuiChip', 'root', { variant: 'soft', color: 'default', size: 'small' })[
      `&.${chipClasses.clickable}`
    ] as Record<string, Record<string, unknown> | undefined> | undefined;
    expect(chip?.['&:hover']?.backgroundColor).toBe(grey);
  });

  // chip.tsx favbase override: a clickable filled palette chip (the selected
  // `FilterChip`) stays on `main` when hovered or keyboard-focused, with the
  // per-color shadow as the hover cue, like the contained button. `resolveStyle`
  // reads only favbase overrides, never MUI's own root variants, so whether
  // this beats MUI's `:hover` / `.Mui-focusVisible` `.dark` rules is not
  // testable here. It was confirmed from the emitted CSS on 2026-10-02: the
  // override renders as `.css-….MuiChip-clickable:hover` and
  // `.css-….MuiChip-clickable.Mui-focusVisible` (three classes) against MUI's
  // two, and the disabled `.Mui-disabled:not(.MuiChip-outlined)` rule (three)
  // is emitted after it. That last order is what is asserted below.
  it('keeps every clickable filled palette chip on main when hovered or focused', () => {
    const clickable = `&.${chipClasses.clickable}`;
    const focus = `&.${chipClasses.focusVisible}`;
    const disabled = `&.${chipClasses.disabled}`;
    type Nested = Record<string, Record<string, unknown> | undefined> | undefined;
    for (const key of colorKeys.palette) {
      const ownerState = { variant: 'filled', color: key, size: 'medium' };
      const chip = resolveStyle('MuiChip', 'root', ownerState)[clickable] as Nested;
      expect(chip?.['&:hover']?.backgroundColor, `${key} hover`).toBe(theme.vars.palette[key].main);
      // `toBe` alone would pass with both sides `undefined`; pin the var first.
      expect(theme.vars.customShadows[key], `${key} shadow token`).toMatch(/^var\(--customShadows-/);
      expect(chip?.['&:hover']?.boxShadow, `${key} hover shadow`).toBe(theme.vars.customShadows[key]);
      expect(chip?.[focus]?.backgroundColor, `${key} focus-visible`).toBe(theme.vars.palette[key].main);
      // Same specificity as the disabled rule, so order decides a disabled chip.
      const emitted = matchedStyles('MuiChip', 'root', ownerState);
      const mainAt = emitted.findIndex(
        (style) => (style[clickable] as Nested)?.['&:hover']?.backgroundColor === theme.vars.palette[key].main,
      );
      const greyAt = emitted.findIndex(
        (style) =>
          (style[disabled] as Nested)?.[`&:not(.${chipClasses.outlined})`]?.backgroundColor ===
          theme.vars.palette.action.disabledBackground,
      );
      expect(mainAt, `${key} override emitted`).toBeGreaterThanOrEqual(0);
      expect(mainAt, `${key} override before disabled`).toBeLessThan(greyAt);
    }
  });

  // docs/25 D11: single-line height = 24px line box + INPUT_PADDING; the theme
  // sets no `minHeight`. Outlined medium 56 / small 40, base 32 / 28.
  it('derives input heights from INPUT_PADDING (outlined 56/40)', () => {
    const line = INPUT_TYPOGRAPHY.lineHeight;
    const height = (pad: { paddingTop: number; paddingBottom: number }) => line + pad.paddingTop + pad.paddingBottom;
    expect(height(INPUT_PADDING.outlined.medium)).toBe(56);
    expect(height(INPUT_PADDING.outlined.small)).toBe(40);

    expect(resolveStyle('MuiInputBase', 'root').lineHeight).toBe(`${line}px`);
    expect(resolveStyle('MuiInputBase', 'input', { size: 'medium' })).toMatchObject({
      height: `${line}px`,
      ...INPUT_PADDING.base.medium,
    });
    expect(resolveStyle('MuiOutlinedInput', 'input', { size: 'medium' })).toMatchObject(INPUT_PADDING.outlined.medium);
    expect(resolveStyle('MuiOutlinedInput', 'input', { size: 'small' })).toMatchObject(INPUT_PADDING.outlined.small);
    expect(resolveStyle('MuiOutlinedInput', 'input', { multiline: true }).padding).toBe(0);
    expect(resolveStyle('MuiOutlinedInput', 'root', { multiline: true })).toMatchObject(INPUT_PADDING.outlined.medium);
    expect(resolveStyle('MuiOutlinedInput', 'root', { multiline: false }).paddingTop).toBeUndefined();
    expect(resolveStyle('MuiFilledInput', 'input', { size: 'small' })).toMatchObject(INPUT_PADDING.filled.small);
    expect(resolveStyle('MuiInputLabel', 'root', { shrink: false, variant: 'outlined', size: 'medium' }).transform).toBe(
      `translate(14px, ${INPUT_PADDING.outlined.medium.paddingTop}px) scale(1)`,
    );
  });

  it('keeps surface radii graded from the 8px base (card/dialog 16, dropdown 10, tooltip 6)', () => {
    // Minimal card ×2 behind a CSS-var hook; dropdown ×1.25; skeleton rounded ×2.
    expect(resolveStyle('MuiCard', 'root').borderRadius).toContain('16px');
    expect(resolveStyle('MuiCardContent', 'root').padding).toBe(theme.spacing(3));
    expect(resolveStyle('MuiPopover', 'paper').borderRadius).toBe('10px');
    expect(resolveStyle('MuiDialog', 'paper', { fullScreen: false }).borderRadius).toBe(16);
    expect(resolveStyle('MuiDialog', 'paper', { fullScreen: false }).width).toBe(`calc(100% - ${theme.spacing(4)})`);
    expect(resolveStyle('MuiDialog', 'paper', { fullScreen: false }).maxHeight).toBe(
      `calc(100dvh - ${theme.spacing(4)})`,
    );
    expect(resolveStyle('MuiDialog', 'paper', { fullScreen: true }).borderRadius).toBeUndefined();
    expect(resolveStyle('MuiDialogTitle', 'root').padding).toBe(theme.spacing(3));
    expect(resolveStyle('MuiDialogContent', 'root').padding).toBe(theme.spacing(0, 3));
    expect(resolveStyle('MuiDialogActions', 'root')).toMatchObject({ padding: theme.spacing(3), flexWrap: 'wrap' });
    // docs/25 C-4: Menu inherits the Popover paper (4px inset); its list adds none.
    expect(theme.components?.MuiMenu).toBeUndefined();
    expect(resolveStyle('MuiPopover', 'paper').padding).toBe(theme.spacing(0.5));
    expect(resolveStyle('MuiPopover', 'paper')['& .MuiList-root']).toEqual({ paddingTop: 0, paddingBottom: 0 });
    expect(resolveStyle('MuiMenuItem', 'root').borderRadius).toBe(6);
    expect(resolveStyle('MuiTooltip', 'tooltip').borderRadius).toBe(6);
    expect(resolveStyle('MuiSkeleton', 'rounded').borderRadius).toBe(16);
    expect(resolveStyle('MuiChip', 'root', { size: 'small' }).borderRadius).toBe('8px');
    expect(resolveStyle('MuiChip', 'root', { size: 'medium' }).borderRadius).toBe('10px');
  });

  it('casts real shadows in both schemes and keeps overlays floating', () => {
    const card = resolveStyle('MuiCard', 'root');
    expect(card.boxShadow).toContain('var(--customShadows-card');
    expect(card.border).toBeUndefined();
    expect(JSON.stringify(card)).not.toContain('none');
    expect(resolveStyle('MuiPopover', 'paper').boxShadow).toContain('var(--customShadows-dropdown');
    expect(resolveStyle('MuiDialog', 'paper', { fullScreen: false }).boxShadow).toContain('var(--customShadows-dialog');
    // Temporary drawers cast a directional Minimal shadow; permanent shell nav stays flat.
    expect(resolveStyle('MuiDrawer', 'paper', { variant: 'temporary', anchor: 'left' }).boxShadow).toContain('80px -8px');
    expect(resolveStyle('MuiDrawer', 'paper', { variant: 'permanent', anchor: 'left' }).boxShadow).toBeUndefined();
    expect(customShadows.light?.card).not.toBe('none');
    expect(customShadows.dark?.card).not.toBe('none');
    // Dark casts the black channel; light casts grey 500.
    expect(customShadows.dark?.card).toContain('rgba(0 0 0');
    expect(customShadows.light?.card).toContain('rgba(145 158 171');
  });

  it('registers the Minimal mixins on the theme', () => {
    expect(typeof theme.mixins.softStyles).toBe('function');
    expect(typeof theme.mixins.filledStyles).toBe('function');
    expect(typeof theme.mixins.menuItemStyles).toBe('function');
    expect(typeof theme.mixins.paperStyles).toBe('function');
    expect(typeof theme.mixins.maxLine).toBe('function');
    expect(typeof theme.mixins.bgBlur).toBe('function');
    expect(typeof theme.mixins.bgGradient).toBe('function');
    expect(theme.mixins.hideScrollX).toMatchObject({ overflowX: 'auto' });
    expect(theme.mixins.hideScrollY).toMatchObject({ overflowY: 'auto' });
    expect(theme.mixins.maxLine({ line: 2 })).toMatchObject({ WebkitLineClamp: 2 });
  });
});

describe('theme mode compatibility', () => {
  it('preserves the persisted mode key and data attribute selector', () => {
    expect(COLOR_MODE_STORAGE_KEY).toBe('favbase-color-mode');
    expect(themeConfig.cssVariables.colorSchemeSelector).toBe('data-color-scheme');
    expect(theme.defaultColorScheme).toBe('light');
  });

  /**
   * `public/theme-init.js` is a classic script no bundler touches, so nothing
   * else type-checks or exercises it. Run the real source against stubs: the
   * only reason the extension does not flash the wrong scheme is that this
   * agrees with `defaultMode` and the selector asserted above.
   */
  describe('public/theme-init.js', () => {
    // Same `__dirname` convention as `tests/*-contract.test.ts`.
    const source = readFileSync(path.resolve(__dirname, '../../../public/theme-init.js'), 'utf8');

    function runGuard(stored: string | null) {
      const store = new Map<string, string>();
      if (stored !== null) store.set(COLOR_MODE_STORAGE_KEY, stored);

      const root: Record<string, string> = {};
      const localStorageStub = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      };
      const documentStub = {
        documentElement: { setAttribute: (name: string, value: string) => void (root[name] = value) },
      };

      new Function('localStorage', 'document', source)(localStorageStub, documentStub);

      return { stored: store.get(COLOR_MODE_STORAGE_KEY) ?? null, attribute: root['data-color-scheme'] };
    }

    it('seeds light on a fresh profile', () => {
      expect(runGuard(null)).toEqual({ stored: 'light', attribute: 'light' });
    });

    it('migrates a legacy `system` to light instead of resolving the OS', () => {
      // The write-back is what makes it stick: MUI reads this key itself and a
      // stored value beats `defaultMode`.
      expect(runGuard('system')).toEqual({ stored: 'light', attribute: 'light' });
    });

    it('leaves an explicit choice untouched', () => {
      expect(runGuard('dark')).toEqual({ stored: 'dark', attribute: 'dark' });
      expect(runGuard('light')).toEqual({ stored: 'light', attribute: 'light' });
    });
  });
});
