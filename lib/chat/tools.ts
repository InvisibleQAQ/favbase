import { tool } from 'ai';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { FavbaseDb } from '@/lib/database';
import { schema } from '@/lib/database';
import { COLLECTION_PLATFORMS } from '@/lib/collections/platforms';
import { hybridRetrieve } from './retrieval';

const { itemContents } = schema;

/** Default top-K for the knowledge-base search when the model omits it. */
const DEFAULT_TOP_K = 8;

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
    '在用户的本地收藏知识库里做混合检索（pgvector 语义 + trigram 关键词），覆盖 B站/GitHub/浏览器书签/X/知乎/YouTube 的收藏内容。回答任何关于"用户收藏了什么/某个话题/某篇文章/某个视频"的问题前，必须先调用它，不要凭记忆作答。返回命中的收藏片段及其来源标题、链接与相关度分数。知识库为空或无相关内容时 count 为 0。',
  inputSchema: z.object({
    query: z.string(),
    platform: z.enum(COLLECTION_PLATFORMS).optional(),
    tag_id: z.string().optional(),
    top_k: z.number().int().min(1).max(20).optional(),
  }).describe(
    '检索参数。query=用户问题的检索关键词或自然语言描述（中英皆可，如 "机器学习入门教程"）；' +
      'platform=可选，限定单个收藏平台，取值之一 bilibili/github/bookmarks/x/zhihu/youtube，不确定时省略；' +
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
    '统计参数。platform=可选，只统计某个平台的标签，取值之一 bilibili/github/bookmarks/x/zhihu/youtube；省略则统计全部平台。',
  ),
  execute: async ({ platform }, { experimental_context }) => {
    const db = contextDb(experimental_context);
    const { getAllUsedTags } = await import('@/lib/tagging');
    const tags = await getAllUsedTags(platform, db);
    return {
      count: tags.length,
      tags: tags.map((tg) => ({ id: tg.id, name: tg.name, count: tg.count })),
    };
  },
});

/**
 * Read-only chat tool registry. The object KEY is the tool name the model sees
 * (referenced by that name in the system prompt).
 */
export const chatTools = { searchKnowledgeBase, getItemContent, listTags };
