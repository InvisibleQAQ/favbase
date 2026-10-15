import { generateObject, NoObjectGeneratedError, type LanguageModelUsage } from 'ai';
import { z } from 'zod';
import { createLanguageModel, supportsSchemaDelivery } from '@/lib/ai';
import type { ResolvedTaggingConfig } from './config';
import { TAGGING_SYSTEM_PROMPT, buildTaggingPrompt, MAX_TAGS, type TaggingInput } from './prompt';

const tagsSchema = z.object({
  tags: z
    .array(z.string())
    .max(MAX_TAGS)
    .describe('3-5个核心关键词标签，中文2-5字或英文1-3个单词，简洁有辨识度'),
});

export interface GeneratedTags {
  tags: string[];
  /** Input + output tokens the call cost (docs/41 D3). */
  tokens: number;
}

/**
 * A tagging call that failed after the endpoint answered, so it was billed.
 * `tokens` is what it cost, `cause` the original error. Failures that never got
 * an answer (HTTP, network) are rethrown unchanged: there is nothing to charge.
 */
export class TaggingSpendError extends Error {
  readonly tokens: number;

  constructor(tokens: number, cause: unknown) {
    super(`Tagging call failed after spending ${tokens} tokens`, { cause });
    this.name = 'TaggingSpendError';
    this.tokens = tokens;
  }
}

/** Code-level safety net behind the prompt rules: trim + dedupe + cap. */
export function normalizeTags(raw: string[]): string[] {
  return [...new Set(raw.map((tag) => tag.trim()).filter(Boolean))].slice(0, MAX_TAGS);
}

/**
 * The reported count, or the text's character count when the endpoint reports
 * none. A reported 0 counts as none: openai-compatible providers turn a missing
 * count into 0, and an answered call never costs zero tokens.
 */
function tokensOrChars(reported: number | undefined, text: string): number {
  return reported !== undefined && Number.isFinite(reported) && reported > 0
    ? reported
    : text.length;
}

/**
 * Input + output tokens, each field estimated from characters on its own when
 * missing. Characters over-count English about fourfold, which is the safe
 * direction for a budget.
 */
function spentTokens(
  usage: LanguageModelUsage | undefined,
  sentText: string,
  answerText: string,
): number {
  return tokensOrChars(usage?.inputTokens, sentText) + tokensOrChars(usage?.outputTokens, answerText);
}

/** A NoObjectGeneratedError was answered and billed, so it leaves as a TaggingSpendError. */
async function billedCall<T>(sentText: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (!NoObjectGeneratedError.isInstance(err)) throw err;
    throw new TaggingSpendError(spentTokens(err.usage, sentText, err.text ?? ''), err);
  }
}

/**
 * One structured-output LLM call → normalized tag names plus what the call
 * cost. Low temperature — tagging wants deterministic extraction, not
 * creativity. Throws on failure (a billed failure as `TaggingSpendError`); the
 * service layer decides what a failure means.
 */
export async function generateTags(
  config: ResolvedTaggingConfig,
  input: TaggingInput,
  existingTags: string[],
): Promise<GeneratedTags> {
  const model = createLanguageModel({
    providerId: config.providerId,
    apiKey: config.apiKey,
    model: config.model,
    customBaseUrl: config.customBaseUrl,
    customProtocol: config.customProtocol,
  });

  const system = TAGGING_SYSTEM_PROMPT;
  const prompt = buildTaggingPrompt(input, existingTags);
  const sentText = system + prompt;

  if (supportsSchemaDelivery(config.providerId, config.customProtocol)) {
    // Schema actually reaches the model (native structured outputs / json_schema).
    const { object, usage } = await billedCall(sentText, () =>
      generateObject({
        model,
        schema: tagsSchema,
        system,
        prompt,
        temperature: 0.2,
      }),
    );
    return {
      tags: normalizeTags(object.tags),
      tokens: spentTokens(usage, sentText, JSON.stringify(object)),
    };
  }

  // json_object mode: the schema never reaches the model — the prompt is the
  // only schema carrier (prompt.ts spells out the JSON shape). 'no-schema'
  // avoids the SDK's responseFormat warning while keeping the exact same
  // request body (`response_format: json_object`). Zod parse is the client-side
  // safety net; a malformed shape throws and the service layer decides.
  const { object, usage } = await billedCall(sentText, () =>
    generateObject({
      model,
      output: 'no-schema',
      system,
      prompt,
      temperature: 0.2,
    }),
  );
  const tokens = spentTokens(usage, sentText, JSON.stringify(object));
  const parsed = tagsSchema.safeParse(object);
  // The call was answered and billed; only our own shape check rejected it.
  if (!parsed.success) throw new TaggingSpendError(tokens, parsed.error);
  return { tags: normalizeTags(parsed.data.tags), tokens };
}
