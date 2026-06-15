export type SupportedLocale = 'zh-CN' | 'en';

export function detectLocale(): SupportedLocale {
  const lang = navigator.language;
  return lang.startsWith('zh') ? 'zh-CN' : 'en';
}
