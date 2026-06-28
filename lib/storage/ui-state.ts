import { storage } from 'wxt/utils/storage';
import { STORAGE_KEYS } from './keys';

export const sidebarPinnedStorage = storage.defineItem<boolean>(
  STORAGE_KEYS.sidebarPinned,
  { fallback: true },
);

export type LocalePreference = 'auto' | 'zh-CN' | 'en';

export const localeStorage = storage.defineItem<LocalePreference>(
  STORAGE_KEYS.locale,
  { fallback: 'auto' },
);
