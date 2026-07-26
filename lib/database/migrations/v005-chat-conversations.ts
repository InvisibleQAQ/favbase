import type { PGlite } from '@electric-sql/pglite';

/**
 * v5: chat_conversations (Agentic RAG chat history).
 *
 * Whole-conversation jsonb rows — `model_messages` stores the FULL model-format
 * history untrimmed (the sliding window moved to the agent's model-feeding
 * path). Reuses v001's `update_updated_at_column()` trigger function.
 * `IF NOT EXISTS` / `DROP TRIGGER IF EXISTS` keep this idempotent under the
 * `_migrations`-tracked runner.
 */
export async function up(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      title          TEXT NOT NULL,
      model_messages JSONB NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    DROP TRIGGER IF EXISTS chat_conversations_updated_at ON chat_conversations;
    CREATE TRIGGER chat_conversations_updated_at
      BEFORE UPDATE ON chat_conversations
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);
}
