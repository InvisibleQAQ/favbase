import type { ModelMessage } from 'ai';
import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

/**
 * Chat (Agentic RAG assistant) conversations. One row per conversation; the
 * full model-format message history (including tool-call/tool-result turns) is
 * stored UNTRIMMED as a single jsonb document — it is the source of truth the
 * chat UI rebuilds display bubbles + source cards from. The `ai` import is
 * type-only (erased at compile time), keeping this entity runtime-dependency
 * free like its siblings.
 */
export const chatConversations = pgTable('chat_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Derived from the first user message; empty string until one exists. */
  title: text('title').notNull(),
  modelMessages: jsonb('model_messages').$type<ModelMessage[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type ChatConversationRow = typeof chatConversations.$inferSelect;
export type NewChatConversationRow = typeof chatConversations.$inferInsert;
