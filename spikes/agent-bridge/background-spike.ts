import { z } from 'zod';

import { hybridRetrieve } from '@/lib/chat/retrieval';
import { chatTools } from '@/lib/chat/tools';
import type { FavbaseDb } from '@/lib/database';
import { initDbProxy } from '@/lib/database';
import { ensure as ensureOffscreen } from '@/lib/offscreen/lifecycle';

const SPIKE_QUERY = 'favbase agent bridge phase zero';

interface RuntimeTool {
  description?: string;
  inputSchema: unknown;
  execute?: (input: never, options: never) => unknown;
}

interface JsonMessage {
  type: string;
  seq?: number;
}

type CheckResult =
  | ({ ok: true } & Record<string, unknown>)
  | { ok: false; error: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readMessage(value: unknown): JsonMessage | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || typeof parsed.type !== 'string') return null;
    if (
      parsed.seq !== undefined &&
      (
        typeof parsed.seq !== 'number' ||
        !Number.isSafeInteger(parsed.seq) ||
        parsed.seq < 1
      )
    ) return null;
    return { type: parsed.type, seq: parsed.seq };
  } catch {
    return null;
  }
}

function readSpikePort(): number {
  const port = Number(import.meta.env.VITE_AGENT_BRIDGE_SPIKE_PORT);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('VITE_AGENT_BRIDGE_SPIKE_PORT must be a valid TCP port');
  }
  return port;
}

function zodSchema(value: unknown): z.ZodType {
  if (!isRecord(value) || typeof value.safeParse !== 'function') {
    throw new Error('Knowledge Tool inputSchema is not a Zod schema');
  }
  return value as unknown as z.ZodType;
}

function send(socket: WebSocket, payload: Record<string, unknown>): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

async function checkDbProxy(): Promise<{ db?: FavbaseDb; result: CheckResult }> {
  const checkStartedAt = performance.now();
  try {
    await ensureOffscreen();
    const db = await initDbProxy(ensureOffscreen);
    const hits = await hybridRetrieve(
      db,
      SPIKE_QUERY,
      { topK: 1 },
      { embedQuery: async () => null },
    );
    return {
      db,
      result: {
        ok: true,
        resultCount: hits.length,
        durationMs: Math.round(performance.now() - checkStartedAt),
      },
    };
  } catch (error) {
    return { result: { ok: false, error: errorMessage(error) } };
  }
}

function checkJsonSchemas(): CheckResult {
  try {
    const descriptors = Object.entries(chatTools).map(([name, definition]) => {
      const tool = definition as RuntimeTool;
      const schema = z.toJSONSchema(zodSchema(tool.inputSchema), {
        target: 'draft-2020-12',
        io: 'input',
      });
      return {
        name,
        hasDescription: typeof tool.description === 'string' && tool.description.length > 0,
        dialect: schema.$schema,
      };
    });
    return { ok: true, toolCount: descriptors.length, descriptors };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

async function checkExecute(db: FavbaseDb | undefined): Promise<CheckResult> {
  if (!db) return { ok: false, error: 'DB proxy check failed; execute was not attempted' };

  try {
    const tool = chatTools.searchKnowledgeBase as RuntimeTool;
    if (!tool.execute) throw new Error('searchKnowledgeBase has no execute function');
    const input = zodSchema(tool.inputSchema).parse({ query: SPIKE_QUERY, top_k: 1 });
    const output = await tool.execute(input as never, {
      toolCallId: 'agent-bridge-phase-0',
      messages: [],
      experimental_context: { db },
    } as never);
    if (!isRecord(output) || typeof output.count !== 'number') {
      throw new Error('searchKnowledgeBase execute returned an invalid result shape');
    }
    return { ok: true, resultCount: output.count };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function runAgentBridgePhase0Spike(): Promise<void> {
  const startedAt = Date.now();
  const instanceId = crypto.randomUUID();
  const socket = new WebSocket(`ws://127.0.0.1:${readSpikePort()}/agent-bridge-phase-0`);

  socket.addEventListener('message', (event) => {
    const message = readMessage(event.data);
    if (message?.type !== 'ping') return;
    send(socket, {
      type: 'pong',
      seq: message.seq,
      instanceId,
      uptimeMs: Date.now() - startedAt,
    });
  });

  socket.addEventListener('open', () => {
    const manifest = chrome.runtime.getManifest();
    send(socket, {
      type: 'connected',
      instanceId,
      startedAt,
      manifestHostPermissions: manifest.host_permissions ?? [],
      userAgent: navigator.userAgent,
    });

    void (async () => {
      const dbProxy = await checkDbProxy();
      const jsonSchemas = checkJsonSchemas();
      const execute = await checkExecute(dbProxy.db);
      send(socket, {
        type: 'spike-result',
        instanceId,
        checks: { dbProxy: dbProxy.result, jsonSchemas, execute },
      });
    })();
  });

  socket.addEventListener('error', () => {
    console.error('[agent-bridge:phase-0] WebSocket connection failed');
  });
}
