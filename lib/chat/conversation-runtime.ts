import type { LanguageModel, ModelMessage } from 'ai';

import { initDbProxy } from '@/lib/database';
import {
  createConversation as makeConversation,
  deleteConversation as deleteStoredConversation,
  deriveTitle,
  listConversations,
  loadConversation,
  modelMessageText,
  saveConversation,
  trimMessages,
  type ChatConversation,
} from './history';

export interface ChatSource {
  itemId: string;
  title: string;
  url: string;
  platform: string;
  score?: number;
}

export interface ChatDisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
}

export type ChatStatus = 'idle' | 'not-configured' | 'streaming' | 'error';
export type ChatErrorKind = 'network' | 'generic';
export type ToolKind = 'search' | 'read' | 'listTags';
export type ToolPhase =
  | 'input-streaming'
  | 'input-available'
  | 'output-available'
  | 'output-error';

export interface ToolActivity {
  kind: ToolKind;
  phase: ToolPhase;
  count?: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
}

export interface ConversationRuntimeSnapshot {
  messages: ChatDisplayMessage[];
  streamingText: string;
  isStreaming: boolean;
  toolActivity: ToolActivity | null;
  status: ChatStatus;
  errorKind: ChatErrorKind | null;
  conversations: ConversationSummary[];
  historyError: boolean;
  activeConversationId: string | null;
}

export interface ConversationStreamInput {
  model: LanguageModel;
  messages: ModelMessage[];
  now: Date;
  abortSignal: AbortSignal;
}

export interface ConversationStreamResult {
  fullStream: AsyncIterable<{
    type: string;
    text?: string;
    toolName?: string;
    output?: unknown;
    error?: unknown;
  }>;
  response: PromiseLike<{ messages: ModelMessage[] }>;
}

export type ConversationStreamFactory = (
  input: ConversationStreamInput,
) => ConversationStreamResult | Promise<ConversationStreamResult>;

export interface ConversationStore {
  list(): Promise<ChatConversation[]>;
  load(id: string): Promise<ChatConversation | null>;
  save(conversation: ChatConversation): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ConversationRuntime {
  getSnapshot(): ConversationRuntimeSnapshot;
  subscribe(listener: () => void): () => void;
  loadInitial(): Promise<void>;
  cancelPending(): void;
  newConversation(): void;
  switchConversation(id: string): Promise<void>;
  send(text: string, model: LanguageModel | null): Promise<void>;
  stop(): void;
  deleteConversation(id: string): Promise<void>;
}

export interface CreateConversationRuntimeOptions {
  store?: ConversationStore;
  createStream?: ConversationStreamFactory;
  now?: () => Date;
  createConversation?: () => ChatConversation;
}

let nextMessageId = 0;

function messageId(): string {
  nextMessageId += 1;
  return `m${nextMessageId}`;
}

interface SearchResultRow {
  item_id: string;
  title: string;
  url: string;
  platform: string;
  score?: number;
}

function unwrapToolOutput(output: unknown): unknown {
  if (output && typeof output === 'object' && 'type' in output) {
    const wrapped = output as { type?: unknown; value?: unknown };
    if (wrapped.type === 'json') return wrapped.value;
    if (wrapped.type === 'text' && typeof wrapped.value === 'string') {
      try {
        return JSON.parse(wrapped.value);
      } catch {
        return undefined;
      }
    }
  }
  return output;
}

function outputToSources(output: unknown): ChatSource[] {
  const value = unwrapToolOutput(output) as { results?: SearchResultRow[] } | undefined;
  if (!Array.isArray(value?.results)) return [];
  return value.results.map((result) => ({
    itemId: result.item_id,
    title: result.title,
    url: result.url,
    platform: result.platform,
    score: result.score,
  }));
}

function dedupeSources(sources: ChatSource[]): ChatSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (!source.itemId || seen.has(source.itemId)) return false;
    seen.add(source.itemId);
    return true;
  });
}

