# 架构深化审计：高内聚 / 低耦合

> 审计时间：2026-06-25
> 审计目标：识别模块深度不足（接口与实现复杂度不匹配）、职责分散、实现细节泄漏
> 术语约定：Module（有接口和实现的任何单元）、Interface（调用方必须知道的一切）、Seam（可替换行为的接口位置）、Depth（小接口背后的大行为 = 高杠杆）、Locality（变更/bug/知识集中在一处）
> 使用方式：按编号独立评估，每项可独立修复提交

---

## 候选项总览

| # | 问题 | 严重度 | 涉及文件数 | 核心矛盾 |
|---|------|--------|-----------|----------|
| 1 | `transcription/types.ts` 是四个领域的类型垃圾场 | HIGH | 13+ importers | 零内聚：一个文件定义了转录/缓存/Offscreen/Background 四个领域的类型 |
| 2 | Offscreen 重复实现 Groq 转录 HTTP 调用 | HIGH | 2 files | DRY 违反：~50 行 Groq HTTP 逻辑在 `groq-client.ts` 和 `offscreen/main.ts` 各写一遍 |
| 3 | Background SW 消息调度缺乏统一注册表 | MEDIUM | 4 files | 新增消息类型需改错误的文件（`transcription/types.ts`） |
| 4 | `handleOffscreenProgress` 广播而非定向路由 | MEDIUM-HIGH | 1 file | 多 tab 并发转录时进度推送到所有 tab（语义 bug） |
| 5 | ASR Provider 选择在 pipeline 层硬编码 Groq | HIGH | 2 files | SiliconFlow ASR 是死代码：UI 可选但 pipeline 从不读取 `asrProvider` |
| 6 | `useTranscribe` 与 `useVideoTranscribe` 逻辑重复 | MEDIUM | 2 files | retryCountdown 逐字复制 + 功能不对等（content script 缺少官方字幕优先流程） |
| 7 | 缓存 key 格式泄漏到 `useSubtitle.ts` | LOW-MEDIUM | 2 files | 调用方手动拼 `'vc:' + normalizeBvid(bvid)` 监听存储变化 |
| 8 | `videos-sync.ts` N+1 查询无事务 | MEDIUM | 1 file | 100 视频 = 300 次跨进程 RPC 往返 |
| 9 | `UserSettings` ASR 字段平铺，新增 provider 要改 4 处 | LOW-MEDIUM | 3 files | 每个 ASR provider 加两个顶层字段，无结构化 |
| 10 | `useSettings.ts` re-export 空壳 | LOW | 1 file | 2 行文件，删除测试：删掉复杂度消失 |

---

## 1. `lib/transcription/types.ts` — 四领域类型垃圾场

**涉及文件**: `lib/transcription/types.ts`（198 行，被 13+ 文件导入）

**问题**:
一个文件定义了四个不相关领域的类型：

```
lib/transcription/types.ts
  ├── 转录核心: SubtitleRow, SubtitleResult, TranscribeStage, TranscribeErrorInfo, PipelineError
  ├── Groq API: GroqSegment, GroqTranscriptionResponse, GroqQuota, GroqTranscriptionResult
  ├── Offscreen 协议: OffscreenPrepareRequest, OffscreenTranscribeRequest, OffscreenReleaseRequest, OffscreenProgressMessage, ...
  ├── 缓存: VideoCacheEntry, GetVideoCacheRequest, CacheSubtitleRequest
  └── Background 调度: BgMessage (union of 转录 + 缓存请求)
```

`BgMessage` 把转录请求和缓存请求强行 union 在一起，但两者完全无关。`VideoCacheEntry` 是缓存领域的核心类型，却定义在转录模块里。

**Locality 问题**: 修改缓存协议（比如给 `CacheSubtitleRequest` 加字段）要编辑转录模块的文件。修改 Offscreen 通信协议也要编辑这个文件。四个独立关注点的变更全部汇聚到同一个文件。

