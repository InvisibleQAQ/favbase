import type { Opacity } from '@mui/material/styles';

/**
 * Shape alphas for the `softStyles` / `filledStyles` mixins and the
 * Switch/Input system tokens; they live in both color schemes as
 * `theme.vars.opacity.*` (Minimal `core/opacity.ts`).
 *
 * favbase override: `soft.paletteHoverBg` (0.24) is the hover wash of a soft
 * *palette* color (`primary`, `info`, …); Minimal's `soft.hoverBg` (0.32) stays
 * for the grey `inherit` branch. See `softStyles` for the contrast numbers.
 */
export type OpacityExtend = {
  filled: {
    commonHoverBg: number;
  };
  outlined: {
    border: number;
  };
  soft: {
    bg: number;
    hoverBg: number;
    paletteHoverBg: number;
    commonBg: number;
    commonHoverBg: number;
    border: number;
  };
};

export const opacity: Partial<Opacity> & OpacityExtend = {
  // system
  switchTrack: 1,
  switchTrackDisabled: 0.48,
  inputPlaceholder: 1,
  inputUnderline: 0.32,
  // shape
  filled: {
    commonHoverBg: 0.72,
  },
  outlined: {
    border: 0.48,
  },
  soft: {
    bg: 0.16,
    hoverBg: 0.32,
    paletteHoverBg: 0.24,
    commonBg: 0.08,
    commonHoverBg: 0.16,
    border: 0.24,
  },
};
