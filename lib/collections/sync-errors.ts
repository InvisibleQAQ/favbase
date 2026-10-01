/**
 * The two shapes a Collection Platform's refusal takes (docs/32 Step 4). Every
 * platform's `*AuthError` extends `PlatformAuthError` and every
 * `*RateLimitError` extends `PlatformRateLimitError`, so the app classifies a
 * failed sync by base class alone and never learns a platform's error names
 * (`entrypoints/app/hooks/collection-sync-error.ts`). Which response counts as
 * auth or rate limit, and where `resetAt` comes from, stays the platform's
 * call in its own `*-api.ts`; only the shape is shared here.
 *
 * Two iron rules, both because this file is loaded from every runtime that
 * talks to a platform (the Background SW included, through `bilibili-api.ts`):
 * - **zero imports**, not even type imports;
 * - **not re-exported from the `lib/collections/index.ts` barrel** — that
 *   barrel goes through `collections-query` and drags drizzle and
 *   `@/lib/database` into every importer. Import this file by path.
 *
 * Guarded by `tests/platform-completeness-contract.test.ts` (every
 * `*AuthError` / `*RateLimitError` class under `lib/<platform>/` must extend
 * the matching base) and `tests/lib-import-smoke.test.ts`.
 */

/**
 * Why a Collection Platform refused us for auth — the two need different user
 * actions.
 *
 * - `'rejected'`: favbase **had already confirmed it holds credentials before
 *   the request** — a PAT, an API key, a captured X session, a local SESSDATA
 *   cookie that exists and has not expired — and the platform refused them.
 *   The user re-enters or refreshes the credential.
 * - `'missing'`: everything else, including a platform whose login favbase
 *   never checks locally. Zhihu's session lives in the browser's cookie jar
 *   and nothing inspects it before the request, so Zhihu is always
 *   `'missing'`. The user logs in.
 */
export type AuthFailReason = 'missing' | 'rejected';

/**
 * A platform refused us for auth. Abstract: each platform throws its own
 * subclass so logs and the UI can still tell platforms apart. The base sets no
 * `name` — every subclass sets its own explicitly, because a production build
 * mangles class names and `new.target.name` would be meaningless.
 */
export abstract class PlatformAuthError extends Error {
  constructor(
    message: string,
    readonly reason: AuthFailReason,
  ) {
    super(message);
  }
}

/**
 * A platform refused us for rate limiting (or anti-crawler risk control). Same
 * abstract / explicit-`name` rules as `PlatformAuthError`.
 */
export abstract class PlatformRateLimitError extends Error {
  constructor(
    message: string,
    /** When the platform said the limit lifts; null when it did not say. */
    readonly resetAt: Date | null,
  ) {
    super(message);
  }
}