**方案**:
拆分为 4 个内聚的类型文件：
- `lib/transcription/types.ts` — 保留：SubtitleRow, SubtitleResult, TranscribeStage/ErrorInfo/ErrorCode, TranscribeRequest/Abort/Response, PipelineError
- `lib/transcription/groq-types.ts` — 移入：GroqSegment, GroqTranscriptionResponse, GroqQuota, GroqTranscriptionResult（或直接内聚到 `groq-client.ts`）
- `lib/offscreen/types.ts` — 移入：Offscreen*Request, Offscreen*Message, ChunkPlan
- `lib/cache/types.ts` — 移入：VideoCacheEntry, GetVideoCacheRequest, CacheSubtitleRequest
- `lib/background/messages.ts` — 新建：BgMessage union，从各领域模块导入成员类型后组合

**收益**:
- **Locality**: 缓存变更只碰缓存文件，Offscreen 协议变更只碰 offscreen 文件
- **Leverage**: 每个类型文件的接口（导出列表）精确匹配其领域
- **测试**: 类型拆分本身不影响运行时，但为后续模块拆分铺路

---

## 2. Offscreen 重复实现 Groq 转录 HTTP 调用

**涉及文件**:
- `lib/transcription/groq-client.ts`（`requestGroqTranscription`，行 68-146）
- `lib/offscreen/main.ts`（`transcribeChunk`，行 306-358）

**问题**:
两个文件各自实现了一遍 Groq Whisper API 的 HTTP 调用：

| 能力 | `groq-client.ts` | `offscreen/main.ts` |
|------|------------------|---------------------|
| FormData 构造 | 有 | 有（重复） |
| 429 Rate Limit 处理 | 有（`parseRetryAfter`） | 有（inline 解析，行为不同） |
| 401 认证错误 | 有 | **缺失** |
| AbortSignal 超时 | 有（`ASR_TASK_TIMEOUT_MS`） | **缺失** |
| 结果解析 | `mapTranscriptionToRows()` 可复用函数 | inline `data.segments.map()` |
| 错误类型 | `AsrError` class | plain object literal |

`offscreen/main.ts` 第 306-358 行的 `transcribeChunk` 是 `requestGroqTranscription` 的劣化副本，缺少超时保护和 401 处理。

**根因**: `offscreen/main.ts` 导入了 `lib/transcription/constants.ts` 的常量，但没有导入 `groq-client.ts` 的函数。Offscreen Document 运行在独立上下文，但它完全可以 import 同一个模块——WXT 打包时 offscreen 入口有独立的 bundle。

**方案**:
`offscreen/main.ts` 的 `transcribeChunk` 改为调用 `requestGroqTranscription(blob, apiKey, model)`，删除重复的 HTTP 逻辑。如果需要去掉 AbortSignal（Offscreen 场景无需外部取消），给 `requestGroqTranscription` 加可选 `signal?` 参数即可。

**收益**:
- **DRY**: 50 行重复代码消失
- **Locality**: Groq API 交互逻辑集中在 `groq-client.ts` 一处，401/429 处理行为统一
- **正确性**: Offscreen 获得超时保护和 401 处理

---

## 3. Background SW 消息调度缺乏统一注册表

**涉及文件**:
- `entrypoints/background.ts`（dispatcher switch，行 36-56）
- `lib/transcription/types.ts`（`BgMessage` union，行 186-190）
- `lib/background/transcription-handlers.ts`
- `lib/background/cache-handlers.ts`

**问题**:
Background SW 接收两种完全不同来源的消息，混在同一个 `onMessage` handler 的 switch 里：

```typescript
// background.ts 行 37-39 — 消息类型是 OffscreenProgressMessage | BgMessage 的 union
// OffscreenProgressMessage 来自 Offscreen Document（内部路由）
// BgMessage 来自 Content Script / app.html（客户端请求）
```

`BgMessage` 定义在 `lib/transcription/types.ts`，但其成员 `GetVideoCacheRequest` 和 `CacheSubtitleRequest` 是缓存领域的，与转录无关。新增一个 Background 消息（比如未来的 `SYNC_TRIGGER`）需要：
1. 在 `lib/transcription/types.ts` 加类型 ← **错误的文件**
2. 在 `BgMessage` union 加成员
3. 在 `background.ts` switch 加 case
4. 在对应 handler 文件加函数

