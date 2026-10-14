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
import { searchUsedTags } from '@/lib/tagging/tag-queries';
import { hybridRetrieve } from './retrieval';

const { items, itemContents } = schema;

/**
 * `top_k` range and default. The zod chain and the model-facing describe string
 * are both built from these, so the model is never told a range the schema does
 * not enforce. SKILL.md's `--limit <min-max>` cannot import them (shipped
 * markdown), so `tests/agent-bridge-cli-aliases.test.ts` reconciles that
 * hand-written copy against the emitted JSON Schema. The CLI holds no copy.
 */
const TOP_K_MIN = 1;
const TOP_K_MAX = 20;
/** Default top-K for the knowledge-base search when the model omits it. */
const DEFAULT_TOP_K = 8;

/**
 * `listTags` `limit` range and default, the same pattern as `top_k`: the zod
 * chain, the describe string and the truncation `hint` are all built from
 * these. A real library has ~2000 tags (~110 bytes each), so an unbounded list
 * was ~210 KB. The default also applies to callers that send no `limit` at
 * all, the published CLI included: the extension cannot tell them apart.
 */
const TAG_LIMIT_MIN = 1;
const TAG_LIMIT_MAX = 200;
const DEFAULT_TAG_LIMIT = 50;

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
 *
 * Its blind spot is relevance: RRF ranks, it cannot say "nothing here is about
 * the question", so the tool almost always returns a full list. The output
 * therefore carries raw evidence (`matched_terms`, `similarity`) and the
 * description tells the model to judge from it. Output fields are additive
 * only: the published CLI prints this object verbatim.
 */
const searchKnowledgeBase = tool({
  description:
    `在用户的本地收藏知识库里做混合检索（向量语义 + 分词关键词），覆盖 ${PLATFORM_LIST} 的收藏内容。回答任何关于"用户收藏了什么/某个话题/某篇文章/某个视频"的问题前，必须先调用它，不要凭记忆作答。返回命中的收藏片段及其来源标题、链接。` +
    '同一收藏项在结果中最多出现一次，只带它最相关的一个片段；要读该收藏的完整正文，用它的 item_id 调用 getItemContent。' +
    'score 是排名融合分，只用于给本次结果排序，不是相关度：不要跨查询比较它，也不要把它当置信度。' +
    '本工具几乎总会返回结果，count 大于 0 不代表用户收藏过这个主题：要看每条结果的 matched_terms（该片段命中的检索词）、similarity（片段与查询的向量相似度，越高越接近，只在同一次调用的结果之间比较才有意义）和片段本身来判断是否相关；没有一条结果真正讲这个问题时，如实说知识库里没找到相关内容，不要拿沾边的结果凑答案。' +
    '查询宜用简短的关键词；没找到时换 2-3 种说法再查（同义词、换成另一种语言），彼此独立的改写可以并行调用。query_terms 是关键词检索实际使用的词，可据此看出查询被怎样切分；在已入库的片段里（有筛选时是筛选范围内）一次都没出现过的词，和出现在大量片段里的常见词，都不参与关键词检索，所以不会出现在其中。' +
    'semantic_search=false 表示本次只跑了关键词检索（没配置 embedding 或配置漂移），此时 similarity 全为 null，换了说法的内容更难命中。' +
    '结果为空或明显偏少有三种成因（确实没收藏、还在处理、provider 没配置所以永远不会处理），此时调用 getProcessingCoverage 区分。',
  inputSchema: z.object({
    query: z.string(),
    platform: z.enum(COLLECTION_PLATFORMS).optional(),
    tag_id: z.string().optional(),
    top_k: z.number().int().min(TOP_K_MIN).max(TOP_K_MAX).optional(),
  }).describe(
    '检索参数。query=用户问题的检索关键词或自然语言描述（中英皆可，如 "机器学习入门教程"）；' +
      `platform=可选，限定单个收藏平台，取值之一 ${PLATFORM_LIST}，不确定时省略；` +
      'tag_id=可选，限定携带该标签 id 的收藏项，id 来自 listTags 返回，不确定时省略；' +
      `top_k=可选，返回的最大命中数（整数，${TOP_K_MIN}-${TOP_K_MAX}，默认 ${DEFAULT_TOP_K}）。`,
  ),
  execute: async ({ query, platform, tag_id, top_k }, { experimental_context }) => {
    const db = contextDb(experimental_context);
    const { hits, queryTerms, semanticSearch } = await hybridRetrieve(db, query, {
      platform,
      tagId: tag_id,
      topK: top_k ?? DEFAULT_TOP_K,
    });
    return {
      count: hits.length,
      query_terms: queryTerms,
      semantic_search: semanticSearch,
      results: hits.map((h) => ({
        item_id: h.item.id,
        title: h.item.title,
        url: h.item.url,
        platform: h.item.platform,
        chunk_text: h.chunkText,
        score: h.score,
        similarity: h.similarity,
        matched_terms: h.matchedTerms,
      })),
    };
  },
});

/**
 * Read the full plain-text body of one collected item. Call when a
 * searchKnowledgeBase snippet is too short to answer and the full source text is
 * needed. Read-only (SELECT only).
 *
 * Two flags, two questions (docs/27 Step 6). `found` keeps the meaning it has
 * always had — an extracted body exists — because the published CLI's bundled
 * SKILL.md describes it and the extension and the CLI version independently.
 * `item_exists` is additive: without it a mistyped id and an item still waiting
 * for its body returned the same `found: false`, and the model could only guess
 * between "the id is wrong" and "not extracted yet".
 */