function toolMessageSources(message: ModelMessage): ChatSource[] {
  if (!Array.isArray(message.content)) return [];
  const sources: ChatSource[] = [];
  for (const part of message.content) {
    if (
      part &&
      typeof part === 'object' &&
      'type' in part &&
      (part as { type?: unknown }).type === 'tool-result' &&
      (part as { toolName?: unknown }).toolName === 'searchKnowledgeBase'
    ) {
      sources.push(...outputToSources((part as { output?: unknown }).output));
    }
  }
  return sources;
}

function rebuildDisplayMessages(modelMessages: ModelMessage[]): ChatDisplayMessage[] {
  const display: ChatDisplayMessage[] = [];
  let assistantText = '';
  let turnSources: ChatSource[] = [];
  let hasAssistant = false;

  const flushAssistant = () => {
    if (hasAssistant && assistantText.trim()) {
      const sources = dedupeSources(turnSources);
      display.push({
        id: messageId(),
        role: 'assistant',
        content: assistantText,
        sources: sources.length ? sources : undefined,
      });
    }
    assistantText = '';
    turnSources = [];
    hasAssistant = false;
  };

  for (const message of modelMessages) {
    if (message.role === 'user') {
      flushAssistant();
      display.push({ id: messageId(), role: 'user', content: modelMessageText(message) });
    } else if (message.role === 'assistant') {
      hasAssistant = true;
      assistantText += modelMessageText(message);
    } else if (message.role === 'tool') {
      turnSources.push(...toolMessageSources(message));
    }
  }
  flushAssistant();
  return display;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message));
}

function classifyError(error: unknown): ChatErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  return /network|fetch|failed to fetch|econn|timeout|cors/i.test(message)
    ? 'network'
    : 'generic';
}

function toolKind(toolName: string | undefined): ToolKind | null {
  if (toolName === 'searchKnowledgeBase') return 'search';
  if (toolName === 'getItemContent') return 'read';
  if (toolName === 'listTags') return 'listTags';
  return null;
}

function toSummary(conversation: ChatConversation): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
  };
}

function createPgliteConversationStore(): ConversationStore {
  return {
    async list() {
      return listConversations(await initDbProxy());
    },
    async load(id) {
      return loadConversation(await initDbProxy(), id);
    },
    async save(conversation) {
      await saveConversation(await initDbProxy(), conversation);
    },
    async delete(id) {
      await deleteStoredConversation(await initDbProxy(), id);
    },
  };
}

const createProductionStream: ConversationStreamFactory = async (input) => {
  const { createChatStream } = await import('./agent');
  const db = await initDbProxy();
  return createChatStream({ ...input, db });
};

