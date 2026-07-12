/** Max tags per item (also enforced by the Zod schema and normalizeTags). */
export const MAX_TAGS = 5;
/** Content excerpt cap — transcripts run long; the head is enough for topics. */
export const MAX_CONTENT_CHARS = 2000;
/** Existing-tags context cap fed into the prompt (most-used first). */
export const MAX_EXISTING_TAGS = 50;

/** Content-type agnostic tagging input — never import platform types here. */
export interface TaggingInput {
  title: string;
  author?: string;
  description?: string;
  content?: string;
}

// OpenAI-spec hard constraint: response_format json_object rejects requests
// unless the prompt contains the word "json" — the JSON mentions below are
// load-bearing, do not remove (guarded by tagging.test.ts).
export const TAGGING_SYSTEM_PROMPT =
  '你是一个专业的内容分析专家。你的任务是阅读给定的内容素材，提取最核心的主题，生成关键词标签。' +
  '请保持客观、准确，严格按照要求以 JSON 对象格式输出。';

export function buildTaggingPrompt(input: TaggingInput, existingTags: string[]): string {
  const lines = ['请分析以下内容，生成 3-5 个核心关键词标签。', '', '内容信息：'];

  lines.push(`标题: ${input.title}`);
  if (input.author) lines.push(`作者: ${input.author}`);
  if (input.description) lines.push(`简介: ${input.description}`);
  if (input.content) lines.push(`正文节选: ${input.content.slice(0, MAX_CONTENT_CHARS)}`);
  if (existingTags.length > 0) {
    lines.push(`已有标签: ${existingTags.slice(0, MAX_EXISTING_TAGS).join('、')}`);
  }

  lines.push(
    '',
    '要求：',
    '1. 标签格式：中文 2-5 字，英文 1-3 个单词',
    '2. 准确反映内容的核心技术、领域或概念，宁缺毋滥',
    '3. 【强制优先】：优先复用「已有标签」中语义匹配的标签，其次才创建新标签',
    '4. 【防重策略】：不生成与已有标签语义重复的新标签' +
      '（如已有"前端"，绝不生成"前端开发"；已有"React"，绝不生成"ReactJS"）',
    '5. 输出格式：JSON 对象，形如 {"tags": ["标签1", "标签2"]}',
  );

  return lines.join('\n');
}
