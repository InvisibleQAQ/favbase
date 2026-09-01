import { describe, expect, it } from 'vitest';

import { COLOR_MODE_STORAGE_KEY } from './theme-provider';
import { createTheme } from './create-theme';
import { themeConfig } from './theme-config';
import { customShadows } from './core/custom-shadows';
import { INPUT_PADDING, INPUT_TYPOGRAPHY } from './core/components/text-field';

const theme = createTheme();

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

/**
 * Resolves a slot the way MUI does: the base style object, then every
 * `variants` entry whose `props` match `ownerState`, later entries winning.
 * Minimal writes nearly every override as a variant, so a plain lookup would
 * read `undefined` for radius, height or shadow.
 */
function resolveStyle(component: string, slot: string, ownerState: OwnerState = {}): Record<string, unknown> {
  const override = (theme.components as Record<string, { styleOverrides?: Record<string, StyleValue> }>)[component]
    ?.styleOverrides?.[slot];
  if (!override) return {};
  const { variants, ...base } = callStyle(override, ownerState) as { variants?: Variant[] } & Record<string, unknown>;
  return (variants ?? [])
    .filter((variant) => variantMatches(variant, ownerState))
    .reduce((acc, variant) => ({ ...acc, ...callStyle(variant.style, ownerState) }), base);
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
  });

  it.each(['light', 'dark'] as const)('%s text and action colors meet WCAG contrast', (scheme) => {
    const colors = themeConfig.scheme[scheme];
    // The default button is Minimal's `contained` + `inherit`: filledStyles
    // inverts the scheme, so it is `text.primary` under `background.paper`.
    const containedBackground = colors.text.primary;
    const containedForeground = colors.background.paper;

    expect(contrastRatio(colors.text.primary, colors.background.default)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.text.secondary, colors.background.default)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.accentText, colors.background.default)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(containedForeground, containedBackground)).toBeGreaterThanOrEqual(4.5);
  });

  // docs/25 C-3: a soft primary chip is `text.accent` on a 16% coral wash.
  // `primary.dark` would read 3.99:1 in light; the accent shade clears 4.5.
  it.each(['light', 'dark'] as const)('%s soft primary text meets WCAG contrast on the 16% wash', (scheme) => {
    const colors = themeConfig.scheme[scheme];
    const wash = blend(themeConfig.palette.primary.main, 0.16, colors.background.paper);
    expect(contrastRatio(colors.accentText, wash)).toBeGreaterThanOrEqual(4.5);
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
});
