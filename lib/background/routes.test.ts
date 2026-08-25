import { describe, expect, it, vi } from 'vitest';

vi.mock('./transcription-handlers', () => ({
  handleTranscribe: vi.fn(),
  handleTranscribeAbort: vi.fn(),
  handleOffscreenProgress: vi.fn(),
}));
vi.mock('./cache-handlers', () => ({
  handleGetVideoCache: vi.fn(),
  handleCacheSubtitle: vi.fn(),
}));
vi.mock('./summary-handlers', () => ({
  handleSummarize: vi.fn(),
  handleSummarizeAbort: vi.fn(),
  handleGetSummaryCache: vi.fn(),
}));
vi.mock('./app-handlers', () => ({ handleOpenAppPage: vi.fn() }));
vi.mock('./bookmark-handlers', () => ({ handleFetchBookmarkPage: vi.fn() }));
vi.mock('./sync-handlers', () => ({
  handleWebdavSyncNow: vi.fn(),
  handleWebdavClearRemote: vi.fn(),
}));
vi.mock('./agent-bridge-handlers', () => ({
  handleAgentBridgeConnectNow: vi.fn(async (_message, ctx) => {
    await ctx.connectAgentBridge();
    return { success: true };
  }),
}));

import { handleAgentBridgeConnectNow } from './agent-bridge-handlers';
import { routeBackgroundMessage } from './routes';
import type { BackgroundContext } from './types';

describe('Background message routes', () => {
  it('routes AGENT_BRIDGE_CONNECT_NOW to the scheduler-owned context command', async () => {
    const connectAgentBridge = vi.fn(async () => {});
    const ctx = { connectAgentBridge } as unknown as BackgroundContext;
    const message = { type: 'AGENT_BRIDGE_CONNECT_NOW' } as const;

    const response = await routeBackgroundMessage(message, { id: 'extension-id' }, ctx);

    expect(response).toEqual({ success: true });
    expect(handleAgentBridgeConnectNow).toHaveBeenCalledWith(message, ctx);
    expect(connectAgentBridge).toHaveBeenCalledOnce();
  });
});
