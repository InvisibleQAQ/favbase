import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserSettings } from '@/lib/types';
import { settingsStorage, DEFAULT_SETTINGS } from '@/lib/storage';

export interface UseSettingsReturn {
  settings: UserSettings;
  updateSettings: (patch: Partial<UserSettings>) => void;
  /** True while the initial load from storage is in progress. */
  loading: boolean;
  /** Briefly true after a save completes, for UI feedback. */
  saved: boolean;
}

export function useSettings(): UseSettingsReturn {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load initial value from storage.
  useEffect(() => {
    let cancelled = false;

    settingsStorage.getValue().then((val: UserSettings) => {
      if (cancelled) return;
      if (val) setSettings(val);
      setLoading(false);
    });

    // Watch for external changes (e.g. another tab).
    const unwatch = settingsStorage.watch((newVal: UserSettings) => {
      if (newVal) setSettings(newVal);
    });

    return () => {
      cancelled = true;
      unwatch();
    };
  }, []);

  // Debounced save — 500ms after last update.
  const updateSettings = useCallback((patch: Partial<UserSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };

      // Clear any pending save timer.
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

      saveTimerRef.current = setTimeout(() => {
        settingsStorage.setValue(next).then(() => {
          setSaved(true);
          if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
          savedTimerRef.current = setTimeout(() => setSaved(false), 1500);
        });
      }, 500);

      return next;
    });
  }, []);

  // Cleanup timers on unmount.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  return { settings, updateSettings, loading, saved };
}
