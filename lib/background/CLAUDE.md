# lib/background

Background Service Worker 的消息层：typed 消息协议与路由、各领域的瘦 handler、转录 / 总结任务登记、PGlite 的 Port 中继。入口接线在 `entrypoints/background.ts`（`entrypoints/CLAUDE.md`）。

## 运行在 Service Worker 里

- SW 接线规则归 `entrypoints/CLAUDE.md`：`background.ts` 必须 `type: 'module'`、PortBridge 与 listener 在 module load time 同步注册、SW 模块图零 PGlite（不走 database / collections barrel）且零动态 `import()`。本目录的 handler 都在这张图上，加 import 前先读它。
- LLM 调用必须落在 SW：content script 的 fetch 受宿主页 CORS 约束，`host_permissions` 对 CS 不放行。代价是 AI SDK 进了 SW 模块图。
- SW 的 `fetch()` 自己设置的 Referer 会被 Chrome MV3 剥离。bilivideo CDN 需要的 Referer / Origin 只能靠 `public/rules.json` 的 `declarativeNetRequest` 静态规则。

## 消息协议

- 发送方一律经 `client.ts` 编码；入口 `dispatcher.ts` 对 `unknown` 先 decode 并校验扩展 sender，再交给 `routes.ts`。
- 新增消息必须五处一起改：`messages.ts`、`message-protocol.ts` 的 registry（请求与响应 schema）、`routes.ts`、typed client、contract test（`message-protocol.test.ts`）。
- 响应由 client 按 message type 解码，畸形响应抛 `BackgroundProtocolError`。调用方不得对 `sendMessage` 的结果做裸类型断言。
- 需要确认完成的 command 必须返回 JSON 可序列化的 ACK（如 `{ success: true }`），不能把进程内的 `void` 当线协议值。
- Background → tab 的 push 必须经 `encodeBackgroundPush`，订阅方经 `onBackgroundPush` 解码；畸形 push 丢弃。
- 未知 type、非法字段、错误 sender 一律静默拒绝。envelope 的 `channel` / `protocolVersion` 是可选的兼容元数据，不带它们的旧消息仍要接受。
- `TRANSCRIBE_AUDIO` 成功响应里的 `data.videoId` 必填：它是请求 videoId 的回声，消费方落库前据此拒收不属于自己的字幕。改成可选等于闸门永远放行。
- Database Port RPC 走 `port-bridge.ts`，不并入本消息协议（`lib/database/bridges/CLAUDE.md`）。

## Handler

- handler 只做消息层，策略留在领域 lib。有状态 handler 签名 `(msg, sender, ctx)`，无状态 `(msg)`。`BackgroundContext` 不暴露 Map 或 transport。
- 转录与总结各持一份 `createJobRegistry()` 实例，互不干扰（取消总结不会中断转录）。
- `finish(tabId, controller)` 必须回传 `start` 给的那个 controller。取消后立刻重开时，旧任务的 `finally` 晚于新任务注册，无条件释放会把活着的任务注销掉。
- 平台转录 handler 经 `transcription-handlers.ts` 的 `platformHandlers` 按 `msg.platform` 分发。平台 handler 只能 import `transcription-utils.ts`，import `transcription-handlers.ts` 会成环。
- Offscreen 进度消息的 sessionId 解析不到目标 tab 时，warn 后丢弃。
- `FETCH_BOOKMARK_PAGE` 把任意站点的 fetch 隔离在没有 Document 的 SW 里：第三方响应的 HTTP Link preload / modulepreload 会污染 app.html 的 CSP。
- `handleFetchBookmarkPage` 先校验 URL（拒 localhost、内网、非 HTTP(S)）。响应是结构化结果，不跨消息传 `Response` / `Headers`。
- `AGENT_BRIDGE_CONNECT_NOW` 只委托 scheduler，页面不持有 WebSocket。连接幂等、开关、重试归 `lib/agent-bridge/CLAUDE.md`。
- WebDAV 的两条消息只转给 SW 里的同步引擎，规则归 `lib/sync/CLAUDE.md`。
- `OPEN_APP_PAGE` 存在是因为 content script 没有 `browser.tabs`。`tabs.query({ url })` 的 pattern 忽略 fragment，且查自家 `chrome-extension://` URL 不需要 `tabs` 权限。
- `openWelcomePage()` 自带闸门（`onboardingStorage` 有值即 no-op）：unpacked 扩展每次 reload 都报 `reason === 'install'`，只看 reason 会在开发期反复弹页。
- `captureXTokens` 的 webRequest 监听器必须保留（在 `background.ts` 注册）：X 浮层已删，但 app.html 的 X 同步全靠它拿认证。filter 由 `PLATFORM_DESCRIPTORS.x.hostPermissions` 派生，不手写域名。
- 工具栏任务 badge 由 app.html 写，SW 只当清道夫（没有 app.html 标签页时清空）。`sweepJobsBadge(closedTabId)` 必须排除正在关闭的 tab：`onRemoved` 触发时 `tabs.query` 可能仍返回它。

## 指针

- 跨 runtime 协议的共享 schema 片段：`lib/runtime-message/CLAUDE.md`。
- 总结策略：`lib/summary/CLAUDE.md`。转录管线：`lib/transcription/CLAUDE.md`。
