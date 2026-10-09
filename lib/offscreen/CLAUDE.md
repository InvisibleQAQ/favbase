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

## 分块续传（docs/38）

- 某块 429 后，SW 的下一次重试（新的 chunk session）从失败的那块接着转，已转完的块不再请求 ASR：限流的条目不出队、不设重试上限，没有续传的话总音频超过 ASPH 额度的作品会在队头无限整条重来。
- `chunk-progress.ts` 是零 I/O 纯模块（进度表 + 续传循环，单测 `chunk-progress.test.ts`）；表实例与接线在 `ffmpeg-subsystem.ts`（接线测试 `ffmpeg-subsystem.test.ts`）。
- 进度表的 key = Offscreen 自己下载的字节的 sha256 + model + baseUrl。不按 URL：同一音轨换了候选主机照样续上。不含 apiKey：换 key 行不变。
- 只存已合并的行与下一块下标，不存块字节：块字节照旧随 SW 的 release 释放，续传时重新下载、重新切。所以条目能活 24 h（LRU 8）。
- 续传前分块计划必须逐项相等（时长探测或 `maxBytes` 变了，切法就不同），否则丢弃进度从头来。
- 续传对 SW 透明：SW↔Offscreen 协议与 SW 的 `finally` release 都不改。别让 SW 带「从第几块开始」，也别跳过 release 来保住 session。
- 撞 429 不在 Offscreen 里原地等再重试同一块：SW 会一直挂着等应答，而这里的转录不认取消信号。等待留在 app.html 的状态机里（docs/38 §2）。

## 坑

- FFmpeg 实例不可并发：`prepare()` / `transcribe()` 导出即经 `withFfmpegLock` 串行。操作失败要 `resetFFmpeg()` 回到 `pending`，否则坏掉的实例会污染后续任务。
- FFmpeg core 从 `public/ffmpeg/` 本地加载。升级 `@ffmpeg/core`（`package.json` 钉死精确版本）要同步替换这两个文件。
