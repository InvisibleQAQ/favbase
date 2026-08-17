import { describe, it, expect } from 'vitest';
import {
  canonicalStringify,
  hashString,
  hashConfig,
  decideConfigSync,
  canAcquireLock,
} from './sync-logic';
import { LOCK_TIMEOUT_MS } from './constants';
import type { RemoteConfig, RemoteSys } from './types';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings-schema';

const baseSettings = {
  ...DEFAULT_SETTINGS,
  provider: 'openai' as const,
  providerApiKeys: { openai: 'k' },
};

function remoteConfig(updatedAt: number): RemoteConfig {
  return { version: 1, updatedAt, settings: baseSettings, locale: 'auto' };
}

function sys(partial: Partial<RemoteSys>): RemoteSys {
  return {
    lock_status: 'unlocked',
    lock_timestamp: 0,
    sync_version: 'v',
    last_sync_time: 0,
    ...partial,
  };
}

describe('canonicalStringify', () => {
  it('is stable across key insertion order', () => {
    expect(canonicalStringify({ a: 1, b: 2 })).toBe(canonicalStringify({ b: 2, a: 1 }));
  });

  it('recurses into nested objects and arrays', () => {
    const x = { z: { y: 1, x: 2 }, a: [3, { m: 1, n: 2 }] };
    const y = { a: [3, { n: 2, m: 1 }], z: { x: 2, y: 1 } };
    expect(canonicalStringify(x)).toBe(canonicalStringify(y));
  });

  it('distinguishes different content', () => {
    expect(canonicalStringify({ a: 1 })).not.toBe(canonicalStringify({ a: 2 }));
  });
});

describe('hashConfig', () => {
  it('is deterministic and order-independent', () => {
    const a = { ...baseSettings, providerApiKeys: { openai: 'k', claude: 'z' } };
    const b = { ...baseSettings, providerApiKeys: { claude: 'z', openai: 'k' } };
    expect(hashConfig(a, 'zh-CN')).toBe(hashConfig(b, 'zh-CN'));
  });

  it('changes when settings or locale change', () => {
    const base = hashConfig(baseSettings, 'auto');
    expect(hashConfig(baseSettings, 'en')).not.toBe(base);
    const edited = { ...baseSettings, provider: 'claude' as const };
    expect(hashConfig(edited, 'auto')).not.toBe(base);
  });

  it('hashString pads to 8 hex chars', () => {
    expect(hashString('')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('decideConfigSync', () => {
  it('pushes to seed when no remote exists', () => {
    expect(decideConfigSync(0, null)).toBe('push');
    expect(decideConfigSync(123, null)).toBe('push');
  });

  it('pulls when remote is newer', () => {
    expect(decideConfigSync(100, remoteConfig(200))).toBe('pull');
  });

  it('pushes when local is newer', () => {
    expect(decideConfigSync(300, remoteConfig(200))).toBe('push');
  });

  it('noops on equal timestamps', () => {
    expect(decideConfigSync(200, remoteConfig(200))).toBe('noop');
  });
});

describe('canAcquireLock', () => {
  const now = 1_000_000_000;

  it('acquires when no sys.json exists', () => {
    expect(canAcquireLock(null, now)).toBe(true);
  });

  it('acquires when unlocked', () => {
    expect(canAcquireLock(sys({ lock_status: 'unlocked' }), now)).toBe(true);
  });

  it('refuses a fresh lock held by another device', () => {
    expect(canAcquireLock(sys({ lock_status: 'locked', lock_timestamp: now - 1000 }), now)).toBe(
      false,
    );
  });

  it('steals a stale lock past the timeout', () => {
    const stale = now - LOCK_TIMEOUT_MS - 1;
    expect(canAcquireLock(sys({ lock_status: 'locked', lock_timestamp: stale }), now)).toBe(true);
  });

  it('treats exactly-at-timeout as stealable', () => {
    const at = now - LOCK_TIMEOUT_MS;
    expect(canAcquireLock(sys({ lock_status: 'locked', lock_timestamp: at }), now)).toBe(true);
  });
});
