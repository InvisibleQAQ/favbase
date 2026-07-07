import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider as ThemeVarsProvider } from '@mui/material/styles';

import { createTheme } from './create-theme';

import type {} from './extend-theme-types';

// Must match the inline FOUC guard in entrypoints/app/index.html.
export const COLOR_MODE_STORAGE_KEY = 'favbase-color-mode';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = createTheme();

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
