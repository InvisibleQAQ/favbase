# 高内聚低耦合架构审计

> 审计日期：2026-06-27 | 聚焦：模块深度、接口宽度、职责归属、知识泄漏

术语约定：**Module**（有接口和实现的单元）、**Depth**（接口小而实现丰富=深）、**Shallow**（接口与实现同等复杂）、**Seam**（可替换行为的接口边界）、**Leverage**（调用方从深度获得的收益）、**Locality**（维护者从深度获得的收益：变更/bug/知识集中于一处）。

---

## 严重程度：高

### 1. `useAutoTranscribe` — 491 行 hook 混合 4 层职责

**文件**: `entrypoints/app/sections/collections/use-auto-transcribe.ts`

**问题**: 完整的后台流水线伪装成 React hook——分页爬取、DB 写入、逐个转录、429 退避、断点续传全部揉在一起。UI 状态更新和业务编排完全纠缠。Locality 为零：改分页逻辑要读转录逻辑，改 UI 状态要理解 DB 查询。用户切页/组件卸载时，闭包内的 pipeline 行为不可预测。

**方案**: 将爬取+转录编排抽到 `lib/bilibili/auto-transcribe-worker.ts`（纯逻辑模块，通过 Background SW 消息通道运行）。hook 退化为 UI observer——订阅进度事件、暴露 start/stop。

**收益**:
- Leverage — worker 对外只暴露 `start(mediaId)` / `stop()` / `onProgress(cb)` 三个操作，内部 491 行编排对调用方不可见
- Locality — 分页、限流、DB 持久化的 bug 集中在一个文件修
- 测试 — worker 可脱离 React 单元测试

---

### 2. `useVideoTranscribe` — 250 行状态机嵌入 hook

**文件**: `entrypoints/app/sections/collections/use-video-transcribe.ts`

**问题**: 批量缓存预加载、per-video 转录状态 Map、Background 消息监听、重试倒计时、DB 持久化——全在一个 hook 里。与 `useAutoTranscribe` 存在重复的消息监听和状态管理模式（都监听 `TRANSCRIBE_STATUS`，都调 `persistSubtitleContent`）。接口约等于实现（shallow）：调用方需要理解 `videoStates` Map 的内部结构才能正确渲染。

**方案**: 抽取 `TranscriptionCoordinator` class（纯状态机，不依赖 React），hook 变成 `useSyncExternalStore` 的薄包装。Coordinator 和 auto-transcribe worker 共享消息监听和持久化逻辑。

**收益**:
- Leverage — Coordinator 对外暴露 `getState(bvid)` / `transcribe(bvid)` / `cancel(bvid)`，两个消费者（手动卡片、自动流水线）共享同一实例，消除重复
- 测试 — 状态机可以用纯 JS 测试全部转换路径

---

### 3. Bilibili 领域知识分散在 6 个文件

**文件**: `lib/bilibili/bilibili-api.ts`, `favorites-sync.ts`, `videos-sync.ts`, `content-sync.ts`, `messaging.ts`, `inject/`

**问题**: 认证（`getBiliAuth`）在 `bilibili-api.ts` 定义，但被 3 个 hook 独立调用，没有缓存或刷新策略。`favorites-sync` / `videos-sync` / `content-sync` 三个同步函数各自独立写 DB，没有统一的事务边界或错误策略。调用方（hook 层）需要自己编排 "先查 source -> 再 sync videos -> 再查 pending" 的流程。知识泄漏：hook 层知道太多 DB schema 细节。

**方案**: 创建 `lib/bilibili/bili-sync-service.ts` 深模块，统一管理认证状态（缓存 + 过期检查）和三层同步（folders -> videos -> content），对外暴露 `syncFolder(mediaId)` / `getPendingVideos(mediaId)` 等高层操作。

**收益**:
- Leverage — 调用方不需要知道 "先查 sources 表拿 sourceId" 这种实现细节
- Locality — 认证过期、同步冲突、DB 事务边界的 bug 集中在一个模块

---

