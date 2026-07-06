// Domain layer: pgvector-backed embedding store + config resolution.
// Infra (provider/client factory, embed*, testEmbeddingConnection,
// EMBEDDING_DIMENSIONS) lives in `@/lib/ai` and is re-exported here for a single
// import surface.

export {
  EMBEDDING_DIMENSIONS,
  createEmbeddingModel,
  embedText,
  embedTexts,
  testEmbeddingConnection,
  type CreateEmbeddingModelOptions,
  type TestEmbeddingResult,
} from '@/lib/ai';

export {
  resolveEmbeddingConfig,
  getEmbeddingSettings,
  type ResolvedEmbeddingConfig,
} from './config';

export { EmbeddingDimensionError } from './errors';

export type { ChunkInput } from './types';

export { chunkSubtitleRows, type ChunkerOptions } from './chunker';

export {
  indexItemChunks,
  type IndexingDeps,
  type IndexedContentState,
} from './indexing';

export {
  toSqlVector,
  replaceItemChunks,
  upsertChunkEmbeddings,
  semanticSearchChunks,
  deleteItemEmbeddings,
  clearAllEmbeddings,
  getEmbeddingStats,
  type ReplacedChunk,
  type ChunkEmbeddingEntry,
  type SemanticSearchOptions,
  type SemanticSearchHit,
  type EmbeddingStats,
} from './vector-store';
