# lib/transcription

转录核心（平台无关）：cache → 官方字幕 → ASR 的策略管线，加上 ASR 客户端、音频下载与错误模型。运行时三层：Content Script / app.html → Background SW → Offscreen Document（大音频分块）。

## 约束

- `pipeline.ts` 的 `runTranscriptionPipeline` 是转录策略的唯一真实来源。平台差异只经 `PipelineDeps` 注入（官方字幕 fetcher、音频 URL 提取、`postProcess`、缓存读写），不在 pipeline 里写平台分支。
- pipeline 是成功响应 `data.videoId` 的唯一 owner：三个 success 出口都在这里盖请求的 id，平台 handler 不自己盖。cache 命中分支里 `videoId` 必须写在展开之后，请求 id 压过 cache 回来的任何值。
- 消费方用 `data.videoId` 拒收不属于自己的字幕时必须逐字节比对：BV 号是大小写敏感的 base58。
- 错误是纯数据 `TranscribeErrorInfo`（无类继承，可过 IPC），用 `createErrorInfo()` / `isTranscribeError()`。`message` 是 debug 信息，永不直接展示；UI 按 `code` + `params` 翻译。
- 429 只把明确的 `audio seconds per day (ASD)` 识别为 `ASR_QUOTA_EXCEEDED`，其余形状一律 `ASR_RATE_LIMIT`；供应商原文只作 debug。
- ASR 配置（apiKey / model / baseUrl）只从 `resolveAsrConfig` 来。`groq-client.ts` 的 `baseUrl` 参数就是多 ASR provider 的接缝，不要为新 provider 另写 client。
- 新增平台：建 `lib/<platform>/<platform>-transcription-handler.ts`（自己 prepare + 组装 deps + 调 pipeline），在 `lib/background/transcription-handlers.ts` 的 `platformHandlers` 注册一行。各平台 handler 完全独立，不抽共享 adapter 接口。
- 新增 `TranscribeErrorCode` 要同步 wire schema（`lib/runtime-message/schemas.ts`）与两个 locale，规则在 `lib/i18n/CLAUDE.md`。

## 坑

- `assertAudioNotReused`：同一音频 hash 配不同 videoId 即拒绝，防的是 SPA 跳转后拿到上一个视频的旧音频。别当成多余校验删掉。
- 音频超过 `GROQ_MAX_AUDIO_BYTES` 才走 Offscreen FFmpeg 分块，否则直传。
- `TranscribeRequest.cid` 可选：B 站 content script 有就传，app.html 不传、由 adapter 解析。
- B 站的 prepare 不读 auth：SW 的 fetch 自带 B 站 cookie jar（docs/29 Step 4），不要再手拼 Cookie。
