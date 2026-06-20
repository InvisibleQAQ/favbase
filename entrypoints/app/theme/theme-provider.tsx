import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider as ThemeVarsProvider } from '@mui/material/styles';

import { createTheme } from './create-theme';

import type {} from './extend-theme-types';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = createTheme();

  return (
    <ThemeVarsProvider disableTransitionOnChange theme={theme}>
      <CssBaseline />
      {children}
    </ThemeVarsProvider>
  );
}