**方案**:
新建 `lib/background/messages.ts`：

```typescript
// lib/background/messages.ts — Background SW 消息注册表（唯一真实来源）
import type { TranscribeRequest, TranscribeAbort } from '@/lib/transcription/types';
import type { GetVideoCacheRequest, CacheSubtitleRequest } from '@/lib/cache/types';
import type { OffscreenProgressMessage } from '@/lib/offscreen/types';

export type BgClientMessage = TranscribeRequest | TranscribeAbort | GetVideoCacheRequest | CacheSubtitleRequest;
export type BgInternalMessage = OffscreenProgressMessage;
export type BgMessage = BgClientMessage | BgInternalMessage;
```

**收益**:
- **Locality**: 新增消息类型在对应领域文件定义类型 + 在 `messages.ts` 注册 = 两步，不碰错误的文件
- **可读性**: `background.ts` 的 switch 注释可以按 `BgClientMessage` / `BgInternalMessage` 分组

---

## 4. `handleOffscreenProgress` 广播而非定向路由

**涉及文件**: `lib/background/transcription-handlers.ts`（行 167-183）

**问题**:
当 Offscreen Document 报告分块转录进度时，`handleOffscreenProgress` 遍历**所有** `tabAbortControllers` 广播进度：

```typescript
// transcription-handlers.ts 行 176-182
for (const [tId] of ctx.tabAbortControllers) {
  const bvid = tabBvids.get(tId) ?? '';  // 每个 tab 有自己的 bvid
  notifyTab(ctx, tId, bvid, progress, 'chunk_transcribing', ...);
}
```

如果 Tab A 正在转录 BV1xxx，Tab B 正在转录 BV2yyy，两个 tab 都会收到对方的进度推送。虽然 UI 侧有 bvid 过滤（`useTranscribe.ts` 行 78: `if (m.bvid && m.bvid.toLowerCase() !== bvid?.toLowerCase()) return`），但：

1. `tabBvids.get(tId)` 返回的是**该 tab 自己的** bvid，不是 Offscreen 报告的 bvid，所以 Tab B 收到的进度消息 bvid 字段是 `BV2yyy`（Tab B 自己的），**不是** `BV1xxx`（实际产生进度的那个）
2. `OffscreenProgressMessage.sessionId` 字段包含 `${bvid}_${Date.now()}`（行 104），本可用于路由回正确的 tab，但 `handleOffscreenProgress` 从未解析 sessionId

**当前状态**: 单 tab 转录时无感知（只有一个 entry），多 tab 并发时进度条错乱。

**方案**:
解析 `sessionId` 提取 bvid → 在 `tabBvids` 中反向查找 tabId → 只通知该 tab。或者维护 `sessionId → tabId` 的映射（在 `handleTranscribe` 中注册，在 `finally` 中清理）。

**收益**:
- **正确性**: 多 tab 并发转录时进度准确路由
- **Locality**: 路由逻辑集中在 `handleOffscreenProgress` 内部，UI 侧的 bvid 过滤变成冗余安全网而非必要防线

---

## 5. ASR Provider 选择在 pipeline 层硬编码 Groq

**涉及文件**:
- `lib/background/transcription-handlers.ts`（行 69-71）
- `lib/storage.ts`（行 14: `asrProvider: ASRProviderId`）

**问题**:
`UserSettings` 定义了 `asrProvider` 字段，UI 层可选择 Groq 或 SiliconFlow，但 pipeline 层完全忽略这个字段：

```typescript
// transcription-handlers.ts 行 69-71 — 硬编码 Groq
getAsrConfig: async () => {
  const s = await settingsStorage.getValue();
  return { apiKey: s.groqApiKey, model: s.groqModel || 'whisper-large-v3-turbo' };
},
```

