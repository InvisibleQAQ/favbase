import { and, asc, eq, exists, inArray, sql } from 'drizzle-orm';
import type { FavbaseDb } from '@/lib/database';
import { getDb, schema } from '@/lib/database';
import { chunk } from '@/lib/database/sql-utils';
import { createEmbeddingModel, embedTexts } from '@/lib/ai';
import { getEmbeddingSettings, type ResolvedEmbeddingConfig } from './config';
import { replaceItemChunks, upsertChunkEmbeddings } from './vector-store';
import type { ChunkInput } from './types';

const { items, itemChunks } = schema;

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
    // Forward the optional user-configured truncation (Matryoshka) so the
    // stored dimension matches what testEmbeddingConnection probes.
    return embedTexts(model, texts, {
      providerId: config.providerId,
      dimensions: config.dimensions,
    });
  },
};

async function setContentState(
  db: FavbaseDb,
  itemId: string,
  state: IndexedContentState,
): Promise<void> {
  await db.update(items).set({ contentState: state }).where(eq(items.id, itemId));
}

interface EmbeddableChunk {
  id: string;
  chunkText: string;
}

/**
 * Shared embed core for fresh indexing and backlog rebuild: embed the ordered
 * chunk texts, attach vectors by chunk id (the lazy dimension switch lives
 * inside `upsertChunkEmbeddings`), then advance the item to 'embedded'.
 * Throws on any failure — the caller decides the policy (`indexItemChunks`
 * swallows and stays 'chunked', `rebuildPendingEmbeddings` stops and
 * propagates).
 */
async function embedChunks(
  db: FavbaseDb,
  itemId: string,
  chunks: EmbeddableChunk[],
  config: ResolvedEmbeddingConfig,
  embed: IndexingDeps['embed'],
): Promise<void> {
  const vectors = await embed(config, chunks.map((c) => c.chunkText));
  if (vectors.length !== chunks.length) {
    throw new Error(
      `Embedding count mismatch: expected ${chunks.length}, got ${vectors.length}`,
    );
  }
  await upsertChunkEmbeddings(
    db,
    chunks.map((c, i) => ({ chunkId: c.id, vector: vectors[i] })),
  );
  await setContentState(db, itemId, 'embedded');
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
    await embedChunks(db, itemId, ordered, config, deps.embed);
    return 'embedded';
  } catch (err) {
    console.error(
      `[embedding] Embed failed for item=${itemId}, staying at 'chunked':`,
      err,
    );
    return 'chunked';
  }
}

// ---------------------------------------------------------------------------
// rebuildPendingEmbeddings
// ---------------------------------------------------------------------------

export interface RebuildProgress {
  completed: number;
  total: number;
}

export type RebuildOutcome =
  | { status: 'not-configured' }
  | { status: 'completed'; completed: number; total: number };

/**
 * Re-embed the backlog left behind by dimension switches or embed failures:
 * every item at 'chunked' that still has chunk rows. Chunks are read from the
 * DB (never re-chunked), embedded item by item and advanced to 'embedded'.
 * `onProgress` fires once with `{ completed: 0, total }` up front (so the UI
 * can show the total immediately) and again after each finished item.
 *
 * Failure policy is the opposite of `indexItemChunks`: the first failing item
 * STOPS the loop and the error propagates (structured, no user copy — the UI
 * translates). Finished items keep 'embedded', the failing one stays
 * 'chunked', so re-running only picks up the remainder — the operation is
 * idempotent-resumable by construction. A dimension mismatch on the first
 * upsert triggers the lazy column switch in `upsertChunkEmbeddings`; no
 * special-casing here.
 */
