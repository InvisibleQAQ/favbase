import { useCallback } from 'react';

import { useColorScheme } from '@mui/material/styles';

import { useSettingsContext } from './context';

/**
 * "Everything back to default" for the appearance drawer and the header dot
 * that advertises it.
 *
 * `canReset` on the context only knows about `local:themeSettings`; light/dark
 * mode lives in MUI's `favbase-color-mode` (docs/25 D13). Folding the two here
 * keeps one answer to "is anything non-default?" instead of one per consumer —
 * `system` is `ThemeProvider`'s `defaultMode`, hence the baseline.
 */
export function useSettingsReset() {
  const { canReset, onReset } = useSettingsContext();
  const { mode, setMode } = useColorScheme();

  // Before mount MUI reports `undefined`; that is not a user choice.
  const modeChanged = mode !== undefined && mode !== 'system';

  const onResetAll = useCallback(() => {
    onReset();
    setMode('system');
  }, [onReset, setMode]);

  return { canReset: canReset || modeChanged, onResetAll };
}
