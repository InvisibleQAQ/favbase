# 低耦合审计：跨模块耦合问题清单

> 审计时间：2026-06-24
> 审计目标：识别模块间不必要的依赖、实现细节泄漏、接口过浅导致的耦合
> 使用方式：按严重度从高到低逐项修复，每项修复后可独立提交

---

## 1. `audio-extractor` 硬耦合 `bilibili-api` — 跨域泄漏

**严重度**: CRITICAL
**涉及文件**:
- `lib/transcription/audio-extractor.ts`（耦合源）
- `lib/bilibili/bilibili-api.ts`（被穿透）
- `lib/bilibili/types.ts`（类型泄漏：`DashAudioStream`）

**问题**:
`extractAudioUrl()` 直接 import `fetchPlayUrl` 和 `DashAudioStream`。transcription 模块应当平台无关，但音频提取被焊死在 B 站 DASH API 上。没有 seam，实现细节穿透了模块边界。

```
lib/transcription/audio-extractor.ts
  ├── import { fetchPlayUrl } from '../bilibili/bilibili-api'
  └── import type { DashAudioStream } from '../bilibili/types'
```

**修复方向**:
`extractAudioUrl(bvid, cid)` 本质上就是 bilibili 的能力 — 把它移到 `lib/bilibili/` 模块。pipeline 已经通过 `PipelineDeps.extractAudioUrl` 注入，所以 pipeline 本身不需要改。只需要：
1. 将 `extractAudioUrl` 移入 `lib/bilibili/bilibili-api.ts`（或独立 `bilibili/audio.ts`）
2. `transcription-handlers.ts` 从 bilibili 模块导入 `extractAudioUrl`，注入 pipeline deps
3. `audio-extractor.ts` 瘦身为只保留 `fetchAudioBlob`（平台无关的 HTTP 下载）+ `AudioExtractError`
4. 如果 `fetchAudioBlob` 内的 `Referer: bilibili.com` header 也是 B 站特定的，考虑让调用方传入或通过 `declarativeNetRequest` 处理（目前已有规则）

**验证**: transcription 目录下 `grep -r 'bilibili'` 应该零结果。

---

## 2. `pipeline.ts` 导入 3 个具体 Error 类 — 抽象层泄漏

**严重度**: HIGH
**涉及文件**:
- `lib/transcription/pipeline.ts`（耦合源）
- `lib/transcription/groq-client.ts`（`AsrError`）
- `lib/transcription/audio-extractor.ts`（`AudioExtractError`）
- `lib/transcription/audio-fingerprint.ts`（`AudioReuseError`）

**问题**:
`toErrorInfo()` 用 `instanceof` 检查 3 个来自不同具体模块的 Error 类。pipeline 应该只依赖 `PipelineDeps` 接口，但 Error 类把它拉回了对具体实现的依赖。新增 ASR provider 或音频源时，必须修改 pipeline 的 `toErrorInfo`。

```ts
// pipeline.ts — 当前耦合
import { AsrError } from './groq-client';
import { AudioExtractError } from './audio-extractor';
import { AudioReuseError } from './audio-fingerprint';

function toErrorInfo(err: unknown): TranscribeErrorInfo {
  if (err instanceof AsrError) return err.info;
  if (err instanceof AudioExtractError) return err.info;
  if (err instanceof AudioReuseError) return err.info;
  // ...fallback
}
```

**修复方向**:
统一错误协议。在 `lib/transcription/types.ts` 定义：

```ts
export class PipelineError extends Error {
  constructor(public info: TranscribeErrorInfo) {
    super(info.message);
  }
}
```

让 `AsrError`、`AudioExtractError`、`AudioReuseError` 都继承 `PipelineError`。`toErrorInfo()` 简化为：

```ts
function toErrorInfo(err: unknown): TranscribeErrorInfo {
  if (err instanceof PipelineError) return err.info;
  if (err instanceof DOMException && err.name === 'AbortError') { ... }
  // ...fallback
}
```

pipeline.ts 的 import 从 3 个具体模块收窄到 0 个（`PipelineError` 在同目录 types.ts）。

**验证**: `pipeline.ts` 的 import 列表不应包含 `groq-client`、`audio-extractor`、`audio-fingerprint`。

---

## 3. `transcription-handlers.ts` 知道 cache 内部实现 — 接口过浅

**严重度**: HIGH
**涉及文件**:
- `lib/background/transcription-handlers.ts`（耦合源）
- `lib/cache/video-cache.ts`（接口过浅）

**问题**:
`saveCache` 适配器手动调用 `computeRowsHash(rows)` 并构造完整 `VideoCacheEntry`：

```ts
// transcription-handlers.ts L54-62
saveCache: async (id: string, rows: SubtitleRow[]) => {
  await mergeVideoCache(id, {
    bvid: id,
    rows,
    source: 'groq',
    rawHash: computeRowsHash(rows),  // ← cache 内部 hash 策略泄漏
    updatedAt: Date.now(),           // ← cache 内部时间戳策略泄漏
  });
},
```

handler 知道 cache 的数据结构、hash 算法、时间戳策略。这些是 cache 模块的实现细节。

**修复方向**:
加深 cache 接口。`mergeVideoCache` 变为：

