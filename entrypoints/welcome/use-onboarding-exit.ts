import type { CollectionPlatform } from '@/lib/collections/platforms';

import { useCallback, useState } from 'react';

import { onboardingStorage } from '@/lib/storage';

import { landingHash, normalizePicks } from './landing';

/**
 * Leaves welcome.html for app.html, recording the outcome on the way out.
 *
 * `location.replace` reuses this tab and drops welcome.html from history, so
 * Back never drags the user through onboarding a second time.
 */
export function useOnboardingExit() {
  const [leaving, setLeaving] = useState(false);

  const exit = useCallback(async (picked: CollectionPlatform[] = []) => {
    setLeaving(true);
    const platforms = normalizePicks(picked);

    try {
      await onboardingStorage.setValue({ completedAt: Date.now(), platforms });
    } catch (err) {
      // A failed write only costs one extra welcome screen on the next install
      // event — never a reason to trap the user on this page.
      console.error('[welcome] failed to persist onboarding state', err);
    }

    window.location.replace(browser.runtime.getURL('/app.html') + landingHash(platforms));
  }, []);

  return { exit, leaving };
}
