import { createClient, AuthType, type WebDAVClient } from 'webdav';
import type { WebdavConfig } from './types';

/**
 * Thin wrapper over the `webdav` npm package (handles PROPFIND/GET/PUT/MKCOL/
 * DELETE + Basic Auth XML for us). We only add: JSON round-tripping, 404→null,
 * and tolerant recursive directory creation. Cross-origin fetches to the user's
 * server require a runtime host permission granted once in the UI (see
 * lib/permissions) — after that the SW can fetch without a user gesture.
 */
export class WebdavClient {
  private client: WebDAVClient;

  constructor(config: WebdavConfig) {
    this.client = createClient(config.url, {
      username: config.username,
      password: config.password,
      authType: AuthType.Password,
    });
  }

  /** PROPFIND the root — throws on auth/network failure (used to validate). */
  async testConnection(): Promise<void> {
    await this.client.getDirectoryContents('/');
  }

  /** GET + JSON.parse a file; returns null if it doesn't exist or won't parse. */
  async getJSON<T>(path: string): Promise<T | null> {
    if (!(await this.client.exists(path))) return null;
    try {
      const text = (await this.client.getFileContents(path, { format: 'text' })) as string;
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  /** Ensure the parent dir exists, then PUT the JSON-serialized value. */
  async putJSON(path: string, data: unknown): Promise<void> {
    const parent = path.slice(0, path.lastIndexOf('/'));
    if (parent) await this.ensureDirectory(parent);
    await this.client.putFileContents(path, JSON.stringify(data, null, 2), { overwrite: true });
  }

  /**
   * MKCOL each path segment in turn. Tolerates "already exists" and servers that
   * reject redundant MKCOLs (Nutstore et al.) — only warns, never throws, so a
   * pre-existing tree doesn't abort a sync.
   */
  async ensureDirectory(dirPath: string): Promise<void> {
    const segments = dirPath.split('/').filter(Boolean);
    let current = '';
    for (const seg of segments) {
      current += `/${seg}`;
      try {
        if (!(await this.client.exists(current))) {
          await this.client.createDirectory(current);
        }
      } catch (err) {
        console.warn('[favbase webdav] createDirectory tolerated failure', current, err);
      }
    }
  }

  /** DELETE a file or directory; no-op if absent. */
  async deletePath(path: string): Promise<void> {
    if (await this.client.exists(path)) {
      await this.client.deleteFile(path);
    }
  }
}
