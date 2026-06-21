import { generateText } from 'ai';
import { createLanguageModel } from './provider-factory';
import type { LLMProviderId } from '@/lib/providers';

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
