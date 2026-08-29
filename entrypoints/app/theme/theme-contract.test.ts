import { describe, expect, it } from 'vitest';

import { COLOR_MODE_STORAGE_KEY } from './theme-provider';
import { createTheme } from './create-theme';
import { themeConfig } from './theme-config';
import { customShadows } from './core/custom-shadows';

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

type StyleOverride = Record<string, unknown> | ((params: { theme: typeof theme; ownerState: object }) => Record<string, unknown>);

function resolveStyle(component: string, slot: string, ownerState: object = {}): Record<string, unknown> {
  const override = (theme.components as Record<string, { styleOverrides?: Record<string, StyleOverride> }>)[component]
    ?.styleOverrides?.[slot];
  if (typeof override === 'function') return override({ theme, ownerState });
  return override ?? {};
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

  it.each(['light', 'dark'] as const)('%s text and action colors meet WCAG contrast', (scheme) => {
    const colors = themeConfig.scheme[scheme];
    const containedForeground = scheme === 'light' ? '#FFFFFF' : themeConfig.palette.grey['900'];
    const containedBackground = scheme === 'light' ? themeConfig.palette.grey['900'] : themeConfig.palette.grey['100'];

    expect(contrastRatio(colors.text.primary, colors.background.default)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.text.secondary, colors.background.default)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.accentText, colors.background.default)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(containedForeground, containedBackground)).toBeGreaterThanOrEqual(4.5);
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

  it('keeps control heights and surface radii in the theme owner', () => {
    expect(theme.components?.MuiButton?.defaultProps?.disableElevation).toBe(true);
    expect(theme.components?.MuiPaper?.defaultProps?.elevation).toBe(0);
    expect(theme.components?.MuiDialog?.defaultProps).toMatchObject({ fullWidth: true, maxWidth: 'sm' });
    expect(theme.components?.MuiTooltip?.defaultProps).toMatchObject({ arrow: true, enterDelay: 400 });
    expect(theme.components?.MuiTextField?.defaultProps?.variant).toBe('outlined');
    expect(theme.components?.MuiFilledInput?.defaultProps?.disableUnderline).toBe(true);
    expect(theme.components?.MuiCardHeader?.defaultProps?.slotProps?.title).toEqual({ variant: 'h6' });
    expect(theme.components?.MuiCardHeader?.defaultProps?.slotProps?.subheader).toEqual({ variant: 'body2' });
    expect(theme.components?.MuiTypography?.defaultProps?.variantMapping?.subtitle1).toBe('p');
    expect(theme.components?.MuiTypography?.defaultProps?.variantMapping?.subtitle2).toBe('p');
    expect(resolveStyle('MuiButton', 'sizeSmall').minHeight).toBe(30);
    expect(resolveStyle('MuiButton', 'sizeMedium').minHeight).toBe(36);
    expect(resolveStyle('MuiButton', 'sizeLarge').minHeight).toBe(48);
    expect(resolveStyle('MuiInputBase', 'root', { multiline: false, size: 'medium' }).minHeight).toBe(48);
    expect(resolveStyle('MuiInputBase', 'root', { multiline: false, size: 'small' }).minHeight).toBe(40);
    expect(resolveStyle('MuiInputBase', 'root', { multiline: true, size: 'medium' }).minHeight).toBeUndefined();
    expect(resolveStyle('MuiInput', 'root', { multiline: false, size: 'medium' }).minHeight).toBe(48);
    expect(resolveStyle('MuiInput', 'root', { multiline: false, size: 'small' }).minHeight).toBe(40);
    expect(resolveStyle('MuiInput', 'root', { multiline: true, size: 'medium' }).minHeight).toBeUndefined();
    expect(resolveStyle('MuiFilledInput', 'root', { multiline: false, size: 'medium' }).minHeight).toBe(48);
    expect(resolveStyle('MuiFilledInput', 'root', { multiline: false, size: 'small' }).minHeight).toBe(40);
    expect(resolveStyle('MuiFilledInput', 'root', { multiline: true, size: 'medium' }).minHeight).toBeUndefined();
    expect(resolveStyle('MuiOutlinedInput', 'root', { multiline: false, size: 'medium' }).minHeight).toBe(48);
    expect(resolveStyle('MuiOutlinedInput', 'root', { multiline: false, size: 'small' }).minHeight).toBe(40);
    expect(resolveStyle('MuiOutlinedInput', 'root', { multiline: true, size: 'medium' }).minHeight).toBeUndefined();
    expect(resolveStyle('MuiTabs', 'root').minHeight).toBe(48);
    expect(resolveStyle('MuiTab', 'root').minHeight).toBe(48);

    expect(resolveStyle('MuiCard', 'root').borderRadius).toBe(8);
    expect(resolveStyle('MuiCardContent', 'root').padding).toBe(theme.spacing(3));
    expect(resolveStyle('MuiPopover', 'paper').borderRadius).toBe(8);
    expect(resolveStyle('MuiDialog', 'paper').borderRadius).toBe(8);
    expect(resolveStyle('MuiDialog', 'paper').width).toBe(`calc(100% - ${theme.spacing(4)})`);
    expect(resolveStyle('MuiDialog', 'paper').maxHeight).toBe(
      `calc(100dvh - ${theme.spacing(4)})`,
    );
    expect(resolveStyle('MuiDialogTitle', 'root').padding).toBe(theme.spacing(3, 3, 1));
    expect(resolveStyle('MuiDialogContent', 'root').padding).toBe(theme.spacing(2, 3));
    expect(resolveStyle('MuiDialogActions', 'root').padding).toBe(theme.spacing(1, 3, 3));
    expect(resolveStyle('MuiMenu', 'list').padding).toBe(theme.spacing(0.5));
    expect(resolveStyle('MuiTooltip', 'tooltip').borderRadius).toBe(6);
    expect(resolveStyle('MuiSkeleton', 'rounded').borderRadius).toBe(8);
  });

  it('keeps card elevation scheme-aware and overlays floating', () => {
    const card = resolveStyle('MuiCard', 'root');
    const darkStyles = JSON.stringify(card);
    expect(card.boxShadow).toContain('var(--customShadows-card');
    expect(card.border).toBeUndefined();
    expect(darkStyles).toContain('none');
    expect(darkStyles).toContain('1px solid');
    expect(resolveStyle('MuiPopover', 'paper').boxShadow).toContain('var(--customShadows-dropdown');
    expect(resolveStyle('MuiDialog', 'paper').boxShadow).toContain('var(--customShadows-dialog');
    expect(resolveStyle('MuiDrawer', 'paper', { variant: 'temporary' }).boxShadow).toContain(
      'var(--customShadows-dropdown',
    );
    expect(resolveStyle('MuiDrawer', 'paper', { variant: 'permanent' }).boxShadow).toBeUndefined();
    expect(customShadows.light?.card).not.toBe('none');
    expect(customShadows.dark?.card).toBe('none');
  });
});

describe('theme mode compatibility', () => {
  it('preserves the persisted mode key and data attribute selector', () => {
    expect(COLOR_MODE_STORAGE_KEY).toBe('favbase-color-mode');
    expect(themeConfig.cssVariables.colorSchemeSelector).toBe('data-color-scheme');
    expect(theme.defaultColorScheme).toBe('light');
  });
});
