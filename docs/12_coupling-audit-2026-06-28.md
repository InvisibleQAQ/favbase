# 耦合审计 #3 — 跨层依赖与类型泄漏

> 审计日期：2026-06-28 | 前置：doc 10 / doc 11 中的问题大部分已修复  
> 聚焦：跨层反向依赖、类型硬编码扩散、模块归属错位、浅模块识别  
> 术语：**Module**（有接口和实现的单元）、**Depth**（小接口背后隐藏大量实现 = 深）、**Shallow**（接口与实现同等复杂）、**Seam**（可替换行为的接口位置）、**Locality**（变更/bug/知识集中在一处）、**Leverage**（调用方从深度获得的收益）

---

## 上次审计修复确认

doc 10 的 10 项中 **8 项已修复**（类型拆分、Offscreen 重复调用、消息注册表、ASR provider 硬编码、retryCountdown 重复、缓存 key 泄漏、ASR 字段结构化、re-export 空壳）。doc 11 的 10 项中 **7 项已修复**（useAutoTranscribe 拆分、TranscriptionCoordinator 提取、bili-sync-service 创建、PipelineDeps 收窄至 5 方法、错误类型扁平化、Background dispatcher 统一、Storage 集中化）。

以下是**当前代码库的新问题**，按严重程度排序。

---

## 严重程度：HIGH

### 1. `pipeline.ts` 反向依赖 bilibili 域模块

**文件**: `lib/transcription/pipeline.ts:9`

```typescript
import { processSubtitles } from '@/lib/bilibili/subtitle-processor';
```

**问题**: `pipeline.ts` 是平台无关的转录编排器（接受 DI 的 `PipelineDeps`），却硬依赖 `lib/bilibili/subtitle-processor`。这是**反向依赖**：通用层 → 领域层。`processSubtitles()` 的实现本身是通用的（normalize + filter + dedup，接受 `{from,to,content}` 或 `{start,end,text}` 两种格式），但它放在 `lib/bilibili/` 目录下，语义上标记为 bilibili 专属。

**后果**:
- 添加第二个平台（如 YouTube）时，通用 pipeline 仍然拖着 bilibili 模块
- 依赖图 `lib/transcription/ → lib/bilibili/` 违反分层原则
- Deletion test：如果删除 bilibili 整个目录，pipeline.ts 编译失败

**方案**: 将 `subtitle-processor.ts` 从 `lib/bilibili/` 移到 `lib/transcription/`。函数本身不含 bilibili 特有逻辑（中文填充词 `嗯/啊/然后` 是语言特征不是平台特征），移动后不需要任何代码修改，只需更新 2 处 import 路径。

**收益**:
- 依赖方向正确化：bilibili → transcription（单向），transcription 不再反向依赖 bilibili
- Locality：字幕处理算法变更只碰 transcription 目录

---

### 2. `'bilibili' | 'groq'` 硬编码扩散至 15+ 文件

**涉及文件**: `lib/cache/types.ts:6,20` · `lib/transcription/types.ts:10,76` · `lib/transcription/pipeline.ts:33,37` · `lib/background/transcription-handlers.ts:206` · `lib/bilibili/content-sync.ts:17` · `lib/bilibili/bili-sync-service.ts:177` · `lib/bilibili/transcription-coordinator.ts:100` · `entrypoints/bilibili-video.content/App.tsx:28` · `entrypoints/bilibili-video.content/hooks/useSubtitle.ts:13,71` · `entrypoints/bilibili-video.content/components/Panel.tsx:28` · `entrypoints/bilibili-video.content/components/SubtitleView.tsx:8,50`

**问题**: `source: 'bilibili' | 'groq'` 作为字面类型 union 散布在 15+ 文件中。这不是类型定义——它是**内联的 magic string 重复**。添加第三个来源（如 `'whisper-local'`、`'youtube'`）需要找到并修改所有出现位置，无编译器辅助（字面量 union 不会报错，只会让新值无法赋值到旧位置）。

**方案**: 在 `lib/transcription/types.ts` 定义单一来源：

