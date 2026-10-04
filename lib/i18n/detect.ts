/**
 * Every locale the extension ships, as a runtime list. `SupportedLocale` is
 * derived from it, so the type and the list cannot disagree; code that has to
 * enumerate locales (a per-locale asset check, say) reads this instead of
 * keeping its own copy.
 */
export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function detectLocale(): SupportedLocale {
  const lang = navigator.language;
  return lang.startsWith('zh') ? 'zh-CN' : 'en';
}
