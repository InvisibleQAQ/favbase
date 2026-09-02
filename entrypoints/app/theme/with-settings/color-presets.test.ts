import { describe, expect, it } from 'vitest';
import { getContrastRatio } from '@mui/material/styles';

import type { ThemeColorPreset } from '@/lib/storage';

import { themeConfig } from '../theme-config';
import { pickContrastText, primaryColorPresets } from './color-presets';

const INK = themeConfig.palette.primary.contrastText;
const WHITE = themeConfig.palette.common.white;

describe('primaryColorPresets', () => {
  it('lists coral first and the five Minimal presets after it', () => {
    // The key set is also locked to the persisted enum by `Record<ThemeColorPreset, …>`.
    expect(Object.keys(primaryColorPresets)).toEqual([
      'default',
      'preset1',
      'preset2',
      'preset3',
      'preset4',
      'preset5',
    ]);
  });

  it('keeps the default preset identical to the Favbase coral ramp', () => {
    expect(primaryColorPresets.default).toEqual(themeConfig.palette.primary);
  });

  it('carries five hex stages per preset', () => {
    for (const preset of Object.values(primaryColorPresets)) {
      for (const stage of ['lighter', 'light', 'main', 'dark', 'darker'] as const) {
        expect(preset[stage]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  // docs/25 D14: contrastText is ink or white, whichever reads better on `main`.
  it.each(Object.keys(primaryColorPresets) as ThemeColorPreset[])(
    '%s contrastText is ink or white and clears WCAG 4.5 on main',
    (preset) => {
      const { main, contrastText } = primaryColorPresets[preset];
      expect([INK, WHITE]).toContain(contrastText);
      expect(getContrastRatio(contrastText, main)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('picks ink for the warm/light hues and white for the saturated blues', () => {
    expect(pickContrastText('#FC7E5B')).toBe(INK);
    expect(pickContrastText('#7635dc')).toBe(WHITE);
    const picks = Object.fromEntries(
      Object.entries(primaryColorPresets).map(([id, preset]) => [id, preset.contrastText === INK ? 'ink' : 'white']),
    );
    expect(picks).toEqual({
      default: 'ink',
      preset1: 'ink',
      preset2: 'white',
      preset3: 'white',
      preset4: 'ink',
      preset5: 'ink',
    });
  });
});