export function createConversationRuntime({
  store = createPgliteConversationStore(),
  createStream = createProductionStream,
  now = () => new Date(),
  createConversation = makeConversation,
}: CreateConversationRuntimeOptions = {}): ConversationRuntime {
  let generation = 0;
  let historyGeneration = 0;
  let activeConversation: ChatConversation | null = null;
  let requestedConversationId: string | null = null;
  let activeController: AbortController | null = null;
  const deletedConversationIds = new Set<string>();
  const mutationTails = new Map<string, Promise<void>>();
  let snapshot: ConversationRuntimeSnapshot = {
    messages: [],
    streamingText: '',
    isStreaming: false,
    toolActivity: null,
    status: 'idle',
    errorKind: null,
    conversations: [],
    historyError: false,
    activeConversationId: null,
  };
  const listeners = new Set<() => void>();

  function publish(next: ConversationRuntimeSnapshot): void {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  function patch(next: Partial<ConversationRuntimeSnapshot>): void {
    publish({ ...snapshot, ...next });
  }

  function claimOwnership(): number {
    generation += 1;
    activeController?.abort();
    activeController = null;
    requestedConversationId = null;
    return generation;
  }

  function owns(owner: number): boolean {
    return owner === generation;
  }

  async function enqueueMutation(id: string, mutation: () => Promise<void>): Promise<void> {
    const previous = mutationTails.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(mutation);
    mutationTails.set(id, current);
    try {
      await current;
    } finally {
      if (mutationTails.get(id) === current) mutationTails.delete(id);
    }
  }

  async function persist(owner: number, conversation: ChatConversation): Promise<void> {
    try {
      await enqueueMutation(conversation.id, async () => {
        if (!owns(owner) || deletedConversationIds.has(conversation.id)) return;
        await store.save(conversation);
      });
      if (owns(owner)) await refreshConversations();
    } catch (error) {
      console.error('[chat] failed to persist conversation:', error);
    }
  }

  async function refreshConversations(): Promise<ChatConversation[]> {
    const request = ++historyGeneration;
    const conversations = await store.list();
    if (request === historyGeneration) {
      patch({
        conversations: conversations.map(toSummary),
        historyError: false,
      });
    }
    return conversations;
  }

  function clearActiveConversation(): void {
    activeConversation = null;
    requestedConversationId = null;
    patch({
      messages: [],
      streamingText: '',
      isStreaming: false,
      toolActivity: null,
      status: 'idle',
      errorKind: null,
      activeConversationId: null,
    });
  }

  function applyConversation(conversation: ChatConversation): void {
    activeConversation = conversation;
    requestedConversationId = null;
    patch({
      activeConversationId: conversation.id,
      messages: rebuildDisplayMessages(conversation.modelMessages),
      streamingText: '',
      isStreaming: false,
      toolActivity: null,
      status: 'idle',
      errorKind: null,
    });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async loadInitial() {
      const owner = generation;
      const request = ++historyGeneration;
      try {
        const conversations = await store.list();
        if (request !== historyGeneration) return;
        patch({
          conversations: conversations.map(toSummary),
          historyError: false,
        });
        if (!owns(owner) || activeConversation) return;
        const latest = conversations[0];
        if (latest) applyConversation(latest);
      } catch (error) {
        if (request !== historyGeneration) return;
        console.error('[chat] failed to load conversation history:', error);
        patch({ historyError: true });
      }
    },
    cancelPending() {
      claimOwnership();
      historyGeneration += 1;
    },
    newConversation() {
      claimOwnership();
      clearActiveConversation();
    },
    async switchConversation(id) {
      if (id === activeConversation?.id && requestedConversationId === null) return;
      const owner = claimOwnership();
      if (id === activeConversation?.id) {
        patch({
          streamingText: '',
          isStreaming: false,
          toolActivity: null,
          status: 'idle',
          errorKind: null,
        });
        return;
      }

      requestedConversationId = id;
      patch({
        streamingText: '',
        isStreaming: false,
        toolActivity: null,
        status: 'idle',
        errorKind: null,
      });
      try {
        const conversation = await store.load(id);
        if (!owns(owner)) return;
        requestedConversationId = null;
        if (conversation) applyConversation(conversation);
      } catch (error) {
        if (!owns(owner)) return;
        requestedConversationId = null;
        console.error('[chat] failed to load conversation:', error);
      }
    },
    async send(text, model) {
      const trimmed = text.trim();
      if (!trimmed || snapshot.isStreaming) return;
      if (!model) {
        patch({ status: 'not-configured' });
        return;
      }

      if (!activeConversation) {
        activeConversation = createConversation();
        patch({ activeConversationId: activeConversation.id });
      }

      const owner = claimOwnership();
      const controller = new AbortController();
      activeController = controller;
      const modelMessages: ModelMessage[] = [
        ...activeConversation.modelMessages,
        { role: 'user', content: trimmed },
      ];
      const conversationId = activeConversation.id;
      const createdAt = activeConversation.createdAt;
      activeConversation = {
        ...activeConversation,
        title: deriveTitle(modelMessages),
        modelMessages,
        updatedAt: now().getTime(),
      };
      const priorDisplay = snapshot.messages;
      patch({
        streamingText: '',
        isStreaming: true,
        toolActivity: null,
        status: 'streaming',
        errorKind: null,
        messages: [...priorDisplay, { id: messageId(), role: 'user', content: trimmed }],
      });

      let draft = '';
      const turnSources: ChatSource[] = [];
      try {
        const stream = await createStream({
          model,
          messages: trimMessages(modelMessages),
          now: now(),
          abortSignal: controller.signal,
        });
        if (!owns(owner)) return;

        for await (const part of stream.fullStream) {
          if (!owns(owner)) return;
          if (part.type === 'text-delta') {
            draft += part.text ?? '';
            patch({ streamingText: draft });
          } else if (part.type === 'tool-input-start') {
            const kind = toolKind(part.toolName);
            if (kind) patch({ toolActivity: { kind, phase: 'input-streaming' } });
          } else if (part.type === 'tool-call') {
            const kind = toolKind(part.toolName);
            if (kind) patch({ toolActivity: { kind, phase: 'input-available' } });
          } else if (part.type === 'tool-result') {
            const kind = toolKind(part.toolName);
            if (part.toolName === 'searchKnowledgeBase') {
              const sources = outputToSources(part.output);
              turnSources.push(...sources);
              patch({
                toolActivity: {
                  kind: 'search',
                  phase: 'output-available',
                  count: sources.length,
                },
              });
            } else if (kind) {
              patch({ toolActivity: { kind, phase: 'output-available' } });
            }
          } else if (part.type === 'tool-error') {
            const kind = toolKind(part.toolName);
            if (kind) patch({ toolActivity: { kind, phase: 'output-error' } });
          } else if (part.type === 'error') {
            throw part.error;
          }
        }

        const response = await stream.response;
        if (!owns(owner)) return;
        const completedMessages = [...modelMessages, ...response.messages];
        const completed: ChatConversation = {
          id: conversationId,
          title: deriveTitle(completedMessages),
          modelMessages: completedMessages,
          createdAt,
          updatedAt: now().getTime(),
        };
        activeConversation = completed;
        const sources = dedupeSources(turnSources);
        patch({
          status: 'idle',
          messages: draft.trim()
            ? [
                ...snapshot.messages,
                {
                  id: messageId(),
                  role: 'assistant',
                  content: draft,
                  sources: sources.length ? sources : undefined,
                },
              ]
            : snapshot.messages,
        });
        await persist(owner, completed);
      } catch (error) {
        if (!owns(owner)) return;
        if (isAbort(error) || controller.signal.aborted) {
          const stoppedMessages: ModelMessage[] = draft.trim()
            ? [...modelMessages, { role: 'assistant', content: draft }]
            : modelMessages;
          const stopped: ChatConversation = {
            id: conversationId,
            title: deriveTitle(stoppedMessages),
            modelMessages: stoppedMessages,
            createdAt,
            updatedAt: now().getTime(),
          };
          activeConversation = stopped;
          if (draft.trim()) {
            const sources = dedupeSources(turnSources);
            patch({
              status: 'idle',
              messages: [
                ...snapshot.messages,
                {
                  id: messageId(),
                  role: 'assistant',
                  content: draft,
                  sources: sources.length ? sources : undefined,
                },
              ],
            });
          } else {
            patch({ status: 'idle' });
          }
          await persist(owner, stopped);
        } else {
          console.error('[chat] agent stream failed:', error);
          patch({ status: 'error', errorKind: classifyError(error) });
        }
      } finally {
        if (owns(owner) && activeController === controller) {
          activeController = null;
          patch({ streamingText: '', isStreaming: false, toolActivity: null });
        }
      }
    },
    stop() {
      activeController?.abort();
    },
    async deleteConversation(id) {
      const deletingActive = activeConversation?.id === id;
      const deletingRequested = requestedConversationId === id;
      const owner = deletingActive || deletingRequested ? claimOwnership() : generation;
      if (deletingActive || deletingRequested) {
        patch({
          streamingText: '',
          isStreaming: false,
          toolActivity: null,
          status: 'idle',
          errorKind: null,
        });
      }
      deletedConversationIds.add(id);
      let deletionCommitted = false;

      try {
        await enqueueMutation(id, () => store.delete(id));
        deletionCommitted = true;
        const conversations = await refreshConversations();
        if (!owns(owner) || !deletingActive) return;

        const next = conversations[0];
        if (!next) {
          clearActiveConversation();
          return;
        }

        const conversation = await store.load(next.id);
        if (!owns(owner)) return;
        if (!conversation) {
          clearActiveConversation();
          return;
        }

        applyConversation(conversation);
      } catch (error) {
        if (!deletionCommitted) {
          deletedConversationIds.delete(id);
        } else if (deletingActive && owns(owner)) {
          clearActiveConversation();
        }
        console.error('[chat] failed to delete conversation:', error);
      }
    },
  };
}
