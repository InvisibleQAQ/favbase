import { COOLDOWN_MS } from '@/lib/x/cooldown';

/**
 * X-specific sync cooldown (pure, testable). After a successful X sync the
 * button is locked for `COOLDOWN_MS` (defined, env-configurable, in
 * `lib/x/cooldown.ts`); the window is derived from the last successful sync
 * time (the Platform Sync Record's `last_success_at`, which a failed attempt
 * never moves), so a failed sync never locks the button and the cooldown
 * survives a reload. The countdown label is the shared `formatCountdown` in
 * `hooks/use-countdown.ts`.
 */

export { COOLDOWN_MS };

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
