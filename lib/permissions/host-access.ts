/**
 * Host-access preflight and recovery for user-configured API domains.
 *
 * The required `<all_urls>` manifest permission normally covers every HTTP(S)
 * origin. Users can still decline or revoke required site access, so callers
 * check the effective grant before fetching and can request missing HTTPS access.
 *
 * `requestHostPermission` MUST run inside a user gesture (a button click) so
 * `browser.permissions.request` has transient user activation.
 */

export type PermissionDenyReason = 'invalid-url' | 'unsupported-scheme' | 'denied';

export type EnsurePermissionResult = { ok: true } | { ok: false; reason: PermissionDenyReason };

export type HostPermissionState =
  | { status: 'granted' }
  | { status: 'needs-grant'; pattern: string; origin: string }
  | { status: 'invalid-url' }
  | { status: 'unsupported-scheme' };

/**
 * Build a Chrome match pattern (`scheme://host/*`) from a Base URL.
 * Uses `hostname` (drops the port — match patterns don't take ports).
 * Returns null when the URL can't be parsed.
 */
export function hostMatchPattern(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}

/**
 * Classify whether a Base URL's origin is already granted, needs required HTTPS
 * access restored, or can't be restored here. Does NOT prompt — callers show an
 * explanation UI on `needs-grant` before calling `requestHostPermission`.
 */
export async function checkHostPermission(baseUrl: string): Promise<HostPermissionState> {
  const pattern = hostMatchPattern(baseUrl);
  if (!pattern) return { status: 'invalid-url' };
  if (await browser.permissions.contains({ origins: [pattern] })) return { status: 'granted' };
  if (!pattern.startsWith('https://')) return { status: 'unsupported-scheme' };
  return { status: 'needs-grant', pattern, origin: new URL(baseUrl).origin };
}

/** Restore a previously-classified required HTTPS origin. MUST run in a user gesture. */
export function requestHostPermission(pattern: string): Promise<boolean> {
  return browser.permissions.request({ origins: [pattern] });
}