const getItemContent = tool({
  description:
    '按收藏项 id 读取其完整正文全文。当 searchKnowledgeBase 返回的某条片段不足以回答、需要该来源的完整内容时调用。' +
    'item_exists=false 表示不存在这个 id 的收藏项——是 id 错了：请重新从 searchKnowledgeBase 的结果里取 item_id，绝不能据此说「用户没收藏」。' +
    'item_exists=true 且 found=false 表示收藏项存在，但（还）没有已提取的正文：改用检索片段或标题作答；用户问处理进度时调用 getProcessingCoverage。' +
    'found=true 时 content 为完整正文。',
  inputSchema: z.object({
    item_id: z.string(),
  }).describe(
    '读取参数。item_id=收藏项的 id 字符串，来自 searchKnowledgeBase 结果中的 item_id 字段。',
  ),
  execute: async ({ item_id }, { experimental_context }) => {
    const db = contextDb(experimental_context);
    // One LEFT JOIN answers both questions. `item_contents.item_id` is both the
    // primary key and a cascading FK to `items.id`, so an item has at most one
    // body row, and a missing one comes back as a null `plain_text` (the column
    // itself is NOT NULL, so null can only mean "no row").
    const rows = await db
      .select({ plainText: itemContents.plainText })
      .from(items)
      .leftJoin(itemContents, eq(itemContents.itemId, items.id))
      .where(eq(items.id, item_id))
      .limit(1);
    const plainText = rows[0]?.plainText ?? null;
    return {
      found: plainText !== null,
      item_exists: rows.length > 0,
      item_id,
      content: plainText ?? '',
    };
  },
});

/**
 * List the tags in use with per-tag item counts, most-used first. Call to
 * discover topics or to narrow a later searchKnowledgeBase via `tag_id`.
 * Read-only (SELECT only).
 *
 * Bounded: only the first `limit` tags come back, and `query` finds a tag by
 * name instead of reading the whole list. Its blind spot is the cut itself, so
 * `total` / `truncated` / `hint` say a list was cut and the description says
 * what to do next. `hint` is the only channel that reaches an agent holding a
 * SKILL.md written before the cut existed. Output fields are additive only:
 * the published CLI prints this object verbatim.
 */
const listTags = tool({
  description:
    `列出知识库中已使用的标签及各自的收藏项数量，按收藏项数量降序、同数按名字排列。默认只返回收藏项数量最多的前 ${DEFAULT_TAG_LIMIT} 个，标签总数可能远多于此，不要把返回的列表当成全部标签。` +
    '当需要了解知识库有哪些主题、或想用某标签缩小 searchKnowledgeBase 的检索范围时调用；返回的 id 可作为 searchKnowledgeBase 的 tag_id 参数。' +
    '顶层 count 是本次返回的标签个数，total 是符合筛选条件的标签总数，tags 里每项的 count 是该标签下的收藏项数。' +
    `truncated=true 表示 total 大于 count、还有标签没返回，此时 hint 是一句说明（不截断时 hint 为 null）：要找某个主题的标签，用 query 按标签名查找；query 没命中（total 为 0）时换同义词或换成另一种语言再查；也可以调大 limit（最大 ${TAG_LIMIT_MAX}）。`,
  inputSchema: z.object({
    platform: z.enum(COLLECTION_PLATFORMS).optional(),
    query: z.string().optional(),
    limit: z.number().int().min(TAG_LIMIT_MIN).max(TAG_LIMIT_MAX).optional(),
  }).describe(
    `统计参数。platform=可选，只统计某个平台的标签，取值之一 ${PLATFORM_LIST}；省略则统计全部平台。` +
      'query=可选，按标签名查找，不区分大小写的子串匹配（如 "rust" 也命中 "Rust 异步"）；省略则不按名字过滤。' +
      `limit=可选，最多返回的标签数（整数，${TAG_LIMIT_MIN}-${TAG_LIMIT_MAX}，默认 ${DEFAULT_TAG_LIMIT}）。`,
  ),
  execute: async ({ platform, query, limit }, { experimental_context }) => {
    const db = contextDb(experimental_context);
    const { tags, total } = await searchUsedTags(
      { platform, query, limit: limit ?? DEFAULT_TAG_LIMIT },
      db,
    );
    const truncated = total > tags.length;
    return {
      count: tags.length,
      total,
      truncated,
      hint: truncated
        ? `符合条件的标签共 ${total} 个，只返回了收藏项数量最多的前 ${tags.length} 个：要找某个主题的标签，用 query 按标签名查找，或调大 limit（最大 ${TAG_LIMIT_MAX}）。`
        : null,
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
    `列出用户收藏库各平台的处理进度（${PLATFORM_LIST}）：已拉取条数、正文获取、Embedding 向量化、AI 标签四个阶段各自的 done/total，以及 blockers（缺失的 provider 配置）。当 searchKnowledgeBase 返回 count 为 0、结果都与问题无关、或命中结果明显偏少时调用它，据此区分「用户确实没收藏这个主题」与「收藏了但 AI 还没处理完」，并把真实进度告诉用户。` +
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
          // A transcription prerequisite (an ASR key, the platform's own
          // tab) is raised by a platform state machine's wait signal, which
          // no Knowledge Tool can see; only the two count-derived
          // capabilities are reportable here.
          prerequisiteBlocked: null,
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
