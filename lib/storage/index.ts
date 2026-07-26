import { migrateSettingsIfNeeded } from './settings';

export { STORAGE_KEYS, STORAGE_PREFIXES } from './keys';

export {
  type UserSettings,
  DEFAULT_SETTINGS,
  settingsStorage,
  resolveAsrConfig,
  resolveLlmConfig,
  type ResolvedLlmConfig,
  getEnvApiKey,
  getEnvModel,
  getAsrSettings,
  migrateSettingsIfNeeded,
} from './settings';

export {
  sidebarPinnedStorage,
  localeStorage,
  type LocalePreference,
  xLastSyncStorage,
  type XLastSync,
} from './ui-state';

export async function runStorageMigrations(): Promise<void> {
  await migrateSettingsIfNeeded();
}
