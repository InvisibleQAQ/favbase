import type { ModelMessage } from 'ai';
import { desc, eq, sql } from 'drizzle-orm';
import type { FavbaseDb } from '@/lib/database';
import { schema } from '@/lib/database';
import type { ChatConversationRow } from '@/lib/database/entities/chat-conversations';

const { chatConversations } = schema;

/**
 * A persisted chat session. `modelMessages` is the source of truth (model
 * format, including tool-call/tool-result turns) — the display bubbles AND the
 * per-answer source cards are rebuilt from it on load. Persistence lives in
 * PGlite (`chat_conversations`, one jsonb row per conversation), stored in
 * FULL — the sliding window is applied when feeding the model, not on save.
 *
 * Write discipline: this module writes ONLY `chat_conversations`. The chat
 * retrieval tools stay strictly read-only over the knowledge-base tables.
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
 * Sliding-window cap: max messages FED TO THE MODEL per turn (context-window
 * budget, not a storage limit — saves persist the full history). The trim
 * realigns the window to start at a user turn so the model never sees a
 * tool-result orphaned from its tool-call (some providers reject that).
 */
export const MAX_MESSAGES = 40;

/** Max characters kept for a derived conversation title. */
const MAX_TITLE_LEN = 40;

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

/** DB row (Date timestamps) → domain conversation (ms epoch numbers). */
function rowToConversation(row: ChatConversationRow): ChatConversation {
  return {
    id: row.id,
    title: row.title,
    modelMessages: row.modelMessages,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/** All conversations, most-recently-updated first. */
export async function listConversations(db: FavbaseDb): Promise<ChatConversation[]> {
  const rows = await db
    .select()
    .from(chatConversations)
    .orderBy(desc(chatConversations.updatedAt));
  return rows.map(rowToConversation);
}

/** One conversation by id (uuid), or null if it does not exist. */
export async function loadConversation(
  db: FavbaseDb,
  id: string,
): Promise<ChatConversation | null> {
  const rows = await db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.id, id))
    .limit(1);
  return rows[0] ? rowToConversation(rows[0]) : null;
}

/**
 * Upsert a conversation with its FULL message history (no trim — the sliding
 * window belongs to the model-feeding path). On the update path the v001
 * `updated_at` trigger refreshes the timestamp to NOW().
 */
export async function saveConversation(db: FavbaseDb, conv: ChatConversation): Promise<void> {
  await db
    .insert(chatConversations)
    .values({
      id: conv.id,
      title: conv.title,
      modelMessages: conv.modelMessages,
      createdAt: new Date(conv.createdAt),
      updatedAt: new Date(conv.updatedAt),
    })
    .onConflictDoUpdate({
      target: chatConversations.id,
      set: {
        title: sql`excluded.title`,
        modelMessages: sql`excluded.model_messages`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

/** A fresh, empty conversation (not yet persisted). Uses `crypto.randomUUID`. */
export function createConversation(): ChatConversation {
  const now = Date.now();
  return { id: crypto.randomUUID(), title: '', modelMessages: [], createdAt: now, updatedAt: now };
}

/** Remove a conversation by id. */
export async function deleteConversation(db: FavbaseDb, id: string): Promise<void> {
  await db.delete(chatConversations).where(eq(chatConversations.id, id));
}
