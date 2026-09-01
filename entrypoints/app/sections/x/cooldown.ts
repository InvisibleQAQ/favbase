import { formatClock } from '@/lib/format';

/**
 * X-specific sync cooldown (pure, testable). After a successful X sync the
 * button is locked for `COOLDOWN_MS`; the window is derived from the last
 * successful sync time (DB `sources.lastFetchedAt`, refreshed only on success),
 * so a failed sync never locks the button and the cooldown survives a reload.
 */

/** Cooldown window after a successful X sync (5 minutes). */
export const COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Milliseconds remaining in the cooldown window, clamped to `[0, COOLDOWN_MS]`.
 * `0` means the window has elapsed (or there was never a sync) → button enabled.
 */
export function remainingCooldown(lastSyncedAt: number | null, now: number): number {
  if (lastSyncedAt === null) return 0;
  const elapsed = now - lastSyncedAt;
  // Clock skew (sync time in the future): keep the button locked, don't crash.
  if (elapsed < 0) return COOLDOWN_MS;
  if (elapsed >= COOLDOWN_MS) return 0;
  return COOLDOWN_MS - elapsed;
}

/** Format a remaining-ms duration as `mm:ss` for the countdown label. */
export function formatCountdown(remainingMs: number): string {
  return formatClock(Math.ceil(Math.max(0, remainingMs) / 1_000));
}
