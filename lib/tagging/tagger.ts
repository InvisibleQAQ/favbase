import { generateObject } from 'ai';
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

  const system = TAGGING_SYSTEM_PROMPT;
  const prompt = buildTaggingPrompt(input, existingTags);

  if (supportsSchemaDelivery(config.providerId, config.customProtocol)) {
    // Schema actually reaches the model (native structured outputs / json_schema).
    const { object } = await generateObject({
      model,
      schema: tagsSchema,
      system,
      prompt,
      temperature: 0.2,
    });
    return normalizeTags(object.tags);
  }

  // json_object mode: the schema never reaches the model — the prompt is the
  // only schema carrier (prompt.ts spells out the JSON shape). 'no-schema'
  // avoids the SDK's responseFormat warning while keeping the exact same
  // request body (`response_format: json_object`). Zod parse is the client-side
  // safety net; a malformed shape throws and the service layer decides.
  const { object } = await generateObject({
    model,
    output: 'no-schema',
    system,
    prompt,
    temperature: 0.2,
  });
  return normalizeTags(tagsSchema.parse(object).tags);
}