`s.asrProvider` 从未被读取。如果用户在 Settings 页面选择 SiliconFlow 并填入 API Key，点击转录按钮仍然会使用 Groq 的 key 和 model。`siliconFlowApiKey` 和 `siliconFlowAsrModel` 两个字段在整个 pipeline 链路中是**死代码**。

**根因**: `getAsrConfig` 在 `PipelineDeps` 中定义为 `() => Promise<{ apiKey: string; model: string }>`，这个接口本身是正确的（不关心具体 provider），但适配器（`transcription-handlers.ts`）绕过了 `asrProvider` 选择逻辑。

**方案**:
```typescript
getAsrConfig: async () => {
  const s = await settingsStorage.getValue();
  if (s.asrProvider === 'siliconflow') {
    return { apiKey: s.siliconFlowApiKey, model: s.siliconFlowAsrModel || 'FunAudioLLM/SenseVoiceSmall' };
  }
  return { apiKey: s.groqApiKey, model: s.groqModel || 'whisper-large-v3-turbo' };
},
```

更好的做法是在 `lib/hooks/useSettings.ts` 已有的 `ASR_FIELD_MAP` 模式基础上，提取一个 `resolveAsrConfig(settings: UserSettings)` 纯函数，让 UI 层和 pipeline 层共享同一个解析逻辑。

**收益**:
- **正确性**: SiliconFlow ASR 从死代码变成可用功能
- **Locality**: ASR provider 解析逻辑集中一处，新增 provider 不会再次遗漏 pipeline 层

---

## 6. `useTranscribe` 与 `useVideoTranscribe` 逻辑重复 + 功能不对等

**涉及文件**:
- `entrypoints/bilibili-video.content/hooks/useTranscribe.ts`（184 行）
- `entrypoints/app/sections/collections/use-video-transcribe.ts`（324 行）

**问题**:

### 6a. retryCountdown 逐字复制

两个 hook 中 retryCountdown 逻辑完全相同（`useTranscribe.ts` 行 138-153，`use-video-transcribe.ts` 行 265-279）：

```typescript
// 完全相同的 15 行代码出现在两处
if (res.error.retryAfter) {
  let remaining = res.error.retryAfter;
  setState((prev) => ({ ...prev, retryCountdown: remaining }));
  countdownRef.current = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = null;
      setState((prev) => ({ ...prev, retryCountdown: 0 }));
    } else {
      setState((prev) => ({ ...prev, retryCountdown: remaining }));
    }
  }, 1000);
}
```

### 6b. 功能不对等

`useVideoTranscribe`（app.html 收藏夹页面）实现了"官方字幕优先 → ASR 降级"两步流程（行 179-215），但 `useTranscribe`（content script 视频页面）直接跳到 ASR，不尝试官方字幕。

这意味着用户在 B 站视频页面的 content script 面板点"转录"，即使该视频有官方字幕，也会消耗 Groq API 配额。而在 app.html 收藏夹页面点"转录"，会优先拉取免费的官方字幕。

**方案**:
1. 提取 `lib/hooks/useRetryCountdown.ts` 消除 retryCountdown 重复
2. 将"官方字幕优先 → ASR 降级"流程下沉到 Background SW pipeline 层（`runTranscriptionPipeline` 的 `checkCache` deps 之后加一步 `checkOfficialSubtitle`），让两个 UI hook 共享同一个转录策略
3. 或者更实际：提取 `lib/transcription/subtitle-first-strategy.ts` 作为共享逻辑，两个 hook 都调用

**收益**:
- **DRY**: 15 行 retryCountdown 只存在一处
- **功能对等**: 两个入口的转录行为一致，content script 用户不再浪费 ASR 配额
- **Locality**: 转录策略变更（比如加第三个字幕来源）只改一处

---

## 7. 缓存 key 格式泄漏到 `useSubtitle.ts`

**涉及文件**:
- `lib/cache/video-cache.ts`（`normalizeBvid` 导出，内部 key 格式 `vc:{bvid}`）
- `entrypoints/bilibili-video.content/hooks/useSubtitle.ts`（行 219-221）

