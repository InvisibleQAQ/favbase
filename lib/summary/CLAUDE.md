# lib/summary

AI 视频总结：缓存字幕 → 一次流式 LLM 调用 → Markdown 总结 + 章节分段（含广告标记）。平台无关；唯一消费者是 B 站面板，经 Background handler 调用。

## 约束

- LLM 调用必须在 Background SW：content script 的 fetch 受宿主页（bilibili.com）CORS 约束，扩展 host 权限对 CS 不放行。代价是 AI SDK 进了 SW bundle。
- 结果只落 `chrome.storage.local`（`local:vs:{platform}:{videoId}`），不进 PGlite：CS 够不到 DB，当前视频也未必在收藏库里、没有 item 行可挂。
- 总结与分段是一次调用（token 比两次调用减半），合并输出协议的四个标签只在 `prompt.ts` 的 `PROTOCOL_TAGS` 定义。两段独立降级：SEGMENTS 缺失或坏掉仍返回可用总结（`segments: []`）。
- 时间戳只能由行号映射：prompt 只让模型输出 `start_line` / `end_line`（1-based）。模型能编时间，编不出不存在的行号；别改成让模型直接给时间。
- `start_line` 越界是幻觉，整条丢；`end_line` 越界钳到末行；坏条目逐条丢，不废整批。
- 模型完全无视协议时回退全文，但要在 SEGMENTS 标签处截断，JSON 不能漏进正文；流式半截标签也不能露给 UI。
- `settings.maxTokens` 刻意不消费：默认值 100000 是输入预算量级，当 `maxOutputTokens` 下发会让多数模型 400。
- 顺序是读字幕 → 查缓存 → 检查配置 → 调 LLM：未配置 LLM 也能看已有总结，且配置检查一定在花钱之前。没有独立开关（`enabled` 由 apiKey + model 派生），与 tagging / embedding 一致。
- `onPartial` 回传的是解码后的累积 Markdown，不是 delta，也不是原始协议文本。
- 取消只认真取消：`signal.aborted` 或 `err.name` 为 `AbortError` / `ResponseAborted`。不做 `/abort/i` 消息模糊匹配——那会把「上游连接 aborted」这类真失败吞成「用户已取消」，UI 什么都不显示。
- 缓存写失败只 warn，不能弄丢用户眼前的总结。
- 缓存按 `subtitleHash` 判过期（官方字幕换成 ASR 后旧总结自动作废）；`force` 重新生成是覆写，没有删除场景，不要加 `clear*`。
- 错误是纯数据 `SummaryErrorInfo`（可过 IPC），code 必须带 `SUMMARY_` 前缀：`isSummaryError` 靠它与转录错误区分。

## 坑

- AI SDK v6 的 `textStream` 迭代时抛真异常，不是 error chunk；`summarizer.ts` 不包装直接抛，映射成错误码只在 `summary-service.ts` 做。
- SW 30 秒空闲回收不是问题：流式数据与节流推送的 `tabs.sendMessage` 持续重置计时器。
