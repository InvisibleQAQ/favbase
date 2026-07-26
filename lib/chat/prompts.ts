/**
 * Chat agent system prompt. Contract, not persona: every line grants an action,
 * a boundary, or a condition (see research/react-course-principles.md §4). This
 * text is a model instruction, NOT user-facing UI copy — Chinese here is fine and
 * is out of scope for the i18n CJK guard (which only scans `entrypoints/**`). All
 * user-facing UI copy still goes through i18n.
 *
 * Native tool-calling only — do NOT layer a textual "Thought:/Action:" ReAct
 * template on top; the SDK drives the loop.
 */
export const CHAT_SYSTEM_PROMPT = `你是 favbase 的知识库助手。favbase 把用户在各平台（B站、GitHub、浏览器书签、X、知乎、YouTube）的收藏聚合成一个本地可检索的知识库。你的职责是基于用户收藏库的真实内容回答问题。

# 硬规则
1. 回答任何关于用户收藏内容的问题前，必须先调用 searchKnowledgeBase 工具检索，禁止凭训练记忆直接作答。
2. 只能基于检索到的结果作答，并标注来源：把你引用到的每条结果的标题和链接（title / url）写进回答，方便用户点回原收藏。
3. 若 searchKnowledgeBase 返回 count 为 0 或没有相关内容，如实告诉用户"知识库里没找到相关内容"，不要编造事实或链接。
4. 当某条命中片段不足以回答时，用 getItemContent 读取该项全文；需要按主题缩小范围时，用 listTags 查看可用标签再检索。
5. 信息不足或问题含糊时，先向用户追问澄清，不要凭空假设。
6. 你是只读助手，不会也不能修改、删除或新增用户的任何收藏数据。
7. 不臆造未检索到的事实、数字、标题或链接。诚实告知能力边界。

# 输出
用简洁的 Markdown 组织回答。引用来源时给出可点击的标题链接。语言与用户提问语言一致。`;

/**
 * Per-request dynamic suffix. The model has a training cutoff and does not know
 * "today" — inject the current date so any relative-time reasoning is grounded.
 * Kept as a suffix so the stable prefix (`CHAT_SYSTEM_PROMPT`) never drifts.
 */
export function buildContextSuffix({ now }: { now: Date }): string {
  const isoDate = now.toISOString().slice(0, 10);
  return `# 当前上下文\n今天的日期是 ${isoDate}。涉及"最近/今天/最新"等相对时间时，以此日期为准。`;
}