**问题**:
`useSubtitle.ts` 直接构造缓存内部的 storage key 来监听跨 tab 变化：

```typescript
// useSubtitle.ts 行 220
const key = 'vc:' + normalizeBvid(bvid);
if (!changes[key]) return;
```

如果 `video-cache.ts` 将 key 格式从 `vc:{bvid}` 改为 `cache:v2:{bvid}`，`useSubtitle.ts` 会静默失效，跨 tab 同步功能消失，没有编译错误。

**方案**:
在 `video-cache.ts` 导出 `onVideoCacheChange(bvid: string, cb: (entry: VideoCacheEntry) => void): () => void`，内部封装 `chrome.storage.onChanged` + key 匹配逻辑。调用方不需要知道 key 格式。

**收益**:
- **Depth**: 缓存模块接口更深——调用方只说"我要监听这个 bvid 的变化"，内部如何存储是实现细节
- **安全**: key 格式变更不会静默破坏跨 tab 同步

---

## 8. `videos-sync.ts` N+1 查询无事务

**涉及文件**: `lib/bilibili/videos-sync.ts`（115 行）

**问题**:
每个视频的同步执行 3 次独立 DB 操作（author upsert + item upsert + item_sources upsert），均通过 PGlite RPC 桥（app.html → Background SW → Offscreen）跨进程往返。

对于一个包含 100 个视频的收藏夹，产生 300 次 RPC 往返。按每次 30ms 计算（Port 中继 + IPC），纯通信延迟约 9 秒。

```
for (const video of videos) {           // N 次循环
  await db.select().from(authors)...     // 1st RPC
  await db.insert(authors)...            // 2nd RPC (if new)
  await db.select().from(items)...       // 3rd RPC
  await db.insert(items)...              // 4th RPC (if new)
  await db.select().from(itemSources)... // 5th RPC
  await db.insert(itemSources)...        // 6th RPC (if new)
}
```

另外，无事务包裹意味着 video[50] 同步失败后，前 50 个已写入、后 49 个未写入，无法回滚到一致状态。虽然 per-video try/catch 设计上容忍部分失败，但 author 和 item 之间的关联也没有事务保护。

**方案**:
1. 使用 `INSERT ... ON CONFLICT DO NOTHING` 替代 select-then-insert 模式，减少一半 RPC
2. 批量 insert（Drizzle 支持 `.values([...])` 数组）减少 RPC 次数到 3 次（authors batch + items batch + item_sources batch）
3. 外层包事务（PGlite 支持）保证原子性
4. 如果 PGlite RPC 不支持事务代理，至少将 select-then-insert 合并为 upsert

**收益**:
- **性能**: 300 次 RPC → ~3-6 次，从 9 秒降到 <1 秒
- **正确性**: 事务保证原子性
- **Depth**: `syncFavVideosToDb` 的接口不变（传入 videos 数组），实现从串行变批量

---

## 9. `UserSettings` ASR 字段平铺

**涉及文件**:
- `lib/storage.ts`（行 14-18）
- `lib/hooks/useSettings.ts`（`ASR_FIELD_MAP`）
- `lib/background/transcription-handlers.ts`（行 69-71）

**问题**:
每个 ASR provider 占用两个顶层字段：

```typescript
interface UserSettings {
  asrProvider: ASRProviderId;
  groqApiKey: string;         // Groq 专属
  groqModel: string;          // Groq 专属
  siliconFlowApiKey: string;  // SiliconFlow 专属
  siliconFlowAsrModel: string; // SiliconFlow 专属
}
```

新增第三个 ASR provider 需要：
1. `lib/storage.ts`: 加 2 个字段到 `UserSettings` + `DEFAULT_SETTINGS`
2. `lib/hooks/useSettings.ts`: 加 `ASR_FIELD_MAP` 条目
3. `lib/background/transcription-handlers.ts`: 加 if 分支（见 #5）
4. `lib/providers.ts`: 加 `ASR_PROVIDER_IDS`

**方案**:
将 ASR 配置结构化为 `Record<ASRProviderId, { apiKey: string; model: string }>`：

