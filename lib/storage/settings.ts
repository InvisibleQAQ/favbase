import { storage } from 'wxt/utils/storage';
import { STORAGE_KEYS } from './keys';
import { resolveAsrConfig } from './resolve';
import {
  canonicalizeSettings,
  DEFAULT_SETTINGS,
  SettingsValidationError,
  type UserSettings,
} from './settings-schema';

export {
  canonicalizeSettings,
  DEFAULT_SETTINGS,
  SettingsValidationError,
  type SettingsValidationIssue,
  type UserSettings,
} from './settings-schema';

type SettingsWatcher = (
  newValue: UserSettings,
  oldValue: UserSettings | null,
) => void;

function defineRawSettingsStorage() {
  return storage.defineItem<unknown>(STORAGE_KEYS.settings, {
    fallback: DEFAULT_SETTINGS,
  });
}

let rawSettingsItem: ReturnType<typeof defineRawSettingsStorage> | null = null;

/**
 * Lazily defined: `storage.defineItem` primes its init mutex by reading the
 * value immediately, which touches `chrome.runtime` at module-evaluation time.
 * Deferring the definition to first use keeps merely IMPORTING this module free
 * of any runtime capability — which matters for consumers that cannot defer the
 * import itself, e.g. the Background Agent Bridge tool registry (a Service
 * Worker may not call dynamic `import()`). See `tests/lib-import-smoke.test.ts`.
 */
function rawSettingsStorage(): ReturnType<typeof defineRawSettingsStorage> {
  rawSettingsItem ??= defineRawSettingsStorage();
  return rawSettingsItem;
}

function reportInvalidStoredSettings(error: SettingsValidationError): void {
  console.error('[favbase settings] invalid persisted settings', error.message);
}

function canonicalOrDefault(input: unknown): UserSettings {
  try {
    return canonicalizeSettings(input);
  } catch (error) {
    if (!(error instanceof SettingsValidationError)) throw error;
    reportInvalidStoredSettings(error);
    return canonicalizeSettings({});
  }
}

export const settingsStorage = {
  async getValue(): Promise<UserSettings> {
    return canonicalOrDefault(await rawSettingsStorage().getValue());
  },

  async setValue(value: UserSettings): Promise<void> {
    await rawSettingsStorage().setValue(canonicalizeSettings(value));
  },

  watch(callback: SettingsWatcher): () => void {
    return rawSettingsStorage().watch((newValue, oldValue) => {
      let canonical: UserSettings;
      try {
        canonical = canonicalizeSettings(newValue);
      } catch (error) {
        if (!(error instanceof SettingsValidationError)) throw error;
        reportInvalidStoredSettings(error);
        return;
      }

      let previous: UserSettings | null = null;
      if (oldValue !== null && oldValue !== undefined) {
        try {
          previous = canonicalizeSettings(oldValue);
        } catch {
          previous = null;
        }
      }
      callback(canonical, previous);
    });
  },
};

// Pure resolvers live in `./resolve` (no wxt storage import) and are
// re-exported here so `@/lib/storage` remains the single import surface.
export {
  getEnvApiKey,
  getEnvModel,
  resolveAsrConfig,
  resolveLlmConfig,
  type ResolvedLlmConfig,
} from './resolve';


export async function getAsrSettings(): Promise<{ apiKey: string; model: string; baseUrl: string }> {
  const settings = await settingsStorage.getValue();
  return resolveAsrConfig(settings);
}

export async function migrateSettingsIfNeeded(): Promise<void> {
  const raw = await rawSettingsStorage().getValue();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return;
  const record = raw as Record<string, unknown>;
  const hasLegacyAsrFields = [
    'groqApiKey',
    'groqModel',
    'siliconFlowApiKey',
    'siliconFlowAsrModel',
  ].some((field) => Object.hasOwn(record, field));
  if (!hasLegacyAsrFields) return;

  await rawSettingsStorage().setValue(canonicalizeSettings(raw));
}
