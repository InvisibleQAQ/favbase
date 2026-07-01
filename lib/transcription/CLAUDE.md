# lib/transcription

转录核心：Groq ASR 3 层管线（Content Script → Background SW → Offscreen Document）的类型、常量、客户端、音频处理与策略编排。

## 模块结构

- `types.ts` — 转录核心类型：TranscribeRequest（`{ type, platform, videoId, cid?, title }`，platform 驱动 handler 分发，videoId 平台无关命名）/TranscribeAbort（`{ type, videoId }`）, TranscribeResponse(success|failure), TranscribeStage(13种 union，含 subtitle_check), TranscribeStatusPush（`{ type, videoId, progress, stage, ... }`），TranscribeErrorCode(13种，含 UNSUPPORTED_PLATFORM) + TranscribeErrorInfo(code + debug message + params) + createErrorInfo(code, message, params?) 工厂函数 + isTranscribeError(err) 类型守卫。纯数据错误模型，无类继承，IPC 天然兼容。内部引用 SubtitleRow/SubtitleSource from `lib/subtitle/types`
- `constants.ts` — GROQ_MAX_AUDIO_BYTES(24MB), CHUNK_SECONDS(600), OVERLAP(4s), SAFETY_RATIO(0.72), PROGRESS 阶段映射, 超时常量
- `groq-client.ts` — ensureGroqConnectivity(apiKey, baseUrl?)（6s pre-flight GET /models）+ requestGroqTranscription(blob, apiKey, model, signal?, baseUrl?)（FormData POST verbose_json+segment）+ mapTranscriptionToRows() + parseRetryAfter()。baseUrl 可选参数支持多 ASR Provider（Groq/SiliconFlow），默认 Groq。错误通过 createErrorInfo() 抛出 TranscribeErrorInfo 纯对象，isTranscribeError() 防双层包装。API 类型内聚于此文件，不导出
- `audio-extractor.ts` — 平台无关的音频下载：fetchAudioBlob(url, signal, onProgress)（streaming 下载，10% 粒度进度映射到 20-55%）。错误通过 createErrorInfo() 抛出。不含 B 站特定逻辑，音频 URL 提取已移至 bilibili-api.ts 的 extractBiliAudioUrl()
- `audio-fingerprint.ts` — assertAudioNotReused(blob, bvid)（SHA-256 + LRU(30)，相同 hash 不同 bvid 拒绝）
- `pipeline.ts` — TranscriptionPipeline 深模块：`runTranscriptionPipeline(request, deps, onProgress)` 编排完整转录策略（cache → official subtitle → ASR fallback → postProcess → cache save）。`PipelineDeps` 6 方法接口（`getAsrConfig`/`fetchOfficialSubtitle`/`transcribeAudio`/`cacheGet`/`cacheSave`/`postProcess`），转录策略的唯一真实来源。`postProcess` 通过 DI 注入平台特有的字幕后处理（B 站注入 `processSubtitles`，未来其他平台注入各自实现）。`AsrConfig`（apiKey/model/baseUrl）是 ASR 配置统一类型。`toErrorInfo()` 通过 `isTranscribeError()` 识别纯数据错误对象

## 约定

- 转录总流程: `handleTranscribe` dispatcher 按 `msg.platform` 查 `platformHandlers` registry 分发到平台 handler。B 站路径：`handleBiliTranscribe` → `prepareBiliTranscription()` adapter 获取平台碎片（auth + CID 解析 + 官方字幕 fetcher + 音频 URL 提取器 + postProcess） → 组装 PipelineDeps → pipeline 统一编排（cache → subtitle_check 官方字幕优先（含重试）→ ASR fallback（connectivity → extractAudioUrl(注入) → fetchAudioBlob → assertAudioNotReused → ≤24MB 直传 / >24MB Offscreen FFmpeg 分块）→ postProcess(注入) → cache save）。TranscribeRequest 消息携带 `platform` + `videoId`（平台无关命名），`cid` 可选（B 站 content script 有 cid 就传，app.html 不传由 adapter 解析）。ASR 配置（apiKey/model/baseUrl）统一由 `AsrConfig` 类型承载，`resolveAsrConfig` 是唯一真实来源。新增平台：(1) 创建 `lib/<platform>/<platform>-transcription-handler.ts`（各自 prepare + 组装 deps + 调 pipeline）(2) 注册到 `transcription-handlers.ts` 的 `platformHandlers` registry 一行。各平台 handler 完全独立，不共享 adapter 接口
