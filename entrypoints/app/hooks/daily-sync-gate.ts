/**
 * Per-platform "once per local day" gate for automatic sync (docs/32 D2). The
 * input is the platform's latest Platform Sync ATTEMPT from its Platform Sync
 * Record (`last_attempt_at`), not its latest success: any attempt today —
 * manual or automatic, succeeded, failed, silenced or never finished — uses up
 * the day, so a platform that just rate-limited or anti-crawler-blocked us is
 * not hit again on every return to the tab. The manual trigger is never gated.
 *
 * This replaces the 07-26 rule "reuse `sources.lastFetchedAt`, no new table"
 * (docs/32 §5.1): a failed or empty sync never wrote a source row, so it left
 * no trace. The record and why it is a table live in docs/32 §5.1 / §5.2.
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
 * Should the platform auto-sync now? Never attempted (null) → yes. Otherwise
 * only when the last attempt was NOT today (local day boundary).
 */
export function shouldAutoSync(lastAttemptAt: Date | null, now: Date): boolean {
  if (lastAttemptAt === null) return true;
  return !isSameLocalDay(lastAttemptAt, now);
}
