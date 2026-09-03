import type { SupportedLocale } from '@/lib/i18n';

/**
 * Dashboard figures. Locale comes in as an argument so these stay pure: the
 * app-wide formatters that read the ambient locale live in `lib/i18n`
 * (`formatCompactNumber`, `formatDateTime`) and analytics wants neither
 * compact notation (a library of 1,024 items must read as 1,024) nor dates.
 *
 * It is `SupportedLocale`, not `string`, because `useTranslation()` hands back
 * both a resolved `locale` and a `preference` that can be `'auto'` — and
 * `Intl.NumberFormat('auto')` throws mid-render. The type makes that mix-up
 * impossible instead of leaving it to review.
 */
export function formatNumber(value: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatShare(value: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value);
}
