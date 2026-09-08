import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** Source with block and line comments removed (so prose may name `import()`). */
function code(relativePath: string): string {
  return source(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
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

  it('reaches the tag query leaf statically, without the tagging or database barrels', () => {
    const tools = source('lib/chat/tools.ts');
    const tagQueries = source('lib/tagging/tag-queries.ts');

    expect(tools).toContain("import { getAllUsedTags } from '@/lib/tagging/tag-queries'");
    expect(tagQueries).not.toMatch(/^import\s+.*from ['"]@\/lib\/tagging['"];?$/m);
    expect(tagQueries).not.toMatch(/^import\s+.*from ['"]@\/lib\/database['"];?$/m);
  });

  // The `getProcessingCoverage` Knowledge Tool (2026-09-08) put the Collection
  // coverage readers on this graph, and it landed importing the
  // `@/lib/collections` barrel — which goes through `collections-query` and so
  // pulls drizzle plus `@/lib/database` (PGlite, `DatabaseRpcHandler`) into
  // `background.js`. `pnpm build` caught it, but only after a full 54 MB build:
  // `Background module graph contains PGlite markers: pglite.wasm, Postgres
  // tried to execute, DatabaseRpcHandler`. This asserts the same rule in
  // `pnpm test`, where the feedback is seconds rather than minutes.
  it('reaches the coverage readers through leaves, not the collections barrel', () => {
    const tools = source('lib/chat/tools.ts');
    const coverage = source('lib/collections/processing-coverage.ts');

    expect(tools).toContain("from '@/lib/collections/processing-coverage'");
    expect(tools).toContain("from '@/lib/collections/configuration-blockers'");
    expect(tools).not.toMatch(/^import\s+[^;]*from ['"]@\/lib\/collections['"];?$/m);
    // The readers themselves are the other half: a `getDb` value import from
    // the database barrel re-exports `./db`, which value-imports PGlite.
    expect(coverage).toContain("import { getDb } from '@/lib/database/db-state'");
    expect(coverage).not.toMatch(/^import\s+(?!type\s)[^;]*from ['"]@\/lib\/database['"];?$/m);
  });

  // Everything the coverage readers pull in is on the graph too, and each of
  // these files already names the database barrel in an `import type` — one
  // keyword away from re-admitting PGlite. A type import is erased; deleting
  // that one keyword is not, and the only signal today would be a 54 MB build
  // failing with a message that names none of these files.
  it.each([
    'lib/collections/configuration-blockers.ts',
    'lib/collections/collection-processing-policy.ts',
    'lib/collections/platform-eligibility.ts',
    'lib/bilibili/video-eligibility.ts',
  ])('%s keeps the database barrel type-only', (file) => {
    const content = code(file);

    expect(content).not.toMatch(/^import\s+(?!type\s)[^;]*from ['"]@\/lib\/database['"];?$/m);
    expect(content).not.toMatch(/^import\s+(?!type\s)[^;]*from ['"]@\/lib\/collections['"];?$/m);
    expect(content).not.toContain('@electric-sql/pglite');
  });

  // A Service Worker may not call dynamic `import()` — the HTML specification
  // disallows it on `ServiceWorkerGlobalScope`, and Chrome rejects the call.
  // Vite wraps every dynamic import in `__vitePreload`, whose
  // `vite:preloadError` reporter turns that rejection into a misleading
  // `window is not defined` / `document is not defined`. Both Chat modules are
  // reachable from the Background Agent Bridge tool registry, so their imports
  // must stay static. `scripts/check-background-bundle.mjs` enforces the same
  // invariant on the built artifact (where the real module graph is known).
  it.each(['lib/chat/tools.ts', 'lib/chat/retrieval.ts', 'lib/agent-bridge/tool-registry.ts'])(
    '%s uses no dynamic import (Service Workers forbid it)',
    (file) => {
      expect(code(file)).not.toMatch(/\bimport\s*\(/);
    },
  );
});
