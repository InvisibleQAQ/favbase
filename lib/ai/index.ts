import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, type LanguageModel } from 'ai';
import type { ASRProviderId, LLMProviderId, SdkType } from '@/lib/providers';
import { getAsrProviderDef, getProviderDef } from '@/lib/providers';

// Embedding provider/client infra (sibling module, re-exported for `@/lib/ai`).
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
} from './embedding';

// ---------------------------------------------------------------------------
// createLanguageModel
// ---------------------------------------------------------------------------

interface CreateModelOptions {
  providerId: LLMProviderId;
  apiKey: string;
  model: string;
  customBaseUrl?: string;
  customProtocol?: 'openai' | 'claude';
}

export function createLanguageModel(options: CreateModelOptions): LanguageModel {
  const { providerId, apiKey, model, customBaseUrl, customProtocol } = options;
  const def = getProviderDef(providerId);

  // custom provider: sdkType resolved at runtime from customProtocol
  if (providerId === 'custom') {
    const baseURL = customBaseUrl || def.baseUrl;
    if (customProtocol === 'claude') {
      return createAnthropic({ apiKey, baseURL })(model);
    }
    return createOpenAICompatible({
      name: 'custom',
      baseURL,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    }).chatModel(model);
  }

  return createModelBySdkType(def.sdkType, {
    providerId,
    apiKey,
    model,
    baseUrl: def.baseUrl,
  });
}

function createModelBySdkType(
  sdkType: SdkType,
  opts: { providerId: string; apiKey: string; model: string; baseUrl: string },
): LanguageModel {
  switch (sdkType) {
    case 'openai':
      return createOpenAI({ apiKey: opts.apiKey })(opts.model);

    case 'anthropic':
      return createAnthropic({ apiKey: opts.apiKey })(opts.model);

    case 'google':
      return createGoogleGenerativeAI({ apiKey: opts.apiKey })(opts.model);

    case 'openai-compatible':
      return createOpenAICompatible({
        name: opts.providerId,
        baseURL: opts.baseUrl,
        headers: opts.apiKey
          ? { Authorization: `Bearer ${opts.apiKey}` }
          : {},
      }).chatModel(opts.model);
  }
}

// ---------------------------------------------------------------------------
// testLlmConnection
// ---------------------------------------------------------------------------

export interface TestConnectionResult {
  success: boolean;
  message: string;
}

export async function testLlmConnection(options: {
  providerId: LLMProviderId;
  apiKey: string;
  model: string;
  customBaseUrl?: string;
  customProtocol?: 'openai' | 'claude';
}): Promise<TestConnectionResult> {
  const model = createLanguageModel(options);

  const { text } = await generateText({
    model,
    prompt: 'Reply with exactly "ok" and nothing else.',
    maxOutputTokens: 20,
    temperature: 0,
  });

  return {
    success: true,
    message: text.trim() || 'Connection successful',
  };
}

// ---------------------------------------------------------------------------
// testAsrConnection
// ---------------------------------------------------------------------------

/**
 * Validates the API key + endpoint reachability via `GET {baseUrl}/models`
 * (both ASR providers are OpenAI-compatible). A real transcription probe
 * would need an audio file; the models endpoint is free and instant. Note it
 * cannot validate a specific model name — only the credential.
 */
export async function testAsrConnection(options: {
  providerId: ASRProviderId;
  apiKey: string;
}): Promise<TestConnectionResult> {
  const def = getAsrProviderDef(options.providerId);
  const endpoint = `${def.baseUrl.replace(/\/+$/, '')}/models`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${options.apiKey}` },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  return { success: true, message: 'API key valid' };
}

// ---------------------------------------------------------------------------
// fetchAvailableModels
// ---------------------------------------------------------------------------

export interface FetchModelsResult {
  models: string[];
  error?: string;
}

function resolveModelsEndpoint(sdkType: SdkType, baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (sdkType === 'anthropic') {
    return `${normalized}/v1/models`;
  }
  return `${normalized}/models`;
}

function buildAuthHeaders(
  sdkType: SdkType,
  apiKey: string,
): Record<string, string> {
  if (!apiKey) return {};

  switch (sdkType) {
    case 'anthropic':
      return {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      };
    case 'google':
      return { 'x-goog-api-key': apiKey };
    case 'openai':
    case 'openai-compatible':
      return { Authorization: `Bearer ${apiKey}` };
  }
}

function extractModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];

  const obj = payload as Record<string, unknown>;

  if (Array.isArray(obj.data)) {
    return obj.data
      .map((m: unknown) => {
        if (typeof m === 'string') return m;
        if (m && typeof m === 'object' && 'id' in m)
          return String((m as { id: unknown }).id);
        return null;
      })
      .filter((id): id is string => id !== null)
      .sort();
  }

  // Google Gemini: { models: [{ name: "models/gemini-2.0-flash" }] }
  if (Array.isArray(obj.models)) {
    return obj.models
      .map((m: unknown) => {
        if (typeof m === 'string') return m;
        if (m && typeof m === 'object' && 'name' in m) {
          const name = String((m as { name: unknown }).name);
          return name.startsWith('models/') ? name.slice('models/'.length) : name;
        }
        if (m && typeof m === 'object' && 'id' in m)
          return String((m as { id: unknown }).id);
        return null;
      })
      .filter((id): id is string => id !== null)
      .sort();
  }

  return [];
}

export async function fetchAvailableModels(options: {
  providerId: LLMProviderId;
  apiKey: string;
  customBaseUrl?: string;
}): Promise<FetchModelsResult> {
  const { providerId, apiKey, customBaseUrl } = options;
  const def = getProviderDef(providerId);
  const baseUrl = (providerId === 'custom' ? customBaseUrl : def.baseUrl) || '';

  if (!baseUrl) {
    return { models: [], error: 'No base URL configured' };
  }

  const sdkType = def.sdkType;
  const endpoint = resolveModelsEndpoint(sdkType, baseUrl);
  const headers = buildAuthHeaders(sdkType, apiKey);

  const response = await fetch(endpoint, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const payload = await response.json();
  const models = extractModelIds(payload);

  return { models };
}
