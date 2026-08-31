# Agent Bridge 用「扩展出站 WebSocket → agent 拉起的本地 MCP 进程」，不用 Native Messaging，也不用磁盘快照

> 2026-08-28 部分被 ADR 0003 取代：数据路径（扩展出站 WS、SW 内复用 `chatTools`、Node 零工具知识）仍有效；「agent 以 stdio 拉起 `favbase-mcp`」与「一个进程对应一个 agent 会话」改为 favbase CLI 自启的常驻 Bridge Daemon。

外部 agent（Claude Code / Codex 等）需要检索 favbase 的本地知识库，但 MV3 扩展不能监听端口，PGlite 数据在 Offscreen 的 IndexedDB 里外部进程打不开。我们决定：agent 以 stdio 拉起 `favbase-mcp`（Node），该进程在 `127.0.0.1:<port>` 起 WebSocket 监听；扩展 Background SW 在用户启用 Agent Bridge 后经 `chrome.alarms` 周期试连、连上后以心跳保活 SW（Chrome 116+ 机制）；工具调用经 WS 转入扩展，在 SW 内执行与 Chat 完全相同的 `chatTools`（`lib/chat/tools.ts`），Node 侧不含任何工具知识与凭据。

## Considered Options

- **Native Messaging 宿主（mcp-chrome 模式）** — 拒绝。运行时语义更好（`connectNative` 的 Port 让 SW 永久存活、多 client 天然共享），但安装要写 Windows 注册表 / 三平台分支目录并依赖 node 路径解析；mcp-chrome 的失败 issue 几乎全是这一类，Anthropic 自家 Claude in Chrome 也从本地 socket 退到云桥。参考环境是 Windows Chrome，装不上等于没有。另有单条消息 1 MB 上限。
- **`dumpDataDir()` 快照 + Node 侧 PGlite/pgvector** — 拒绝。Chrome 关了也能查，但要在 Node 复刻一套 hybrid 检索（两套真相源），语义检索要把 embedding key 复制到磁盘，且快照陈旧、体积大。违反 DRY 与「凭据不出扩展」。

## Consequences

- Phase 0 已在 Windows Chrome 149 实测通过：20s 应用层 ping 维持同一 SW
  实例 330.012s，且派生 manifest 删除 `<all_urls>` 与 loopback host pattern
  后仍能连接 `ws://127.0.0.1`。因此 Chrome v1 不新增 host permission；
  原始证据见 `spikes/agent-bridge/phase-0-result.json`。
- SW 里会出现 20s 心跳与 30s alarm 轮询，这是本决策的已知代价，不是待修的 bug；轮询只在用户开启 Agent Bridge 后发生。`minimum_chrome_version` 抬到 116。
- 首次工具调用最坏等待一个轮询周期（app.html 打开时即时连接）；`favbase-mcp` 需对首个调用做有界等待并返回可读错误。
- 一个 `favbase-mcp` 进程对应一个 agent 会话；第二个实例遇 `EADDRINUSE` 必须明确报错退出，绝不杀占用者。多 agent 共享留给 daemon 拆分（未决）。
- 扩展侧传输层做成接口，Native Messaging 将来可作为第二实现补上，不动协议与工具层。
- Chrome 不运行时 Agent Bridge 不可用，这是知情接受，不再作为需求提出。
