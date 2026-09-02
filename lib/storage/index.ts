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

export {
  type ThemeColorPreset,
  type ThemeContrast,
  type ThemeSettings,
  THEME_COLOR_PRESETS,
  THEME_CONTRASTS,
  DEFAULT_THEME_SETTINGS,
  canonicalizeThemeSettings,
  themeSettingsStorage,
  getThemeSettings,
  setThemeSettings,
  watchThemeSettings,
  isSameThemeSettings,
} from './theme-settings';

export {
  type AgentBridgeConfig,
  type AgentBridgeConnectionState,
  type AgentBridgeStatus,
  DEFAULT_AGENT_BRIDGE_CONFIG,
  DEFAULT_AGENT_BRIDGE_STATUS,
  agentBridgeConfigStorage,
  agentBridgeStatusStorage,
  getAgentBridgeConfig,
  setAgentBridgeConfig,
  watchAgentBridgeConfig,
  getAgentBridgeStatus,
  setAgentBridgeStatus,
  watchAgentBridgeStatus,
} from './agent-bridge';

export async function runStorageMigrations(): Promise<void> {
  await migrateSettingsIfNeeded();
}
