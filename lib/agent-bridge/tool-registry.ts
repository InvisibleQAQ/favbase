import { z } from 'zod';

import { chatTools } from '@/lib/chat/tools';
import type { FavbaseDb } from '@/lib/database';
import { decodeAgentBridgeToolDescriptor } from './protocol';
import type {
  AgentBridgeToolDescriptor,
  AgentBridgeToolErrorCode,
} from './protocol';

interface RuntimeTool {
  description?: string;
  inputSchema: unknown;
  execute?: (input: never, options: never) => unknown;
}

type ToolCallErrorCode = Extract<
  AgentBridgeToolErrorCode,
  'unknown-tool' | 'invalid-args'
>;

export class AgentBridgeToolCallError extends Error {
  readonly code: ToolCallErrorCode;

  constructor(code: ToolCallErrorCode, message: string) {
    super(message);
    this.name = 'AgentBridgeToolCallError';
    this.code = code;
  }
}

function inputSchema(toolName: string, value: unknown): z.ZodType {
  if (!(value instanceof z.ZodType)) {
    throw new Error(`[agent-bridge] Knowledge Tool ${toolName} has no Zod input schema`);
  }
  return value;
}

export function describeTools(): AgentBridgeToolDescriptor[] {
  return Object.entries(chatTools).map(([name, tool]) => {
    const runtimeTool = tool as RuntimeTool;
    if (!runtimeTool.description) {
      throw new Error(`[agent-bridge] Knowledge Tool ${name} has no description`);
    }
    const inputJsonSchema = z.toJSONSchema(inputSchema(name, runtimeTool.inputSchema), {
      target: 'draft-2020-12',
      io: 'input',
    });
    const descriptor = decodeAgentBridgeToolDescriptor({
      name,
      description: runtimeTool.description,
      inputSchema: inputJsonSchema,
    });
    if (!descriptor) {
      throw new Error(`[agent-bridge] Knowledge Tool ${name} produced invalid JSON Schema`);
    }
    return descriptor;
  });
}

export async function callTool(
  name: string,
  args: unknown,
  db: FavbaseDb,
): Promise<unknown> {
  if (!Object.hasOwn(chatTools, name)) {
    throw new AgentBridgeToolCallError('unknown-tool', `Unknown Knowledge Tool: ${name}`);
  }

  const tool = chatTools[name as keyof typeof chatTools] as RuntimeTool;
  const schema = inputSchema(name, tool.inputSchema);
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.message}`;
    });
    throw new AgentBridgeToolCallError(
      'invalid-args',
      `Invalid arguments for Knowledge Tool ${name}: ${issues.join('; ')}`,
    );
  }
  if (!tool.execute) {
    throw new Error(`[agent-bridge] Knowledge Tool ${name} has no execute function`);
  }

  return await tool.execute(parsed.data as never, {
    toolCallId: `agent-bridge:${name}`,
    messages: [],
    experimental_context: { db },
  } as never);
}
