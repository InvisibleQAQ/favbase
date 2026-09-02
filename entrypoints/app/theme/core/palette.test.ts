import { describe, expect, it } from 'vitest';

import { COLLECTION_PLATFORMS } from '@/lib/collections/platforms';

import { createTheme } from '../create-theme';
import { themeConfig, type BrandColoredPlatform } from '../theme-config';
import { background, platform, text } from './palette';

const SCHEMES = ['light', 'dark'] as const;
const BRAND_COLORED = Object.keys(themeConfig.platform.light) as BrandColoredPlatform[];

/** WCAG 2.x relative luminance of a `#RRGGBB` color. */
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

describe('palette.background', () => {
  it('keeps the app canvas on the specified scheme colors', () => {
    expect(background.light.default).toBe('#FFFFFF');
    expect(background.light.paper).toBe('#FFFFFF');
    expect(background.light.neutral).toBe('#F4F6F8');
    expect(background.dark.default).toBe('#141A21');
    expect(background.dark.paper).toBe('#1C252E');
    // docs/25 C-2: Minimal's `#28323D` drops youtube dark to 2.95:1, so the
    // neutral keeps the value the platform validator was run against.
    expect(background.dark.neutral).toBe('#222B34');
  });

  it('takes the Minimal dark ink (white / grey 500 / grey 600)', () => {
    expect(text.dark.primary).toBe('#FFFFFF');
    expect(text.dark.secondary).toBe(themeConfig.palette.grey['500']);
    expect(text.dark.disabled).toBe(themeConfig.palette.grey['600']);
  });

  // docs/25 Step 2: the accent is not a scheme constant any more; it is the
  // brand ramp's `darker` on the light ground and `light` on the dark ground.
  it('derives text.accent from the coral ramp (light darker / dark light)', () => {
    expect(text.light.accent).toBe(themeConfig.palette.primary.darker);
    expect(text.dark.accent).toBe(themeConfig.palette.primary.light);
    expect(text.light.accentChannel).toMatch(/^\d+ \d+ \d+$/);
  });

  it('keeps the Minimal neutral ramp as the static theme source', () => {
    expect(themeConfig.palette.grey).toEqual({
      '50': '#FCFDFD',
      '100': '#F9FAFB',
      '200': '#F4F6F8',
      '300': '#DFE3E8',
      '400': '#C4CDD5',
      '500': '#919EAB',
      '600': '#637381',
      '700': '#454F5B',
      '800': '#1C252E',
      '900': '#141A21',
    });
  });
});

describe('palette.platform', () => {
  it.each(SCHEMES)('%s scheme maps exactly the six Collection platforms', (scheme) => {
    const keys = Object.keys(platform[scheme]).filter((key) => !key.endsWith('Channel'));
    expect(keys.sort()).toEqual([...COLLECTION_PLATFORMS].sort());
    for (const id of COLLECTION_PLATFORMS) {
      expect(platform[scheme][`${id}Channel`]).toMatch(/^\d+ \d+ \d+$/);
    }
  });

  it.each(SCHEMES)('%s scheme keeps black-logo brands (github, x) as ink', (scheme) => {
    expect(platform[scheme].github).toBe(text[scheme].primary);
    expect(platform[scheme].x).toBe(text[scheme].primary);
  });

  it.each(SCHEMES)('%s scheme takes the hued four from themeConfig.platform', (scheme) => {
    for (const id of BRAND_COLORED) {
      expect(platform[scheme][id]).toBe(themeConfig.platform[scheme][id]);
    }
  });

  // Locks the dataviz validator's conclusion into the repo: every brand color is a
  // 3:1 graphic on both the page ground and the neutral tile of its scheme. Do not
  // "brighten" a value without re-running the validator (see theme-config.ts).
  it.each(SCHEMES)('%s brand colors hold >= 3:1 on background.default and background.neutral', (scheme) => {
    for (const id of BRAND_COLORED) {
      const color = themeConfig.platform[scheme][id];
      expect(contrastRatio(color, background[scheme].default), `${scheme} ${id} on default`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(color, background[scheme].neutral), `${scheme} ${id} on neutral`).toBeGreaterThanOrEqual(3);
    }
  });

  // MUI must keep the non-standard `platform` palette key through createTheme and
  // expose it as one CSS var per platform, or `theme.vars.palette.platform[id]` in
  // the consumer silently resolves to undefined (the Tile would render with no color).
  it('survives createTheme as one CSS variable per platform in both schemes', () => {
    const theme = createTheme();
    for (const id of COLLECTION_PLATFORMS) {
      // MUI appends the default-scheme value as the var() fallback; only the name is the contract.
      expect(theme.vars.palette.platform[id]).toMatch(new RegExp(String.raw`^var\(--palette-platform-${id}[,)]`));
      expect(theme.colorSchemes.light?.palette.platform[id]).toBe(platform.light[id]);
      expect(theme.colorSchemes.dark?.palette.platform[id]).toBe(platform.dark[id]);
    }
  });
});
