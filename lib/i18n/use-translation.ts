import { useSyncExternalStore } from 'react';
import {
  t,
  subscribeLocale,
  getLocaleSnapshot,
  setLocale,
  resolveLocale,
} from './index';
import type { SupportedLocale, LocalePreference } from './index';

export interface UseTranslationReturn {
  t: typeof t;
  locale: SupportedLocale;
  preference: LocalePreference;
  setLocale: typeof setLocale;
}

export function useTranslation(): UseTranslationReturn {
  const preference = useSyncExternalStore(subscribeLocale, getLocaleSnapshot);
  return { t, locale: resolveLocale(preference), preference, setLocale };
}
