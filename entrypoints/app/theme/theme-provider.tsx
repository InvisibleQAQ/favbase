import { use, useMemo } from 'react';

import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider as ThemeVarsProvider } from '@mui/material/styles';

import { createTheme } from './create-theme';
import { SettingsContext } from '../components/settings/context/settings-context';

import type {} from './extend-theme-types';

// Must match the FOUC guard key in public/theme-init.js, which also normalizes
// anything that is not 'light' / 'dark' (absent, or a legacy 'system' from
// before mode became two-state) so MUI never reads a third value back.
export const COLOR_MODE_STORAGE_KEY = 'favbase-color-mode';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Optional settings: app.html mounts `SettingsProvider` in main.tsx, so the
  // preset / contrast state rebuilds the theme; welcome.html and bare test
  // renders have no provider and get the coral defaults. Read the leaf context
  // rather than `useSettingsContext()` so the absence is not an error.
  const settings = use(SettingsContext);
  const settingsState = settings?.state;
  const theme = useMemo(() => createTheme({ settingsState }), [settingsState]);

  return (
    <ThemeVarsProvider
      disableTransitionOnChange
      defaultMode="light"
      modeStorageKey={COLOR_MODE_STORAGE_KEY}
      theme={theme}
    >
      <CssBaseline />
      {children}
    </ThemeVarsProvider>
  );
}
