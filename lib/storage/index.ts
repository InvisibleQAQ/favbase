import { migrateSettingsIfNeeded } from './settings';

export { STORAGE_KEYS } from './keys';

export {
  type UserSettings,
  DEFAULT_SETTINGS,
  settingsStorage,
  resolveAsrConfig,
  getAsrSettings,
  migrateSettingsIfNeeded,
} from './settings';

export { sidebarPinnedStorage } from './ui-state';

export async function runStorageMigrations(): Promise<void> {
  await migrateSettingsIfNeeded();
}