export async function rebuildPendingEmbeddings(
  db: FavbaseDb,
  deps: IndexingDeps = defaultDeps,
  onProgress?: (progress: RebuildProgress) => void,
): Promise<RebuildOutcome> {
  const config = await deps.getConfig();
  if (!config.enabled) return { status: 'not-configured' };

  // One query for the whole backlog (no N+1 candidate scan): 'chunked' items
  // that actually have chunk rows. Ordered for deterministic resume runs.
  const pending = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.contentState, 'chunked'),
        exists(
          db
            .select({ one: sql`1` })
            .from(itemChunks)
            .where(eq(itemChunks.itemId, items.id)),
        ),
      ),
    )
    .orderBy(asc(items.createdAt), asc(items.id));

  const total = pending.length;
  let completed = 0;
  onProgress?.({ completed, total });

  for (const { id: itemId } of pending) {
    const chunks = await db
      .select({ id: itemChunks.id, chunkText: itemChunks.chunkText })
      .from(itemChunks)
      .where(eq(itemChunks.itemId, itemId))
      .orderBy(asc(itemChunks.chunkIndex));

    // Race guard: chunks may have been replaced/cleared since the backlog
    // query (re-transcription) — an item without chunks must not become
    // 'embedded'.
    if (chunks.length > 0) {
      await embedChunks(db, itemId, chunks, config, deps.embed);
    }

    completed += 1;
    onProgress?.({ completed, total });
  }

  return { status: 'completed', completed, total };
}

// ---------------------------------------------------------------------------
// embedNewItems
// ---------------------------------------------------------------------------

/** Injectable seams for tests — `IndexingDeps` plus the db accessor (mirrors TaggingDeps). */
export interface EmbedNewItemsDeps extends IndexingDeps {
  db: () => FavbaseDb;
}

/** Keeps `inArray` bind-params well under the PG 65535 limit (same as ingest). */
const ID_QUERY_CHUNK_SIZE = 500;

/**
 * Batch entry for collection syncs (mirrors `tagNewItems`): embed the items a
 * sync run just persisted chunks for. Addressed by (platform, platformItemId)
 * so callers never touch DB uuids. Only items still at 'chunked' qualify, so
 * re-runs are idempotent by construction.
 *
 * Sequential on purpose — a first sync can insert hundreds of items, and
 * serial awaits are the pacing that keeps the embedding API from being
 * hammered. Never throws: unconfigured is a silent no-op, a failing item logs
 * and stays 'chunked' without aborting the rest (the settings-page rebuild
 * remains the backlog safety net). Fire-and-forget from callers
 * (`void embedNewItems(…)`).
 */
export async function embedNewItems(
  platform: string,
  platformItemIds: string[],
  deps: Partial<EmbedNewItemsDeps> = {},
): Promise<void> {
  if (platformItemIds.length === 0) return;
  const getConfig = deps.getConfig ?? defaultDeps.getConfig;
  const embed = deps.embed ?? defaultDeps.embed;

  try {
    const config = await getConfig();
    if (!config.enabled) return;
    const db = (deps.db ?? getDb)();

    const targets: { id: string }[] = [];
    for (const batch of chunk(platformItemIds, ID_QUERY_CHUNK_SIZE)) {
      const rows = await db
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.platform, platform),
            inArray(items.platformItemId, batch),
            eq(items.contentState, 'chunked'),
          ),
        )
        .orderBy(asc(items.createdAt), asc(items.id));
      targets.push(...rows);
    }

    for (const { id: itemId } of targets) {
      try {
        const chunks = await db
          .select({ id: itemChunks.id, chunkText: itemChunks.chunkText })
          .from(itemChunks)
          .where(eq(itemChunks.itemId, itemId))
          .orderBy(asc(itemChunks.chunkIndex));
        if (chunks.length === 0) continue;
        await embedChunks(db, itemId, chunks, config, embed);
      } catch (err) {
        console.error(
          `[embedding] Post-sync embed failed for item=${itemId}, staying at 'chunked':`,
          err,
        );
      }
    }
  } catch (err) {
    console.error('[embedding] embedNewItems aborted:', err);
  }
}
