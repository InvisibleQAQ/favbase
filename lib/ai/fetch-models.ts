import type { LLMProviderId } from '@/lib/providers';
import { getProviderDef } from '@/lib/providers';

export interface FetchModelsResult {
  models: string[];
  error?: string;
}

function resolveModelsEndpoint(
  providerId: LLMProviderId,
  baseUrl: string,
): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (providerId === 'claude') {
    return `${normalized}/v1/models`;
  }
  return `${normalized}/models`;
}

function buildHeaders(
  providerId: LLMProviderId,
  apiKey: string,
): Record<string, string> {
  if (!apiKey) return {};
  const def = getProviderDef(providerId);

  if (providerId === 'claude') {
    return {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  if (providerId === 'gemini') {
    return { 'x-goog-api-key': apiKey };
  }

  return { [def.headerKey]: `${def.tokenPrefix}${apiKey}` };
}

function extractModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];

  const obj = payload as Record<string, unknown>;

  if (Array.isArray(obj.data)) {
    return obj.data
      .map((m: unknown) => {
        if (typeof m === 'string') return m;
        if (m && typeof m === 'object' && 'id' in m) return String((m as { id: unknown }).id);
        return null;
      })
      .filter((id): id is string => id !== null)
      .sort();
  }

  // Google Gemini returns { models: [{ name: "models/gemini-2.0-flash", ... }] }
  // Strip "models/" prefix so the ID matches AI SDK expectations
  if (Array.isArray(obj.models)) {
    return obj.models
      .map((m: unknown) => {
        if (typeof m === 'string') return m;
        if (m && typeof m === 'object' && 'name' in m) {
          const name = String((m as { name: unknown }).name);
          return name.startsWith('models/') ? name.slice('models/'.length) : name;
        }
        if (m && typeof m === 'object' && 'id' in m) return String((m as { id: unknown }).id);
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

  const endpoint = resolveModelsEndpoint(providerId, baseUrl);
  const headers = buildHeaders(providerId, apiKey);

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
