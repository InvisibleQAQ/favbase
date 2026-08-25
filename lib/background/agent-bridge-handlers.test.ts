import { describe, expect, it, vi } from 'vitest';

import { handleAgentBridgeConnectNow } from './agent-bridge-handlers';
import type { BackgroundContext } from './types';

describe('Agent Bridge background handlers', () => {
  it('returns a serializable acknowledgement after the scheduler settles', async () => {
    const connectAgentBridge = vi.fn(async () => {});
    const ctx = { connectAgentBridge } as unknown as BackgroundContext;

    await expect(handleAgentBridgeConnectNow(
      { type: 'AGENT_BRIDGE_CONNECT_NOW' },
      ctx,
    )).resolves.toEqual({ success: true });
    expect(connectAgentBridge).toHaveBeenCalledOnce();
  });

  it('preserves scheduler failures instead of acknowledging them', async () => {
    const error = new Error('scheduler failed');
    const connectAgentBridge = vi.fn(async () => {
      throw error;
    });
    const ctx = { connectAgentBridge } as unknown as BackgroundContext;

    await expect(handleAgentBridgeConnectNow(
      { type: 'AGENT_BRIDGE_CONNECT_NOW' },
      ctx,
    )).rejects.toBe(error);
  });
});
