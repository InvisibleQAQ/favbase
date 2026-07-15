export const STORAGE_KEYS = {
  settings: 'local:settings',
  sidebarPinned: 'local:sidebarPinned',
  locale: 'local:locale',
  videoCacheLegacy: 'local:videoCache',
  // X (Twitter) auth headers captured live from x.com traffic (session-scoped,
  // cleared on browser close). Written by the background webRequest listener,
  // read by lib/x/x-auth. See lib/x/CLAUDE.md.
  xCookie: 'session:x-cookie',
  xCsrf: 'session:x-csrf',
  xAuth: 'session:x-auth',
} as const;

export const STORAGE_PREFIXES = {
  videoCache: 'vc:',
} as const;