```typescript
interface UserSettings {
  asrProvider: ASRProviderId;
  asrConfigs: Record<string, { apiKey: string; model: string }>;
  // ... 其他字段不变
}
```

需要数据迁移（从平铺字段读取 → 写入新结构），但迁移逻辑可以放在 `settingsStorage` 的 `init` 或 `getValue` 里一次性完成。

**收益**:
- **Locality**: 新增 ASR provider 只需在 `providers.ts` 加定义 + `DEFAULT_SETTINGS` 加默认值
- **Depth**: `getAsrConfig` 从 if/else 链变成单行 `settings.asrConfigs[settings.asrProvider]`

---

## 10. Content Script `useSettings.ts` 空壳 re-export

**涉及文件**: `entrypoints/bilibili-video.content/hooks/useSettings.ts`（2 行）

**问题**:
```typescript
export { useSettings } from '@/lib/hooks/useSettings';
export type { UseSettingsReturn, LlmUpdate, AsrUpdate } from '@/lib/hooks/useSettings';
```

**删除测试**: 删掉这个文件，复杂度消失（调用方直接 import `@/lib/hooks/useSettings`）。不删，调用方需要知道"这个 re-export 存在"这个多余的知识。

这个文件存在的唯一理由是维持 `./hooks/useSettings` 的本地导入路径约定。但 Content Script 的其他 hook（`useSubtitle.ts`、`useTranscribe.ts`、`useVideoDetect.ts`）都有实际逻辑，不是 re-export。一个 re-export 混在三个真实 hook 中间，反而制造困惑。

**方案**: 删除文件，所有调用方改为 `import { useSettings } from '@/lib/hooks/useSettings'`。

**收益**: 消除一个浅模块，减少一次错误的间接层。

---

## 优先级建议

### P0 — 正确性问题，应立即修复
- **#5** ASR Provider 硬编码：SiliconFlow 是死代码
- **#4** 进度广播 bug：多 tab 并发时进度错乱

### P1 — DRY / 一致性，下个迭代修复
- **#2** Offscreen Groq 重复代码
- **#6** 转录 hook 重复 + 功能不对等
- **#1** 类型文件拆分（为 #3 铺路）

### P2 — 架构改善，按需修复
- **#3** Background 消息注册表
- **#7** 缓存 key 泄漏
- **#8** N+1 查询优化
- **#9** ASR 字段结构化
- **#10** 删除 re-export 空壳

---

## 架构健康评估

### 做得好的部分

| 模块 | 评价 |
|------|------|
| `PipelineDeps` 接口 (`pipeline.ts`) | **深模块典范**：小接口（8 个 deps）背后编排 8 阶段转录流程，完全可测试 |
| `InjectStateMachine` (`inject/state.ts`) | 状态机 + 副作用注入，纯逻辑可单测 |
| `RpcTransport` (`bridges/types.ts`) | 传输层解耦，proxy-driver 不知道底层用 Chrome Port |
| `BackgroundContext` (`background/types.ts`) | 正确的 seam：handler 不直接碰 chrome.tabs API |
| `subtitle-processor.ts` | 纯函数四步管线，无外部依赖 |
| `ASR_FIELD_MAP` 模式 | 数据驱动替代 if/else，可扩展 |

### 整体判断

代码库在 **pipeline 深模块** 和 **注入式副作用** 方面做得好（`PipelineDeps`、`InjectEffects`），这是正确的架构方向。主要摩擦集中在：

1. **类型文件内聚性**：`transcription/types.ts` 承担了过多职责
2. **UI 层重复**：两个转录 hook 复制了相同的状态机逻辑
3. **配置 → pipeline 断裂**：用户选择的 ASR provider 在 pipeline 层被忽略
4. **数据同步性能**：串行 RPC 模式在大数据量时会成为瓶颈

这些问题不是"设计错误"，而是 MVP 阶段的合理取舍在功能增长后产生的摩擦。修复它们会让代码库从"能跑"进化到"好维护"。
