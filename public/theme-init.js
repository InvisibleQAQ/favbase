// FOUC guard: resolve color scheme before first paint.
// Classic (non-module) script so it runs synchronously in <head>, ahead of the
// deferred main.tsx module. Lives in public/ (served at extension root) because
// MV3 extension_pages CSP forbids inline scripts and rejects hash/nonce.
// Key/attribute must stay in sync with COLOR_MODE_STORAGE_KEY (theme-provider.tsx)
// and colorSchemeSelector 'data-color-scheme' (theme-config.ts).
(function () {
  try {
    var mode = localStorage.getItem('favbase-color-mode') || 'system';
    var scheme =
      mode === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : mode;
    document.documentElement.setAttribute('data-color-scheme', scheme);
  } catch (e) {}
})();
