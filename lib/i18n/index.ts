import type { LocaleKeys } from './locales/zh-CN';
import zhCN from './locales/zh-CN';
import en from './locales/en';
import { detectLocale } from './detect';

const locales = { 'zh-CN': zhCN, en } as const;

const currentLocale = detectLocale();
const messages = locales[currentLocale];

/**
 * Translate a key, optionally interpolating `{{name}}` placeholders.
 *
 * @example
 * t('status.loading')                       // "正在加载字幕..."
 * t('status.count', { count: 42 })          // "共 42 条字幕 (B站 AI)"
 */
export function t(
  key: LocaleKeys,
  params?: Record<string, string | number>,
): string {
  let text: string = messages[key] ?? key;

  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{{${name}}}`, String(value));
    }
  }

  return text;
}
