import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('Agent Bridge background bundle contract', () => {
  it('builds the Background Service Worker as an ES module', () => {
    const background = source('entrypoints/background.ts');

    expect(background).toMatch(
      /defineBackground\(\{\s*type: 'module',\s*main\(\)/,
    );
  });

  it('imports only the PGlite proxy leaf', () => {
    const background = source('entrypoints/background.ts');

    expect(background).toContain("from '@/lib/database/read-proxy-db'");
    expect(background).not.toContain("from '@/lib/database/proxy-db'");
    expect(background).not.toMatch(/^import\s+.*from ['"]@\/lib\/database['"];?$/m);
  });

  it.each(['lib/chat/tools.ts', 'lib/chat/retrieval.ts', 'lib/embedding/vector-store.ts'])(
    '%s imports schema from the leaf instead of executing the database barrel',
    (file) => {
      const content = source(file);

      expect(content).toContain("import * as schema from '@/lib/database/schema'");
      expect(content).not.toContain("import { schema } from '@/lib/database'");
    },
  );

  it('keeps the Background read proxy free of the PGlite runtime', () => {
    const proxy = source('lib/database/read-proxy-db.ts');

    expect(proxy).toContain("from 'drizzle-orm/pg-proxy'");
    expect(proxy).not.toContain('drizzle-orm/pglite');
    expect(proxy).not.toContain('@electric-sql/pglite');
    expect(proxy).not.toContain("from './db'");
  });

  it('loads the tag query leaf without the tagging or database barrels', () => {
    const tools = source('lib/chat/tools.ts');
    const tagQueries = source('lib/tagging/tag-queries.ts');

    expect(tools).toContain("import('@/lib/tagging/tag-queries')");
    expect(tagQueries).not.toMatch(/^import\s+.*from ['"]@\/lib\/tagging['"];?$/m);
    expect(tagQueries).not.toMatch(/^import\s+.*from ['"]@\/lib\/database['"];?$/m);
  });
});
