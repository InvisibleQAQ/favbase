import {
  mapPlatforms,
  PLATFORM_DESCRIPTORS,
  type PlatformReadiness,
} from '@/lib/collections/platform-descriptor';
import { COLLECTION_PLATFORMS, type CollectionPlatform } from '@/lib/collections/platforms';

export type WelcomeReadiness = PlatformReadiness;

/** Readiness shape for every platform; welcome owns the interpretation. */
export const WELCOME_READINESS_BY_PLATFORM: Record<CollectionPlatform, WelcomeReadiness> =
  mapPlatforms(PLATFORM_DESCRIPTORS, (descriptor) => descriptor.readiness);

/** True when the platform needs a token/key before its first sync can run. */
export function needsCredentials(platform: CollectionPlatform): boolean {
  return WELCOME_READINESS_BY_PLATFORM[platform] === 'credentials';
}

/** Readiness shape used by the picker to keep onboarding copy exhaustive. */
export function readinessFor(platform: CollectionPlatform): WelcomeReadiness {
  return WELCOME_READINESS_BY_PLATFORM[platform];
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
