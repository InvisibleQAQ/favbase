import type { LanguageModel, ModelMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import type { ChatConversation } from './history';
import {
  createConversationRuntime,
  type ConversationStore,
} from './conversation-runtime';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function conversation(id: string, text: string): ChatConversation {
  const modelMessages: ModelMessage[] = [
    { role: 'user', content: text },
    { role: 'assistant', content: `${text} answer` },
  ];
  return { id, title: text, modelMessages, createdAt: 1, updatedAt: 2 };
}

function createStore(overrides: Partial<ConversationStore> = {}): ConversationStore {
  return {
    list: vi.fn(async () => []),
    load: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('ConversationRuntime ownership', () => {
  it('keeps the newest Conversation when loads resolve out of order', async () => {
    const loadA = deferred<ChatConversation | null>();
    const loadB = deferred<ChatConversation | null>();
    const store = createStore({
      load: vi.fn((id: string) => (id === 'a' ? loadA.promise : loadB.promise)),
    });
    const runtime = createConversationRuntime({ store });

    const switchingToA = runtime.switchConversation('a');
    const switchingToB = runtime.switchConversation('b');

    loadB.resolve(conversation('b', 'Question B'));
    await switchingToB;
    loadA.resolve(conversation('a', 'Question A'));
    await switchingToA;

    expect(runtime.getSnapshot()).toMatchObject({
      activeConversationId: 'b',
      messages: [
        { role: 'user', content: 'Question B' },
        { role: 'assistant', content: 'Question B answer' },
      ],
    });
  });

  it('does not let a stale stream update or persist the selected Conversation', async () => {
    const releaseStream = deferred<void>();
    const store = createStore({
      load: vi.fn(async (id: string) =>
        id === 'a' ? conversation('a', 'Question A') : conversation('b', 'Question B'),
      ),
    });
    const createStream = vi.fn(async () => ({
      fullStream: (async function* () {
        await releaseStream.promise;
        yield { type: 'text-delta' as const, text: 'Late answer from A' };
      })(),
      response: Promise.resolve({
        messages: [{ role: 'assistant' as const, content: 'Late answer from A' }],
      }),
    }));
    const runtime = createConversationRuntime({ store, createStream });

    await runtime.switchConversation('a');
    const sendingFromA = runtime.send('Follow up A', {} as LanguageModel);
    await Promise.resolve();

    await runtime.switchConversation('b');
    releaseStream.resolve();
    await sendingFromA;

    expect(runtime.getSnapshot()).toMatchObject({
      activeConversationId: 'b',
      messages: [
        { role: 'user', content: 'Question B' },
        { role: 'assistant', content: 'Question B answer' },
      ],
    });
    expect(store.save).not.toHaveBeenCalled();
  });

  it('does not let stale cleanup clear a newer stream', async () => {
    const releaseA = deferred<void>();
    const releaseB = deferred<void>();
    const bDraftVisible = deferred<void>();
    const store = createStore({
      load: vi.fn(async (id: string) =>
        id === 'a' ? conversation('a', 'Question A') : conversation('b', 'Question B'),
      ),
    });
    const createStream = vi.fn(async ({ messages }) => {
      const latest = messages.at(-1);
      const fromA = latest?.role === 'user' && latest.content === 'Follow up A';
      return {
        fullStream: (async function* () {
          if (fromA) {
            await releaseA.promise;
            yield { type: 'text-delta' as const, text: 'Stale A draft' };
            return;
          }
          yield { type: 'text-delta' as const, text: 'Current B draft' };
          bDraftVisible.resolve();
          await releaseB.promise;
        })(),
        response: Promise.resolve({ messages: [] }),
      };
    });
    const runtime = createConversationRuntime({ store, createStream });

    await runtime.switchConversation('a');
    const sendingA = runtime.send('Follow up A', {} as LanguageModel);
    await Promise.resolve();
    await runtime.switchConversation('b');
    const sendingB = runtime.send('Follow up B', {} as LanguageModel);
    await bDraftVisible.promise;

    releaseA.resolve();
    await sendingA;

    expect(runtime.getSnapshot()).toMatchObject({
      activeConversationId: 'b',
      isStreaming: true,
      streamingText: 'Current B draft',
    });

    releaseB.resolve();
    await sendingB;
  });

  it('makes deletion the final mutation when a save is already in flight', async () => {
    const saveStarted = deferred<void>();
    const releaseSave = deferred<void>();
    const mutations: string[] = [];
    const store = createStore({
      list: vi.fn(async () => []),
      load: vi.fn(async () => conversation('a', 'Question A')),
      save: vi.fn(async () => {
        mutations.push('save:start');
        saveStarted.resolve();
        await releaseSave.promise;
        mutations.push('save:end');
      }),
      delete: vi.fn(async () => {
        mutations.push('delete');
      }),
    });
    const createStream = vi.fn(async () => ({
      fullStream: (async function* () {
        yield { type: 'text-delta' as const, text: 'Answer A' };
      })(),
      response: Promise.resolve({
        messages: [{ role: 'assistant' as const, content: 'Answer A' }],
      }),
    }));
    const runtime = createConversationRuntime({ store, createStream });

    await runtime.switchConversation('a');
    const sending = runtime.send('Follow up A', {} as LanguageModel);
    await saveStarted.promise;

    const deleting = runtime.deleteConversation('a');
    releaseSave.resolve();
    await sending;
    await deleting;

    expect(mutations).toEqual(['save:start', 'save:end', 'delete']);
    expect(runtime.getSnapshot()).toMatchObject({
      activeConversationId: null,
      messages: [],
    });
  });

  it('keeps and persists a partial answer when the current owner is stopped', async () => {
    const partialVisible = deferred<void>();
    const store = createStore({
      load: vi.fn(async () => conversation('a', 'Question A')),
    });
    const createStream = vi.fn(async ({ abortSignal }) => ({
      fullStream: (async function* () {
        yield { type: 'text-delta' as const, text: 'Partial answer' };
        partialVisible.resolve();
        await new Promise<void>((_, reject) => {
          abortSignal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      })(),
      response: Promise.resolve({ messages: [] }),
    }));
    const runtime = createConversationRuntime({ store, createStream });

    await runtime.switchConversation('a');
    const sending = runtime.send('Follow up A', {} as LanguageModel);
    await partialVisible.promise;
    runtime.stop();
    await sending;

    expect(runtime.getSnapshot()).toMatchObject({
      activeConversationId: 'a',
      status: 'idle',
      isStreaming: false,
      messages: [
        { role: 'user', content: 'Question A' },
        { role: 'assistant', content: 'Question A answer' },
        { role: 'user', content: 'Follow up A' },
        { role: 'assistant', content: 'Partial answer' },
      ],
    });
    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'a',
        modelMessages: expect.arrayContaining([
          { role: 'assistant', content: 'Partial answer' },
        ]),
      }),
    );
  });

  it('persists the user turn when stopped before the first response token', async () => {
    const streamStarted = deferred<void>();
    const store = createStore({
      load: vi.fn(async () => conversation('a', 'Question A')),
    });
    const createStream = vi.fn(async ({ abortSignal }) => ({
      fullStream: (async function* () {
        streamStarted.resolve();
        await new Promise<void>((_, reject) => {
          abortSignal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      })(),
      response: Promise.resolve({ messages: [] }),
    }));
    const runtime = createConversationRuntime({ store, createStream });

    await runtime.switchConversation('a');
    const sending = runtime.send('Persist this question', {} as LanguageModel);
    await streamStarted.promise;
    runtime.stop();
    await sending;

    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'a',
        modelMessages: expect.arrayContaining([
          { role: 'user', content: 'Persist this question' },
        ]),
      }),
    );
  });
});
