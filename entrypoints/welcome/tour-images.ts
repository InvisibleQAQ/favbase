// Type-only, and from the leaf: `@/lib/i18n` itself reads storage on load.
import type { SupportedLocale } from '@/lib/i18n/detect';

/** The app.html pages shown in the welcome product tour, in display order. */
export const TOUR_PAGES = ['dashboard', 'collections', 'github', 'x'] as const;

export type TourPage = (typeof TOUR_PAGES)[number];

/** Each page is captured once per colour scheme. */
export const TOUR_SCHEMES = ['light', 'dark'] as const;

export type TourScheme = (typeof TOUR_SCHEMES)[number];

/**
 * URL of one tour screenshot. The files live in `public/assets/images/welcome/`
 * (served from the extension root) as `tour-<page>-<scheme>-<locale>.webp`,
 * where `<locale>` is the `SupportedLocale` id itself, so no mapping table.
 *
 * Screenshots are re-captured in place under the same names; nothing may depend
 * on what one shows. `tour-images.test.ts` checks the list against the
 * directory in both directions.
 */
export function tourImageSrc(page: TourPage, scheme: TourScheme, locale: SupportedLocale): string {
  return `/assets/images/welcome/tour-${page}-${scheme}-${locale}.webp`;
}
