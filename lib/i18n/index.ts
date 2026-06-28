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
  let text: string = currentMessages[key] ?? key;

  if (import.meta.env.DEV && !(key in currentMessages)) {
    console.warn(`[i18n] missing key: "${key}" for locale "${currentLocale}"`);
  }

  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{{${name}}}`, String(value));
    }
  }

  return text;
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
