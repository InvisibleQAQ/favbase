import { tool } from 'ai';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { FavbaseDb } from '@/lib/database';
import * as schema from '@/lib/database/schema';
import { COLLECTION_PLATFORMS, type CollectionPlatform } from '@/lib/collections/platforms';
import { PLATFORM_DESCRIPTORS } from '@/lib/collections/platform-descriptor';
// Leaves, never the `@/lib/collections` barrel: that barrel goes through
// `collections-query` and drags drizzle plus `@/lib/database` (and with it
// PGlite) into every importer — including this Background Service Worker graph.
import {
  getAllProcessingCoverage,
  getProcessingCoverage,
  type ProcessingCoverage,
} from '@/lib/collections/processing-coverage';
import { deriveConfigurationBlockers } from '@/lib/collections/configuration-blockers';
import { resolveEmbeddingConfig } from '@/lib/embedding/config';
import { settingsStorage } from '@/lib/storage/settings';
import { resolveLlmConfig } from '@/lib/storage/resolve';
// Static on purpose: these tools also run inside the Background Service
// Worker (Agent Bridge), and a Service Worker cannot use dynamic `import()`
// (disallowed on ServiceWorkerGlobalScope by the HTML specification).
import { getAllUsedTags } from '@/lib/tagging/tag-queries';
import { hybridRetrieve } from './retrieval';

const { itemContents } = schema;

/** Default top-K for the knowledge-base search when the model omits it. */
const DEFAULT_TOP_K = 8;

/**
 * The platform discriminators spelled out for the model, derived so a newly
 * onboarded platform reaches the prompt at the same moment it reaches
 * `z.enum(COLLECTION_PLATFORMS)`. Hand-writing this list is how the schema
 * ends up accepting a platform the model was never told exists.
 *
 * Ids, not display names: display names live in `PLATFORM_META.title` as
 * `LocaleKeys` under `entrypoints/app/`, which `lib/` must not import. The
 * model maps 「B站」→ `bilibili` on its own.
 */
const PLATFORM_LIST = COLLECTION_PLATFORMS.join('/');

/**
 * The distinct Content-stage artefacts across platforms, derived the same way
 * and for the same reason as `PLATFORM_LIST`. Spelling these out lets the model
 * report 「已转录」 instead of the meaningless 「已完成正文获取」.
 */
const CONTENT_KIND_LIST = [
  ...new Set(COLLECTION_PLATFORMS.map((platform) => PLATFORM_DESCRIPTORS[platform].contentKind)),
].join('/');

/**
 * Object flowed into `streamText({ experimental_context })` and read back inside
 * each tool's `execute`. Keeps the read-only DB handle off the model wire. Treat
 * as immutable inside tools (parallel calls share it).
 */
export interface ChatToolContext {
  db: FavbaseDb;
}

/** Narrow `experimental_context` to the chat DB handle (fail loud if missing). */
function contextDb(experimental_context: unknown): FavbaseDb {
  const ctx = experimental_context as ChatToolContext | undefined;
  if (!ctx?.db) {
    throw new Error('[chat] tool executed without a db in experimental_context');
  }
  return ctx.db;
}

/**
 * Hybrid semantic + keyword retrieval over the user's local collection. This is
 * the primary grounding tool — the assistant MUST call it before answering any
 * question about the user's saved content. Read-only (SELECT only).
 */
const searchKnowledgeBase = tool({
  description:
    `在用户的本地收藏知识库里做混合检索（pgvector 语义 + trigram 关键词），覆盖 ${PLATFORM_LIST} 的收藏内容。回答任何关于"用户收藏了什么/某个话题/某篇文章/某个视频"的问题前，必须先调用它，不要凭记忆作答。返回命中的收藏片段及其来源标题、链接与相关度分数。知识库为空或无相关内容时 count 为 0。`,
  inputSchema: z.object({
    query: z.string(),
    platform: z.enum(COLLECTION_PLATFORMS).optional(),
    tag_id: z.string().optional(),
    top_k: z.number().int().min(1).max(20).optional(),
  }).describe(
    '检索参数。query=用户问题的检索关键词或自然语言描述（中英皆可，如 "机器学习入门教程"）；' +
      `platform=可选，限定单个收藏平台，取值之一 ${PLATFORM_LIST}，不确定时省略；` +
      'tag_id=可选，限定携带该标签 id 的收藏项，id 来自 listTags 返回，不确定时省略；' +
      'top_k=可选，返回的最大命中数（整数，1-20，默认 8）。',
  ),
  execute: async ({ query, platform, tag_id, top_k }, { experimental_context }) => {
    const db = contextDb(experimental_context);
    const hits = await hybridRetrieve(db, query, {
      platform,
      tagId: tag_id,
      topK: top_k ?? DEFAULT_TOP_K,
    });
    return {
      count: hits.length,
      results: hits.map((h) => ({
        item_id: h.item.id,
        title: h.item.title,
        url: h.item.url,
        platform: h.item.platform,
        chunk_text: h.chunkText,
        score: h.score,
      })),
    };
  },
});

/**
 * Read the full plain-text body of one collected item. Call when a
 * searchKnowledgeBase snippet is too short to answer and the full source text is
 * needed. Read-only (SELECT only).
 */
