# Multi-Platform Extensibility Audit

> Date: 2026-06-29
> Goal: 识别阻碍 Favbase 支持多平台（YouTube、Douyin 等）的架构耦合点，按严重程度排序。
> Constraints: 数据库共用、LLM/ASR key 共用、ASR 处理各平台不同、其他部分按平台定制。

---

## CRITICAL — 阻断多平台扩展

### C1. `PipelineDeps` 接口用 `bvid` 作为 video identifier

**Files**: `lib/transcription/pipeline.ts:18-46`

**Problem**: `PipelineDeps` 的 5 个方法全部用 `bvid: string` 作为参数名。`PipelineRequest` 也声明 `bvid: string`。`bvid` 是 Bilibili 的视频 ID 格式（BV1xx4y1xx），YouTube 是 11 位 alphanumeric，Douyin 是纯数字。pipeline 号称平台无关，但接口里写死了 Bilibili 的 ID 命名。

**Solution**: 将所有 `bvid` 重命名为 `videoId`。这是纯语义修改，不改行为，但消除了"这个模块只服务 Bilibili"的暗示，让新平台开发者不会误以为需要把自己的 ID 转成 BV 格式。

**Depth**: 接口名是调用者必须理解的东西。错误的命名等于错误的接口。

---

### C2. `pipeline.ts` 硬编码 `'bilibili'` 和 `'groq'` 作为 SubtitleSource

**Files**: `lib/transcription/pipeline.ts:86,111`

**Problem**: Pipeline 内部决定 subtitle source 标签：
- Line 86: `await deps.cacheSave(bvid, rows, 'bilibili')` — official subtitle 固定标记为 `'bilibili'`
- Line 111: `await deps.cacheSave(bvid, rows, 'groq')` — ASR 结果固定标记为 `'groq'`

YouTube 的官方字幕应该标记为 `'youtube'` 而非 `'bilibili'`。ASR provider 也不一定是 Groq（可能是 SiliconFlow）。pipeline 不应该知道具体平台名或 ASR provider 名。

**Solution**: source 标签应由调用者（adapter）提供。在 `PipelineDeps` 或 `PipelineRequest` 中增加 `officialSourceLabel: SubtitleSource` 和 `asrSourceLabel: SubtitleSource`，pipeline 使用它们而非硬编码字面量。

---

### C3. `SubtitleSource` 类型混淆了平台身份和转录方法

**Files**: `lib/subtitle/types.ts:1`

**Problem**: `type SubtitleSource = 'bilibili' | 'groq'` 是一个二元 union，语义上混合了两个维度：
- `'bilibili'` = 平台的官方字幕（来源维度）
- `'groq'` = ASR 服务商（工具维度）

添加 YouTube 后，变成 `'bilibili' | 'youtube' | 'groq' | 'siliconflow'` — 这不是一个一致的维度。你无法回答"YouTube 的 Groq 转录结果的 source 是什么？"

**Solution**: 拆为两个维度：
```typescript
type SubtitleMethod = 'official' | 'asr';
type SubtitlePlatform = 'bilibili' | 'youtube' | 'douyin';
type AsrProvider = 'groq' | 'siliconflow';
```
或者如果不想大改，至少改为 `type SubtitleSource = 'official' | 'asr'`，平台信息从 item 的 `platform` 字段获取。

---

### C4. `handleTranscribe` 直接调用 `prepareBiliTranscription`，无平台分发

**Files**: `lib/background/transcription-handlers.ts:22,165`

**Problem**: Line 165 直接 `await prepareBiliTranscription(bvid, msg.cid)` — 没有平台判断，没有 adapter registry。添加 YouTube 必须 if/else 或 switch 这里，然后每个新平台再加一个分支。

**Solution**: 引入 platform adapter registry：
```typescript
const adapters: Record<string, (videoId, cid?) => Promise<TranscriptionContext>> = {
  bilibili: prepareBiliTranscription,
  youtube: prepareYoutubeTranscription,
};
const prepare = adapters[platform];
```
但前提是消息里要带 `platform` 字段（见 C6）。

---

### C5. `AutoTranscribePipeline` 整体绑定 Bilibili

