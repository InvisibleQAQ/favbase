import type { PGlite } from '@electric-sql/pglite';

export async function up(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    SET timezone = 'UTC';

    -- updated_at auto-refresh trigger function
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    -----------------------------------------------------------------------
    -- authors
    -----------------------------------------------------------------------
    CREATE TABLE authors (
      id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      platform            TEXT NOT NULL,
      platform_author_id  TEXT NOT NULL,
      name                TEXT NOT NULL,
      avatar_url          TEXT,
      platform_meta       JSONB NOT NULL DEFAULT '{}',
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_authors_platform UNIQUE (platform, platform_author_id)
    );

    CREATE TRIGGER authors_updated_at
      BEFORE UPDATE ON authors
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    -----------------------------------------------------------------------
    -- sources
    -----------------------------------------------------------------------
    CREATE TABLE sources (
      id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      platform            TEXT NOT NULL,
      platform_source_id  TEXT NOT NULL,
      title               TEXT NOT NULL,
      description         TEXT,
      platform_meta       JSONB NOT NULL DEFAULT '{}',
      last_fetched_at     TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_sources_platform UNIQUE (platform, platform_source_id)
    );

    CREATE TRIGGER sources_updated_at
      BEFORE UPDATE ON sources
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    -----------------------------------------------------------------------
    -- items
    -----------------------------------------------------------------------
    CREATE TABLE items (
      id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      platform            TEXT NOT NULL,
      platform_item_id    TEXT NOT NULL,
      author_id           UUID NOT NULL REFERENCES authors(id) ON DELETE RESTRICT,
      title               TEXT NOT NULL,
      author_name         TEXT NOT NULL,
      original_url        TEXT NOT NULL,
      published_at        TIMESTAMPTZ,
      content_state       TEXT NOT NULL DEFAULT 'pending'
                          CHECK (content_state IN (
                            'pending','has_content','chunked',
                            'embedded','no_content','error'
                          )),
      platform_meta       JSONB NOT NULL DEFAULT '{}',
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_items_platform UNIQUE (platform, platform_item_id)
    );

    CREATE INDEX idx_items_author_id ON items(author_id);
    CREATE INDEX idx_items_created_at ON items(created_at DESC);

    CREATE TRIGGER items_updated_at
      BEFORE UPDATE ON items
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    -----------------------------------------------------------------------
    -- item_sources
    -----------------------------------------------------------------------
    CREATE TABLE item_sources (
      item_id   UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (item_id, source_id)
    );

    CREATE INDEX idx_item_sources_source_id ON item_sources(source_id);

    -----------------------------------------------------------------------
    -- item_contents
    -----------------------------------------------------------------------
    CREATE TABLE item_contents (
      item_id     UUID PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
      plain_text  TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TRIGGER item_contents_updated_at
      BEFORE UPDATE ON item_contents
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    -----------------------------------------------------------------------
    -- item_chunks
    -----------------------------------------------------------------------
    CREATE TABLE item_chunks (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      item_id     UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      chunk_text  TEXT NOT NULL,
      embedding   VECTOR(1536),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_item_chunks_index UNIQUE (item_id, chunk_index)
    );

    CREATE INDEX idx_item_chunks_item_id ON item_chunks(item_id);
    CREATE INDEX idx_item_chunks_text_trgm ON item_chunks USING GIN (chunk_text gin_trgm_ops);
    CREATE INDEX idx_items_title_trgm ON items USING GIN (title gin_trgm_ops);

    CREATE TRIGGER item_chunks_updated_at
      BEFORE UPDATE ON item_chunks
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);
}
