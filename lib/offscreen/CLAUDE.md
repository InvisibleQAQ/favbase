# lib/offscreen

Offscreen Document 的协议、生命周期与两个子系统：FFmpeg WASM 音频分块 + PGlite 数据库持有者。

## 约束

- Document 常驻、不销毁：PGlite 住在里面。所有需要它的调用点（FFmpeg 分块、PGlite RPC）都经 `lifecycle.ts` 的 `ensure()`，不要自己 `chrome.offscreen.createDocument`——`ensure()` 带 in-flight 守卫，防并发重复创建。
- `db-subsystem.start()` 必须在 document 加载时同步调用：`initDbMain()` 在首个 await 之前同步注册 port RPC listener，晚了 ready-gate 的时序就破了。
- 两个子系统零相互 import、各自持有状态，一个挂了不影响另一个。两套 IPC 也完全隔离：FFmpeg 走 `chrome.runtime.onMessage`（request / response），PGlite 走 `chrome.runtime.onConnect` 的 port RPC（归 `lib/database/bridges/`）。不要把 DB 消息并进 `protocol.ts`。
- Background 只经 `client.ts` 的 typed client 发请求，禁止直接 `chrome.runtime.sendMessage` 或对返回值做类型断言。新消息要同时注册 request / response schema、dispatcher 路由和 contract test。
- `main.ts` 只做接线，raw 输入必须先过 `dispatcher.ts`：校验 `sender.id` 并 decode。未知 type、非法字段、非本扩展 sender 静默拒绝，不触达子系统；非法响应由 client 抛 `OffscreenProtocolError`。
- progress push（`OFFSCREEN_CHUNK_PROGRESS`）同样先过 encoder 再发，由 Background 侧协议解码。
- envelope 的 `channel` / `protocolVersion` 是可选兼容元数据：不带它们的 legacy 消息仍须接收。
- dispatcher 的返回值有语义：同步应答（status / release）返回 `false`，异步应答（prepare / transcribe）返回 `true` 保持通道。
- handler 的 rejection 统一成 `TranscribeErrorInfo` 纯对象过 IPC，不抛类实例。
- Background 传的是 `audioUrl`，音频字节由 Offscreen 自己 fetch，不要改成传 ArrayBuffer。
- 模块加载不得有定时器副作用：session 清扫的 `setInterval` 收在 `ffmpeg-subsystem.start()` 里，由 `main.ts` 启动，测试用 `stop()` 关。
- `chunking.ts` 保持零副作用的纯数学，单测 `chunking.test.ts`。

## 坑

- FFmpeg 实例不可并发：`prepare()` / `transcribe()` 导出即经 `withFfmpegLock` 串行。操作失败要 `resetFFmpeg()` 回到 `pending`，否则坏掉的实例会污染后续任务。
- FFmpeg core 从 `public/ffmpeg/` 本地加载。升级 `@ffmpeg/core`（`package.json` 钉死精确版本）要同步替换这两个文件。
