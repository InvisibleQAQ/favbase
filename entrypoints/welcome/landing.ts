import { COLLECTION_PLATFORMS, type CollectionPlatform } from '@/lib/collections/platforms';

/**
 * Platforms that cannot sync until the user enters a credential in Settings >
 * Connections. Everything else is ready the moment the app opens: bilibili /
 * zhihu / x ride the browser's existing login, bookmarks are read locally.
 */
const CREDENTIAL_PLATFORMS = new Set<CollectionPlatform>(['github', 'youtube']);

/** True when the platform needs a token/key before its first sync can run. */
export function needsCredentials(platform: CollectionPlatform): boolean {
  return CREDENTIAL_PLATFORMS.has(platform);
}

/** Picks de-duplicated and sorted into registry order (click order is noise). */
export function normalizePicks(picked: Iterable<CollectionPlatform>): CollectionPlatform[] {
  const set = new Set(picked);
  return COLLECTION_PLATFORMS.filter((platform) => set.has(platform));
}

/**
 * The app.html hash route the welcome CTA lands on, derived from the first pick
 * in registry order: a credential platform lands in Settings (nothing to see
 * before a token exists), anything else lands on its own collection page.
 * No picks → bare app.html (dashboard).
 */
export function landingHash(picked: Iterable<CollectionPlatform>): string {
  const [first] = normalizePicks(picked);
  if (!first) return '';
  return needsCredentials(first) ? '#/settings' : `#/collections/${first}`;
}
