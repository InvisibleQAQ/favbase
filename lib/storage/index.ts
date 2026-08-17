import { migrateSettingsIfNeeded } from './settings';

export { STORAGE_KEYS, STORAGE_PREFIXES } from './keys';

export {
  type UserSettings,
  type SettingsValidationIssue,
  DEFAULT_SETTINGS,
  canonicalizeSettings,
  SettingsValidationError,
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
  asrQuotaPauseStorage,
  xLastSyncStorage,
  type XLastSync,
  onboardingStorage,
  type OnboardingState,
  libraryGateStorage,
} from './ui-state';

export async function runStorageMigrations(): Promise<void> {
  await migrateSettingsIfNeeded();
}
