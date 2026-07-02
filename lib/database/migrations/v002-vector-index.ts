import type { PGlite } from '@electric-sql/pglite';

/**
 * v2: HNSW ANN index on item_chunks.embedding for cosine semantic search.
 *
 * pglite-pgvector ships both `hnsw` and `ivfflat` access methods; HNSW is chosen
 * for better recall without a training step (IVFFlat needs pre-populated data to
 * build centroids, which we don't have at migration time). `vector_cosine_ops`
 * pairs with the `<=>` operator used by `semanticSearchChunks`.
 *
 * `IF NOT EXISTS` keeps this idempotent under the `_migrations`-tracked runner.
 */
export async function up(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE INDEX IF NOT EXISTS idx_item_chunks_embedding
      ON item_chunks USING hnsw (embedding vector_cosine_ops);
  `);
}
