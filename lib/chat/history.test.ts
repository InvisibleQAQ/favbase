import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import type { ModelMessage } from 'ai';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
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

// CRUD runs against a real in-memory PGlite (same rig as retrieval.test.ts):
// PGlite.create + extensions + runMigrations, Drizzle on top. All history
// functions take the db as an explicit first argument, so no proxy/storage
// mocking is needed.

function userMsg(text: string): ModelMessage {
  return { role: 'user', content: text };
}

describe('chat history CRUD (PGlite)', () => {
  let pg: PGlite;
  let db: FavbaseDb;

  beforeAll(async () => {
    pg = await PGlite.create({ extensions: { vector, uuid_ossp, pg_trgm } });
    await runMigrations(pg);
    db = drizzle({ client: pg, schema }) as unknown as FavbaseDb;
  });

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(async () => {
    await pg.exec('DELETE FROM chat_conversations');
  });

  it('starts empty', async () => {
    expect(await listConversations(db)).toEqual([]);
    expect(await loadConversation(db, crypto.randomUUID())).toBeNull();
  });

  it('createConversation makes a unique unsaved conversation', () => {
    const a = createConversation();
    const b = createConversation();
    expect(a.id).not.toBe(b.id);
    expect(a.modelMessages).toEqual([]);
    expect(a.title).toBe('');
    // Not persisted until saveConversation is called.
  });

  it('saves and loads a conversation (timestamptz ↔ ms epoch round-trip)', async () => {
    const conv = createConversation();
    conv.modelMessages = [userMsg('hello')];
    conv.title = deriveTitle(conv.modelMessages);
    await saveConversation(db, conv);

    const loaded = await loadConversation(db, conv.id);
    expect(loaded?.title).toBe('hello');
    expect(loaded?.modelMessages).toEqual([userMsg('hello')]);
    expect(loaded?.createdAt).toBe(conv.createdAt);
    expect(typeof loaded?.updatedAt).toBe('number');
  });

  it('persists the FULL message history — save never trims', async () => {
    const conv = createConversation();
    const total = MAX_MESSAGES + 10;
    for (let i = 0; i < total; i += 1) conv.modelMessages.push(userMsg(`m${i}`));
    await saveConversation(db, conv);

    const loaded = await loadConversation(db, conv.id);
    expect(loaded?.modelMessages).toHaveLength(total);
    expect(loaded?.modelMessages[0]).toEqual(userMsg('m0'));
    expect(loaded?.modelMessages[total - 1]).toEqual(userMsg(`m${total - 1}`));
  });

  it('upserts (updates in place) rather than duplicating', async () => {
    const conv = createConversation();
    conv.modelMessages = [userMsg('first')];
    await saveConversation(db, conv);
    await saveConversation(db, {
      ...conv,
      title: 'updated',
      modelMessages: [userMsg('first'), userMsg('second')],
    });

    const all = await listConversations(db);
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('updated');
    expect(all[0].modelMessages).toHaveLength(2);
  });

  it('lists conversations most-recently-updated first', async () => {
    const older: ChatConversation = { ...createConversation(), title: 'old', updatedAt: 100 };
    const newer: ChatConversation = { ...createConversation(), title: 'new', updatedAt: 200 };
    await saveConversation(db, older);
    await saveConversation(db, newer);

    const all = await listConversations(db);
    expect(all.map((c) => c.title)).toEqual(['new', 'old']);
  });

  it('deletes a conversation', async () => {
    const conv = createConversation();
    await saveConversation(db, conv);
    await deleteConversation(db, conv.id);
    expect(await loadConversation(db, conv.id)).toBeNull();
    expect(await listConversations(db)).toEqual([]);
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
