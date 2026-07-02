import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { embed, embedMany, type EmbeddingModel } from 'ai';
import type { EmbeddingProviderId, SdkType } from '@/lib/providers';
import { getEmbeddingProviderDef } from '@/lib/providers';

// `ProviderOptions` is not re-exported by `ai`; derive it from `embed`'s params
// so it stays in sync with the installed SDK without a direct provider-utils dep.
type EmbedProviderOptions = NonNullable<Parameters<typeof embed>[0]['providerOptions']>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Canonical embedding dimension. The `item_chunks.embedding` column is fixed at
 * VECTOR(1536) with an ANN index, so all vectors written to the store MUST be
 * this length. OpenAI-family models are asked for this dimension explicitly via
 * `providerOptions.openai.dimensions`; other providers return their model's
 * native dimension and are validated at the VectorStore boundary.
 */
export const EMBEDDING_DIMENSIONS = 1536;

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
// providerOptions (dimension pinning for openai-family)
// ---------------------------------------------------------------------------

/**
 * Ask openai-family models to return `EMBEDDING_DIMENSIONS`-length vectors.
 * Only OpenAI's text-embedding-3-* models honor the `dimensions` option; other
 * SDKs ignore an unknown key, so passing it is harmless.
 */
function embeddingProviderOptions(
  providerId: EmbeddingProviderId,
): EmbedProviderOptions | undefined {
  const def = getEmbeddingProviderDef(providerId);
  if (def.sdkType === 'openai') {
    return { openai: { dimensions: EMBEDDING_DIMENSIONS } };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// embedText / embedTexts
// ---------------------------------------------------------------------------

/** Embed a single string. Empty/blank input is rejected (no wasted request). */
export async function embedText(
  model: EmbeddingModel,
  text: string,
  providerId?: EmbeddingProviderId,
): Promise<number[]> {
  const providerOptions = providerId ? embeddingProviderOptions(providerId) : undefined;
  const { embedding } = await embed({
    model,
    value: text,
    ...(providerOptions ? { providerOptions } : {}),
  });
  return embedding;
}

/** Embed a batch of strings. Empty array short-circuits to `[]`. */
export async function embedTexts(
  model: EmbeddingModel,
  texts: string[],
  providerId?: EmbeddingProviderId,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const providerOptions = providerId ? embeddingProviderOptions(providerId) : undefined;
  const { embeddings } = await embedMany({
    model,
    values: texts,
    ...(providerOptions ? { providerOptions } : {}),
  });
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
 * so the UI can warn when `dimensions !== EMBEDDING_DIMENSIONS` (the fixed
 * pgvector column width). Mirrors `testLlmConnection` but adds `dimensions`.
 */
export async function testEmbeddingConnection(
  options: CreateEmbeddingModelOptions,
): Promise<TestEmbeddingResult> {
  const model = createEmbeddingModel(options);
  const vector = await embedText(model, 'favbase connection test', options.providerId);

  return {
    success: true,
    message: `Embedded probe vector (${vector.length} dimensions)`,
    dimensions: vector.length,
  };
}
