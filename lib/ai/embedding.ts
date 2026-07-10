import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { embed, embedMany, type EmbeddingModel } from 'ai';
import type { EmbeddingProviderId, SdkType } from '@/lib/providers';
import { getEmbeddingProviderDef } from '@/lib/providers';

// NOTE: There is no canonical embedding dimension anymore. The
// `item_chunks.embedding` column follows the active model — the vector store
// (`lib/embedding/vector-store.ts`) lazily re-dimensions the column when a new
// batch's dimension differs, and rejects anything above the HNSW index cap
// (`MAX_INDEXABLE_DIMENSIONS`, 2000).

// ---------------------------------------------------------------------------
// createEmbeddingModel
// ---------------------------------------------------------------------------

export interface CreateEmbeddingModelOptions {
  providerId: EmbeddingProviderId;
  apiKey: string;
  baseUrl?: string;
  model: string;
}

/**
 * Build an AI SDK text-embedding model. Branch is data-driven off the provider's
 * `sdkType` (mirrors `createLanguageModel` in `./index.ts`).
 */
export function createEmbeddingModel(
  options: CreateEmbeddingModelOptions,
): EmbeddingModel {
  const { providerId, apiKey, baseUrl, model } = options;
  const def = getEmbeddingProviderDef(providerId);
  const resolvedBaseUrl = baseUrl || def.baseUrl;

  return createModelBySdkType(def.sdkType, {
    providerId,
    apiKey,
    baseUrl: resolvedBaseUrl,
    model,
  });
}

function createModelBySdkType(
  sdkType: SdkType,
  opts: { providerId: string; apiKey: string; baseUrl: string; model: string },
): EmbeddingModel {
  switch (sdkType) {
    case 'openai':
      return createOpenAI({ apiKey: opts.apiKey }).textEmbeddingModel(opts.model);

    case 'google':
      return createGoogleGenerativeAI({ apiKey: opts.apiKey }).textEmbeddingModel(
        opts.model,
      );

    // anthropic has no embedding endpoint; treat it as openai-compatible fallback
    case 'anthropic':
    case 'openai-compatible':
      return createOpenAICompatible({
        name: opts.providerId,
        baseURL: opts.baseUrl,
        headers: opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {},
      }).textEmbeddingModel(opts.model);
  }
}

// ---------------------------------------------------------------------------
// embedText / embedTexts
// ---------------------------------------------------------------------------

/** Embed a single string. Empty/blank input is rejected (no wasted request). */
export async function embedText(
  model: EmbeddingModel,
  text: string,
): Promise<number[]> {
  const { embedding } = await embed({ model, value: text });
  return embedding;
}

/** Embed a batch of strings. Empty array short-circuits to `[]`. */
export async function embedTexts(
  model: EmbeddingModel,
  texts: string[],
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({ model, values: texts });
  return embeddings;
}

// ---------------------------------------------------------------------------
// testEmbeddingConnection
// ---------------------------------------------------------------------------

export interface TestEmbeddingResult {
  success: boolean;
  message: string;
  /** Actual vector length returned by the provider (for dimension warnings). */
  dimensions: number;
}

/**
 * Probe a provider by embedding a short string. Returns the real vector length
 * so the UI can validate it against the HNSW index cap (2000, see
 * `MAX_INDEXABLE_DIMENSIONS` in `lib/embedding`). Mirrors `testLlmConnection`
 * but adds `dimensions`.
 */
export async function testEmbeddingConnection(
  options: CreateEmbeddingModelOptions,
): Promise<TestEmbeddingResult> {
  const model = createEmbeddingModel(options);
  const vector = await embedText(model, 'favbase connection test');

  return {
    success: true,
    message: `Embedded probe vector (${vector.length} dimensions)`,
    dimensions: vector.length,
  };
}
