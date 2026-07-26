import type { ModelMessage } from 'ai';
import { storage } from 'wxt/utils/storage';
import { STORAGE_KEYS } from '@/lib/storage';

/**
 * A persisted chat session. `modelMessages` is the source of truth (model
 * format, including tool-call/tool-result turns) — the display bubbles AND the
 * per-answer source cards are rebuilt from it on load. Chat persists ONLY to WXT
 * `local:` storage; it never writes PGlite (read-only knowledge base).
 */
export interface ChatConversation {
  id: string;
  /** Short title derived from the first user message. Empty until one exists. */
  title: string;
  modelMessages: ModelMessage[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Sliding-window cap: max messages retained per conversation. Older messages are
 * trimmed on save so a long session can't grow storage without bound. The trim
 * realigns the window to start at a user turn so a persisted tool-result is never
 * orphaned from its tool-call (some providers reject that).
 */
export const MAX_MESSAGES = 40;

/** Max characters kept for a derived conversation title. */
const MAX_TITLE_LEN = 40;

const conversationsStorage = storage.defineItem<ChatConversation[]>(
  STORAGE_KEYS.chatConversations,
  { fallback: [] },
);

/** Flatten a model message's content into plain text (string or text parts). */
export function modelMessageText(message: ModelMessage): string {
  const { content } = message;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) =>
      part && typeof part === 'object' && 'type' in part && part.type === 'text'
        ? (part as { text?: string }).text ?? ''
        : '',
    )
    .join('');
}

/** Derive a short title from the first user message; '' when none exists. */
export function deriveTitle(modelMessages: ModelMessage[]): string {
  const firstUser = modelMessages.find((m) => m.role === 'user');
  const text = (firstUser ? modelMessageText(firstUser) : '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  return text.length > MAX_TITLE_LEN ? `${text.slice(0, MAX_TITLE_LEN)}…` : text;
}

/**
 * Trim to the last `max` messages, then drop any leading non-user messages so the
 * window starts cleanly at a user turn (never an orphan tool-result). If no user
 * message survives the slice, the raw slice is returned.
 */
export function trimMessages(messages: ModelMessage[], max = MAX_MESSAGES): ModelMessage[] {
  if (messages.length <= max) return messages;
  const sliced = messages.slice(messages.length - max);
  let start = 0;
  while (start < sliced.length && sliced[start].role !== 'user') start += 1;
  return start < sliced.length ? sliced.slice(start) : sliced;
}

/** All conversations, most-recently-updated first. */
export async function listConversations(): Promise<ChatConversation[]> {
  const all = await conversationsStorage.getValue();
  return [...all].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** One conversation by id, or null if it does not exist. */
export async function loadConversation(id: string): Promise<ChatConversation | null> {
  const all = await conversationsStorage.getValue();
  return all.find((c) => c.id === id) ?? null;
}

/** Upsert a conversation (trimmed to the sliding window) into storage. */
export async function saveConversation(conv: ChatConversation): Promise<void> {
  const all = await conversationsStorage.getValue();
  const trimmed: ChatConversation = {
    ...conv,
    modelMessages: trimMessages(conv.modelMessages),
  };
  const idx = all.findIndex((c) => c.id === conv.id);
  const next =
    idx >= 0 ? all.map((c) => (c.id === conv.id ? trimmed : c)) : [...all, trimmed];
  await conversationsStorage.setValue(next);
}

/** A fresh, empty conversation (not yet persisted). Uses `crypto.randomUUID`. */
export function createConversation(): ChatConversation {
  const now = Date.now();
  return { id: crypto.randomUUID(), title: '', modelMessages: [], createdAt: now, updatedAt: now };
}

/** Remove a conversation by id. */
export async function deleteConversation(id: string): Promise<void> {
  const all = await conversationsStorage.getValue();
  await conversationsStorage.setValue(all.filter((c) => c.id !== id));
}