```typescript
export type SubtitleSource = 'bilibili' | 'groq';
```

所有 15+ 处改为引用 `SubtitleSource` 类型。新增来源只需改这一处定义。

**收益**:
- Locality：来源类型的修改集中到一行
- 编译器辅助：IDE "Find References" 可以找到所有消费点
- 认知负担减轻：看到 `SubtitleSource` 就知道是同一个概念，不用猜 `'bilibili' | 'groq'` 是否和其他地方的 `'bilibili' | 'groq'` 相同

---

### 3. `transcription-handlers.ts` — bilibili 特定知识泄漏到 Background 通用层

**文件**: `lib/background/transcription-handlers.ts`（258 行）

**问题**: 这个文件是 Background SW 的转录消息处理器，**应该是平台无关的调度层**，但它直接导入了 4 个 bilibili-specific 函数：

```typescript
// line 22-27
import {
  extractBiliAudioUrl,
  getBiliAuth,
  fetchCidByPageList,
  fetchSubtitle,
} from '@/lib/bilibili/bilibili-api';
```

具体泄漏点：
- `line 62-86`: `createFetchOfficialSubtitle()` 内嵌 bilibili 字幕 API 重试逻辑
- `line 106`: `extractBiliAudioUrl(bvid, cid)` — bilibili DASH manifest 解析
- `line 194`: `getBiliAuth()` — bilibili cookie 认证
- `line 195`: `fetchCidByPageList()` — bilibili CID 获取

**后果**: 添加第二个平台需要在这个 handler 里加 if/else 分支，或者复制一个新 handler。handler 的接口（`TranscribeRequest`）已经是 bilibili-specific 的（`bvid`、`cid` 字段），但这可以通过泛化请求类型来解决——问题是实现也是 bilibili-specific 的。

**方案**: 提取 `lib/bilibili/bilibili-transcription-adapter.ts`，实现 `PipelineDeps` 接口的 bilibili 适配。handler 只负责：接收请求 → 选择平台适配器 → 调用 pipeline → 返回结果。

```
Before:  handler → [bilibili-api + groq-client + cache + pipeline] (全揉在一起)
After:   handler → adapter(platform) → pipeline(deps)
```

**收益**:
- Leverage：handler 对外只做调度，不关心平台细节
- Locality：bilibili 认证/CID/字幕获取的变更集中在适配器
- 可测试：适配器可独立单元测试

---

## 严重程度：MEDIUM

### 4. `bilibili-api.ts` 反向导入 `transcription/types`

**文件**: `lib/bilibili/bilibili-api.ts:7`

```typescript
import type { SubtitleResult, SubtitleRow } from '../transcription/types';
```

**问题**: bilibili API 模块的 `fetchSubtitle()` 函数返回 `SubtitleResult`（含 `SubtitleRow[]`）。这意味着 bilibili API 层的**返回类型**由 transcription 层定义。依赖方向：`bilibili → transcription`，但 transcription 的 pipeline 也间接消费 bilibili 的输出。

这不是致命问题（bilibili 依赖 transcription 类型是合理的方向），但 `SubtitleRow` 作为一个 `{ start: number; end: number; text: string }` 的简单结构，被放在 `transcription/types.ts` 暗示它是"转录"的概念——实际上它是**通用字幕行**，bilibili 官方字幕和 ASR 转录都使用。

**方案**: 将 `SubtitleRow` 和 `SubtitleResult` 移到共享位置（如 `lib/types.ts` 或 `lib/subtitle/types.ts`），作为平台无关的字幕数据结构。或者保持现状但通过 `SubtitleSource` 类型（#2）统一来源标记。

**优先级**: 可与 #1 合并处理。如果 `subtitle-processor.ts` 迁移到 `lib/transcription/`，那么 `SubtitleRow` 留在 `transcription/types.ts` 也说得通。

---

### 5. bilibili 域 4 个模块反向导入 `transcription/types`

