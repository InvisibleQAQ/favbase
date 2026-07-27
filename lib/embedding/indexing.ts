import { and, asc, eq, exists, sql } from 'drizzle-orm';
import type { FavbaseDb } from '@/lib/database';
import { getDb, schema } from '@/lib/database';
import { emitDomainEvent } from '@/lib/events';
import type { CooperativeCheckpoint } from '@/lib/collections';
import { createEmbeddingModel, embedTexts } from '@/lib/ai';
import { getEmbeddingSettings, type ResolvedEmbeddingConfig } from './config';
import {
  createEmbeddingTraceId,
  embeddingTrace,
  embeddingTraceError,
  type EmbeddingTraceDetails,
} from './diagnostics';
import { replaceItemChunks, upsertChunkEmbeddings } from './vector-store';
import type { ChunkInput } from './types';

const { items, itemChunks } = schema;

/**
 * Content-agnostic indexing orchestrator. Knows nothing about platforms or
 * content types — it consumes `ChunkInput[]` produced by whatever chunker the
 * platform service chose (subtitle rows today, article text tomorrow).
 *
 * Policy: chunking is free and always persisted ('chunked'); the combined
 * `indexItemChunks` compatibility path keeps embedding best-effort. The
 * platform-addressed job path rejects failures so its scheduler stays
 * truthful. Dimension changes across model switches are handled inside `upsertChunkEmbeddings`
 * (lazy column re-dimensioning), not here.
 */

export type IndexedContentState = 'chunked' | 'embedded';

/** Embed operations, injectable for tests (mirrors PipelineDeps DI style). */
export interface IndexingDeps {
  getConfig(): Promise<ResolvedEmbeddingConfig>;
  embed(config: ResolvedEmbeddingConfig, texts: string[]): Promise<number[][]>;
}

