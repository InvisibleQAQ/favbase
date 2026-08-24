import type { AgentBridgeConnectNowRequest } from './messages';
import type { BackgroundContext } from './types';

export function handleAgentBridgeConnectNow(
  _message: AgentBridgeConnectNowRequest,
  ctx: BackgroundContext,
): Promise<void> {
  return ctx.connectAgentBridge();
}
