import { storage } from 'wxt/utils/storage';
import { STORAGE_KEYS } from './keys';
import type { AutoTranscribeQuotaPause } from '@/lib/auto-transcribe/types';
// Pure discriminator module (no DB imports) — safe to pull into storage.
import type { CollectionPlatform } from '@/lib/collections/platforms';

export const sidebarPinnedStorage = storage.defineItem<boolean>(
  STORAGE_KEYS.sidebarPinned,
  { fallback: true },
);

export type LocalePreference = 'auto' | 'zh-CN' | 'en';

export const localeStorage = storage.defineItem<LocalePreference>(
  STORAGE_KEYS.locale,
  { fallback: 'auto' },
);

export const asrQuotaPauseStorage = storage.defineItem<AutoTranscribeQuotaPause | null>(
  STORAGE_KEYS.asrQuotaPause,
  { fallback: null },
);

/** Summary of the most recent successful X bookmarks sync. */
export interface XLastSync {
  /** Epoch ms of the successful sync. */
  syncedAt: number;
  /** Items newly inserted that run (the "N new this run" count). */
  inserted: number;
}

// Persists the last X sync summary so the "N new this run" caption survives an
// app.html reload. Only the X collection section writes/reads it. `null` =
// never synced through this feature (legacy) → caption omits the "new" segment.
export const xLastSyncStorage = storage.defineItem<XLastSync | null>(
  STORAGE_KEYS.xLastSync,
  { fallback: null },
);

/** Outcome of the first-run welcome flow (welcome.html). */
export interface OnboardingState {
  /** Epoch ms the user left welcome.html, with or without platform picks. */
  completedAt: number;
  /**
   * Platforms picked in the welcome flow, in registry order. The app uses this
   * preference for CTA landing and Collections navigation priority only; every
   * platform stays visible, usable, and eligible for normal sync behavior.
   */
  platforms: CollectionPlatform[];
}

// `null` = the welcome flow was never completed, which is the gate
// for opening welcome.html on install (reloading an unpacked extension also
// reports reason 'install', so the reason alone is not a reliable first-run
// signal). Written once by the welcome page.
export const onboardingStorage = storage.defineItem<OnboardingState | null>(
  STORAGE_KEYS.onboarding,
  { fallback: null },
);

// Knowledge-base build gate. Stores the platforms whose pipeline is PAUSED —
// not a per-platform boolean map — so `[]` already means "everything runs" and
// platform N+1 needs no default entry. Written/read only through the app.html
// facade (entrypoints/app/hooks/library-gate.ts), which keeps a synchronous
// mirror because the job dispatcher is not React.
export const libraryGateStorage = storage.defineItem<CollectionPlatform[]>(
  STORAGE_KEYS.libraryGate,
  { fallback: [] },
);
