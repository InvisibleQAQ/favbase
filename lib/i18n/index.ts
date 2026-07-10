import type { LocaleKeys } from './locales/zh-CN';
import zhCN from './locales/zh-CN';
import en from './locales/en';
import { detectLocale, type SupportedLocale } from './detect';
import { localeStorage, type LocalePreference } from '@/lib/storage';

export type { LocaleKeys } from './locales/zh-CN';
export type { SupportedLocale } from './detect';
export type { LocalePreference } from '@/lib/storage';

const locales: Record<SupportedLocale, Record<string, string>> = { 'zh-CN': zhCN, en };

let currentPreference: LocalePreference = 'auto';
let currentLocale: SupportedLocale = detectLocale();
let currentMessages = locales[currentLocale];

const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) cb();
}

export function resolveLocale(pref: LocalePreference): SupportedLocale {
  return pref === 'auto' ? detectLocale() : pref;
}

function applyPreference(pref: LocalePreference) {
  const resolved = resolveLocale(pref);
  const changed = pref !== currentPreference || resolved !== currentLocale;
  currentPreference = pref;
  currentLocale = resolved;
  currentMessages = locales[resolved];
  if (changed) notify();
}

export function setLocale(pref: LocalePreference): void {
  applyPreference(pref);
  localeStorage.setValue(pref);
}

export function t(
  key: LocaleKeys,
  params?: Record<string, string | number>,
): string {
  // Plural resolution: when a `count` param is present, prefer a variant key
  // `${key}.${category}` (e.g. `foo.one` / `foo.other`), falling back to
  // `${key}.other`, then the base `key`. Non-count calls are unaffected.
  let resolvedKey: string = key;
  if (params?.count !== undefined) {
    const category = new Intl.PluralRules(currentLocale).select(Number(params.count));
    const variantKey = `${key}.${category}`;
    const otherKey = `${key}.other`;
    if (variantKey in currentMessages) resolvedKey = variantKey;
    else if (otherKey in currentMessages) resolvedKey = otherKey;
  }

  let text: string = currentMessages[resolvedKey] ?? currentMessages[key] ?? key;

  if (import.meta.env.DEV && !(resolvedKey in currentMessages) && !(key in currentMessages)) {
    console.warn(`[i18n] missing key: "${key}" for locale "${currentLocale}"`);
  }

  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{{${name}}}`, String(value));
    }
  }

  return text;
}

/**
 * Locale-aware compact number formatting.
 * zh-CN → `1.2万` / `1.2亿`, en → `1.2K` / `1.2M`.
 * Consumers must subscribe via `useTranslation()` to re-render on locale change.
 */
export function formatCompactNumber(n: number): string {
  return new Intl.NumberFormat(currentLocale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

/**
 * Locale-aware date-time formatting (short date + short time).
 * Consumers must subscribe via `useTranslation()` to re-render on locale change.
 */
export function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(currentLocale, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(timestamp);
}

export function subscribeLocale(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getLocaleSnapshot(): LocalePreference {
  return currentPreference;
}

export function getResolvedLocale(): SupportedLocale {
  return currentLocale;
}

localeStorage.getValue().then((pref) => {
  if (pref !== currentPreference) applyPreference(pref);
});

localeStorage.watch((newPref) => {
  if (newPref !== currentPreference) applyPreference(newPref);
});