**Files**: `lib/bilibili/auto-transcribe-pipeline.ts:1-369`

**Problem**: 这个 class 从头到尾只服务 Bilibili：
- Import `checkAuth`、`fetchAndSyncVideos`、`getPendingBvids` — 全是 bilibili 专属
- State 字段 `currentVideoBvid`、变量名 `bvid`
- `response.data.source === 'bilibili'` 决定延迟策略
- `v.attr === 9` 是 bilibili 特有的"已失效"标记
- `v.bvid` 直接读取 bilibili 数据结构

这个模块的定位对了（放在 `lib/bilibili/` 下），但它的状态机逻辑（syncing → transcribing → waiting → done）、countdown UI、rate limit handling 是通用需求。

**Solution**: 拆两层：
1. **通用状态机**（`lib/auto-transcribe/pipeline.ts`）：管理 phase 切换、countdown、progress 订阅、useSyncExternalStore 契约
2. **平台适配器**（`lib/bilibili/auto-transcribe-adapter.ts`）：提供 `checkAuth`、`fetchPage`、`getPending`、`getVideoMeta` 等平台特定实现

---

### C6. `TranscribeRequest` 消息缺少 `platform` 字段

**Files**: `lib/transcription/types.ts` (TranscribeRequest), `lib/background/messages.ts`

**Problem**: Background 收到的 `TRANSCRIBE_AUDIO` 消息里只有 `bvid`、`cid`、`title`。没有 `platform` 字段告诉 handler 该用哪个 adapter。目前隐式假设所有请求都是 Bilibili。

**Solution**: `TranscribeRequest` 增加 `platform: string` 字段；Content script 发送时填入；handler 根据 platform 分发到对应 adapter。

---

## HIGH — 显著增加新平台接入成本

### H1. `BackgroundContext` 的 `bvid` 耦合

**Files**: `entrypoints/background.ts:20-21,30-31,41,46-49,61-62,76-77`

**Problem**: `tabBvids: Map<number, string>`、`activeBvids: Set<string>`、方法签名 `startTranscription(tabId, bvid)` — 全用 `bvid`。YouTube tab 会有 YouTube video ID，不是 BV ID。

**Solution**: 重命名为 `videoId`。纯语义，但阻止认知混淆。

---

### H2. `video-cache.ts` 的 BV-specific 逻辑

**Files**: `lib/cache/video-cache.ts:11-14,92-94,145-149`

**Problem**:
- `normalizeBvid()` 用正则 `/BV[0-9A-Za-z]+/i` 提取 — YouTube ID 不匹配这个 pattern
- Storage key `local:vc:{bvid}` 没有平台 namespace — 理论上不同平台的 ID 可能碰撞
- `CACHE_DEFAULTS.source` 默认 `'bilibili'`

**Solution**:
- 将 `normalizeBvid` 改为 `normalizeVideoId(platform, id)` — bilibili 走 BV 提取，其他平台 passthrough lowercase
- Key 改为 `local:vc:{platform}:{videoId}`
- 移除默认 source，要求调用者显式传入

---

### H3. Content Script 硬编码 Bilibili URL

**Files**: `entrypoints/bilibili-video.content/index.ts:7`, `entrypoints/bilibili-inject.content.ts`

**Problem**: `matches: ['*://*.bilibili.com/video/*']` — WXT 要求 content script 的 URL match 写在 entrypoint 定义里。每个新平台需要一个新的 entrypoint 文件。

**这是 WXT 架构限制，不是设计错误**。当前 `entrypoints/bilibili-video.content/` 的定位是对的。

**Solution**: 每个平台创建自己的 entrypoint：
- `entrypoints/youtube-video.content/`
- `entrypoints/douyin-video.content/`

内部 App 组件可以抽取共用部分（transcribe button、progress bar、subtitle display），平台差异（video detect、inject 脚本、DOM anchor）各自实现。

---

### H4. `useVideoDetect` 直接 import Bilibili API

**Files**: `entrypoints/bilibili-video.content/hooks/useVideoDetect.ts:2-4`

**Problem**: Import `extractBvid`、`fetchCidByPageList`、`onBiliMessage` — 全是 bilibili 包。YouTube 不需要 CID 概念，不需要 BV 提取，消息协议也不同。

