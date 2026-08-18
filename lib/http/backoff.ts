/**
 * Shared serial-pacing / transient-backoff primitives for platform HTTP
 * adapters — deduplicates the sleep + jittered-delay + capped-exponential
 * implementations that x-api.ts and zhihu-api.ts used to copy line-for-line
 * (and the identical `sleep` in youtube/bookmarks). Pure leaf module like
 * fetch-with-deadline.ts: no storage, no DB, no chrome.* — safe in any
 * runtime.
 *
 * The delay MATH is separated from the WAIT so it stays testable with an
 * injected `random` (the favoritePageDelayMs(random) precedent in
 * lib/bilibili/favorites-sync-runner.ts). Platforms keep their own pacing
 * CONSTANTS (each an envNumber-configurable value) — only the mechanism is
 * shared, never the numbers.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `base + random() * jitter` — serial inter-page pacing (human-ish cadence). */
export function jitteredDelayMs(
  baseMs: number,
  jitterMs: number,
  random: () => number = Math.random,
): number {
  return baseMs + random() * jitterMs;
}

/**
 * `base * 2^(attempt-1) + random() * jitter` — capped exponential backoff for
 * transient 429/5xx retries. `attempt` is 1-based (the value AFTER the caller
 * increments its retry counter); the cap itself stays with the caller.
 */
export function backoffDelayMs(
  attempt: number,
  baseMs: number,
  jitterMs: number,
  random: () => number = Math.random,
): number {
  return baseMs * 2 ** (attempt - 1) + random() * jitterMs;
}
