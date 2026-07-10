// Domain layer: pgvector-backed embedding store + config resolution.
// Infra (provider/client factory, embed*, testEmbeddingConnection) lives in
// `@/lib/ai` and is re-exported here for a single import surface.

export {
  createEmbeddingModel,
  embedText,
  embedTexts,
  embeddingProviderOptions,
  testEmbeddingConnection,
  type CreateEmbeddingModelOptions,
  type EmbedOptions,
  type TestEmbeddingOptions,
  type TestEmbeddingResult,
} from '@/lib/ai';

export {
  resolveEmbeddingConfig,
  getEmbeddingSettings,
  type ResolvedEmbeddingConfig,
} from './config';

export {
  EmbeddingDimensionError,
  EmbeddingDimensionLimitError,
  MAX_INDEXABLE_DIMENSIONS,
} from './errors';

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
  getEmbeddingColumnDimensions,
  alterEmbeddingDimensions,
  deleteItemEmbeddings,
  clearAllEmbeddings,
  getEmbeddingStats,
  type ReplacedChunk,
  type ChunkEmbeddingEntry,
  type SemanticSearchOptions,
  type SemanticSearchHit,
  type EmbeddingStats,
} from './vector-store';
