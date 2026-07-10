import { eq } from 'drizzle-orm';
import type { FavbaseDb } from '@/lib/database';
import { schema } from '@/lib/database';
import { createEmbeddingModel, embedTexts } from '@/lib/ai';
import { getEmbeddingSettings, type ResolvedEmbeddingConfig } from './config';
import { replaceItemChunks, upsertChunkEmbeddings } from './vector-store';
import type { ChunkInput } from './types';

const { items } = schema;

/**
 * Content-agnostic indexing orchestrator. Knows nothing about platforms or
 * content types — it consumes `ChunkInput[]` produced by whatever chunker the
 * platform service chose (subtitle rows today, article text tomorrow).
 *
 * Policy: chunking is free and always persisted ('chunked'); embedding is
 * best-effort — disabled config, un-indexable dimension (HNSW cap), or network
 * failure logs and leaves the item at 'chunked' without throwing. Dimension
 * changes across model switches are handled inside `upsertChunkEmbeddings`
 * (lazy column re-dimensioning), not here.
 */

export type IndexedContentState = 'chunked' | 'embedded';

/** Embed operations, injectable for tests (mirrors PipelineDeps DI style). */
export interface IndexingDeps {
  getConfig(): Promise<ResolvedEmbeddingConfig>;
  embed(config: ResolvedEmbeddingConfig, texts: string[]): Promise<number[][]>;
}

const defaultDeps: IndexingDeps = {
  getConfig: getEmbeddingSettings,
  embed: (config, texts) => {
    const model = createEmbeddingModel({
      providerId: config.providerId,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
    });
    return embedTexts(model, texts);
  },
};

async function setContentState(
  db: FavbaseDb,
  itemId: string,
  state: IndexedContentState,
): Promise<void> {
  await db.update(items).set({ contentState: state }).where(eq(items.id, itemId));
}

/**
 * Rebuild the item's chunks and advance `content_state`:
 * chunks written → 'chunked'; embedding configured + succeeded → 'embedded'.
 * Chunk-write failures propagate (caller decides); embed failures never do.
 */
export async function indexItemChunks(
  db: FavbaseDb,
  itemId: string,
  chunks: ChunkInput[],
  deps: IndexingDeps = defaultDeps,
): Promise<IndexedContentState> {
  const inserted = await replaceItemChunks(db, itemId, chunks);
  await setContentState(db, itemId, 'chunked');
  if (inserted.length === 0) return 'chunked';

  try {
    const config = await deps.getConfig();
    if (!config.enabled) return 'chunked';

    const ordered = [...inserted].sort((a, b) => a.chunkIndex - b.chunkIndex);
    const vectors = await deps.embed(config, ordered.map((c) => c.chunkText));
    if (vectors.length !== ordered.length) {
      throw new Error(
        `Embedding count mismatch: expected ${ordered.length}, got ${vectors.length}`,
      );
    }

    await upsertChunkEmbeddings(
      db,
      ordered.map((row, i) => ({ chunkId: row.id, vector: vectors[i] })),
    );
    await setContentState(db, itemId, 'embedded');
    return 'embedded';
  } catch (err) {
    console.error(
      `[embedding] Embed failed for item=${itemId}, staying at 'chunked':`,
      err,
    );
    return 'chunked';
  }
}
