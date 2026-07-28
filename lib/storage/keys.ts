export const STORAGE_KEYS = {
  settings: 'local:settings',
  sidebarPinned: 'local:sidebarPinned',
  locale: 'local:locale',
  asrQuotaPause: 'local:asr-quota-pause',
  videoCacheLegacy: 'local:videoCache',
  // X (Twitter) auth headers captured live from x.com traffic (session-scoped,
  // cleared on browser close). Written by the background webRequest listener,
  // read by lib/x/x-auth. See lib/x/CLAUDE.md.
  xCookie: 'session:x-cookie',
  xCsrf: 'session:x-csrf',
  xAuth: 'session:x-auth',
  // X last-sync summary ({ syncedAt, inserted }) — persists the "N new this run"
  // count across app.html reloads so the X collection caption can show it after
  // a refresh. Written by sections/x/use-x-bookmarks syncFn. See lib/x/CLAUDE.md.
  xLastSync: 'local:x-last-sync',
  // WebDAV sync (lib/sync). config: connection settings (password AES-GCM
  // obfuscated). meta: LWW clock + version bookkeeping. status: UI-facing state
  // watched by the settings card. See lib/sync/CLAUDE.md.
  webdavConfig: 'local:webdav-config',
  webdavSyncMeta: 'local:webdav-sync-meta',
  webdavSyncStatus: 'local:webdav-sync-status',
  // First-run welcome flow outcome ({ completedAt, platforms }). Absent = the
  // user has never completed welcome.html, which is what gates the
  // install-time tab. See entrypoints/welcome/CLAUDE.md.
  onboarding: 'local:onboarding',
  // Knowledge-base build gate — the list of PAUSED platforms (empty = all run).
  // Written by the app.html gate facade (entrypoints/app/hooks/library-gate.ts),
  // read by it on load + watch. See that file's header for the semantics.
  libraryGate: 'local:library-gate',
} as const;

export const STORAGE_PREFIXES = {
  videoCache: 'vc:',
  /** AI summary per video — `vs:{platform}:{videoId}`, see lib/summary. */
  videoSummary: 'vs:',
} as const;
