export const STORAGE_KEYS = {
  settings: 'local:settings',
  sidebarPinned: 'local:sidebarPinned',
  locale: 'local:locale',

  // Cache domain — managed internally by lib/cache/video-cache.ts (deep module)
  // videoCachePrefix: 'local:vc:{bvid}'   (per-bvid dynamic keys)
  // videoCache_legacy: 'local:videoCache'  (migration source, will be removed)
} as const;
