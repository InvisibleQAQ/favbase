import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelMessage } from 'ai';

import { initDbProxy } from '@/lib/database';
import { useSettings } from '@/lib/hooks/useSettings';
import { isChatModelConfigured, resolveChatModel } from '@/lib/chat/config';
import { createChatStream } from '@/lib/chat/agent';
import {
  createConversation,
  deleteConversation as deleteStoredConversation,
  deriveTitle,
  listConversations,
  loadConversation,
  modelMessageText,
  saveConversation,
  type ChatConversation,
} from '@/lib/chat/history';

/** High-level state the chat view renders from. */
export type ChatStatus = 'idle' | 'not-configured' | 'streaming' | 'error';

/** Error taxonomy so the view can pick the right i18n message. */
export type ChatErrorKind = 'network' | 'generic';

/** A retrieved source card attached to an assistant answer. */
export interface ChatSource {
  itemId: string;
  title: string;
  url: string;
  platform: string;
  score?: number;
}

/** A rendered conversation turn (display-only; not the model message format). */
export interface ChatDisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Source cards (deduped) grounding an assistant answer. */
  sources?: ChatSource[];
}

/** Which knowledge-base tool the activity refers to. */
export type ToolKind = 'search' | 'read' | 'listTags';

/** Tool-call four-state machine (course §2): input-streaming → available → output/error. */
export type ToolPhase =
  | 'input-streaming'
  | 'input-available'
  | 'output-available'
  | 'output-error';

/** Live tool activity during a turn (null when none/finished). */
export interface ToolActivity {
  kind: ToolKind;
  phase: ToolPhase;
  /** Result count for a completed search. */
  count?: number;
}

/** A conversation entry for the session list UI (no message bodies). */
export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
}

export interface UseChatAgentReturn {
  messages: ChatDisplayMessage[];
  /** Live assistant draft while streaming (empty when idle). */
  streamingText: string;
  /** Latest tool activity during the current turn (null when none/finished). */
  toolActivity: ToolActivity | null;
  status: ChatStatus;
  errorKind: ChatErrorKind | null;
  isStreaming: boolean;
  /** True when the primary LLM has no API key configured. */
  configured: boolean;
  /** Settings still loading — view should not flash the not-configured state. */
  loading: boolean;
  send: (text: string) => void;
  stop: () => void;
  /** Session list (most-recently-updated first). */
  conversations: ConversationSummary[];
  /** Currently open conversation id, or null for a fresh unsaved one. */
  activeConversationId: string | null;
  /** Start a fresh conversation (stops any active stream). */
  newConversation: () => void;
  /** Load a persisted conversation (stops any active stream). */
  switchConversation: (id: string) => void;
  /** Delete a conversation; if active, falls back to the next one or a fresh session. */
  deleteConversation: (id: string) => void;
}

let nextId = 0;
function makeId(): string {
  nextId += 1;
  return `m${nextId}`;
}

function classifyError(err: unknown): ChatErrorKind {
  const message = err instanceof Error ? err.message : String(err);
  if (/network|fetch|failed to fetch|econn|timeout|cors/i.test(message)) {
    return 'network';
  }
  return 'generic';
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message));
}

function toolKind(toolName: string): ToolKind | null {
  if (toolName === 'searchKnowledgeBase') return 'search';
  if (toolName === 'getItemContent') return 'read';
  if (toolName === 'listTags') return 'listTags';
  return null;
}

interface SearchResultRow {
  item_id: string;
  title: string;
  url: string;
  platform: string;
  score?: number;
}

/**
 * Unwrap a tool output: live `fullStream` results are the raw returned object,
 * while persisted `ModelMessage` tool-result parts wrap it as `{type:'json',value}`
 * (or `{type:'text',value:'<json>'}`). Both flow through here.
 */
function unwrapToolOutput(output: unknown): unknown {
  if (output && typeof output === 'object' && 'type' in output) {
    const o = output as { type?: unknown; value?: unknown };
    if (o.type === 'json') return o.value;
    if (o.type === 'text' && typeof o.value === 'string') {
      try {
        return JSON.parse(o.value);
      } catch {
        return undefined;
      }
    }
  }
  return output;
}

function outputToSources(output: unknown): ChatSource[] {
  const inner = unwrapToolOutput(output) as { results?: SearchResultRow[] } | undefined;
  if (!inner?.results || !Array.isArray(inner.results)) return [];
  return inner.results.map((r) => ({
    itemId: r.item_id,
    title: r.title,
    url: r.url,
    platform: r.platform,
    score: r.score,
  }));
}

function dedupeSources(sources: ChatSource[]): ChatSource[] {
  const seen = new Set<string>();
  const out: ChatSource[] = [];
  for (const s of sources) {
    if (!s.itemId || seen.has(s.itemId)) continue;
    seen.add(s.itemId);
    out.push(s);
  }
  return out;
}

