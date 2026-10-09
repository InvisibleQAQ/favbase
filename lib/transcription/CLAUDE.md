# lib/transcription

转录核心（平台无关）：cache → 官方字幕 → ASR 的策略管线，加上 ASR 客户端、音频下载与错误模型。运行时三层：Content Script / app.html → Background SW → Offscreen Document（大音频分块）。

## 约束

- `pipeline.ts` 的 `runTranscriptionPipeline` 是转录策略的唯一真实来源。平台差异只经 `PipelineDeps` 注入（官方字幕 fetcher、音频 URL 提取、`postProcess`、缓存读写），不在 pipeline 里写平台分支。
- pipeline 是成功响应 `data.videoId` 的唯一 owner：三个 success 出口都在这里盖请求的 id，平台 handler 不自己盖。cache 命中分支里 `videoId` 必须写在展开之后，请求 id 压过 cache 回来的任何值。
- 消费方用 `data.videoId` 拒收不属于自己的字幕时必须逐字节比对：BV 号是大小写敏感的 base58。
- 错误是纯数据 `TranscribeErrorInfo`（无类继承，可过 IPC），用 `createErrorInfo()` / `isTranscribeError()`。`message` 是 debug 信息，永不直接展示；UI 按 `code` + `params` 翻译。
- 429 只把明确的 `audio seconds per day (ASD)` 识别为 `ASR_QUOTA_EXCEEDED`，其余形状一律 `ASR_RATE_LIMIT`；供应商原文只作 debug。
- ASR 配置（apiKey / model / baseUrl）只从 `resolveAsrConfig` 来。`groq-client.ts` 的 `baseUrl` 参数就是多 ASR provider 的接缝，不要为新 provider 另写 client。
- 新增平台：建 `lib/<platform>/<platform>-transcription-handler.ts`（自己取媒体 / 字幕来源、组装 deps、调 pipeline；取媒体可以懒到 deps 的 extractor 里，抖音就是——cache 命中与缺 ASR key 时零平台请求），在 `lib/background/transcription-handlers.ts` 的 `platformHandlers` 注册一行。各平台 handler 完全独立，不抽共享 adapter 接口。
- 新增 `TranscribeErrorCode` 要同步 wire schema（`lib/runtime-message/schemas.ts`）与两个 locale，规则在 `lib/i18n/CLAUDE.md`。

## app 侧落库 seam（`transcribe-and-persist.ts`，docs/37 D-c）

- 它是 `TRANSCRIBE_AUDIO` 的另一端：app.html 侧发消息、逐字节比对 `data.videoId`、调平台注入的 `persist`、发 `item-content-updated`、交给 `startProcessing`，正文 durable 后立即返回（Embed / Tag ticket 不阻塞下一条转录，`onIndexed` 只是晚到的通知）。平台只注入 `platform` + `persist` + hooks。
- 与上面「各平台 handler 完全独立」不冲突：那条管 SW 侧的 prepare + deps；这条是 app 侧的落库，所有平台共用一份。
- 本目录不得 import `lib/<platform>/`（方向只能平台 → 共享），也不得出现平台 id 字面量；加载图 storage-free，在 `tests/lib-import-smoke.test.ts` 清单里。
- videoId 闸门逐字节 `!==`，不按平台放宽（BV 号是大小写敏感的 base58；aweme_id 是纯数字串，闸门不因此放宽）。不匹配 → 不调 persist、不发事件、不启动后处理，`console.error` 恰好一行、带两个 id（它首先是定位工具）。
- `persist` 返回 `null`（条目不存在、写库失败）→ `onIndexed(null)`、无事件、无后处理。
- `createStatusListener` 的大小写无关比对是已知缺陷（跟着 `lib/background/job-registry.ts` 的 lowercase），别照抄到闸门上。
- `PersistContentResult` 的 owner 是这里；`lib/bilibili/bili-sync-service.ts` 与 `transcribe-utils.ts` 只 re-export。
- 守卫：`transcribe-and-persist.test.ts`（假 persist、任意 platform）与 `lib/bilibili/transcribe-utils.test.ts`（经 B 站包装对真实 PGlite persist）。

## 音频候选与下载（docs/37 Step 2）

- `createTranscribeAudio` 的 extractor 返回**候选 URL 列表**（B 站一条，抖音三级各三条），不是单个 URL；`audio-extractor.ts` 的 `fetchFirstAudioBlob` 按序逐条下载，非 2xx 与网络错误换下一条，AbortError 立即穿透，全部失败抛最后一条的错误，空列表 `ASR_NO_AUDIO_SOURCE`。「一个列表按序试」是机制，不带平台知识。
- extractor 抛出的 `TranscribeErrorInfo` 与 AbortError 原样透传，其余才折成 `ASR_NO_AUDIO_SOURCE`：抖音的四个 `DOUYIN_*` 码全在 extractor 里产生，「统一」成 `ASR_NO_AUDIO_SOURCE` 会把「缺标签页」变成「无音轨」。
- 交给 Offscreen 分块的是**实际下载成功的那条** URL（Offscreen 自己再下载一次），不是候选第一条。
- 四个 `DOUYIN_*` 码是平台前置条件类错误，`params.reason` 的取值与折算表只写在 `lib/douyin/CLAUDE.md`（别在这里再抄一份）；本目录只需知道 `DOUYIN_RATE_LIMITED` 的 `retryAfter` 单位是秒、不带 `resetAt` / `providerId`（那是 ASR quota 的形状）。

## 坑

- `assertAudioNotReused`：同一音频 hash 配不同 videoId 即拒绝，防的是 SPA 跳转后拿到上一个视频的旧音频。别当成多余校验删掉。
- 音频超过 `GROQ_MAX_AUDIO_BYTES` 才走 Offscreen FFmpeg 分块，否则直传。
- 已知缺口：没有 ASR 幻觉过滤。静音 / 纯音乐片段的 Whisper 结果是非空套话（「字幕志愿者 李宗盛」「请不吝点赞 订阅 转发 打赏支持明镜与点点栏目」），各平台的「空转录」分支都接不住，套话入库、进检索；docs/37 Step 4 实测抖音 9 / 90。B站走同一条 ASR 路径。
- `TranscribeRequest.cid` 可选：B 站 content script 有就传，app.html 不传、由 adapter 解析。
- B 站的 prepare 不读 auth：SW 的 fetch 自带 B 站 cookie jar（docs/29 Step 4），不要再手拼 Cookie。
