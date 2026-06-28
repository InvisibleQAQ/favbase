import { storage } from 'wxt/utils/storage';
import { STORAGE_KEYS } from './keys';

export const sidebarPinnedStorage = storage.defineItem<boolean>(
  STORAGE_KEYS.sidebarPinned,
  { fallback: true },
);
