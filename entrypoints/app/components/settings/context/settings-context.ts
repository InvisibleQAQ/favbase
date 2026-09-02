import { createContext } from 'react';

import type { SettingsContextValue } from '../types';

// Leaf on purpose: `theme/theme-provider.tsx` reads this context optionally, so
// this file may import nothing but React and types — no storage, no barrel —
// or welcome.html and every bare `<ThemeProvider>` test would pick it up.
export const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);
