import type { PGlite } from '@electric-sql/pglite';
import { up as v001Init } from './v001-init';
import { up as v002VectorIndex } from './v002-vector-index';

interface Migration {
  version: number;
  name: string;
  up: (pg: PGlite) => Promise<void>;
}

const migrations: Migration[] = [
  { version: 1, name: 'v1_init', up: v001Init },
  { version: 2, name: 'v2_vector_index', up: v002VectorIndex },
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
