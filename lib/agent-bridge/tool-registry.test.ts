import { describe, expect, it, vi } from 'vitest';

import type { FavbaseDb } from '@/lib/database';
import {
  AgentBridgeToolCallError,
  callTool,
  describeTools,
} from './tool-registry';

const KNOWLEDGE_TOOL_NAMES = [
  'searchKnowledgeBase',
  'getItemContent',
  'listTags',
] as const;

describe('Agent Bridge Knowledge Tool registry', () => {
  it('describes exactly the three Chat Knowledge Tools as JSON Schema 2020-12', () => {
    const descriptors = describeTools();

    expect(descriptors.map(({ name }) => name)).toEqual(KNOWLEDGE_TOOL_NAMES);
    expect(descriptors).toHaveLength(3);
    for (const descriptor of descriptors) {
      expect(descriptor.description.length).toBeGreaterThan(0);
      expect(descriptor.inputSchema).toMatchObject({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: expect.any(Object),
      });
      expect(JSON.parse(JSON.stringify(descriptor.inputSchema))).toEqual(
        descriptor.inputSchema,
      );
    }
  });

  it('rejects an unknown tool with a stable error code', async () => {
    await expect(callTool('deleteEverything', {}, {} as FavbaseDb)).rejects.toEqual(
      expect.objectContaining<Partial<AgentBridgeToolCallError>>({
        name: 'AgentBridgeToolCallError',
        code: 'unknown-tool',
      }),
    );
  });

  it('rejects invalid arguments before executing the tool', async () => {
    const inaccessibleDb = new Proxy({}, {
      get() {
        throw new Error('invalid arguments reached tool execution');
      },
    }) as FavbaseDb;

    await expect(
      callTool('searchKnowledgeBase', { query: 'typescript', top_k: 0 }, inaccessibleDb),
    ).rejects.toEqual(expect.objectContaining<Partial<AgentBridgeToolCallError>>({
      name: 'AgentBridgeToolCallError',
      code: 'invalid-args',
    }));
  });

  it('executes the selected Chat tool with the provided database context', async () => {
    const limit = vi.fn().mockResolvedValue([{ plainText: 'Saved article body' }]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = { select } as unknown as FavbaseDb;

    await expect(callTool('getItemContent', { item_id: 'item-1' }, db)).resolves.toEqual({
      found: true,
      item_id: 'item-1',
      content: 'Saved article body',
    });
    expect(select).toHaveBeenCalledOnce();
  });
});