/** Sources from a persisted `tool` ModelMessage's searchKnowledgeBase results. */
function toolMessageSources(message: ModelMessage): ChatSource[] {
  const { content } = message;
  if (!Array.isArray(content)) return [];
  const sources: ChatSource[] = [];
  for (const part of content) {
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

/**
 * Rebuild display bubbles from persisted model messages. Each user message starts
 * a turn; the following assistant text parts are concatenated into one bubble and
 * all searchKnowledgeBase tool-results in that turn become its (deduped) sources.
 */
function rebuildDisplayMessages(modelMessages: ModelMessage[]): ChatDisplayMessage[] {
  const out: ChatDisplayMessage[] = [];
  let assistantText = '';
  let turnSources: ChatSource[] = [];
  let hasAssistant = false;

  const flush = () => {
    if (hasAssistant && assistantText.trim().length > 0) {
      const sources = dedupeSources(turnSources);
      out.push({
        id: makeId(),
        role: 'assistant',
        content: assistantText,
        sources: sources.length ? sources : undefined,
      });
    }
    assistantText = '';
    turnSources = [];
    hasAssistant = false;
  };

  for (const msg of modelMessages) {
    if (msg.role === 'user') {
      flush();
      out.push({ id: makeId(), role: 'user', content: modelMessageText(msg) });
    } else if (msg.role === 'assistant') {
      hasAssistant = true;
      assistantText += modelMessageText(msg);
    } else if (msg.role === 'tool') {
      turnSources.push(...toolMessageSources(msg));
    }
  }
  flush();
  return out;
}

function toSummary(conv: ChatConversation): ConversationSummary {
  return { id: conv.id, title: conv.title, updatedAt: conv.updatedAt };
}

/**
 * Drives the multi-step chat agent from app.html. Owns the model-format
 * conversation (`modelMessagesRef`, fed to `createChatStream`) and a separate
 * display list. Consumes `result.fullStream`: `text-delta` grows the assistant
 * draft; `tool-input-start`/`tool-call`/`tool-result`/`tool-error` drive the
 * four-state tool activity; searchKnowledgeBase results accumulate into the
 * turn's source cards. After each turn the model messages persist to WXT storage
 * (never PGlite) so conversations survive a refresh and appear in the session list.
 */
export function useChatAgent(): UseChatAgentReturn {
  const { settings, loading } = useSettings();

  // Latest settings for `send` without stale closures.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const [messages, setMessages] = useState<ChatDisplayMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [toolActivity, setToolActivity] = useState<ToolActivity | null>(null);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [errorKind, setErrorKind] = useState<ChatErrorKind | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const modelMessagesRef = useRef<ModelMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const draftRef = useRef('');
  const turnSourcesRef = useRef<ChatSource[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const createdAtRef = useRef<number>(0);

  const configured = isChatModelConfigured(settings);

  // Restore the most recent conversation on first mount (storage only, no PGlite).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await listConversations();
      if (cancelled) return;
      setConversations(list.map(toSummary));
      // Only auto-open if the user hasn't already started a session.
      if (activeIdRef.current !== null || modelMessagesRef.current.length > 0) return;
      const latest = list[0];
      if (!latest) return;
      modelMessagesRef.current = latest.modelMessages;
      createdAtRef.current = latest.createdAt;
      activeIdRef.current = latest.id;
      setActiveConversationId(latest.id);
      setMessages(rebuildDisplayMessages(latest.modelMessages));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshConversations = useCallback(async () => {
    const list = await listConversations();
    setConversations(list.map(toSummary));
  }, []);

  const persistActive = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id || modelMessagesRef.current.length === 0) return;
    const conv: ChatConversation = {
      id,
      title: deriveTitle(modelMessagesRef.current),
      modelMessages: modelMessagesRef.current,
      createdAt: createdAtRef.current || Date.now(),
      updatedAt: Date.now(),
    };
    await saveConversation(conv);
    await refreshConversations();
  }, [refreshConversations]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const resetSession = useCallback(() => {
    modelMessagesRef.current = [];
    turnSourcesRef.current = [];
    draftRef.current = '';
    setMessages([]);
    setStreamingText('');
    setToolActivity(null);
    setStatus('idle');
    setErrorKind(null);
  }, []);

  const newConversation = useCallback(() => {
    stop();
    activeIdRef.current = null;
    createdAtRef.current = 0;
    setActiveConversationId(null);
    resetSession();
  }, [stop, resetSession]);

  const switchConversation = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) return;
      stop();
      void (async () => {
        const conv = await loadConversation(id);
        if (!conv) return;
        modelMessagesRef.current = conv.modelMessages;
        createdAtRef.current = conv.createdAt;
        activeIdRef.current = conv.id;
        turnSourcesRef.current = [];
        draftRef.current = '';
        setActiveConversationId(conv.id);
        setMessages(rebuildDisplayMessages(conv.modelMessages));
        setStreamingText('');
        setToolActivity(null);
        setStatus('idle');
        setErrorKind(null);
      })();
    },
    [stop],
  );

  const deleteConversation = useCallback(
    (id: string) => {
      void (async () => {
        await deleteStoredConversation(id);
        const list = await listConversations();
        setConversations(list.map(toSummary));
        if (activeIdRef.current === id) {
          const next = list[0];
          if (next) {
            switchConversation(next.id);
          } else {
            newConversation();
          }
        }
      })();
    },
    [switchConversation, newConversation],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const resolved = resolveChatModel(settingsRef.current);
      if (!resolved.enabled) {
        setStatus('not-configured');
        return;
      }

      // Lazily create the conversation id on the first message of a fresh session.
      if (activeIdRef.current === null) {
        const fresh = createConversation();
        activeIdRef.current = fresh.id;
        createdAtRef.current = fresh.createdAt;
        setActiveConversationId(fresh.id);
      }

      // Append the user turn to both the model conversation and the display list.
      modelMessagesRef.current.push({ role: 'user', content: trimmed });
      setMessages((prev) => [...prev, { id: makeId(), role: 'user', content: trimmed }]);

      setStatus('streaming');
      setErrorKind(null);
      setIsStreaming(true);
      setToolActivity(null);
      draftRef.current = '';
      turnSourcesRef.current = [];
      setStreamingText('');

      const controller = new AbortController();
      abortRef.current = controller;

      void (async () => {
        try {
          const db = await initDbProxy();
          const result = createChatStream({
            model: resolved.model,
            messages: modelMessagesRef.current,
            db,
            now: new Date(),
            abortSignal: controller.signal,
          });

          for await (const part of result.fullStream) {
            switch (part.type) {
              case 'text-delta': {
                draftRef.current += part.text;
                setStreamingText(draftRef.current);
                break;
              }
              case 'tool-input-start': {
                const kind = toolKind(part.toolName);
                if (kind) setToolActivity({ kind, phase: 'input-streaming' });
                break;
              }
              case 'tool-call': {
                const kind = toolKind(part.toolName);
                if (kind) setToolActivity({ kind, phase: 'input-available' });
                break;
              }
              case 'tool-result': {
                const kind = toolKind(part.toolName);
                if (part.toolName === 'searchKnowledgeBase') {
                  const sources = outputToSources(part.output);
                  turnSourcesRef.current.push(...sources);
                  setToolActivity({ kind: 'search', phase: 'output-available', count: sources.length });
                } else if (kind) {
                  setToolActivity({ kind, phase: 'output-available' });
                }
                break;
              }
              case 'tool-error': {
                const kind = toolKind(part.toolName);
                if (kind) setToolActivity({ kind, phase: 'output-error' });
                break;
              }
              case 'error': {
                throw part.error;
              }
              default:
                break;
            }
          }

          // Merge the generated assistant/tool messages so the next turn has context.
          const response = await result.response;
          modelMessagesRef.current.push(...response.messages);

          const finalText = draftRef.current;
          if (finalText.trim().length > 0) {
            const sources = dedupeSources(turnSourcesRef.current);
            setMessages((prev) => [
              ...prev,
              {
                id: makeId(),
                role: 'assistant',
                content: finalText,
                sources: sources.length ? sources : undefined,
              },
            ]);
          }
          setStatus('idle');
          void persistActive();
        } catch (err) {
          // Abort (user pressed stop) is not an error: keep any partial draft.
          if (isAbort(err) || controller.signal.aborted) {
            const partial = draftRef.current;
            if (partial.trim().length > 0) {
              const sources = dedupeSources(turnSourcesRef.current);
              setMessages((prev) => [
                ...prev,
                {
                  id: makeId(),
                  role: 'assistant',
                  content: partial,
                  sources: sources.length ? sources : undefined,
                },
              ]);
              // Fold the partial answer into the model conversation so it persists.
              modelMessagesRef.current.push({ role: 'assistant', content: partial });
            }
            setStatus('idle');
            void persistActive();
          } else {
            console.error('[chat] agent stream failed:', err);
            setErrorKind(classifyError(err));
            setStatus('error');
          }
        } finally {
          setIsStreaming(false);
          setToolActivity(null);
          setStreamingText('');
          draftRef.current = '';
          abortRef.current = null;
        }
      })();
    },
    [isStreaming, persistActive],
  );

  return {
    messages,
    streamingText,
    toolActivity,
    status,
    errorKind,
    isStreaming,
    configured,
    loading,
    send,
    stop,
    conversations,
    activeConversationId,
    newConversation,
    switchConversation,
    deleteConversation,
  };
}
