# lib/offscreen

Offscreen Document 协议、生命周期管理与逻辑。双职责（FFmpeg WASM 分块 + PGlite 数据库持有者）已按子系统拆分为独立模块，`main.ts` 只做消息路由 + 子系统启动。

## 模块结构

- `types.ts` — Offscreen 领域类型：SubsystemState(`'pending'|'ready'|'failed'`) + OffscreenStatus（双子系统状态）+ chunk request/response 类型。跨 runtime wire schema 不在此文件维护
- `protocol.ts` — Offscreen 协议 Module：4 种 request、对应 response、progress push 的 Zod registry、legacy + optional `channel:'favbase-offscreen'`/`protocolVersion:1` decoder/encoder。非法请求不调用子系统；非法响应由 client 抛 `OffscreenProtocolError`
- `client.ts` — Background 侧 typed client：发送已编码 request/progress，按 discriminator 解码 response；调用方禁止直接 `chrome.runtime.sendMessage` 或强转返回值
- `dispatcher.ts` — Offscreen listener Adapter：先 decode request，再校验 `sender.id`；同步 status/release 返回 `false`，prepare/transcribe 异步 response 返回 `true`，handler rejection 统一为 `TranscribeErrorInfo`
- `lifecycle.ts` — Offscreen Document 生命周期管理（Background 侧）：`ensure()` 统一入口（in-flight promise 守卫，防止并发 TOCTOU 竞态）+ `getSubsystemStatus()` 查询 FFmpeg/PGlite 子系统状态（ensure + typed `sendOffscreenMessage`）。所有需要 Offscreen Document 的调用点（FFmpeg 分块、PGlite RPC）均通过此模块
- `chunking.ts` — 纯分块数学，零副作用：`estimateSafeChunkSeconds`(0.72 安全系数，clamp [45,600]s) + `buildOverlappedChunkPlan`(600s+4s overlap，尾块 <45s 时并入前一块防丢音频) + `mergeTimestampedChunkRows`(时间偏移 + overlap 裁剪 + 1.5s 近邻同文本去重)。单测见 `chunking.test.ts`
- `ffmpeg-subsystem.ts` — FFmpeg 分块子系统，自持全部状态：FFmpeg lazy init（成功→ready/失败→failed，操作失败 resetFFmpeg()→pending 防状态污染）+ `withFfmpegLock` Promise-chain mutex（`prepare()`/`transcribe()` 导出即加锁，串行执行）+ Session Map（10min TTL，清扫定时器由显式 `start()`/`stop()` 控制，不再模块加载即启动）。fetchAudioBytes(自行 fetch audioUrl) + resolveAudioDuration(HTML5 Audio 优先，ffprobe 降级) + FFmpeg 本地 WASM 加载(public/ffmpeg/) + splitAudioIntoChunks(FFmpeg -c:a copy，最多 3 轮 30% 缩减) + transcribeChunk(委托 `requestGroqTranscription`，错误透传 TranscribeErrorInfo 纯对象)。导出：`start/stop/getState/prepare/transcribe/release`
- `db-subsystem.ts` — PGlite 持有者子系统：`start()` 调 `initDbMain()`（port RPC listener 在其内部同步注册，先于任何 await——**start() 必须在 document 加载时同步调用**，保持 ready-gate 时序）+ `getState()`。导出：`start/getState`
- `main.ts` — 薄 wiring：模块加载时 `ffmpeg.start()` + `db.start()`，raw `onMessage` 交给 `dispatcher.ts`，不再直接信任 `OffscreenRequest`。**07-20：X 书签同步 runner（`x-sync.ts`）+ `OFFSCREEN_X_SYNC` 路由已删——x.com 浮层按钮整体移除，X 同步统一走 app.html（页面 context 直接 `syncBookmarks`，经 RPC proxy 写本 offscreen 的 PGlite）**
- `entrypoints/offscreen.html` — WXT unlisted page，通过 lifecycle.ensure() 按需创建

## 约定

- Offscreen Document: WXT unlisted page `entrypoints/offscreen.html` 加载 `lib/offscreen/main.ts`。通过 `lib/offscreen/lifecycle.ts` 的 `ensure()` 按需创建（singleton，in-flight promise 守卫防并发竞态）+ `getSubsystemStatus()` 查询子系统健康状态。Document 常驻不销毁（PGlite 需要）
- **Runtime 协议**：Background 只通过 `lib/offscreen/client.ts` 发送 4 种请求；`main.ts` 的 raw 输入必须先经 `dispatcher.ts`/`protocol.ts`。未知 type、非法字段和非扩展 sender 静默拒绝；prepare/transcribe 的 response 必须由 client 解码。`OFFSCREEN_CHUNK_PROGRESS` 发送前经 encoder，再由 Background protocol 解码
- **子系统隔离**：`ffmpeg-subsystem.ts` 与 `db-subsystem.ts` 零相互 import，各自持有自己的状态与 SubsystemState 上报（一个挂了不影响另一个）。`OFFSCREEN_STATUS` 响应由 main.ts 组合两侧 `getState()`，wire 形状 `{ ffmpeg, pglite }` 不变。两套 IPC 完全隔离：FFmpeg 用 `chrome.runtime.onMessage`（request/response），PGlite 用 `chrome.runtime.onConnect`（port-based RPC，channel name `favbase-db`）
- 定时器无模块加载副作用：session 清扫 `setInterval` 收在 `ffmpeg-subsystem.start()` 内，生产路径由 main.ts 启动，测试可用 `stop()` 关闭
- Background 传 audioUrl（非 ArrayBuffer），Offscreen 自行 fetch 音频数据。FFmpeg WASM 从 `public/ffmpeg/`（@ffmpeg/core@0.12.10）本地加载
