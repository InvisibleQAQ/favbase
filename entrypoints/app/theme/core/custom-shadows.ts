import { varAlpha } from 'minimal-shared/utils';

import { grey, info, error, common, primary, success, warning, secondary } from './palette';

import type { ThemeColorScheme } from '../types';

export interface CustomShadows {
  z1?: string;
  z4?: string;
  z8?: string;
  z12?: string;
  z16?: string;
  z20?: string;
  z24?: string;
  primary?: string;
  secondary?: string;
  info?: string;
  success?: string;
  warning?: string;
  error?: string;
  card?: string;
  dialog?: string;
  dropdown?: string;
}

export function createShadowColor(colorChannel: string): string {
  return `0 8px 16px 0 ${varAlpha(colorChannel, 0.24)}`;
}

/**
 * One warm, offset, soft shadow family. Entries declare their elevation with a
 * hairline (`card` is `none` on purpose); only floating layers — popover,
 * menu, dialog — cast. `alpha` is the floating-layer strength, z-tiers scale
 * from it.
 */
function createCustomShadows(colorChannel: string, alpha: number): CustomShadows {
  const tier = varAlpha(colorChannel, alpha * 0.75);
  const floating = varAlpha(colorChannel, alpha);
  return {
    z1: `0 1px 2px 0 ${tier}`,
    z4: `0 4px 8px -2px ${tier}`,
    z8: `0 8px 16px -4px ${tier}`,
    z12: `0 12px 24px -6px ${tier}`,
    z16: `0 16px 32px -8px ${tier}`,
    z20: `0 20px 40px -8px ${tier}`,
    z24: `0 24px 48px -12px ${tier}`,
    card: 'none',
    dropdown: `0 8px 24px -8px ${floating}`,
    dialog: `0 8px 24px -8px ${floating}`,
    primary: createShadowColor(primary.mainChannel),
    secondary: createShadowColor(secondary.mainChannel),
    info: createShadowColor(info.mainChannel),
    success: createShadowColor(success.mainChannel),
    warning: createShadowColor(warning.mainChannel),
    error: createShadowColor(error.mainChannel),
  };
}

export const customShadows: Partial<Record<ThemeColorScheme, CustomShadows>> = {
  light: createCustomShadows(grey['800Channel'], 0.18),
  dark: createCustomShadows(common.blackChannel, 0.5),
};
