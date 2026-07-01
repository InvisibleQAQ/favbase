# lib/offscreen

Offscreen Document 协议、生命周期管理与逻辑（FFmpeg WASM 分块 + PGlite 数据库持有者双职责）。

## 模块结构

- `types.ts` — Offscreen 协议类型：SubsystemState(`'pending'|'ready'|'failed'`) + OffscreenStatus（双子系统状态）+ OffscreenStatusRequest + ChunkPlan, OffscreenPrepareRequest/TranscribeRequest/ReleaseRequest, OffscreenProgressMessage/ResultMessage/ErrorMessage, OffscreenRequest（含 StatusRequest）/OffscreenMessage union
- `lifecycle.ts` — Offscreen Document 生命周期管理（Background 侧）：`ensure()` 统一入口（in-flight promise 守卫，防止并发 TOCTOU 竞态）+ `getSubsystemStatus()` 查询 FFmpeg/PGlite 子系统状态（ensure + sendMessage OFFSCREEN_STATUS）。所有需要 Offscreen Document 的调用点（FFmpeg 分块、PGlite RPC）均通过此模块
- `main.ts` — Offscreen Document 逻辑：模块级 `subsystemStatus` 追踪双子系统初始化状态（FFmpeg lazy init 成功→ready/失败→failed/reset→pending，PGlite init 成功→ready/失败→failed）。FFmpeg 全局互斥锁（`withFfmpegLock` Promise-chain mutex，handlePrepare/handleTranscribe 串行执行）。fetchAudioBytes(自行 fetch audioUrl) + resolveAudioDuration(HTML5 Audio 优先，ffprobe 降级) + FFmpeg 本地 WASM 加载(public/ffmpeg/) + estimateSafeChunkSeconds(0.72 安全系数) + buildOverlappedChunkPlan(600s+4s overlap) + splitAudioIntoChunks(FFmpeg -c:a copy) + transcribeChunk(委托 `requestGroqTranscription`，错误直接透传 TranscribeErrorInfo 纯对象，IPC 天然兼容) + mergeTimestampedChunkRows(时间偏移+overlap 裁剪+1.5s 近邻去重)。最多 3 轮 30% 缩减。Session Map 带 10min TTL 自动清理（60s 扫描）+ FFmpeg 操作失败后 resetFFmpeg() 防止状态污染。OFFSCREEN_STATUS handler 返回当前子系统状态
- `entrypoints/offscreen.html` — WXT unlisted page，通过 lifecycle.ensure() 按需创建

## 约定

- Offscreen Document: WXT unlisted page `entrypoints/offscreen.html`，逻辑在 `lib/offscreen/main.ts`。通过 `lib/offscreen/lifecycle.ts` 的 `ensure()` 按需创建（singleton，in-flight promise 守卫防并发竞态）+ `getSubsystemStatus()` 查询子系统健康状态。Document 常驻不销毁（PGlite 需要）。**双职责**：FFmpeg WASM 分块 + PGlite 数据库持有者，两个子系统完全独立（一个挂了不影响另一个）。显式子系统状态契约：`subsystemStatus: { ffmpeg: SubsystemState, pglite: SubsystemState }`（`'pending'|'ready'|'failed'`），通过 `OFFSCREEN_STATUS` 消息 pull 查询。FFmpeg 全局互斥锁（`withFfmpegLock` Promise-chain mutex）保证 prepare/transcribe 串行执行。两套 IPC 完全隔离：FFmpeg 用 `chrome.runtime.onMessage`（request/response），PGlite 用 `chrome.runtime.onConnect`（port-based RPC，channel name `favbase-db`）。Background 传 audioUrl（非 ArrayBuffer），Offscreen 自行 fetch 音频数据。FFmpeg WASM 从 `public/ffmpeg/`（@ffmpeg/core@0.12.10）本地加载。Session Map 带 10min TTL 自动清理防泄漏，FFmpeg 操作失败后自动 reset 实例防状态污染
