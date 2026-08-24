import { z } from 'zod';

export const AGENT_BRIDGE_PROTOCOL_CHANNEL = 'favbase-agent-bridge';
export const AGENT_BRIDGE_PROTOCOL_VERSION = 1;
export const DEFAULT_AGENT_BRIDGE_PORT = 17_836;

export const AGENT_BRIDGE_TOOL_ERROR_CODES = [
  'unknown-tool',
  'invalid-args',
  'db-unavailable',
  'execution-failed',
] as const;

export type AgentBridgeToolErrorCode = typeof AGENT_BRIDGE_TOOL_ERROR_CODES[number];

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);

const idSchema = z.string().min(1).max(256);
const toolNameSchema = z.string().min(1).max(256);
const tokenSchema = z.string().min(1).max(512);
const versionSchema = z.string().min(1).max(128);

const toolDescriptorSchema = z.strictObject({
  name: toolNameSchema,
  description: z.string().min(1).max(50_000),
  inputSchema: jsonObjectSchema,
});

export type AgentBridgeToolDescriptor = z.infer<typeof toolDescriptorSchema>;

export function decodeAgentBridgeToolDescriptor(
  input: unknown,
): AgentBridgeToolDescriptor | null {
  const result = toolDescriptorSchema.safeParse(input);
  return result.success ? result.data : null;
}

const envelopeShape = {
  channel: z.literal(AGENT_BRIDGE_PROTOCOL_CHANNEL),
  protocolVersion: z.literal(AGENT_BRIDGE_PROTOCOL_VERSION),
  id: idSchema,
};

function messageSchema<Type extends string, Payload extends z.ZodType>(
  type: Type,
  payload: Payload,
) {
  return z.strictObject({
    ...envelopeShape,
    type: z.literal(type),
    payload,
  });
}

const toolResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    callId: idSchema,
    ok: z.literal(true),
    result: jsonValueSchema,
  }),
  z.strictObject({
    callId: idSchema,
    ok: z.literal(false),
    error: z.strictObject({
      code: z.enum(AGENT_BRIDGE_TOOL_ERROR_CODES),
      message: z.string().min(1).max(50_000),
    }),
  }),
]);

const agentBridgeMessageSchemas = {
  hello: messageSchema('hello', z.strictObject({
    token: tokenSchema,
    extensionId: idSchema,
    extensionVersion: versionSchema,
    tools: z.array(toolDescriptorSchema).max(64),
  })),
  welcome: messageSchema('welcome', z.strictObject({
    token: tokenSchema,
    serverVersion: versionSchema,
  })),
  reject: messageSchema('reject', z.strictObject({
    reason: z.enum(['bad-token', 'bad-origin', 'version']),
  })),
  'tools.call': messageSchema('tools.call', z.strictObject({
    callId: idSchema,
    name: toolNameSchema,
    args: jsonObjectSchema,
  })),
  'tools.result': messageSchema('tools.result', toolResultSchema),
  ping: messageSchema('ping', z.strictObject({})),
  pong: messageSchema('pong', z.strictObject({})),
};

type AgentBridgeMessageSchemaMap = typeof agentBridgeMessageSchemas;
export type AgentBridgeMessageType = keyof AgentBridgeMessageSchemaMap;
export type AgentBridgeMessage = {
  [Type in AgentBridgeMessageType]: z.infer<AgentBridgeMessageSchemaMap[Type]>;
}[AgentBridgeMessageType];

type WithoutEnvelope<Message> = Message extends AgentBridgeMessage
  ? Omit<Message, 'channel' | 'protocolVersion'>
  : never;

export type AgentBridgeMessageInput = WithoutEnvelope<AgentBridgeMessage>;

export const AGENT_BRIDGE_MESSAGE_TYPES = Object.freeze(
  Object.keys(agentBridgeMessageSchemas) as AgentBridgeMessageType[],
);

function messageType(input: unknown): AgentBridgeMessageType | null {
  if (!input || typeof input !== 'object') return null;
  const type = (input as { type?: unknown }).type;
  if (typeof type !== 'string' || !Object.hasOwn(agentBridgeMessageSchemas, type)) {
    return null;
  }
  return type as AgentBridgeMessageType;
}

export function decodeAgentBridgeMessage(input: unknown): AgentBridgeMessage | null {
  const type = messageType(input);
  if (!type) return null;
  const result = agentBridgeMessageSchemas[type].safeParse(input);
  return result.success ? result.data as AgentBridgeMessage : null;
}

export function encodeAgentBridgeMessage(
  input: AgentBridgeMessageInput,
): AgentBridgeMessage | null {
  return decodeAgentBridgeMessage({
    ...input,
    channel: AGENT_BRIDGE_PROTOCOL_CHANNEL,
    protocolVersion: AGENT_BRIDGE_PROTOCOL_VERSION,
  });
}
