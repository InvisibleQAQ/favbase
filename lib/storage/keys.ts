export const STORAGE_KEYS = {
  settings: 'local:settings',
  sidebarPinned: 'local:sidebarPinned',
  locale: 'local:locale',
  videoCacheLegacy: 'local:videoCache',
} as const;

export const STORAGE_PREFIXES = {
  videoCache: 'vc:',
} as const;
