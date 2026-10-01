import { envNumber } from '@/lib/env';

/**
 * X's sync pacing: after a successful X sync the Fetch button stays locked for
 * this long (default 5 minutes). It is rate-limit policy for one platform, so
 * the number lives here with the platform's other numbers and goes through
 * `envNumber` like them (`.env.example`, x block). The window arithmetic and
 * the countdown label are app-side (`entrypoints/app/sections/x/cooldown.ts`,
 * `entrypoints/app/hooks/use-countdown.ts`).
 *
 * Its own leaf rather than a constant in `x-sync-service.ts`, so the app-side
 * cooldown and its test never load the DB layer.
 */
export const COOLDOWN_MS = envNumber('VITE_X_COOLDOWN_MS', 300_000);
