import type { AgentBridgeConnectNowRequest } from './messages';
import type { BackgroundResponseMap } from './message-protocol';
import type { BackgroundContext } from './types';

export async function handleAgentBridgeConnectNow(
  _message: AgentBridgeConnectNowRequest,
  ctx: BackgroundContext,
): Promise<BackgroundResponseMap['AGENT_BRIDGE_CONNECT_NOW']> {
  await ctx.connectAgentBridge();
  return { success: true };
}
