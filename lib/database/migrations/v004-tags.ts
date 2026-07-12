import type { PGlite } from '@electric-sql/pglite';

/**
 * v4: tags + item_tags (AI tagging).
 *
 * Flat global tag namespace (single-user, no user_id). item_tags is a plain
 * M:N join keyed on items — platform-agnostic, so future article/repo items
 * reuse it unchanged. `IF NOT EXISTS` keeps this idempotent under the
 * `_migrations`-tracked runner.
 */
export async function up(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_tags_name UNIQUE (name)
    );

    CREATE TABLE IF NOT EXISTS item_tags (
      item_id    UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      tag_id     UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (item_id, tag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_item_tags_tag_id ON item_tags(tag_id);
  `);
}