```ts
// 修复后的接口：3 个参数，不暴露内部结构
export async function mergeVideoCache(
  bvid: string,
  rows: SubtitleRow[],
  source: 'bilibili' | 'groq',
): Promise<void>
```

`computeRowsHash` 和 `updatedAt` 由 cache 内部计算，不导出。handler 的 `saveCache` 简化为：

```ts
saveCache: (id, rows) => mergeVideoCache(id, rows, 'groq'),
```

**验证**: `computeRowsHash` 不出现在 `video-cache.ts` 的 export 列表中。handler 不 import `computeRowsHash`。

---

## 4. `lib/types.ts` 中央集市 — 无关领域类型混在一起

**严重度**: MEDIUM
**涉及文件**:
- `lib/types.ts`（12+ 模块依赖）
- 所有 import `SubtitleRow`、`UserSettings`、`SdkType` 的文件

**问题**:
一个文件混了 4 个不相关领域：

| 类型 | 领域 | 导入者 |
|------|------|--------|
| `SubtitleRow`, `SubtitleResult`, `RawSubtitleItem` | 字幕 | bilibili, transcription, cache, offscreen, background |
| `SdkType`, `LLMProviderDef`, `ASRProviderDef` | AI Provider | providers.ts, ai/index.ts, hooks |
| `UserSettings` | 用户设置 | storage.ts, hooks |

修改任意领域的类型都可能触发其他无关模块重编译。`UserSettings` 同时引用 `LLMProviderId` 和 `ASRProviderId`，让设置类型与 provider 模块绑死。

**修复方向**:
按领域就近安置：

1. `SubtitleRow` / `SubtitleResult` → `lib/transcription/types.ts`（字幕是 transcription 的核心产出）
2. `RawSubtitleItem` → `lib/bilibili/types.ts`（B 站 API 原始格式）
3. `SdkType` / `LLMProviderDef` / `ASRProviderDef` → 已在 `lib/providers.ts`，直接迁入
4. `UserSettings` → `lib/storage.ts`（与 `settingsStorage` 同模块）
5. 删除 `lib/types.ts`

**验证**: `lib/types.ts` 文件不存在。`grep -r "from '@/lib/types'" lib/` 零结果。

---

## 5. `BackgroundContext` 混杂通用调度与 Bilibili 业务状态

**严重度**: MEDIUM
**涉及文件**:
- `lib/background/types.ts`（定义）
- `lib/background/transcription-handlers.ts`（消费者）
- `entrypoints/background.ts`（构造者）

**问题**:
`BackgroundContext` 同时持有：
- 通用能力：`tabAbortControllers`, `ensureOffscreen`
- Bilibili 特定状态：`tabBvids: Map<number, string>`
- Transcription 特定类型：`notifyTab` 签名耦合 `TranscribeStage` + `TranscribeErrorInfo`

```ts
export interface BackgroundContext {
  tabAbortControllers: Map<number, AbortController>;
  tabBvids: Map<number, string>;  // ← bilibili-specific
  notifyTab(
    tabId: number, bvid: string, progress: number,
    stage: TranscribeStage,       // ← transcription-specific type
    error?: TranscribeErrorInfo,  // ← transcription-specific type
  ): void;
  ensureOffscreen(): Promise<void>;
}
```

扩展到其他视频平台时这个接口会膨胀。types.ts 被迫 import transcription 类型。

**修复方向**:
`tabBvids` 改为 handler 内部状态（闭包或模块级 Map），不注入 context。`notifyTab` 签名改为通用 progress payload：

```ts
export interface BackgroundContext {
  tabAbortControllers: Map<number, AbortController>;
  notifyTab(tabId: number, payload: TabNotification): void;
  ensureOffscreen(): Promise<void>;
}

interface TabNotification {
  contentId: string;  // bvid or future platform ID
  progress: number;
  stage: string;
  error?: { code: string; message: string };
  stageParams?: Record<string, string | number>;
}
```

**验证**: `lib/background/types.ts` 不 import transcription 模块的类型。`tabBvids` 不出现在 `BackgroundContext` 接口中。

---

## 依赖关系图（修复前）

```
transcription-handlers.ts
  ├─→ bilibili/subtitle-processor.ts   (跨域：issue #1 相关)
  ├─→ cache/video-cache.ts             (接口过浅：issue #3)
  │     └── computeRowsHash()          (内部实现泄漏)
  ├─→ transcription/pipeline.ts
  │     ├─→ groq-client.ts             (Error 类耦合：issue #2)
  │     ├─→ audio-extractor.ts          (Error 类耦合：issue #2)
  │     │     └─→ bilibili/bilibili-api.ts  (跨域硬耦合：issue #1)
  │     └─→ audio-fingerprint.ts        (Error 类耦合：issue #2)
  ├─→ transcription/groq-client.ts      (直接导入)
  ├─→ transcription/audio-extractor.ts  (直接导入)
  └─→ transcription/audio-fingerprint.ts (直接导入)
```

## 修复顺序建议

1 → 2 → 3 可以独立并行修复，互不依赖。建议按序号顺序做，因为 #1 修完后 #2 的 `AudioExtractError` 位置会变。
4 是纯重组 + 更新 import 路径，任何时候都可以做，但改动面大（12+ 文件），建议最后批量处理。
5 依赖 #1 的 bvid 概念抽象，可以和 #4 一起做。
