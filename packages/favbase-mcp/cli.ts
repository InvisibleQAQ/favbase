import { pathToFileURL } from 'node:url';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { DEFAULT_AGENT_BRIDGE_PORT } from '../../lib/agent-bridge/protocol';
import {
  BridgePortInUseError,
  BridgeServer,
  type BridgeLogger,
} from './bridge-server';
import { createMcpServer } from './mcp-server';

declare const __FAVBASE_MCP_VERSION__: string;

const version = typeof __FAVBASE_MCP_VERSION__ === 'string'
  ? __FAVBASE_MCP_VERSION__
  : '0.0.0-dev';

const logger: BridgeLogger = {
  error(message) {
    process.stderr.write(`${message}\n`);
  },
};

function bridgeToken(value: string | undefined): string {
  const token = value?.trim();
  if (!token) throw new Error('FAVBASE_TOKEN is required');
  if (token.length > 512) throw new Error('FAVBASE_TOKEN must be at most 512 characters');
  return token;
}

export function bridgePort(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_AGENT_BRIDGE_PORT;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('FAVBASE_BRIDGE_PORT must be an integer between 1 and 65535');
  }
  return port;
}

export async function runCli(): Promise<void> {
  const port = bridgePort(process.env.FAVBASE_BRIDGE_PORT);
  const token = bridgeToken(process.env.FAVBASE_TOKEN);
  const bridge = new BridgeServer({ port, token, serverVersion: version, logger });

  try {
    await bridge.start();
  } catch (error) {
    if (error instanceof BridgePortInUseError) {
      throw new Error(
        `favbase bridge port ${port} is already in use (possibly by another agent session); close it, or change both FAVBASE_BRIDGE_PORT and the extension setting`,
      );
    }
    throw error;
  }

  const server = createMcpServer(bridge, version, logger);
  server.onerror = error => logger.error(`[favbase-mcp] MCP error: ${error.message}`);
  server.onclose = () => {
    void bridge.close();
  };

  try {
    await server.connect(new StdioServerTransport());
  } catch (error) {
    await bridge.close();
    throw error;
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await server.close();
    await bridge.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

function reportFatalError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`[favbase-mcp] ${message}`);
  process.exitCode = 1;
}

const entrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;
if (entrypoint) void runCli().catch(reportFatalError);
