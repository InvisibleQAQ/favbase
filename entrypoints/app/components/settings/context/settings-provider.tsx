import { useRef, useMemo, useState, useEffect, useCallback } from 'react';

import {
  DEFAULT_THEME_SETTINGS,
  isSameThemeSettings,
  setThemeSettings,
  watchThemeSettings,
} from '@/lib/storage';

import { SettingsContext } from './settings-context';

import type { ThemeSettings } from '@/lib/storage';
import type { SettingsContextValue, SettingsProviderProps } from '../types';

/**
 * Minimal `SettingsProvider` over WXT storage instead of `useLocalStorage`
 * (docs/25 D13). `initialState` is the value `main.tsx` read before the first
 * render, so there is no default-color first frame; the provider then owns the
 * in-memory copy and mirrors it to `local:themeSettings`.
 */
export function SettingsProvider({ initialState, children }: SettingsProviderProps) {
  const [state, setLocalState] = useState<ThemeSettings>(initialState);
  // Mirror of the latest applied value, written only by the two writers below
  // (never during render) and updated before React commits. The stable
  // `setState` merges against it, so two quick edits to different fields do
  // not overwrite each other, and a repeated identical call — or the storage
  // echo of our own write — is a no-op instead of a second write.
  const stateRef = useRef<ThemeSettings>(initialState);

  useEffect(
    () =>
      watchThemeSettings((next) => {
        if (isSameThemeSettings(stateRef.current, next)) return;
        stateRef.current = next;
        setLocalState(next);
      }),
    [],
  );

  const setState = useCallback((updateValue: Partial<ThemeSettings>) => {
    const current = stateRef.current;
    const next: ThemeSettings = { ...current, ...updateValue };
    if (isSameThemeSettings(current, next)) return;
    stateRef.current = next;
    setLocalState(next);
    void setThemeSettings(next).catch((error) => {
      console.error('[theme settings] persist failed', error);
    });
  }, []);

  const setField = useCallback(
    <K extends keyof ThemeSettings>(name: K, updateValue: ThemeSettings[K]) => {
      const partial: Partial<ThemeSettings> = {};
      partial[name] = updateValue;
      setState(partial);
    },
    [setState],
  );

  const onReset = useCallback(() => {
    setState({ ...DEFAULT_THEME_SETTINGS });
  }, [setState]);

  const canReset = !isSameThemeSettings(state, DEFAULT_THEME_SETTINGS);

  const [openDrawer, setOpenDrawer] = useState(false);

  const onToggleDrawer = useCallback(() => {
    setOpenDrawer((prev) => !prev);
  }, []);

  const onCloseDrawer = useCallback(() => {
    setOpenDrawer(false);
  }, []);

  const memoizedValue = useMemo<SettingsContextValue>(
    () => ({
      state,
      canReset,
      onReset,
      setState,
      setField,
      openDrawer,
      onCloseDrawer,
      onToggleDrawer,
    }),
    [state, canReset, onReset, setState, setField, openDrawer, onCloseDrawer, onToggleDrawer],
  );

  return <SettingsContext value={memoizedValue}>{children}</SettingsContext>;
}
