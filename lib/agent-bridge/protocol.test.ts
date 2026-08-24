import { describe, expect, it } from 'vitest';

import {
  AGENT_BRIDGE_MESSAGE_TYPES,
  AGENT_BRIDGE_PROTOCOL_CHANNEL,
  AGENT_BRIDGE_PROTOCOL_VERSION,
  AGENT_BRIDGE_TOOL_ERROR_CODES,
  DEFAULT_AGENT_BRIDGE_PORT,
  decodeAgentBridgeMessage,
  encodeAgentBridgeMessage,
  type AgentBridgeMessageInput,
} from './protocol';

const toolDescriptor = {
  name: 'searchKnowledgeBase',
  description: 'Search saved content',
  inputSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
};

const validMessages: readonly AgentBridgeMessageInput[] = [
  {
    id: 'hello-1',
    type: 'hello',
    payload: {
      token: 'bridge-token',
      extensionId: 'extension-id',
      extensionVersion: '0.0.5',
      tools: [toolDescriptor],
    },
  },
  {
    id: 'welcome-1',
    type: 'welcome',
    payload: { token: 'bridge-token', serverVersion: '0.1.0' },
  },
  {
    id: 'reject-1',
    type: 'reject',
    payload: { reason: 'bad-token' },
  },
  {
    id: 'call-1',
    type: 'tools.call',
    payload: {
      callId: 'tool-call-1',
      name: 'searchKnowledgeBase',
      args: { query: 'typescript' },
    },
  },
  {
    id: 'result-1',
    type: 'tools.result',
    payload: { callId: 'tool-call-1', ok: true, result: { count: 0, results: [] } },
  },
  { id: 'ping-1', type: 'ping', payload: {} },
  { id: 'pong-1', type: 'pong', payload: {} },
];

describe('Agent Bridge v1 protocol', () => {
  it('exposes stable shared constants', () => {
    expect(AGENT_BRIDGE_PROTOCOL_CHANNEL).toBe('favbase-agent-bridge');
    expect(AGENT_BRIDGE_PROTOCOL_VERSION).toBe(1);
    expect(DEFAULT_AGENT_BRIDGE_PORT).toBe(17_836);
    expect(AGENT_BRIDGE_TOOL_ERROR_CODES).toEqual([
      'unknown-tool',
      'invalid-args',
      'db-unavailable',
      'execution-failed',
    ]);
  });

  it('keeps the runtime schema registry complete', () => {
    expect(AGENT_BRIDGE_MESSAGE_TYPES).toEqual(validMessages.map(({ type }) => type));
  });

  it.each(validMessages)('encodes and decodes $type messages', (input) => {
    const encoded = encodeAgentBridgeMessage(input);

    expect(encoded).toMatchObject({
      ...input,
      channel: AGENT_BRIDGE_PROTOCOL_CHANNEL,
      protocolVersion: AGENT_BRIDGE_PROTOCOL_VERSION,
    });
    expect(decodeAgentBridgeMessage(encoded)).toEqual(encoded);
  });

  it('accepts the failure tools.result variant', () => {
    const input: AgentBridgeMessageInput = {
      id: 'result-2',
      type: 'tools.result',
      payload: {
        callId: 'tool-call-2',
        ok: false,
        error: { code: 'invalid-args', message: 'query is required' },
      },
    };

    expect(encodeAgentBridgeMessage(input)?.payload).toEqual(input.payload);
  });

  it.each([
    ['missing envelope', { id: 'ping-1', type: 'ping', payload: {} }],
    [
      'wrong channel',
      {
        channel: 'other-channel',
        protocolVersion: AGENT_BRIDGE_PROTOCOL_VERSION,
        id: 'ping-1',
        type: 'ping',
        payload: {},
      },
    ],
    [
      'wrong version',
      {
        channel: AGENT_BRIDGE_PROTOCOL_CHANNEL,
        protocolVersion: 2,
        id: 'ping-1',
        type: 'ping',
        payload: {},
      },
    ],
    [
      'unknown type',
      {
        channel: AGENT_BRIDGE_PROTOCOL_CHANNEL,
        protocolVersion: AGENT_BRIDGE_PROTOCOL_VERSION,
        id: 'unknown-1',
        type: 'unknown',
        payload: {},
      },
    ],
    [
      'invalid payload',
      {
        channel: AGENT_BRIDGE_PROTOCOL_CHANNEL,
        protocolVersion: AGENT_BRIDGE_PROTOCOL_VERSION,
        id: 'call-1',
        type: 'tools.call',
        payload: { callId: 'tool-call-1', name: 'searchKnowledgeBase', args: null },
      },
    ],
  ])('rejects %s', (_case, message) => {
    expect(decodeAgentBridgeMessage(message)).toBeNull();
  });
});
