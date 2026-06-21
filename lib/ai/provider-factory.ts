import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { LLMProviderId } from '@/lib/providers';
import { getProviderDef } from '@/lib/providers';

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

  switch (providerId) {
    case 'openai':
      // AI SDK default is https://api.openai.com/v1; let it handle defaults
      return createOpenAI({ apiKey })(model);

    case 'claude':
      // AI SDK default is https://api.anthropic.com/v1; don't override with a wrong base
      return createAnthropic({ apiKey })(model);

    case 'gemini':
      // AI SDK default is https://generativelanguage.googleapis.com/v1beta; let it handle defaults
      return createGoogleGenerativeAI({ apiKey })(model);

    case 'custom': {
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

    default:
      return createOpenAICompatible({
        name: providerId,
        baseURL: def.baseUrl,
        headers: apiKey
          ? { [def.headerKey]: `${def.tokenPrefix}${apiKey}` }
          : {},
      }).chatModel(model);
  }
}
