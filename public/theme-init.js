// FOUC guard: resolve color scheme before first paint.
// Classic (non-module) script so it runs synchronously in <head>, ahead of the
// deferred main.tsx module. Lives in public/ (served at extension root) because
// MV3 extension_pages CSP forbids inline scripts and rejects hash/nonce.
// Key/attribute must stay in sync with COLOR_MODE_STORAGE_KEY (theme-provider.tsx)
// and colorSchemeSelector 'data-color-scheme' (theme-config.ts).
//
// Mode is two-state since 2026-09-06 and the default is light. Anything else —
// nothing stored yet, or a legacy 'system' — becomes 'light' and is written
// back. The write-back is load-bearing, not tidying: MUI reads this key itself
// and a stored value beats `defaultMode`, so a legacy 'system' left in place
// would keep resolving against the OS forever.
(function () {
  try {
    var KEY = 'favbase-color-mode';
    var mode = localStorage.getItem(KEY);
    if (mode !== 'light' && mode !== 'dark') {
      mode = 'light';
      localStorage.setItem(KEY, mode);
    }
    document.documentElement.setAttribute('data-color-scheme', mode);
  } catch (e) {}
})();
