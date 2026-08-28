import type { CSSObject, TypographyVariantsOptions } from '@mui/material/styles';

import { pxToRem, setFont } from 'minimal-shared/utils';

import { themeConfig } from '../theme-config';

export type FontStyleExtend = {
  fontWeightSemiBold: CSSObject['fontWeight'];
  fontSecondaryFamily: CSSObject['fontFamily'];
};

const primaryFont = setFont(themeConfig.fontFamily.primary);
const secondaryFont = setFont(themeConfig.fontFamily.secondary);

/**
 * Catalog type scale. Barlow carries the page title (h1) and large figures
 * (h2/h3); DM Sans carries everything else at three UI sizes — 16 / 14 / 12 —
 * with hierarchy coming from weight and color, not from more sizes. No
 * responsive scaling: the same entry reads the same at every width.
 */
export const typography: TypographyVariantsOptions = {
  fontFamily: primaryFont,
  fontSecondaryFamily: secondaryFont,
  fontWeightLight: '300',
  fontWeightRegular: '400',
  fontWeightMedium: '500',
  fontWeightSemiBold: '600',
  fontWeightBold: '700',
  h1: {
    fontFamily: secondaryFont,
    fontWeight: 700,
    lineHeight: 1.2,
    fontSize: pxToRem(28),
    letterSpacing: 0,
  },
  h2: {
    fontFamily: secondaryFont,
    fontWeight: 700,
    lineHeight: 1.25,
    fontSize: pxToRem(24),
    letterSpacing: 0,
  },
  h3: {
    fontFamily: secondaryFont,
    fontWeight: 600,
    lineHeight: 1.3,
    fontSize: pxToRem(20),
    letterSpacing: 0,
  },
  h4: { fontWeight: 600, lineHeight: 1.5, fontSize: pxToRem(16) },
  h5: { fontWeight: 600, lineHeight: 22 / 14, fontSize: pxToRem(14) },
  h6: { fontWeight: 600, lineHeight: 22 / 14, fontSize: pxToRem(14) },
  subtitle1: { fontWeight: 600, lineHeight: 1.5, fontSize: pxToRem(16) },
  subtitle2: { fontWeight: 600, lineHeight: 22 / 14, fontSize: pxToRem(14) },
  body1: { lineHeight: 1.5, fontSize: pxToRem(16) },
  body2: { lineHeight: 22 / 14, fontSize: pxToRem(14) },
  caption: { lineHeight: 1.5, fontSize: pxToRem(12) },
  overline: {
    fontWeight: 600,
    lineHeight: 1.5,
    fontSize: pxToRem(12),
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  button: {
    fontWeight: 600,
    lineHeight: 24 / 14,
    fontSize: pxToRem(14),
    textTransform: 'unset',
  },
};
