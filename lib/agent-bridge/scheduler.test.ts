import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage/agent-bridge', () => ({
  getAgentBridgeConfig: vi.fn(),
  watchAgentBridgeConfig: vi.fn(),
}));

import type { AgentBridgeConfig } from '@/lib/storage/agent-bridge';
import {
  AGENT_BRIDGE_ALARM,
  AGENT_BRIDGE_POLL_MINUTES,
  initAgentBridgeScheduler,
  type AgentBridgeSchedulerClient,
} from './scheduler';

describe('Agent Bridge scheduler', () => {
  let config: AgentBridgeConfig;
  let alarms: Map<string, { periodInMinutes?: number }>;
  let alarmListener: ((alarm: { name: string }) => void) | undefined;
  let startupListener: (() => void) | undefined;
  let configListener: (() => void) | undefined;
  let client: AgentBridgeSchedulerClient;

  beforeEach(() => {
    config = {
      enabled: false,
      port: 17_836,
      token: '',
      tokenCreatedAt: null,
    };
    alarms = new Map();
    client = {
      tryConnect: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
  });

  function init() {
    return initAgentBridgeScheduler(client, {
      getConfig: async () => config,
      watchConfig: (listener) => {
        configListener = listener;
        return () => {};
      },
      alarms: {
        create: vi.fn(async (name, info) => { alarms.set(name, info); }),
        clear: vi.fn(async (name) => alarms.delete(name)),
        onAlarm: { addListener: (listener) => { alarmListener = listener; } },
      },
      startup: { addListener: (listener) => { startupListener = listener; } },
    });
  }

  it('keeps zero Agent Bridge alarms while disabled', async () => {
    init();

    await vi.waitFor(() => expect(client.close).toHaveBeenCalledWith('disabled'));
    expect(alarms.has(AGENT_BRIDGE_ALARM)).toBe(false);
    expect(client.tryConnect).not.toHaveBeenCalled();
  });

  it('arms, connects, and clears both transport and alarm on disable', async () => {
    init();
    await vi.waitFor(() => expect(client.close).toHaveBeenCalledOnce());

    config = { ...config, enabled: true, token: 'token' };
    configListener?.();
    await vi.waitFor(() => expect(client.tryConnect).toHaveBeenCalledOnce());
    expect(alarms.get(AGENT_BRIDGE_ALARM)).toEqual({
      periodInMinutes: AGENT_BRIDGE_POLL_MINUTES,
    });

    config = { ...config, enabled: false };
    configListener?.();
    await vi.waitFor(() => {
      expect(client.close).toHaveBeenLastCalledWith('disabled');
      expect(alarms.has(AGENT_BRIDGE_ALARM)).toBe(false);
    });
  });

  it('routes only its alarm and startup compensation through tryConnect', async () => {
    config = { ...config, enabled: true, token: 'token' };
    const scheduler = init();
    await vi.waitFor(() => expect(client.tryConnect).toHaveBeenCalledOnce());

    alarmListener?.({ name: 'other-alarm' });
    expect(client.tryConnect).toHaveBeenCalledOnce();

    alarmListener?.({ name: AGENT_BRIDGE_ALARM });
    await vi.waitFor(() => expect(client.tryConnect).toHaveBeenCalledTimes(2));

    startupListener?.();
    await vi.waitFor(() => expect(client.tryConnect).toHaveBeenCalledTimes(3));

    await scheduler.connectNow();
    expect(client.tryConnect).toHaveBeenCalledTimes(4);
  });
});
