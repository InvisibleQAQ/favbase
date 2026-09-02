import type { ThemeSettings } from '@/lib/storage';

export type { ThemeSettings, ThemeColorPreset, ThemeContrast } from '@/lib/storage';

/**
 * Minimal `SettingsContextValue` reduced to Favbase's persisted fields
 * (`lib/storage/theme-settings.ts`). Mode, font, direction and nav layout are
 * not settings here: mode belongs to MUI's `favbase-color-mode`, the rest is
 * out of scope (docs/25 §0.2).
 */
export type SettingsContextValue = {
  state: ThemeSettings;
  canReset: boolean;
  onReset: () => void;
  setState: (updateValue: Partial<ThemeSettings>) => void;
  setField: <K extends keyof ThemeSettings>(name: K, updateValue: ThemeSettings[K]) => void;
  // Drawer (UI lands in docs/25 Step 4)
  openDrawer: boolean;
  onCloseDrawer: () => void;
  onToggleDrawer: () => void;
};

export type SettingsProviderProps = {
  /** Read once by `main.tsx` before the first render so the first frame is already the saved preset. */
  initialState: ThemeSettings;
  children: React.ReactNode;
};
