import { storage } from 'wxt/utils/storage';
import { STORAGE_KEYS } from '@/lib/storage';
import { encryptSecret, decryptSecret } from './crypto';
import type { WebdavConfig } from './types';

/**
 * Persisted shape: password stored AES-GCM obfuscated (see crypto.ts). Callers
 * never see this — get/setWebdavConfig round-trip the decrypted `WebdavConfig`.
 */
interface StoredWebdavConfig {
  enabled: boolean;
  url: string;
  username: string;
  encPassword: string;
}

const DEFAULT_STORED: StoredWebdavConfig = {
  enabled: false,
  url: '',
  username: '',
  encPassword: '',
};

const configStorage = storage.defineItem<StoredWebdavConfig>(STORAGE_KEYS.webdavConfig, {
  fallback: DEFAULT_STORED,
});

/** Read the decrypted WebDAV config. */
export async function getWebdavConfig(): Promise<WebdavConfig> {
  const stored = await configStorage.getValue();
  return {
    enabled: stored.enabled,
    url: stored.url,
    username: stored.username,
    password: await decryptSecret(stored.encPassword),
  };
}

/** Write the WebDAV config, obfuscating the password before it hits disk. */
export async function setWebdavConfig(config: WebdavConfig): Promise<void> {
  await configStorage.setValue({
    enabled: config.enabled,
    url: config.url.trim(),
    username: config.username,
    encPassword: await encryptSecret(config.password),
  });
}

/** Whether the config has enough to connect (url + username + password). */
export function hasWebdavCredentials(config: WebdavConfig): boolean {
  return !!config.url && !!config.username && !!config.password;
}

/**
 * Whether AUTOMATIC background sync should run: enabled AND connectable. Manual
 * "Sync now" only needs credentials (`hasWebdavCredentials`) — `enabled` gates
 * the scheduler's periodic/debounce/startup triggers, not user-driven syncs.
 */
export function isConfigSyncable(config: WebdavConfig): boolean {
  return config.enabled && hasWebdavCredentials(config);
}

/** Cross-context subscription to config changes (SW scheduler + UI). */
export function watchWebdavConfig(cb: () => void): () => void {
  return configStorage.watch(cb);
}
