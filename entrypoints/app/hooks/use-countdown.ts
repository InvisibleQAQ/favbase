import { useEffect, useState } from 'react';

import { formatClock } from '@/lib/format';

/**
 * The one 1 s countdown: re-renders every second while `remainingAt(now) > 0`
 * and returns the current remaining ms (docs/32 Step 4). Drives both X's
 * post-sync cooldown and the rate-limit lock on the Fetch button.
 *
 * `now` is read during render (`Date.now()`), not kept in state. A deadline
 * that appears long after mount — a rate-limit error ten minutes into the
 * page's life — must be measured from this moment on its first frame; a
 * `now` captured at mount (or at the last tick) would show a remainder that is
 * wrong by however long the page sat idle. The interval only forces the
 * re-render; each render recomputes from the clock. It runs only while
 * something remains and stops once the remainder reaches 0.
 *
 * `remainingAt` is a fresh closure on every render, so it is deliberately not
 * an effect dependency.
 */
export function useCountdown(remainingAt: (now: number) => number): number {
  const [, setTick] = useState(0);
  const remaining = Math.max(0, remainingAt(Date.now()));
  const active = remaining > 0;

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  return remaining;
}

/** Format a remaining-ms duration as `m:ss` for a countdown label (never `0:00` while time remains). */
export function formatCountdown(remainingMs: number): string {
  return formatClock(Math.ceil(Math.max(0, remainingMs) / 1_000));
}
