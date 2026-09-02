import { use } from 'react';

import { SettingsContext } from './settings-context';

/** Strict reader for the settings drawer and other app.html consumers. */
export function useSettingsContext() {
  const context = use(SettingsContext);

  if (!context) throw new Error('useSettingsContext must be used inside SettingsProvider');

  return context;
}
