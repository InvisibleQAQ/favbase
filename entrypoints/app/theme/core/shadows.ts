import type { Shadows } from '@mui/material/styles';

import { varAlpha } from 'minimal-shared/utils';
import { createTheme } from '@mui/material/styles';

import { grey, common } from './palette';

import type { SchemesRecord } from '../types';

/**
 * MUI's 25-level elevation scale with every `rgba(...)` recolored to a
 * channel var — grey 500 in light, black in dark (Minimal `core/shadows.ts`).
 */
function updateShadowColor(shadow: string, colorChannel: string): string {
  return shadow.replace(/rgba\(\d+,\d+,\d+,(.*?)\)/g, (_, alpha) =>
    varAlpha(colorChannel, parseFloat(alpha)),
  );
}

function createShadows(colorChannel: string): Shadows {
  const { shadows: defaultShadows } = createTheme();

  return defaultShadows.map((shadow) => updateShadowColor(shadow, colorChannel)) as Shadows;
}

export const shadows: SchemesRecord<Shadows> = {
  light: createShadows(grey['500Channel']),
  dark: createShadows(common.blackChannel),
};
