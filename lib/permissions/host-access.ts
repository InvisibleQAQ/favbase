/**
 * Runtime host permission helper for user-configured API domains.
 *
 * MV3 extension pages can only make cross-origin fetches to hosts covered by
 * `host_permissions` (built-in providers, declared statically) or an optional
 * host permission granted at runtime (custom domains). Any other origin is
 * blocked by CORS. This module bridges that gap for custom Base URLs.
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
 * Classify whether a Base URL's origin is already granted, needs a runtime
 * grant (unknown https origin), or can't be granted. Does NOT prompt — callers
 * show an explanation UI on `needs-grant` before calling `requestHostPermission`.
 */
export async function checkHostPermission(baseUrl: string): Promise<HostPermissionState> {
  const pattern = hostMatchPattern(baseUrl);
  if (!pattern) return { status: 'invalid-url' };
  if (await browser.permissions.contains({ origins: [pattern] })) return { status: 'granted' };
  if (!pattern.startsWith('https://')) return { status: 'unsupported-scheme' };
  return { status: 'needs-grant', pattern, origin: new URL(baseUrl).origin };
}

/** Request a previously-classified origin pattern. MUST run in a user gesture. */
export function requestHostPermission(pattern: string): Promise<boolean> {
  return browser.permissions.request({ origins: [pattern] });
}