**这个文件位置对了**（在 `bilibili-video.content/` 下），不需要抽象。但如果你想让 content script 的 **UI 组件**跨平台复用（transcribe button、progress bar），需要定义通用的 `VideoDetection` 接口并让各平台 hook 实现。

**Solution**: `VideoDetection` 接口（`videoId`、`pageId`、`title`、`loading`、`error`）提升到 `lib/` 层作为通用契约。各平台各自实现 `useVideoDetect()`。

---

### H5. Dashboard 路由硬编码

**Files**: `entrypoints/app/main.tsx:60`

**Problem**: `path: 'collections/bilibili/:mediaId'` — 只支持 Bilibili 收藏夹。

**Solution**: 改为 `path: 'collections/:platform/:collectionId'`，组件根据 `platform` param 加载对应的 hook。

---

## MEDIUM — 可管理的摩擦

### M1. `wxt.config.ts` host permissions

**Files**: `wxt.config.ts:10-17`

**Problem**: Host permissions 硬编码 `bilibili.com`、`hdslb.com`、`bilivideo.com` 等。新平台需要手动添加。

**Impact**: 低。添加几行 URL 不算架构问题。但可以考虑按平台组织注释。

---

### M2. i18n 中的平台相关 key

**Files**: `lib/i18n/locales/en.ts:17`, `zh-CN.ts:15`

**Problem**: `'source.bilibili': 'Official AI'` — 只有 bilibili 的标签。

**Impact**: 低。加新 key 即可。但如果 SubtitleSource 改为 `'official' | 'asr'`（见 C3），这些 key 也要相应调整。

---

### M3. `video-card.tsx` 状态比较

**Files**: `entrypoints/app/sections/collections/video-card.tsx`

**Problem**: `contentStatus === 'has_bilibili'` 等字面量比较。

**Impact**: 如果 C3 的 SubtitleSource 重构完成，这里自然会跟着改。不是独立问题。

---

### M4. DNR rules

**Files**: `public/rules.json`, `wxt.config.ts:20`

**Problem**: `bilibili_headers` rule — 用于修改请求头绕过 Bilibili referer 限制。

**Impact**: 每个平台可能需要自己的 DNR rule（YouTube 不太需要）。低摩擦。

---

## 总结：多平台路线图优先级

```
Phase 1: 语义解耦（不改行为，只改命名和类型）
  C1 pipeline bvid → videoId
  C3 SubtitleSource 重新设计
  C6 TranscribeRequest 增加 platform
  H1 BackgroundContext bvid → videoId
  H2 video-cache 平台感知

Phase 2: 分发机制
  C2 pipeline source 标签由 adapter 提供
  C4 adapter registry 替代直接调用

Phase 3: 状态机拆层
  C5 AutoTranscribePipeline 抽取通用状态机

Phase 4: 新平台接入
  H3 新 content script entrypoint
  H4 通用 VideoDetection 接口
  H5 路由参数化
```

Phase 1 是纯重构，零功能变更，零风险。完成后 pipeline 和 cache 的接口不再绑定 Bilibili 语义。
Phase 2 引入真正的分发，是支持第二个平台的最小必要架构。
Phase 3 在实际有第二个平台的 auto-transcribe 需求时再做。
Phase 4 是添加具体平台时的实际工作。

---

## 架构优势（保持不变）

以下设计已经是平台无关的，不需要改动：

| Module | Why it's good |
|--------|---------------|
| `lib/database/entities/` | `platform` + `platformItemId` 组合键，`platformMeta: jsonb` — 天然多平台 |
| `lib/database/bridges/` | RPC proxy 完全与业务无关 |
| `lib/ai/index.ts` | LLM factory 按 SDK type 分发 — 与平台无关 |
| `lib/providers.ts` | Provider registry 纯粹是 LLM/ASR 关注点 |
| `lib/transcription/groq-client.ts` | ASR 客户端与平台无关 |
| `lib/offscreen/main.ts` | FFmpeg + audio chunk — 纯粹的音频处理 |
| `lib/storage/settings.ts` | 用户设置与平台无关 |
