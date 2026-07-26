# Summary 领域层

AI 视频总结：字幕 → 一次 LLM 流式调用 → 结构化 Markdown 总结 + 章节分段（含广告标记）。
平台无关深模块，依赖 `lib/ai`（createLanguageModel）+ `lib/cache`（读字幕）+ `lib/storage/resolve`（配置）。
消费者只有 B 站面板（`entrypoints/bilibili-video.content`），经 background handler 调用。
参考实现是 Bilitato 的 `utils/promptBuilder.js` + `background.js` summary 任务（抄 prompt 工程与协议，不抄其代码结构）。

## 模块结构

- `types.ts` — 领域类型 + 消息 + 错误模型。`VideoSegment { start, end, title, type: 'content'|'ad' }`（秒，由行号映射而来）/ `SummaryResult { markdown, segments, model, subtitleHash, createdAt }`。消息：`SUMMARIZE_VIDEO` / `SUMMARIZE_ABORT` / `GET_SUMMARY_CACHE`（只读探针）/ `SUMMARY_STATUS`（流式推送，携带累积 Markdown）。错误是纯数据 `SummaryErrorInfo { code, message, params? }` + `createSummaryError` / `isSummaryError`（镜像 `lib/transcription/types.ts`，IPC 天然兼容；`isSummaryError` 以 `SUMMARY_` 前缀区分于转录错误）
- `prompt.ts` — prompt 构建纯函数。`buildSummaryPrompt({ title, rows, tone?, detail? })` 组装：任务1 总结 + 任务2 分段 + TONE/DETAIL 风格块 + 视频信息 + 带行号字幕 + 输出协议。`formatSubtitleForPrompt(rows)` → `#1 [0:12] 文本`（**1-based**，时间戳走共享 `lib/format.ts` 的 `formatClock`，与面板显示同一份实现）。`PROTOCOL_TAGS` 是 `<<<SUMMARY_START>>>` 等四个标签的唯一真实来源。tone/detail 目前恒为 `DEFAULT_TONE='balanced'` / `DEFAULT_DETAIL='normal'`——参数接缝已留好，接 UI 不动内核
- `protocol.ts` — 输出解码纯函数。`parseSummarySection(text)` 容忍流式半截（无 END 标签取尾部）与**模型完全无视协议**（回退到全文，但在 SEGMENTS 标签处截断，JSON 永不漏进正文），并隐藏半截标签 `<<<SUMM`。`parseSegments(text, rows)` 剥 ```json 围栏 → 取首个 `[`…`]` → Zod 逐条 safeParse（**坏条目丢弃，不废整批**）→ **行号映射真实秒数**：`start_line` 越界即幻觉直接丢，`end_line` 越界钳到末行（意图明确）→ 按 start 排序
- `config.ts` — `resolveSummaryConfig(settings)` = 共享 `resolveLlmConfig`（`lib/storage/resolve`）+ `temperature`。**`maxTokens` 有意不消费**：其默认值 100000 是输入预算量级，当 `maxOutputTokens` 下发会让多数模型 400
- `summarizer.ts` — `streamSummary(config, prompt, { onText, signal })`：createLanguageModel + `streamText`，`onText` 回传**累积全文**（非 delta）。错误不包装直接抛（`textStream` 迭代时 AI SDK 抛真异常而非 error chunk，见 v6 文档），映射由 service 负责
- `summary-cache.ts` — per-video key `local:vs:{platform}:{videoId}`（前缀注册在 `STORAGE_PREFIXES.videoSummary`）。`getSummaryCache(platform, videoId, subtitleHash?)`：传 hash 且与存量不符 → 视为未命中（官方字幕换 ASR 后旧总结自动作废）。无内存层无写锁（一次生成只写一次）。只有 get/save 两个函数——`force` 重新生成是覆写，没有删除场景，不留没人调的 `clear*`
- `summary-service.ts` — 编排深模块，`SummaryDeps` 六方法可注入（镜像 `TaggingDeps`/`PipelineDeps`）：
  - `summarizeVideo(request, options, deps?)`：读字幕缓存（无 → `SUMMARY_NO_SUBTITLE`）→ 非 force 查缓存（命中 `cached:true` 零 LLM）→ 配置未就绪 → `SUMMARY_NOT_CONFIGURED`（**在花钱之前**）→ 构 prompt → 流式（onPartial 按 `PARTIAL_EMIT_INTERVAL_MS=300` 节流，回传的是**解码后的 Markdown**不是原始协议文本）→ 解码 → 落缓存。**缓存写失败只 warn**，不能弄丢用户眼前的总结
  - `loadCachedSummary(platform, videoId, deps?)`：只读探针，面板打开时用，永不触发 LLM
  - **取消判定只认真取消**：`signal.aborted`（唯一的中止入口就是我们自己的 controller）+ `err.name` 为 `AbortError`/`ResponseAborted`。**不做 `/abort/i` 消息模糊匹配**——那会把"上游连接 aborted"这类真失败吞进"用户已取消"（UI 不显示任何错误），失败必须响
- `index.ts` — barrel，单一 import 面

## 约定

- **总结与分段一次调用**：合并输出协议（`<<<SUMMARY_START>>>` Markdown + `<<<SEGMENTS_START>>>` JSON），token 比两次调用减半。代价是自己解协议——但 Zod + 行号映射把风险收在 `protocol.ts` 一个纯函数里，全部有单测。两者**独立降级**：SEGMENTS 缺失/坏掉仍返回可用总结（`segments: []`），UI 不显示章节区
- **时间戳只能由行号映射**：prompt 明令模型只输出 `start_line`/`end_line`，不接受任何时间戳。模型能编时间，编不出不存在的行号。这是 Bilitato 的核心 trick，唯一值得抄的分段设计
- **LLM 调用必须在 Background SW**：MV3 content script 的 fetch 受宿主页（bilibili.com）CORS 约束，扩展 host_permissions 自 Chrome 85 起对 CS 不放行。代价：AI SDK 进了 SW bundle，`background.js` 38KB → 641KB。SW 30s 空闲回收不是问题——流式数据与每 300ms 的 `tabs.sendMessage` 持续重置计时器
- 结果只落 `chrome.storage.local`，**不进 PGlite**：CS 够不到 DB（RPC bridge 只服务 app.html），且当前视频未必在收藏库里没有 item 行可挂。要在 app.html 展示总结时再谈迁移
- 未配置 LLM 静默（`enabled` 派生自 apiKey+model，无开关），与 tagging/embedding 一致
- 测试：`summary.test.ts` 纯函数（prompt 协议/行号格式/协议解码/幻觉行号丢弃/围栏容错）+ `summary-service.test.ts` 注入 deps 覆盖编排（缓存命中零调用/force 跳缓存/节流 partial 是解码后文本/四类错误映射（含"消息里带 abort 字样的真失败不算取消"）/缓存写失败仍返回/segments 坏掉仍留总结）。渲染器测试在 `tests/panel-markdown.test.tsx`