## 严重程度：中

### 4. `PipelineDeps` 10 方法 DI 接口 — 接口比实现还宽

**文件**: `lib/transcription/pipeline.ts`, `lib/background/transcription-handlers.ts`

**问题**: `PipelineDeps` 有 10 个方法，但 `runTranscriptionPipeline` 只有 ~70 行编排逻辑。接口的认知负担超过了它隐藏的复杂性。更严重的是，`transcription-handlers.ts` 中构造 `transcribeChunked` 适配器时，190+ 行的 offscreen 会话管理逻辑被塞进了一个函数参数——DI 没有隔离策略，只是把实现搬到了注入点。

**方案**: 将 `PipelineDeps` 收窄到 5 个方法（`getConfig` / `fetchOfficialSubtitle` / `transcribeAudio` / `saveResult` / `reportProgress`），把 "官方字幕优先 -> ASR 降级" 这个策略从 `handleTranscribe` 移入 pipeline 内部。`transcribeAudio` 只负责 "给 audioUrl 返回字幕行"，chunking 决策在其实现内部。

**收益**:
- Leverage — pipeline 对外只需要知道 "有没有官方字幕" 和 "转录音频"，不需要区分 direct/chunked
- Locality — chunking 策略和 offscreen 会话管理集中在 pipeline 实现内

---

### 5. 错误类型层级 — 3 层包装无区分

**文件**: `lib/transcription/types.ts`, `groq-client.ts`, `audio-extractor.ts`, `pipeline.ts`

**问题**: `PipelineError` -> `AsrError` / `AudioExtractError` / `AudioReuseError` 的继承层级存在，但 pipeline 对所有子类做同样的 catch，handler 也不区分子类。类层级增加了概念数量但没有增加信息。同时，`offscreen/main.ts` 直接构造 `TranscribeErrorInfo` 而不是抛错误类——IPC 边界上类继承本来就不能穿透。

**方案**: 删除 `PipelineError` / `AsrError` / `AudioExtractError` / `AudioReuseError` 四个类。统一使用 `TranscribeErrorInfo`（纯数据对象）+ 工厂函数 `createErrorInfo(code, message, params?)`。error code 已经是 discriminant，不需要类层级。

**收益**:
- 消除 4 个类定义 + 3 层 catch-rewrap 逻辑
- 错误创建集中到工厂函数（locality），序列化穿透 IPC 天然兼容

---

### 6. 缓存检查逻辑分散在 3 个调用点

**文件**: `lib/cache/video-cache.ts`, `lib/background/transcription-handlers.ts`, `entrypoints/app/sections/collections/use-video-transcribe.ts`, `lib/transcription/pipeline.ts`

**问题**: "检查缓存 -> 命中则返回 -> 未命中则继续" 这个策略在 3 个地方独立实现，每个地方对 cache miss 的处理不同。`video-cache.ts` 本身只提供底层 get/set，不包含策略。`pipeline.ts` 的 `PipelineDeps.checkCache` 是从 handler 注入的，又是一层间接。

**方案**: 在 `video-cache.ts` 中增加 `getOrTranscribe(bvid, transcribeFn)` 模式——cache-aside 策略内聚到缓存模块。调用方只传 "怎么获取数据"，缓存命中/写入/hash 去重完全对调用方透明。

**收益**:
- 3 个调用点的缓存检查逻辑归一
- Leverage — 调用方不需要知道缓存存在

---

### 7. Background 消息分发 — 松散类型 + handler 签名不一致 ✅ FIXED (2e61a64)

**文件**: `entrypoints/background.ts`, `lib/background/messages.ts`, `lib/background/types.ts`

**问题**: `BgMessage` union 没有共享 discriminant 验证。handler 签名不一致——有的返回 `Promise`，有的返回 `void`，有的直接修改共享状态（`tabAbortControllers`）。`BackgroundContext` 暴露实现细节：`tabAbortControllers: Map<number, AbortController>` 被 handler 直接操作。同一 bvid 的并发转录请求没有合并/去重。

