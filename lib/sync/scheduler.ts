import { settingsStorage, localeStorage } from '@/lib/storage';
import { getWebdavConfig, isConfigSyncable, watchWebdavConfig } from './sync-config-storage';
import { noteLocalConfigChange, seedConfigClockIfUnset, getSyncMeta } from './sync-meta-storage';
import { doSync } from './sync-engine';
import {
  ALARM_PERIODIC,
  ALARM_DEBOUNCE,
  PERIODIC_MINUTES,
  DEBOUNCE_MINUTES,
} from './constants';

/**
 * Background auto-sync triggers (Background SW only). Three sources, all gated
 * on `enabled` (doSync itself no-ops when disabled):
 *   1. periodic  — chrome.alarms every 30 min (MV3 SWs sleep; setTimeout can't).
 *   2. on-change — local settings/locale edit → debounced 5-min alarm.
 *   3. startup   — if ≥30 min since last sync, catch up on SW wake.
 *
 * Listeners are registered synchronously so the SW can be woken by them.
 */
export function initWebdavSyncScheduler(): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_PERIODIC || alarm.name === ALARM_DEBOUNCE) {
      void doSync();
    }
  });

  // Config enable/disable/URL change → (re)arm or clear the periodic alarm.
  watchWebdavConfig(() => void refreshPeriodicAlarm());

  // Local config edits → bump the LWW clock + schedule a debounced sync.
  settingsStorage.watch(() => void onLocalConfigChanged());
  localeStorage.watch(() => void onLocalConfigChanged());

  void refreshPeriodicAlarm();
  void startupCatchUp();
}

async function refreshPeriodicAlarm(): Promise<void> {
  const config = await getWebdavConfig();
  if (isConfigSyncable(config)) {
    await seedConfigClockIfUnset();
    await browser.alarms.create(ALARM_PERIODIC, { periodInMinutes: PERIODIC_MINUTES });
  } else {
    await browser.alarms.clear(ALARM_PERIODIC);
  }
}

async function onLocalConfigChanged(): Promise<void> {
  const changed = await noteLocalConfigChange(Date.now());
  if (!changed) return; // our own pull-write, or a no-op change
  const config = await getWebdavConfig();
  if (isConfigSyncable(config)) {
    // Re-creating the same-named alarm resets its delay → debounce.
    await browser.alarms.create(ALARM_DEBOUNCE, { delayInMinutes: DEBOUNCE_MINUTES });
  }
}

async function startupCatchUp(): Promise<void> {
  const config = await getWebdavConfig();
  if (!isConfigSyncable(config)) return;
  const meta = await getSyncMeta();
  if (Date.now() - meta.lastSyncTime >= PERIODIC_MINUTES * 60 * 1000) {
    void doSync();
  }
}
