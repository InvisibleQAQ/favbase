import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelMessage } from 'ai';

// In-memory stub of WXT's storage.defineItem — the real implementation needs a
// browser extension context (chrome.storage), which vitest lacks. Mirrors the
// pattern in lib/storage/x-last-sync.test.ts.
vi.mock('wxt/utils/storage', () => {
  const store = new Map<string, unknown>();
  return {
    storage: {
      defineItem<T>(key: string, opts?: { fallback?: T }) {
        return {
          async getValue(): Promise<T> {
            return (store.has(key) ? store.get(key) : opts?.fallback) as T;
          },
          async setValue(value: T): Promise<void> {
            store.set(key, value);
          },
          async removeValue(): Promise<void> {
            store.delete(key);
          },
        };
      },
    },
    __store: store,
  };
});

import {
  MAX_MESSAGES,
  createConversation,
  deleteConversation,
  deriveTitle,
  listConversations,
  loadConversation,
  saveConversation,
  trimMessages,
  type ChatConversation,
} from './history';

function userMsg(text: string): ModelMessage {
  return { role: 'user', content: text };
}

async function reset(): Promise<void> {
  const mod = (await import('wxt/utils/storage')) as unknown as { __store: Map<string, unknown> };
  mod.__store.clear();
}

describe('chat history CRUD', () => {
  beforeEach(reset);

  it('starts empty', async () => {
    expect(await listConversations()).toEqual([]);
    expect(await loadConversation('missing')).toBeNull();
  });

  it('createConversation makes a unique unsaved conversation', () => {
    const a = createConversation();
    const b = createConversation();
    expect(a.id).not.toBe(b.id);
    expect(a.modelMessages).toEqual([]);
    expect(a.title).toBe('');
    // Not persisted until saveConversation is called.
  });

  it('saves and loads a conversation', async () => {
    const conv = createConversation();
    conv.modelMessages = [userMsg('hello')];
    conv.title = deriveTitle(conv.modelMessages);
    await saveConversation(conv);

    const loaded = await loadConversation(conv.id);
    expect(loaded?.title).toBe('hello');
    expect(loaded?.modelMessages).toEqual([userMsg('hello')]);
  });

  it('upserts (updates in place) rather than duplicating', async () => {
    const conv = createConversation();
    conv.modelMessages = [userMsg('first')];
    await saveConversation(conv);
    await saveConversation({ ...conv, modelMessages: [userMsg('first'), userMsg('second')] });

    const all = await listConversations();
    expect(all).toHaveLength(1);
    expect(all[0].modelMessages).toHaveLength(2);
  });

  it('lists conversations most-recently-updated first', async () => {
    const older: ChatConversation = { ...createConversation(), title: 'old', updatedAt: 100 };
    const newer: ChatConversation = { ...createConversation(), title: 'new', updatedAt: 200 };
    await saveConversation(older);
    await saveConversation(newer);

    const all = await listConversations();
    expect(all.map((c) => c.title)).toEqual(['new', 'old']);
  });

  it('deletes a conversation', async () => {
    const conv = createConversation();
    await saveConversation(conv);
    await deleteConversation(conv.id);
    expect(await loadConversation(conv.id)).toBeNull();
  });
});

describe('deriveTitle', () => {
  it('uses the first user message and collapses whitespace', () => {
    expect(deriveTitle([userMsg('  what is   RAG?  ')])).toBe('what is RAG?');
  });

  it('truncates long titles', () => {
    const long = 'a'.repeat(80);
    const title = deriveTitle([userMsg(long)]);
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(41);
  });

  it('returns empty when there is no user message', () => {
    expect(deriveTitle([{ role: 'assistant', content: 'hi' }])).toBe('');
  });

  it('reads text parts from array content', () => {
    const msg: ModelMessage = { role: 'user', content: [{ type: 'text', text: 'hello parts' }] };
    expect(deriveTitle([msg])).toBe('hello parts');
  });
});

describe('trimMessages (sliding window)', () => {
  it('returns messages unchanged when within the cap', () => {
    const msgs = [userMsg('a'), userMsg('b')];
    expect(trimMessages(msgs)).toBe(msgs);
  });

  it('keeps only the last MAX_MESSAGES and realigns to a user turn', () => {
    const msgs: ModelMessage[] = [];
    for (let i = 0; i < MAX_MESSAGES + 6; i += 1) {
      msgs.push(userMsg(`u${i}`));
      msgs.push({ role: 'assistant', content: `a${i}` });
    }
    const trimmed = trimMessages(msgs);
    expect(trimmed.length).toBeLessThanOrEqual(MAX_MESSAGES);
    expect(trimmed[0].role).toBe('user');
  });

  it('drops a leading orphan tool-result so history starts at a user turn', () => {
    const msgs: ModelMessage[] = [
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 't', toolName: 'x', output: { type: 'json', value: {} } }] },
      userMsg('real start'),
    ];
    const trimmed = trimMessages(msgs, 2);
    // Within cap here (2 <= 2) → unchanged; assert the realign logic via a >cap case.
    expect(trimmed).toBe(msgs);

    const overflow: ModelMessage[] = [
      { role: 'assistant', content: 'a0' },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 't', toolName: 'x', output: { type: 'json', value: {} } }] },
      userMsg('u1'),
      { role: 'assistant', content: 'a1' },
    ];
    const t2 = trimMessages(overflow, 3);
    expect(t2[0].role).toBe('user');
  });
});