**文件**: 
- `lib/bilibili/content-sync.ts:5` → `SubtitleRow`
- `lib/bilibili/bili-sync-service.ts:12` → `SubtitleRow`
- `lib/bilibili/transcribe-utils.ts:1` → `TranscribeResponse, TranscribeStatusPush`
- `lib/bilibili/transcription-coordinator.ts:4` → `TranscribeStage, TranscribeErrorInfo`

**问题**: bilibili 域的 4 个模块导入 transcription 层的类型。方向上 bilibili → transcription 是合理的（bilibili 是 transcription 的消费者），但导入的范围过宽：
- `content-sync.ts` 只需要 `SubtitleRow`（数据结构）— 合理
- `bili-sync-service.ts` 只需要 `SubtitleRow`（透传）— 合理
- `transcribe-utils.ts` 需要 `TranscribeResponse, TranscribeStatusPush`（IPC 协议类型）— **边界泄漏**
- `transcription-coordinator.ts` 需要 `TranscribeStage, TranscribeErrorInfo`（UI 状态类型）— **边界泄漏**

`transcribe-utils.ts` 和 `transcription-coordinator.ts` 直接与 Background SW 的 IPC 协议耦合（`browser.runtime.sendMessage`/`onMessage`），知道 `TRANSCRIBE_AUDIO` 和 `TRANSCRIBE_STATUS` 消息类型的内部结构。

**方案**: `transcribe-utils.ts` 的两个函数（`transcribeAndPersist` + `createStatusListener`）是 bilibili → Background IPC 的桥接，它们对 IPC 协议的了解是**必要的**。问题不在于类型导入本身，而在于 `transcribe-utils.ts` 是否值得存在（见 #6）。

---

### 6. `transcribe-utils.ts` — 删除测试失败的浅模块

**文件**: `lib/bilibili/transcribe-utils.ts`（34 行，2 个导出函数）

**问题**: 
- `transcribeAndPersist()` = 发送 `browser.runtime.sendMessage` + 成功时调用 `persistContent`（15 行）
- `createStatusListener()` = 订阅 `browser.runtime.onMessage` + bvid 匹配 + 回调（13 行）

**删除测试**: 如果删除这个文件，28 行逻辑分散到 2 个消费者（`transcription-coordinator.ts` 和 `auto-transcribe-pipeline.ts`）。每个消费者增加约 15 行。但这 15 行的逻辑**几乎相同**——所以这个模块的存在确实在消除重复。

**重新评估**: 这个模块通过了删除测试（删除后复杂度不消失，而是分散到 N 个调用方）。它是**合理的薄共享层**，不是 pass-through。

**结论**: 保留，不需要修改。**从候选列表移除。**

---

### 7. `handleOffscreenProgress` 降级广播仍存在

**文件**: `lib/background/transcription-handlers.ts:237-257`

**问题**: doc 10 #4 指出的进度广播问题已**部分修复**：主路径通过 `ctx.resolveProgressTarget(msg.sessionId)` 精确路由（line 248-252）。但降级路径（line 254-256）仍然遍历所有活跃转录广播：

```typescript
for (const t of ctx.getActiveTranscriptions()) {
  notifyTab(ctx, t.tabId, t.bvid, progress, 'chunk_transcribing', undefined, stageParams);
}
```

**风险**: 如果 `resolveProgressTarget` 返回 `undefined`（sessionId 竞态、注册/注销时序错误），所有 tab 收到错误的进度。这条降级路径**不应该存在**——如果 sessionId 无法解析，说明出了 bug，应该 warn + 丢弃，而不是给所有 tab 推假进度。

**方案**: 将降级分支改为 `console.warn` + `return`，不广播。

**收益**: 多 tab 并发转录时不会出现幽灵进度条

---

## 严重程度：LOW

### 8. 缓存 key 常量未纳入中央注册表

**文件**: `lib/storage/keys.ts` · `lib/cache/video-cache.ts`

**问题**: `keys.ts` 用注释标记了缓存 key 格式（`videoCachePrefix: 'local:vc:{bvid}'`），但实际常量 `CHROME_KEY_PREFIX = 'vc:'` 定义在 `video-cache.ts` 内部。注册表不完整：如果有人在 `keys.ts` 新增 key `'local:vc:something'`，不会意识到与缓存 key 冲突。

