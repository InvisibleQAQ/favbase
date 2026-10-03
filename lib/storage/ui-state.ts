import { storage } from 'wxt/utils/storage';
import { STORAGE_KEYS } from './keys';
import type { AutoTranscribeQuotaPause } from '@/lib/auto-transcribe/types';
// Pure discriminator module (no DB imports) — safe to pull into storage.
import type { CollectionPlatform } from '@/lib/collections/platforms';
// Type-only: erased at build, so the douyin sync service never enters this graph.
import type { DouyinBackfillState } from '@/lib/douyin/douyin-sync-service';

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

// Douyin backfill breakpoint (docs/33 Step 2): where the first full walk of
// the all-favorites list stopped, so the next run tops up the head and then
// resumes from there. The fallback `{ null, false }` is "never completed":
// walk everything from the top. lib/douyin validates the value at its own
// boundary (a non-digit cursor reads as null), so this item stores it as is.
// Device-local; WebDAV syncs only settings + locale, so nothing to exclude.
export const douyinBackfillStorage = storage.defineItem<DouyinBackfillState>(
  STORAGE_KEYS.douyinBackfill,
  { fallback: { resumeCursor: null, backfillDone: false } },
);
