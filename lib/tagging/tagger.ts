import { generateObject } from 'ai';
import { z } from 'zod';
import { createLanguageModel } from '@/lib/ai';
import type { ResolvedTaggingConfig } from './config';
import { TAGGING_SYSTEM_PROMPT, buildTaggingPrompt, MAX_TAGS, type TaggingInput } from './prompt';

const tagsSchema = z.object({
  tags: z
    .array(z.string())
    .max(MAX_TAGS)
    .describe('3-5个核心关键词标签，中文2-5字或英文1-3个单词，简洁有辨识度'),
});

/** Code-level safety net behind the prompt rules: trim + dedupe + cap. */
export function normalizeTags(raw: string[]): string[] {
  return [...new Set(raw.map((tag) => tag.trim()).filter(Boolean))].slice(0, MAX_TAGS);
}

/**
 * One structured-output LLM call → normalized tag names. Low temperature —
 * tagging wants deterministic extraction, not creativity. Throws on LLM
 * failure; the service layer decides what a failure means.
 */
export async function generateTags(
  config: ResolvedTaggingConfig,
  input: TaggingInput,
  existingTags: string[],
): Promise<string[]> {
  const model = createLanguageModel({
    providerId: config.providerId,
    apiKey: config.apiKey,
    model: config.model,
    customBaseUrl: config.customBaseUrl,
    customProtocol: config.customProtocol,
  });

  const { object } = await generateObject({
    model,
    schema: tagsSchema,
    system: TAGGING_SYSTEM_PROMPT,
    prompt: buildTaggingPrompt(input, existingTags),
    temperature: 0.2,
  });

  return normalizeTags(object.tags);
}
