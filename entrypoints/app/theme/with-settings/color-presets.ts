import { getContrastRatio } from '@mui/material/styles';

import type { ThemeColorPreset } from '@/lib/storage';

import { themeConfig } from '../theme-config';

import type { PaletteColorNoChannels } from '../core/palette';

/**
 * Minimal's primary-color presets with Favbase coral as `default`. The preset
 * ids come from `lib/storage/theme-settings.ts` (the persisted enum), so a
 * missing entry here fails compilation. No secondary presets: Favbase never
 * re-colors `secondary`.
 */

const INK = themeConfig.palette.primary.contrastText;
const WHITE = themeConfig.palette.common.white;

/**
 * favbase override (docs/25 D14): Minimal ships white `contrastText` for every
 * preset, which reads 3.47:1 on preset1 blue and 3.67:1 on preset5 red. Pick
 * whichever of white / the Favbase ink clears WCAG better on `main`. Result:
 * ink for default / preset1 / preset4 / preset5, white for preset2 / preset3;
 * all ≥ 4.5:1 (`color-presets.test.ts`).
 */
export function pickContrastText(main: string): string {
  return getContrastRatio(INK, main) >= getContrastRatio(WHITE, main) ? INK : WHITE;
}

type PresetStages = Omit<PaletteColorNoChannels, 'contrastText'>;

function preset(stages: PresetStages): PaletteColorNoChannels {
  return { ...stages, contrastText: pickContrastText(stages.main) };
}

export const primaryColorPresets: Record<ThemeColorPreset, PaletteColorNoChannels> = {
  default: { ...themeConfig.palette.primary },
  preset1: preset({
    lighter: '#CCF4FE',
    light: '#68CDF9',
    main: '#078DEE',
    dark: '#0351AB',
    darker: '#012972',
  }),
  preset2: preset({
    lighter: '#EBD6FD',
    light: '#B985F4',
    main: '#7635dc',
    dark: '#431A9E',
    darker: '#200A69',
  }),
  preset3: preset({
    lighter: '#CDE9FD',
    light: '#6BB1F8',
    main: '#0C68E9',
    dark: '#063BA7',
    darker: '#021D6F',
  }),
  preset4: preset({
    lighter: '#FEF4D4',
    light: '#FED680',
    main: '#fda92d',
    dark: '#B66816',
    darker: '#793908',
  }),
  preset5: preset({
    lighter: '#FFE3D5',
    light: '#FFC1AC',
    main: '#FF3030',
    dark: '#B71833',
    darker: '#7A0930',
  }),
};