/** Shared dependencies for platform-addressed single-item and batch embedding. */
export interface EmbeddingItemDeps extends IndexingDeps {
  db: () => FavbaseDb;
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

function configTraceDetails(config: ResolvedEmbeddingConfig): EmbeddingTraceDetails {
  return {
    providerId: config.providerId,
    model: config.model,
    ...(config.dimensions !== undefined ? { dimensions: config.dimensions } : {}),
  };
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
  diagnostic: EmbeddingTraceDetails = {
    traceId: createEmbeddingTraceId('item'),
    itemId,
    source: 'embed-chunks',
  },
): Promise<void> {
  const contentDetails: EmbeddingTraceDetails = {
    ...diagnostic,
    ...configTraceDetails(config),
    chunkCount: chunks.length,
    charCount: chunks.reduce((total, chunk) => total + chunk.chunkText.length, 0),
  };
  const providerStartedAt = Date.now();
  embeddingTrace('provider:started', {
    ...contentDetails,
    stage: 'provider',
    elapsedMs: 0,
  });

  let vectors: number[][];
  try {
    vectors = await embed(config, chunks.map((c) => c.chunkText));
  } catch (error) {
    embeddingTraceError('provider:failed', error, {
      ...contentDetails,
      stage: 'provider',
      elapsedMs: Date.now() - providerStartedAt,
    });
    throw error;
  }
  if (vectors.length !== chunks.length) {
    const error = new Error(
      `Embedding count mismatch: expected ${chunks.length}, got ${vectors.length}`,
    );
    embeddingTraceError('provider:failed', error, {
      ...contentDetails,
      stage: 'provider',
      phase: 'response-validation',
      vectorCount: vectors.length,
      vectorDimensions: vectors[0]?.length,
      elapsedMs: Date.now() - providerStartedAt,
    });
    throw error;
  }
  embeddingTrace('provider:completed', {
    ...contentDetails,
    stage: 'provider',
    vectorCount: vectors.length,
    vectorDimensions: vectors[0]?.length,
    elapsedMs: Date.now() - providerStartedAt,
  });

  const persistenceStartedAt = Date.now();
  const persistenceDetails: EmbeddingTraceDetails = {
    ...contentDetails,
    stage: 'persistence',
    vectorCount: vectors.length,
    vectorDimensions: vectors[0]?.length,
  };
  embeddingTrace('persistence:started', {
    ...persistenceDetails,
    elapsedMs: 0,
  });
  try {
    await upsertChunkEmbeddings(
      db,
      chunks.map((c, i) => ({ chunkId: c.id, vector: vectors[i] })),
    );
    await setContentState(db, itemId, 'embedded');
  } catch (error) {
    embeddingTraceError('persistence:failed', error, {
      ...persistenceDetails,
      elapsedMs: Date.now() - persistenceStartedAt,
    });
    throw error;
  }
  embeddingTrace('persistence:completed', {
    ...persistenceDetails,
    elapsedMs: Date.now() - persistenceStartedAt,
  });
}

async function replaceAndMarkItemChunks(
  db: FavbaseDb,
  itemId: string,
  chunks: ChunkInput[],
) {
  const inserted = await replaceItemChunks(db, itemId, chunks);
  await setContentState(db, itemId, 'chunked');
  return inserted;
}

async function getEmbeddableChunks(
  db: FavbaseDb,
  itemId: string,
): Promise<EmbeddableChunk[]> {
  return db
    .select({ id: itemChunks.id, chunkText: itemChunks.chunkText })
    .from(itemChunks)
    .where(eq(itemChunks.itemId, itemId))
    .orderBy(asc(itemChunks.chunkIndex));
}

/** Persist a prepared content type's chunks and expose the durable `chunked` seam. */
export async function persistItemChunks(
  db: FavbaseDb,
  itemId: string,
  chunks: ChunkInput[],
): Promise<'chunked'> {
  await replaceAndMarkItemChunks(db, itemId, chunks);
  return 'chunked';
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
  const inserted = await replaceAndMarkItemChunks(db, itemId, chunks);
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

/**
 * Single-item embedding addressed by platform identity. The item must already
 * be at the durable `chunked` seam; missing chunks return null, while DB or
 * Provider failures reject so job owners cannot report false completion.
 */
export async function embedPlatformItem(
  platform: string,
  platformItemId: string,
  deps: Partial<EmbeddingItemDeps> = {},
): Promise<IndexedContentState | null> {
  const startedAt = Date.now();
  let phase = 'db-init';
  let diagnostic: EmbeddingTraceDetails = {
    traceId: createEmbeddingTraceId('single-item'),
    platform,
    platformItemId,
    source: 'platform-item',
  };
  const getConfig = deps.getConfig ?? defaultDeps.getConfig;
  const embed = deps.embed ?? defaultDeps.embed;

  embeddingTrace('single-item:started', {
    ...diagnostic,
    phase,
    elapsedMs: 0,
  });
  try {
    const db = (deps.db ?? getDb)();
    phase = 'item-query';
    embeddingTrace('query:started', {
      ...diagnostic,
      stage: 'query',
      phase,
      elapsedMs: Date.now() - startedAt,
    });
    const targets = await db
      .select({ id: items.id, contentState: items.contentState })
      .from(items)
      .where(and(eq(items.platform, platform), eq(items.platformItemId, platformItemId)))
      .limit(1);
    embeddingTrace('query:completed', {
      ...diagnostic,
      stage: 'query',
      phase,
      total: targets.length,
      elapsedMs: Date.now() - startedAt,
    });
    if (targets.length === 0) {
      embeddingTrace('single-item:completed', {
        ...diagnostic,
        phase: 'not-found',
        elapsedMs: Date.now() - startedAt,
      });
      return null;
    }

    const target = targets[0];
    diagnostic = { ...diagnostic, itemId: target.id };
    if (target.contentState === 'embedded') {
      embeddingTrace('single-item:completed', {
        ...diagnostic,
        phase: 'already-embedded',
        elapsedMs: Date.now() - startedAt,
      });
      return 'embedded';
    }
    if (target.contentState !== 'chunked') {
      embeddingTrace('single-item:completed', {
        ...diagnostic,
        phase: 'not-chunked',
        elapsedMs: Date.now() - startedAt,
      });
      return null;
    }

    phase = 'chunk-query';
    embeddingTrace('query:started', {
      ...diagnostic,
      stage: 'query',
      phase,
      elapsedMs: Date.now() - startedAt,
    });
    const chunks = await getEmbeddableChunks(db, target.id);
    const contentDetails: EmbeddingTraceDetails = {
      ...diagnostic,
      chunkCount: chunks.length,
      charCount: chunks.reduce((sum, chunk) => sum + chunk.chunkText.length, 0),
    };
    embeddingTrace('query:completed', {
      ...contentDetails,
      stage: 'query',
      phase,
      elapsedMs: Date.now() - startedAt,
    });
    if (chunks.length === 0) {
      embeddingTrace('single-item:skipped', {
        ...contentDetails,
        phase: 'no-chunks',
        elapsedMs: Date.now() - startedAt,
      });
      return null;
    }

    phase = 'config';
    embeddingTrace('config:started', {
      ...diagnostic,
      stage: 'config',
      elapsedMs: Date.now() - startedAt,
    });
    const config = await getConfig();
    embeddingTrace('config:completed', {
      ...diagnostic,
      ...configTraceDetails(config),
      stage: 'config',
      phase: config.enabled ? 'enabled' : 'disabled',
      elapsedMs: Date.now() - startedAt,
    });
    if (!config.enabled) {
      embeddingTrace('single-item:completed', {
        ...diagnostic,
        ...configTraceDetails(config),
        phase: 'disabled',
        elapsedMs: Date.now() - startedAt,
      });
      return 'chunked';
    }

    phase = 'embedding';
    await embedChunks(db, target.id, chunks, config, embed, diagnostic);
    emitDomainEvent('item-embedded', { platform, platformItemId });
    embeddingTrace('single-item:completed', {
      ...contentDetails,
      ...configTraceDetails(config),
      phase: 'embedded',
      elapsedMs: Date.now() - startedAt,
    });
    return 'embedded';
  } catch (err) {
    const failureDetails: EmbeddingTraceDetails = {
      ...diagnostic,
      phase,
      elapsedMs: Date.now() - startedAt,
    };
    if (phase === 'embedding') {
      embeddingTrace('single-item:failed', failureDetails);
    } else {
      embeddingTraceError('single-item:failed', err, failureDetails);
    }
    throw err;
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
    const chunks = await getEmbeddableChunks(db, itemId);

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
// embedPlatformBacklog
// ---------------------------------------------------------------------------

/** Progress payload for the platform embed lane (extends the {done,total} shape). */
export interface BacklogEmbedProgress {
  done: number;
  total: number;
  /** Items whose embed threw this run (they stay 'chunked'; the run continues). */
  failed: number;
}

/**
 * Batch entry for the shared embed lane: embed EVERYTHING the platform still
 * has at the durable 'chunked' seam (with chunk rows) — not just the ids a
 * sync run happened to hand over. Items a sync just persisted are part of that
 * backlog by definition, so callers stopped threading id lists through; a sync
 * with zero new items still drains the backlog an earlier interrupted run left
 * behind. Idempotent by construction ('embedded' items no longer qualify).
 *
 * Sequential on purpose — serial awaits pace the embedding API. Per-item
 * failures log, count into `progress.failed`, and never abort the rest; when
 * any item failed, the run THROWS at the end so the job surfaces as failed
 * with a real error instead of a silent console line (the settings-page
 * rebuild remains the manual safety net). Unconfigured embedding completes
 * silently at 0/0 — auto-dispatch must not spam failed jobs on keyless setups.
 *
 * `onProgress` fires once with `{ done: 0, total, failed: 0 }` after the
 * backlog query, then after each settled item. Monotonic, always reaches
 * total. It is a pure notifier — it must not throw.
 */
export async function embedPlatformBacklog(
  platform: string,
  deps: Partial<EmbeddingItemDeps> = {},
  onProgress?: (progress: BacklogEmbedProgress) => void,
  control?: CooperativeCheckpoint,
): Promise<void> {
  const traceId = createEmbeddingTraceId('backlog');
  const startedAt = Date.now();
  const diagnostic: EmbeddingTraceDetails = {
    traceId,
    platform,
    source: 'platform-backlog',
  };
  const getConfig = deps.getConfig ?? defaultDeps.getConfig;
  const embed = deps.embed ?? defaultDeps.embed;

  embeddingTrace('backlog:started', {
    ...diagnostic,
    stage: 'config',
    elapsedMs: 0,
  });
  let config: ResolvedEmbeddingConfig;
  try {
    config = await getConfig();
  } catch (error) {
    const details: EmbeddingTraceDetails = {
      ...diagnostic,
      stage: 'config',
      elapsedMs: Date.now() - startedAt,
    };
    embeddingTraceError('backlog:failed', error, details);
    throw error;
  }
  embeddingTrace('config:completed', {
    ...diagnostic,
    ...configTraceDetails(config),
    stage: 'config',
    phase: config.enabled ? 'enabled' : 'disabled',
    elapsedMs: Date.now() - startedAt,
  });
  if (!config.enabled) {
    onProgress?.({ done: 0, total: 0, failed: 0 });
    embeddingTrace('backlog:completed', {
      ...diagnostic,
      ...configTraceDetails(config),
      stage: 'config',
      phase: 'disabled',
      done: 0,
      total: 0,
      failed: 0,
      elapsedMs: Date.now() - startedAt,
    });
    return;
  }
  let db: FavbaseDb;
  try {
    db = (deps.db ?? getDb)();
  } catch (error) {
    embeddingTraceError('backlog:failed', error, {
      ...diagnostic,
      stage: 'query',
      phase: 'db-init',
      elapsedMs: Date.now() - startedAt,
    });
    throw error;
  }

  // Platform-scoped mirror of the rebuild backlog query: 'chunked' items that
  // actually have chunk rows, in deterministic resume order.
  embeddingTrace('query:started', {
    ...diagnostic,
    ...configTraceDetails(config),
    stage: 'query',
    phase: 'backlog',
    elapsedMs: Date.now() - startedAt,
  });
  let targets: Array<{ id: string; platformItemId: string }>;
  try {
    targets = await db
      .select({ id: items.id, platformItemId: items.platformItemId })
      .from(items)
      .where(
        and(
          eq(items.platform, platform),
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
  } catch (error) {
    const details: EmbeddingTraceDetails = {
      ...diagnostic,
      ...configTraceDetails(config),
      stage: 'query',
      phase: 'backlog',
      elapsedMs: Date.now() - startedAt,
    };
    embeddingTraceError('backlog:failed', error, details);
    throw error;
  }

  const total = targets.length;
  let done = 0;
  let failed = 0;
  embeddingTrace('query:completed', {
    ...diagnostic,
    ...configTraceDetails(config),
    stage: 'query',
    phase: 'backlog',
    total,
    elapsedMs: Date.now() - startedAt,
  });
  onProgress?.({ done, total, failed });
  embeddingTrace('backlog:progress', {
    ...diagnostic,
    done,
    total,
    failed,
    elapsedMs: Date.now() - startedAt,
  });

  for (const { id: itemId, platformItemId } of targets) {
    try {
      await control?.checkpoint();
    } catch (error) {
      embeddingTraceError('backlog:failed', error, {
        ...diagnostic,
        itemId,
        platformItemId,
        stage: 'scheduler',
        phase: 'checkpoint',
        done,
        total,
        failed,
        elapsedMs: Date.now() - startedAt,
      });
      throw error;
    }
    const itemStartedAt = Date.now();
    const itemDiagnostic: EmbeddingTraceDetails = {
      ...diagnostic,
      itemId,
      platformItemId,
    };
    embeddingTrace('item:started', {
      ...itemDiagnostic,
      phase: 'chunk-query',
      done,
      total,
      failed,
      elapsedMs: 0,
    });
    let itemPhase = 'chunk-query';
    try {
      const chunks = await getEmbeddableChunks(db, itemId);
      const contentDetails: EmbeddingTraceDetails = {
        ...itemDiagnostic,
        chunkCount: chunks.length,
        charCount: chunks.reduce((sum, chunk) => sum + chunk.chunkText.length, 0),
      };
      embeddingTrace('query:completed', {
        ...contentDetails,
        stage: 'query',
        phase: 'chunks',
        elapsedMs: Date.now() - itemStartedAt,
      });
      // Race guard: chunks may have been replaced/cleared since the backlog
      // query — an item without chunks must not become 'embedded'.
      if (chunks.length > 0) {
        itemPhase = 'embedding';
        await embedChunks(db, itemId, chunks, config, embed, itemDiagnostic);
        emitDomainEvent('item-embedded', { platform, platformItemId });
      }
      embeddingTrace('item:completed', {
        ...contentDetails,
        phase: chunks.length > 0 ? 'embedded' : 'no-chunks',
        elapsedMs: Date.now() - itemStartedAt,
      });
    } catch (err) {
      failed += 1;
      const failureDetails: EmbeddingTraceDetails = {
        ...itemDiagnostic,
        phase: itemPhase,
        elapsedMs: Date.now() - itemStartedAt,
      };
      if (itemPhase === 'embedding') {
        embeddingTrace('item:failed', failureDetails);
      } else {
        embeddingTraceError('item:failed', err, failureDetails);
      }
    }
    done += 1;
    onProgress?.({ done, total, failed });
    embeddingTrace('backlog:progress', {
      ...diagnostic,
      done,
      total,
      failed,
      elapsedMs: Date.now() - startedAt,
    });
  }

  if (failed > 0) {
    const error = new Error(`Embedding failed for ${failed}/${total} items`);
    embeddingTraceError('backlog:failed', error, {
      ...diagnostic,
      done,
      total,
      failed,
      elapsedMs: Date.now() - startedAt,
    });
    throw error;
  }
  embeddingTrace('backlog:completed', {
    ...diagnostic,
    done,
    total,
    failed,
    elapsedMs: Date.now() - startedAt,
  });
}
