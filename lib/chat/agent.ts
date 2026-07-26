import { streamText, stepCountIs } from 'ai';
import type { LanguageModel, ModelMessage } from 'ai';
import type { FavbaseDb } from '@/lib/database';
import { chatTools, type ChatToolContext } from './tools';
import { CHAT_SYSTEM_PROMPT, buildContextSuffix } from './prompts';

/**
 * ReAct step cap. `streamText`/`generateText` default to `stepCountIs(1)` (single
 * step — the #1 v6 trap): without an explicit `stopWhen` the loop stops after the
 * first tool call and never reads the observation. 8 leaves fault tolerance for a
 * short-chain conversational agent (see research/react-course-principles.md §1).
 */
const MAX_STEPS = 8;

/** Temperature for the chat agent — low for stable tool-selection reasoning. */
const TEMPERATURE = 0.3;

export interface CreateChatStreamParams {
  model: LanguageModel;
  /** Conversation so far (user + prior assistant/tool turns), model format. */
  messages: ModelMessage[];
  /** Read-only DB handle injected into every tool via `experimental_context`. */
  db: FavbaseDb;
  /** Current time, injected into the system prompt so relative-time is grounded. */
  now: Date;
  /** Abort the whole multi-step stream (composer "stop" button). */
  abortSignal?: AbortSignal;
}

/**
 * Build the agent stream: multi-step tool-calling (industrialized ReAct) driven
 * by the SDK. The model emits structured tool calls, the SDK executes them and
 * feeds results back until it produces a plain-text answer or hits `MAX_STEPS`.
 * The DB handle rides `experimental_context` (off the model wire); tools are
 * read-only. Returns the `StreamTextResult` for the hook to consume `fullStream`.
 */
export function createChatStream(params: CreateChatStreamParams) {
  const { model, messages, db, now, abortSignal } = params;
  const system = `${CHAT_SYSTEM_PROMPT}\n\n${buildContextSuffix({ now })}`;

  return streamText({
    model,
    system,
    messages,
    tools: chatTools,
    stopWhen: stepCountIs(MAX_STEPS),
    temperature: TEMPERATURE,
    experimental_context: { db } satisfies ChatToolContext,
    abortSignal,
  });
}
