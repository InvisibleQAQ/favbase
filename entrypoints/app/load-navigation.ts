import { onboardingStorage } from '@/lib/storage';
import {
  isCollectionPlatform,
  type CollectionPlatform,
} from '@/lib/collections/platforms';

import { createNavData } from './layouts/nav-config';

/** Builds the immutable app navigation from the one-time onboarding preference. */
export async function loadNavigationData() {
  try {
    const onboarding = await onboardingStorage.getValue();
    const preferredPlatforms = Array.isArray(onboarding?.platforms)
      ? onboarding.platforms.filter(
          (value): value is CollectionPlatform =>
            typeof value === 'string' && isCollectionPlatform(value),
        )
      : [];

    return createNavData(preferredPlatforms);
  } catch (error) {
    console.error('[app] failed to load onboarding navigation preference', error);
    return createNavData();
  }
}
