import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: (_key: string, options: { fallback: unknown }) => ({
      fallback: options.fallback,
      getValue: vi.fn(),
      setValue: vi.fn(),
      watch: vi.fn(),
    }),
  },
}));

import { DEFAULT_AGENT_BRIDGE_PORT } from '@/lib/agent-bridge/protocol';
import { STORAGE_KEYS } from './keys';
import {
  DEFAULT_AGENT_BRIDGE_CONFIG,
  DEFAULT_AGENT_BRIDGE_STATUS,
} from './agent-bridge';

describe('Agent Bridge storage contract', () => {
  it('uses central keys and remains disabled by default', () => {
    expect(STORAGE_KEYS.agentBridge).toBe('local:agent-bridge');
    expect(STORAGE_KEYS.agentBridgeStatus).toBe('local:agent-bridge-status');
    expect(DEFAULT_AGENT_BRIDGE_CONFIG).toEqual({
      enabled: false,
      port: DEFAULT_AGENT_BRIDGE_PORT,
      token: '',
      tokenCreatedAt: null,
    });
    expect(DEFAULT_AGENT_BRIDGE_STATUS).toEqual({
      state: 'disabled',
      lastConnectedAt: null,
      lastError: null,
      authFailureCount: 0,
      nextRetryAt: null,
    });
  });
});
