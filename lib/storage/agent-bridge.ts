import { storage } from 'wxt/utils/storage';

import { DEFAULT_AGENT_BRIDGE_PORT } from '@/lib/agent-bridge/protocol';
import { envNumber } from '@/lib/env';
import { STORAGE_KEYS } from './keys';

export interface AgentBridgeConfig {
  enabled: boolean;
  port: number;
  token: string;
  tokenCreatedAt: number | null;
}

export type AgentBridgeConnectionState =
  | 'disabled'
  | 'disconnected'
  | 'connecting'
  | 'connected';

export interface AgentBridgeStatus {
  state: AgentBridgeConnectionState;
  lastConnectedAt: number | null;
  lastError: string | null;
  /** Consecutive authentication failures, reset only by a valid welcome. */
  authFailureCount: number;
  /** Epoch ms before which the client must not retry authentication. */
  nextRetryAt: number | null;
  /** Last bad-token failure, retained after a later successful welcome. */
  lastAuthFailureAt: number | null;
}

export const DEFAULT_AGENT_BRIDGE_CONFIG: Readonly<AgentBridgeConfig> = Object.freeze({
  enabled: false,
  port: envNumber('VITE_AGENT_BRIDGE_PORT', DEFAULT_AGENT_BRIDGE_PORT),
  token: '',
  tokenCreatedAt: null,
});

export const DEFAULT_AGENT_BRIDGE_STATUS: Readonly<AgentBridgeStatus> = Object.freeze({
  state: 'disabled',
  lastConnectedAt: null,
  lastError: null,
  authFailureCount: 0,
  nextRetryAt: null,
  lastAuthFailureAt: null,
});

export const agentBridgeConfigStorage = storage.defineItem<AgentBridgeConfig>(
  STORAGE_KEYS.agentBridge,
  { fallback: DEFAULT_AGENT_BRIDGE_CONFIG },
);

export const agentBridgeStatusStorage = storage.defineItem<AgentBridgeStatus>(
  STORAGE_KEYS.agentBridgeStatus,
  { fallback: DEFAULT_AGENT_BRIDGE_STATUS },
);

export function getAgentBridgeConfig(): Promise<AgentBridgeConfig> {
  return agentBridgeConfigStorage.getValue();
}

export function setAgentBridgeConfig(config: AgentBridgeConfig): Promise<void> {
  return agentBridgeConfigStorage.setValue(config);
}

export function watchAgentBridgeConfig(
  callback: (config: AgentBridgeConfig) => void,
): () => void {
  return agentBridgeConfigStorage.watch((config) => callback(config));
}

export function getAgentBridgeStatus(): Promise<AgentBridgeStatus> {
  return agentBridgeStatusStorage.getValue().then(normalizeAgentBridgeStatus);
}

export function setAgentBridgeStatus(status: AgentBridgeStatus): Promise<void> {
  return agentBridgeStatusStorage.setValue(status);
}

export function watchAgentBridgeStatus(
  callback: (status: AgentBridgeStatus) => void,
): () => void {
  return agentBridgeStatusStorage.watch((status) => callback(normalizeAgentBridgeStatus(status)));
}

function normalizeAgentBridgeStatus(status: AgentBridgeStatus): AgentBridgeStatus {
  return {
    ...DEFAULT_AGENT_BRIDGE_STATUS,
    ...status,
    lastAuthFailureAt: Number.isFinite(status.lastAuthFailureAt)
      ? status.lastAuthFailureAt
      : null,
  };
}
