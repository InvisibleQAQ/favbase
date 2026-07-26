/**
 * Per-platform "once per local day" gate for automatic sync. The single source
 * of truth is `sources.lastFetchedAt` (read via `getPlatformLastSyncedAt`) — no
 * new table, no extra storage. Manual sync also refreshes `lastFetchedAt`, so a
 * platform synced manually today is treated as "already synced today" and the
 * auto path skips it.
 *
 * Pure functions — no React, no storage. Locked by daily-sync-gate.test.ts.
 */

/** True when a and b fall on the same local calendar day (year/month/date). */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Should the platform auto-sync now? Never synced (null) → yes. Otherwise only
 * when the last sync was NOT today (local day boundary).
 */
export function shouldAutoSync(lastSyncedAt: Date | null, now: Date): boolean {
  if (lastSyncedAt === null) return true;
  return !isSameLocalDay(lastSyncedAt, now);
}
