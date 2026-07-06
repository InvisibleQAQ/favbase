/**
 * The single contract between content-type chunkers and the content-agnostic
 * indexing orchestrator (`indexItemChunks`). Any platform/content type plugs in
 * by producing `ChunkInput[]` — subtitle chunker sets the time span, article
 * chunkers (future Zhihu etc.) leave it undefined (stored as NULL).
 *
 * Timestamps are metadata ONLY: they go into the `start_sec`/`end_sec` columns
 * and must never be mixed into `text` (would pollute the embedding vector).
 */
export interface ChunkInput {
  text: string;
  startSec?: number;
  endSec?: number;
}
