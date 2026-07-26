import { streamText } from 'ai';
import { createLanguageModel } from '@/lib/ai';
import type { ResolvedSummaryConfig } from './config';
import { SUMMARY_SYSTEM_PROMPT } from './prompt';

export interface StreamSummaryOptions {
  /** Called with the FULL text accumulated so far, not the raw delta. */
  onText?: (fullText: string) => void;
  signal?: AbortSignal;
}

/**
 * One streaming LLM call. Returns the complete raw response — protocol
 * decoding is `protocol.ts`'s job, this layer stays transport-only.
 *
 * Errors (including aborts) propagate: with `textStream` the AI SDK throws
 * rather than emitting error chunks, so the service layer's try/catch maps
 * them to `SummaryErrorInfo`.
 */
export async function streamSummary(
  config: ResolvedSummaryConfig,
  prompt: string,
  options: StreamSummaryOptions = {},
): Promise<string> {
  const model = createLanguageModel({
    providerId: config.providerId,
    apiKey: config.apiKey,
    model: config.model,
    customBaseUrl: config.customBaseUrl,
    customProtocol: config.customProtocol,
  });

  const result = streamText({
    model,
    system: SUMMARY_SYSTEM_PROMPT,
    prompt,
    temperature: config.temperature,
    abortSignal: options.signal,
  });

  let full = '';
  for await (const delta of result.textStream) {
    full += delta;
    options.onText?.(full);
  }
  return full;
}
