import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { embed, embedMany, type EmbeddingModel } from 'ai';
import type { EmbeddingProviderId, SdkType } from '@/lib/providers';
import { getEmbeddingProviderDef } from '@/lib/providers';

const EMBEDDING_REQUEST_TIMEOUT_MS = 60_000;

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

/** Per-call options for `embedText` / `embedTexts`. */
export interface EmbedOptions {
  providerId: EmbeddingProviderId;
  /**
   * Optional output truncation (Matryoshka). `undefined` = model native
   * dimension. Forwarded via providerOptions to providers that support it;
   * see `embeddingProviderOptions`.
   */
  dimensions?: number;
}

/**
 * Build the per-call `providerOptions` that forward the optional `dimensions`
 * truncation. Key/field per sdkType, verified against local SDK sources:
 *
 * - `openai` → `{ openai: { dimensions } }` — @ai-sdk/openai puts it verbatim
 *   into the POST /embeddings body (`dist/index.mjs`, ~L1719 in 3.0.73).
 * - `google` → `{ google: { outputDimensionality } }` — @ai-sdk/google parses
 *   `providerOptions.google` and sends `outputDimensionality` (truncates the
 *   output embedding from the end). Google does NOT re-normalize truncated
 *   vectors — harmless here: pgvector's `<=>` cosine distance divides by the
 *   norms internally, so ranking is scale-invariant. Do not switch semantic
 *   search to inner product (`<#>`) without re-normalizing.
 * - `openai-compatible` (and the anthropic fallback) →
 *   `{ [providerId]: { dimensions } }` — @ai-sdk/openai-compatible 2.0.51
 *   parses `providerOptions[config.provider.split('.')[0]]`, and
 *   `createOpenAICompatible({ name })` sets `config.provider =
 *   "${name}.embedding"`, so the key is exactly our providerId.
 *
 * Invalid values (undefined / non-positive / non-finite) return `undefined`
 * so the request carries no truncation — same filter as
 * `resolveEmbeddingConfig`, guarding direct callers too.
 */
export function embeddingProviderOptions(
  providerId: EmbeddingProviderId,
  dimensions?: number,
): Record<string, Record<string, number>> | undefined {
  if (
    dimensions === undefined ||
    typeof dimensions !== 'number' ||
    !Number.isFinite(dimensions) ||
    dimensions <= 0
  ) {
    return undefined;
  }

  const def = getEmbeddingProviderDef(providerId);
  switch (def.sdkType) {
    case 'openai':
      return { openai: { dimensions } };
    case 'google':
      return { google: { outputDimensionality: dimensions } };
    case 'anthropic':
    case 'openai-compatible':
      return { [providerId]: { dimensions } };
  }
}

/** Embed a single string. Empty/blank input is rejected (no wasted request). */
export async function embedText(
  model: EmbeddingModel,
  text: string,
  options?: EmbedOptions,
): Promise<number[]> {
  const providerOptions = options
    ? embeddingProviderOptions(options.providerId, options.dimensions)
    : undefined;
  const { embedding } = await embed({
    model,
    value: text,
    providerOptions,
    abortSignal: AbortSignal.timeout(EMBEDDING_REQUEST_TIMEOUT_MS),
  });
  return embedding;
}

/** Embed a batch of strings. Empty array short-circuits to `[]`. */
export async function embedTexts(
  model: EmbeddingModel,
  texts: string[],
  options?: EmbedOptions,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const providerOptions = options
    ? embeddingProviderOptions(options.providerId, options.dimensions)
    : undefined;
  const { embeddings } = await embedMany({
    model,
    values: texts,
    providerOptions,
    abortSignal: AbortSignal.timeout(EMBEDDING_REQUEST_TIMEOUT_MS),
  });
  return embeddings;
}

// ---------------------------------------------------------------------------
// testEmbeddingConnection
// ---------------------------------------------------------------------------

export interface TestEmbeddingOptions extends CreateEmbeddingModelOptions {
  /**
   * Optional output truncation — MUST match what indexing will actually send,
   * otherwise the probe reports the native dimension while real embeds store
   * the truncated one (e.g. 3-large: probe says 3072 > cap, but indexing
   * would store a valid 1024).
   */
  dimensions?: number;
}

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
 * but adds `dimensions`. The probe carries the configured truncation so it
 * reflects the dimension that would actually be stored.
 */
export async function testEmbeddingConnection(
  options: TestEmbeddingOptions,
): Promise<TestEmbeddingResult> {
  const model = createEmbeddingModel(options);
  const vector = await embedText(model, 'favbase connection test', {
    providerId: options.providerId,
    dimensions: options.dimensions,
  });

  return {
    success: true,
    message: `Embedded probe vector (${vector.length} dimensions)`,
    dimensions: vector.length,
  };
}