**方案**: 在 `keys.ts` 导出 `VIDEO_CACHE_PREFIX = 'vc:'` 常量，`video-cache.ts` 从 keys 导入。保持 key 注册表是唯一的命名空间真实来源。

**风险**: 低。当前只有 video-cache.ts 使用这个前缀，冲突概率极低。

---

### 9. Settings 组件跳过 hook 层直接导入 `lib/ai`

**文件**: `entrypoints/app/sections/settings/llm-config-card.tsx:25`

```typescript
import { testLlmConnection, fetchAvailableModels, type TestConnectionResult } from '@/lib/ai';
```

**问题**: 其他设置操作通过 `useSettings` hook 抽象（`updateLlm`/`updateAsr`），但 AI 连接测试和模型列表获取直接从 `lib/ai` 导入业务函数。这不是严重耦合（组件确实需要这些功能），但违反了 Settings 页面的统一抽象模式。

**方案**: 两个选择：
1. 创建 `useAiConfig` hook 包装 `testLlmConnection` 和 `fetchAvailableModels`（增加一个模块）
2. 保持现状，接受 Settings 页面对 `lib/ai` 的直接依赖（AI 操作不涉及状态持久化，不属于 `useSettings` 的职责范围）

**建议**: 选 2 — 保持现状。`testLlmConnection` 是无状态操作，强行包一个 hook 增加的接口复杂度超过它隐藏的实现复杂度（shallow module 反模式）。**从候选列表移除。**

---

## 依赖关系与建议执行顺序

```
#1 subtitle-processor 迁移（5 分钟，只改 2 处 import）
     │
     ▼
#2 SubtitleSource 类型提取（30 分钟，改 15+ 处字面量 → 类型引用）
     │
     ▼
#3 bilibili-transcription-adapter 提取（1-2 小时，需要重构 handler）
     │
     ▼
#7 handleOffscreenProgress 降级广播移除（5 分钟）
     │
     ▼
#8 缓存 key 常量注册（5 分钟）
```

\#1 和 #2 可以独立提交。#3 是最大的重构，但只在添加第二个平台时才有实际 ROI——MVP 阶段可以推迟。#4 和 #5 是类型层面的分析，结论是当前依赖方向基本合理，不需要改动。#6 和 #9 经过重新评估后从候选列表移除。

---

## 架构健康评估

### 较上次审计改善的部分

| 模块 | 改善 |
|------|------|
| `TranscriptionCoordinator` | 从 250 行 hook 变成纯 JS class + 58 行 hook 包装 |
| `AutoTranscribePipeline` | 从 491 行 hook 变成纯逻辑 class + 54 行 hook 包装 |
| `bili-sync-service` | DB schema 知识集中，hook 层不再直接操作 drizzle |
| `PipelineDeps` | 从 10 方法收窄到 5 方法 |
| 错误模型 | 从类继承变成 `createErrorInfo()` 纯数据工厂 |
| 消息注册表 | `lib/background/messages.ts` 统一管理，handler 签名一致 |
| i18n | observable locale + `useSyncExternalStore`，运行时切换 |

### 剩余摩擦

代码库的主要架构问题从"模块深度不足"转向了"跨层依赖方向"：
1. `transcription/pipeline.ts` → `bilibili/subtitle-processor.ts`（通用层反向依赖领域层）
2. `background/transcription-handlers.ts` → `bilibili/bilibili-api.ts`（调度层混入领域实现）
3. `'bilibili' | 'groq'` 字面量扩散（缺少类型别名的单一来源）

这些问题在 **MVP 单平台阶段影响有限**——只有一个平台（Bilibili）时，"平台无关"是理论追求。但一旦添加第二个平台（PRD 提到 YouTube/知乎），这些耦合点会成为阻塞性问题。建议在添加第二个平台之前完成 #1 和 #2（合计 35 分钟），#3 可以在那时再做。
