import { useMemo } from 'react';

import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider as ThemeVarsProvider } from '@mui/material/styles';

import { createTheme } from './create-theme';

import type {} from './extend-theme-types';

// Must match the FOUC guard key in public/theme-init.js.
export const COLOR_MODE_STORAGE_KEY = 'favbase-color-mode';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Built once per provider; docs/25 Step 2 adds the settings state as the
  // dependency that rebuilds it.
  const theme = useMemo(() => createTheme(), []);

  return (
    <ThemeVarsProvider
      disableTransitionOnChange
      defaultMode="system"
      modeStorageKey={COLOR_MODE_STORAGE_KEY}
      theme={theme}
    >
      <CssBaseline />
      {children}
    </ThemeVarsProvider>
  );
}
