/**
 * The single contract between content-type chunkers and chunk persistence
 * (`replaceItemChunks`, called by `lib/ingest`). Any platform/content type
 * plugs in by producing `ChunkInput[]` — the subtitle chunker sets the time
 * span, text chunkers leave it undefined (stored as NULL).
 *
 * Timestamps are metadata ONLY: they go into the `start_sec`/`end_sec` columns
 * and must never be mixed into `text` (would pollute the embedding vector).
 */
export interface ChunkInput {
  text: string;
  startSec?: number;
  endSec?: number;
}
