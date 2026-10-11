import { describe, expect, it, vi } from 'vitest';

// The section's module reaches `lib/i18n`, which reads extension storage on
// import; the stops never translate anything.
vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}));

import { createTheme } from '@/entrypoints/app/theme/create-theme';

import { stageStops } from './product-tour';

const theme = createTheme();

function neutralOf(scheme: 'light' | 'dark') {
  const neutral = theme.colorSchemes[scheme]?.palette.background.neutral;
  if (!neutral) throw new Error(`missing ${scheme} background.neutral`);
  return neutral;
}

// The stage's stops feed a MotionValue, not CSS. Both rules below invite a
// tidy-up, a stop back to a `theme.vars` token or the neutral back to the
// source's `theme.palette`, and either breaks the stage without a type error
// (`stageStops`' comment has the why).
describe('product tour stage stops', () => {
  it.each(['light', 'dark', undefined] as const)(
    'are literal colours, never a CSS variable (scheme %s)',
    (scheme) => {
      // A `var()` makes motion step between stops instead of blending them.
      for (const stop of stageStops(theme, scheme)) {
        expect(stop).not.toContain('var(');
      }
    }
  );

  it('ends on the dark neutral in the dark scheme', () => {
    // `theme.palette` is always the light scheme under CSS variables, so
    // reading the neutral from it paints a light-grey band on the dark page.
    expect(neutralOf('dark')).not.toBe(neutralOf('light'));
    expect(stageStops(theme, 'dark').at(-1)).toBe(
      `linear-gradient(180deg, ${neutralOf('dark')}, ${neutralOf('dark')})`
    );
  });

  it.each(['light', undefined] as const)('ends on the light neutral (scheme %s)', (scheme) => {
    // `colorScheme` is undefined until the provider mounts.
    expect(stageStops(theme, scheme).at(-1)).toBe(
      `linear-gradient(180deg, ${neutralOf('light')}, ${neutralOf('light')})`
    );
  });
});
