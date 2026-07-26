/**
 * Prompt construction for the merged summary + segments call.
 *
 * Adapted from Bilitato's `utils/promptBuilder.js` (BASE/TASK/TONE/DETAIL
 * blocks + `<<<...>>>` output protocol), with one deliberate difference: the
 * model is never asked for timestamps. It reports subtitle LINE NUMBERS and
 * `protocol.ts` maps them back to real seconds — models hallucinate clock
 * times, they cannot hallucinate a line number that isn't in the transcript.
 */

import { formatClock } from '@/lib/format';
import type { SubtitleRow } from '@/lib/subtitle/types';
import type { SummaryDetail, SummaryTone } from './types';

export const PROTOCOL_TAGS = {
  summaryStart: '<<<SUMMARY_START>>>',
  summaryEnd: '<<<SUMMARY_END>>>',
  segmentsStart: '<<<SEGMENTS_START>>>',
  segmentsEnd: '<<<SEGMENTS_END>>>',
} as const;

export const SUMMARY_SYSTEM_PROMPT =
  '你是一个中文视频内容分析助手。基于字幕完成分析：' +
  '字幕存在明显识别错误时可结合上下文合理修正，忽略无意义重复、口误和噪声。';

const SUMMARY_TASK = `
【任务1：视频总结】
1. 先用 2-4 句话概括视频主题、核心观点与结论，让读者立刻知道"这个视频讲了什么"。
2. 再提炼主要观点、关键论据、重要细节、典型案例、数据结论、作者态度倾向。
3. 不要逐句复述字幕，要重新组织成易读的总结；长视频必须覆盖前中后期，不能只总结前半段。
4. 忽略广告、套话、闲聊、重复内容、点赞关注引导。
5. 只输出总结正文，禁止输出思考过程、任务复述、写作计划，
   禁止"让我分析""我将梳理""需要输出"等前置文字。
6. 使用 Markdown 加粗小标题（**小标题**），禁止一级标题，禁止整段纯文本。
   小标题按视频实际内容命名，不要套固定模板；第一个小标题承担"概述"功能。
   有明显争议时应包含争议相关小标题；教程类应包含步骤要点；
   故事类按情节推进组织；新闻事件类按背景、经过、影响、争议组织。
`.trim();

const SEGMENTS_TASK = `
【任务2：章节分段】
1. 按内容逻辑划分章节，粒度适合进度条导航；话题、人物、阶段、结论切换处应拆新章节。
2. 每个章节给一个简短清晰的小标题（像视频进度条章节名），不要写成一句话概述。
3. 必须覆盖视频全程，按时间顺序排列，不要中途停止分段。
4. 广告识别：博主从讲述内容转为推荐产品/服务、出现品牌介绍、购买下载注册引导、
   优惠码、"本期视频由…支持"等，标记为 ad；频道介绍、开场白、结尾感谢不算广告。
   广告边界不确定时宁可缩小范围，不要过度标记。
`.trim();

export const TONE_PROMPTS: Record<SummaryTone, string> = {
  casual: '表达风格：像向朋友解释这个视频，优先讲清"到底在讲什么""为什么值得看"，不堆砌术语。',
  balanced: '表达风格：清晰自然，兼顾可读性与信息密度，保留主要观点和关键细节，不过度简写也不学术化。',
  professional:
    '表达风格：分析报告式。提炼论点之间的逻辑关系、作者隐含立场与可能影响；' +
    '有争议时指出争议焦点与不同观点背后的逻辑。',
};

export const DETAIL_PROMPTS: Record<SummaryDetail, string> = {
  brief: '篇幅控制：2-3 个加粗小标题，每个小标题下最多 2 条要点，每条不超过 35 字，只留核心结论。',
  normal: '篇幅控制：3-4 个加粗小标题，每个小标题下 2-3 条要点，每条 35-60 字，覆盖主要观点与必要背景。',
  detailed:
    '篇幅控制：4-6 个加粗小标题，每个小标题下 3-5 条要点，每条 50-90 字，' +
    '展开背景、原因、影响、争议与隐含结论。',
};

/** MVP defaults — the tone/detail seam exists for a future settings UI. */
export const DEFAULT_TONE: SummaryTone = 'balanced';
export const DEFAULT_DETAIL: SummaryDetail = 'normal';

export interface SummaryPromptInput {
  title: string;
  rows: SubtitleRow[];
  tone?: SummaryTone;
  detail?: SummaryDetail;
}

/**
 * Numbered transcript: `#1 [00:12] text`. The `#N` ids are the only anchor the
 * model may cite for chapter boundaries — 1-based so "#0" is recognizably bogus.
 */
export function formatSubtitleForPrompt(rows: SubtitleRow[]): string {
  return rows
    .map((row, i) => `#${i + 1} [${formatClock(row.start)}] ${row.text.trim()}`)
    .join('\n');
}

/** Chapter-count guidance scaled by duration (Bilitato's tiers). */
function chapterCountHint(durationSeconds: number): string {
  const minutes = durationSeconds / 60;
  if (minutes <= 10) return '4-7';
  if (minutes <= 25) return '6-10';
  if (minutes <= 45) return '8-12';
  return '10-16';
}

function buildOutputProtocol(lineCount: number, durationSeconds: number): string {
  return `
【输出协议 — 严格执行，任何偏离都会导致解析失败】
必须依次输出两个区块，标签必须原样保留：

${PROTOCOL_TAGS.summaryStart}
（总结正文，Markdown 加粗小标题，禁止 JSON）
${PROTOCOL_TAGS.summaryEnd}

${PROTOCOL_TAGS.segmentsStart}
（章节 json 数组，除数组外不要任何文字、不要代码围栏）
${PROTOCOL_TAGS.segmentsEnd}

章节 json 数组的元素形如：
{"start_line": 1, "end_line": 24, "title": "章节标题", "type": "content"}

字段规则：
- start_line / end_line 必须是【字幕内容】里真实出现过的 #编号（1 到 ${lineCount}），
  禁止输出时间戳、禁止估算、禁止超出范围；找不到确切编号时宁可缩小区间。
- end_line 必须 >= start_line，章节之间按 start_line 升序且不要重叠。
- type 只能是 "content" 或 "ad"。
- 本视频总时长约 ${formatClock(durationSeconds)}，章节数量控制在 ${chapterCountHint(durationSeconds)} 个。
- 最后一个章节的 end_line 应接近 ${lineCount}，确保视频结尾不被遗漏。

禁止在两个区块之外输出任何解释文字，禁止省略任何一个标签。
`.trim();
}

export function buildSummaryPrompt(input: SummaryPromptInput): string {
  const { title, rows, tone = DEFAULT_TONE, detail = DEFAULT_DETAIL } = input;
  const durationSeconds = rows.length ? rows[rows.length - 1].end : 0;

  return [
    SUMMARY_TASK,
    SEGMENTS_TASK,
    '【输出风格要求】',
    TONE_PROMPTS[tone],
    DETAIL_PROMPTS[detail],
    `【视频信息】\n标题：${title || '（未知）'}\n时长：约 ${formatClock(durationSeconds)}\n字幕行数：${rows.length}`,
    `【字幕内容】\n${formatSubtitleForPrompt(rows)}`,
    buildOutputProtocol(rows.length, durationSeconds),
  ].join('\n\n');
}
