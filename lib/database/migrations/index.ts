import type { PGlite } from '@electric-sql/pglite';
import { up as v001Init } from './v001-init';
import { up as v002VectorIndex } from './v002-vector-index';
import { up as v003ChunkTimestamps } from './v003-chunk-timestamps';
import { up as v004Tags } from './v004-tags';
import { up as v005ChatConversations } from './v005-chat-conversations';

interface Migration {
  version: number;
  name: string;
  up: (pg: PGlite) => Promise<void>;
}

const migrations: Migration[] = [
  { version: 1, name: 'v1_init', up: v001Init },
  { version: 2, name: 'v2_vector_index', up: v002VectorIndex },
  { version: 3, name: 'v3_chunk_timestamps', up: v003ChunkTimestamps },
  { version: 4, name: 'v4_tags', up: v004Tags },
  { version: 5, name: 'v5_chat_conversations', up: v005ChatConversations },
];

const MIGRATIONS_DDL = `
  CREATE TABLE IF NOT EXISTS _migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

export async function runMigrations(pg: PGlite): Promise<void> {
  await pg.exec(MIGRATIONS_DDL);

  const { rows } = await pg.query<{ version: number }>(
    'SELECT version FROM _migrations ORDER BY version',
  );
  const applied = new Set(rows.map((r) => r.version));

  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    await m.up(pg);
    await pg.query(
      'INSERT INTO _migrations (version, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [m.version, m.name],
    );
  }
}