**方案**: 引入 typed message discriminator + 统一 handler 签名 `(msg, ctx) => Promise<Response>`。将 `tabAbortControllers` 内聚到 `BackgroundContext` 内部方法（`ctx.getAbort(tabId)` / `ctx.setAbort(tabId, ac)`），不暴露 Map。

**收益**:
- Locality — handler 不直接操作 Context 内部数据结构
- 新增消息类型只需加一行类型定义 + 一个 handler，不需要理解 Context 内部

---

### 8. Storage 访问模式分散 ✅ FIXED

**文件**: `lib/storage.ts`, `lib/cache/video-cache.ts`, `lib/hooks/useSettings.ts`, `entrypoints/app/sections/collections/use-auto-transcribe.ts`

**问题**: `settingsStorage` 在 `lib/storage.ts` 定义，但 5+ 个模块直接访问。缓存模块定义自己的 storage key。`useAutoTranscribe` 直接读 settings（不通过 `useSettings` hook）。没有统一的 storage schema 或迁移策略。

**方案**: 创建 `lib/storage/` 目录，按领域分割 typed accessor（`settings.ts`, `cache-keys.ts`, `ui-state.ts`），统一 key 命名和迁移注册。

**收益**:
- 所有 storage key 集中可审查，避免命名冲突
- 迁移逻辑可组合，新增字段不需要散布 `migrateIfNeeded` 调用

---

## 严重程度：低

### 9. Offscreen 双职责缺乏显式契约 ✅ FIXED

**文件**: `lib/offscreen/main.ts`, `lib/offscreen/lifecycle.ts`

**问题**: FFmpeg WASM 和 PGlite 共存于同一 Offscreen Document，使用不同 IPC 通道（`onMessage` vs `onConnect`），但初始化顺序是隐式的——PGlite 失败只 console.error，FFmpeg 失败会阻断转录。没有 "如果 PGlite 挂了但 FFmpeg 还活着" 的显式状态。FFmpeg 的全局 session Map + sweep interval 是有状态的，但没有互斥保证。

**方案**: 分离两个子系统的初始化状态为显式枚举（`{ ffmpeg: 'ready' | 'failed', pglite: 'ready' | 'failed' }`），`lifecycle.ts` 提供 `getSubsystemStatus()` 查询。对 FFmpeg 操作加 session 级互斥锁。

**收益**: 调试时可精确定位哪个子系统故障，不需要翻 console log。

---

### 10. i18n 无动态切换 ✅ FIXED

**文件**: `lib/i18n/index.ts`

**问题**: locale 在模块加载时一次性检测（`detectLocale()`），不可运行时切换。缺少复数/性别支持。missing key fallback 到 key 本身，无告警机制。

**方案**: Observable singleton + `useSyncExternalStore`。`localeStorage`（`local:locale`）持久化用户偏好（`'auto' | 'zh-CN' | 'en'`），`t()` 读可变引用，`useTranslation()` hook 驱动 React re-render，`storage.watch()` 跨 context 同步，DEV 模式 missing key `console.warn`。

**收益**: 运行时切换语言即时生效，跨 tab 同步，开发者可发现翻译遗漏。

---

## 依赖关系与建议执行顺序

```
#1 useAutoTranscribe ──┐
                       ├──> 共享 TranscriptionCoordinator (#2)
#2 useVideoTranscribe ─┘
         │
         ▼
#3 Bilibili 领域整合（Coordinator 消费 bili-sync-service）
         │
         ▼
#4 PipelineDeps 收窄（pipeline 内聚后 Coordinator 调用更简单）
         │
         ▼
#5 错误类型扁平化（pipeline 和 coordinator 共享统一错误模型）
         │
         ▼
#6-#8 缓存/消息/存储 — 可独立并行
```

建议先做 #1 + #2（最高 ROI，消除最大的内聚问题），再做 #3 整合 Bilibili 领域，然后 #4-#5 收窄 pipeline 接口和错误模型。#6-#8 可以穿插进行。
