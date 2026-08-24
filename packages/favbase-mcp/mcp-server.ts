import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import type {
  AgentBridgeToolDescriptor,
  JsonObject,
  JsonValue,
} from '../../lib/agent-bridge/protocol';
import { BridgeCallError } from './bridge-server';
import type { BridgeLogger } from './bridge-server';

export interface AgentBridgePeer {
  callTool(name: string, args: JsonObject, signal?: AbortSignal): Promise<JsonValue>;
  listTools(): readonly AgentBridgeToolDescriptor[];
}

function mcpTool(descriptor: AgentBridgeToolDescriptor): Tool {
  return {
    name: descriptor.name,
    description: descriptor.description,
    inputSchema: descriptor.inputSchema as Tool['inputSchema'],
  };
}

function resultText(result: JsonValue): string {
  return typeof result === 'string' ? result : JSON.stringify(result);
}

function errorText(error: unknown): string {
  if (error instanceof BridgeCallError) return `[${error.code}] ${error.message}`;
  return error instanceof Error ? error.message : 'Unknown Agent Bridge error';
}

export function createMcpServer(
  bridge: AgentBridgePeer,
  version: string,
  logger: BridgeLogger,
): Server {
  const server = new Server(
    { name: 'favbase-mcp', version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = bridge.listTools().map(mcpTool);
    if (tools.length === 0) {
      logger.error(
        '[favbase-mcp] tools/list returned no tools: favbase extension has not completed hello; open Chrome and enable Agent Bridge with the same port and token',
      );
    }
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const result = await bridge.callTool(
        request.params.name,
        (request.params.arguments ?? {}) as JsonObject,
        extra.signal,
      );
      return { content: [{ type: 'text', text: resultText(result) }] };
    } catch (error) {
      const text = errorText(error);
      logger.error(`[favbase-mcp] tools/call failed: ${text}`);
      return {
        content: [{ type: 'text', text }],
        isError: true,
      };
    }
  });

  return server;
}
