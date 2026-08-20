import { useEffect } from 'react';

import { useTranslation } from '@/lib/i18n/use-translation';

import { themeConfig } from '../theme/theme-config';
import { useRunningJobs } from './background-jobs-store';

// The indicator chip's tone. Read from the palette constants (not the React
// theme object) because this value feeds a plain browser API. Chrome
// auto-picks contrasting badge text (M110+).
const BADGE_COLOR = themeConfig.palette.warning.main;

/**
 * Write the running-job count onto the toolbar action badge, with the
 * localized reminder as the icon's hover title. count 0 clears both
 * ('' resets the title to the manifest name).
 *
 * WRITE-only: jobs live in this page's context, so only this page knows the
 * count — but badge text outlives the page (browser-session persistent).
 * Wiping a badge left behind by a closed app.html is the SW janitor's job
 * (lib/background/jobs-badge.ts), never ours.
 */
export function applyJobsBadge(count: number, reminder: string): void {
  const swallow = (err: unknown) =>
    console.warn('[jobs-badge] action update failed:', err);

  void browser.action.setBadgeText({ text: count > 0 ? String(count) : '' }).catch(swallow);
  void browser.action.setTitle({ title: count > 0 ? reminder : '' }).catch(swallow);
  if (count > 0) {
    void browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch(swallow);
  }
}

/**
 * Keep the toolbar badge in sync with the running-job count while mounted
 * (dashboard layout — always mounted across routes, same as the indicator).
 * Locale switches re-render → the reminder recomputes → the title follows.
 */
export function useJobsBadge(): void {
  const { t } = useTranslation();
  const count = useRunningJobs().length;
  const reminder = count > 0 ? t('backgroundJobs.reminder', { count }) : '';

  useEffect(() => {
    applyJobsBadge(count, reminder);
  }, [count, reminder]);
}