const getItemContent = tool({
  description:
    '按收藏项 id 读取其完整正文全文。当 searchKnowledgeBase 返回的某条片段不足以回答、需要该来源的完整内容时调用。found=false 表示该项没有已提取的正文。',
  inputSchema: z.object({
    item_id: z.string(),
  }).describe(
    '读取参数。item_id=收藏项的 id 字符串，来自 searchKnowledgeBase 结果中的 item_id 字段。',
  ),
  execute: async ({ item_id }, { experimental_context }) => {
    const db = contextDb(experimental_context);
    const rows = await db
      .select({ plainText: itemContents.plainText })
      .from(itemContents)
      .where(eq(itemContents.itemId, item_id))
      .limit(1);
    const found = rows.length > 0;
    return {
      found,
      item_id,
      content: found ? rows[0].plainText : '',
    };
  },
});

/**
 * List the tags in use across the knowledge base with per-tag item counts. Call
 * to discover topics or to narrow a later searchKnowledgeBase via `tag_id`.
 * Read-only (SELECT only).
 */
const listTags = tool({
  description:
    '列出知识库中已使用的标签及各自的收藏项数量（count 降序）。当需要了解知识库有哪些主题、或想用某标签缩小 searchKnowledgeBase 的检索范围时调用。返回的 tag id 可作为 searchKnowledgeBase 的 tag_id 参数。',
  inputSchema: z.object({
    platform: z.enum(COLLECTION_PLATFORMS).optional(),
  }).describe(
    `统计参数。platform=可选，只统计某个平台的标签，取值之一 ${PLATFORM_LIST}；省略则统计全部平台。`,
  ),
  execute: async ({ platform }, { experimental_context }) => {
    const db = contextDb(experimental_context);
    const tags = await getAllUsedTags(platform, db);
    return {
      count: tags.length,
      tags: tags.map((tg) => ({ id: tg.id, name: tg.name, count: tg.count })),
    };
  },
});

/**
 * Per-platform Processing Coverage plus the count-derived reasons a stage is
 * stalled. Call when a search comes back empty or visibly thin: "nothing saved"
 * and "saved but not processed yet" need different answers, and an unconfigured
 * provider means the backlog will never drain on its own. Read-only (SELECT
 * only).
 *
 * `blockers` is deliberately *not* exhaustive, and the description says so: the
 * Content stage's own readiness is a platform state-machine wait signal that no
 * Knowledge Tool can see (PRD D4), so a backlog stuck there reports an empty
 * `blockers`. Left unsaid, the model would read empty `blockers` as "still
 * working, try later" — the exact answer this tool exists to prevent.
 */
const getProcessingCoverageTool = tool({
  description:
    `列出用户收藏库各平台的处理进度（${PLATFORM_LIST}）：已拉取条数、正文获取、Embedding 向量化、AI 标签四个阶段各自的 done/total，以及 blockers（缺失的 provider 配置）。当 searchKnowledgeBase 返回 count 为 0、或命中结果明显偏少时调用它，据此区分「用户确实没收藏这个主题」与「收藏了但 AI 还没处理完」，并把真实进度告诉用户。` +
    `content.kind 说明该平台的「正文」具体是什么（取值之一 ${CONTENT_KIND_LIST}），据此选用贴切的说法，例如 transcript 就说「已转录」而不是「已完成正文获取」。` +
    'acquisition.total 恒为 null：平台不提供可靠的远端总数，所以只能说「已拉取 N 条」，不得声称收藏已同步完整。' +
    'blockers 非空表示该阶段缺 provider 配置、不会自行推进，此时应提示用户去设置页配置，而不是让用户稍后再试。' +
    'blockers 只判定 embedding（向量化）与 llm（AI 标签）两项能力；正文阶段的 provider 就绪状态本工具看不到，所以 blockers 为空只说明这两段没被配置卡住，不能推断正文会自行推进——若 content.done 长期停在同一数字，同样要让用户去设置页确认正文/转录 provider，别只说稍后再试。',
  inputSchema: z.object({
    platform: z.enum(COLLECTION_PLATFORMS).optional(),
  }).describe(
    `进度参数。platform=可选，只看某个平台，取值之一 ${PLATFORM_LIST}；省略则返回全部平台（含一条都没同步过的平台，其计数为 0）。`,
  ),
  execute: async ({ platform }, { experimental_context }) => {
    const db = contextDb(experimental_context);
    const settings = await settingsStorage.getValue();
    const embeddingConfigured = resolveEmbeddingConfig(settings).enabled;
    const llmConfigured = resolveLlmConfig(settings).enabled;
    const coverages: Array<[CollectionPlatform, ProcessingCoverage]> = platform
      ? [[platform, await getProcessingCoverage(platform, db)]]
      : Object.entries(await getAllProcessingCoverage(db)) as Array<
          [CollectionPlatform, ProcessingCoverage]
        >;

    return {
      platforms: coverages.map(([id, coverage]) => ({
        platform: id,
        acquisition: coverage.acquisition,
        content: { ...coverage.content, kind: PLATFORM_DESCRIPTORS[id].contentKind },
        embedding: coverage.embedding,
        tagging: coverage.tagging,
        blockers: deriveConfigurationBlockers({
          coverage,
          // The ASR blocker is raised by the Bilibili state machine's wait
          // signal, which no Knowledge Tool can see; only the two
          // count-derived capabilities are reportable here.
          asrBlocked: false,
          asrConfigured: false,
          embeddingConfigured,
          llmConfigured,
        }),
      })),
    };
  },
});

/**
 * Read-only chat tool registry. The object KEY is the tool name the model sees
 * (referenced by that name in the system prompt).
 */
export const chatTools = {
  searchKnowledgeBase,
  getItemContent,
  listTags,
  getProcessingCoverage: getProcessingCoverageTool,
};
