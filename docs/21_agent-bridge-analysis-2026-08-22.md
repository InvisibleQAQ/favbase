# Agent Bridge：让 Claude Code / Codex 等外部 agent 检索 favbase 数据 —— 分析、决策、设计与路线（2026-08-22）

> **2026-08-28 修订（`docs/adr/0003`）**：MCP 前端已被「favbase CLI + 常驻 Bridge Daemon + Agent Skill」取代，见第 11 节；第 1 节结论、Q5/Q9/Q10 与 §6.6 安装流程以第 11 节为准，其余（数据路径、协议、SW 侧、设置 UI）仍有效。
> 状态：**Phase 0 Spike、Phase 1 协议 + 工具注册、Phase 2 Node 包、Phase 3 扩展 SW 侧与 Phase 4 设置 UI 已于 2026-08-24 完成；Phase 5 Skill 于 2026-08-28 随 Skill-first 落地；Phase 6 E2E/发布未做**。
> 已决（用户逐题确认）：Q1–Q10，见第 4 节。
> 术语已入 `CONTEXT.md`（Agent Bridge / Knowledge Tool / Bridge Token）；架构决策见 `docs/adr/0002-agent-bridge-extension-outbound-websocket.md`。
> 事实来源：本仓库源码逐条核对（file:line）、Chrome 官方文档、GitHub 参考项目源码与 issue（`gh api` + deepwiki）。未核实的点一律标 `[UNKNOWN]`。

---

## 1. 一句话结论

**做 MCP，Skill 作为薄附件；检索引擎不在 Node 里，而是复用扩展内已有的 `chatTools`（`lib/chat/tools.ts:129`），Node 包 `favbase-mcp` 只是一条不认识任何工具、不持有任何凭据的哑管道；传输层用"扩展出站 WebSocket → agent 拉起的本地 MCP 进程"（Playwright MCP 模式），不用 Native Messaging，不用磁盘快照。**

## 2. 需求重述与隐含假设

用户原话："让 Claude Code / Codex 这样的 agent 连接插件，用 agent 搜索插件中的数据，完成问答等需求；MCP 还是 Skill 需要权衡。"

| # | 隐含假设 | 实际情况 | 影响 |
|---|---|---|---|
| A1 | "MCP 或 Skill 二选一" | 伪二分。Skill 只是 SKILL.md（+ 可选脚本），**本身碰不到扩展进程里的数据**；拿数据要么有进程桥（= MCP 的活），要么读磁盘快照。Skill 的价值是"教 agent 怎么用 favbase"，且跨 agent 可移植（agentskills.io 标准，Claude Code / Codex / Cursor / Gemini CLI 已采纳）。 | **MCP（必需）+ Skill（补充）** |
| A2 | "agent 连接插件"是直接连 | MV3 扩展**不能监听端口**。外部进程触达扩展只有两条路：扩展主动出站连本地进程（WebSocket/fetch），或 Native Messaging（Chrome 按 manifest 拉起宿主、stdio 通信）。 | 必然存在扩展之外的本地进程（npm 包）；"装扩展即用"不可能。 |
| A3 | 数据可被外部进程直接读 | PGlite 数据在 Offscreen 的 `idb://favbase`（`lib/database/constants.ts:2`），IndexedDB 对 Node 不可见；PGlite 单连接、无锁。 | 只能经 RPC 走扩展内唯一持有者，或 `dumpDataDir()` 导快照。 |
| A4 | 语义检索在外部进程也能做 | 查询向量化需要 embedding provider key，key 只在扩展 `local:settings`（`lib/hooks/useSettings.ts:214-218`）。 | 检索必须在扩展内执行，key 永不出扩展。 |
| A5 | "问答"由 favbase 负责 | 不是。外部 agent 自己是推理者，favbase 只提供**检索 + 取正文**工具；Chat 的 prompt/agent loop 不搬出去。 | 工具面 = 现有三只读工具。 |

## 3. 事实基础

### 3.1 本仓库（已逐条核对）

- **检索已工具化**：`lib/chat/tools.ts` 定义 `searchKnowledgeBase`（hybrid：pgvector 语义 + trigram `word_similarity` + RRF，`lib/chat/retrieval.ts:168`）、`getItemContent`、`listTags`，均为 AI SDK `tool({ description, inputSchema: zod, execute })`，DB 经 `experimental_context` 注入（`tools.ts:20-31`）。**已实测**：zod 4.4.3 `z.toJSONSchema(tool.inputSchema)` 直接产出 JSON Schema 2020-12，MCP `tools/list` 零手写。
- **无 embedding key 时语义臂静默降级为纯关键词**（`retrieval.ts:30-46`，`config.enabled = !!apiKey`，`lib/embedding/config.ts:85`）。外部 agent 走同一路径即继承同一降级语义，符合 PRODUCT.md "Useful without AI keys"。
- **DB 单持有者 = Offscreen**；app.html 经 Background SW PortBridge 三跳 RPC（`lib/background/port-bridge.ts:1-8`）。Phase 3 将 RPC client 与 Drizzle adapter 拆开：app 继续使用完整 `proxy-db.ts`，生产 SW 只导入 `read-proxy-db.ts`，并在首个 Knowledge Tool 调用时执行 `initReadDbProxy(ensureOffscreen)`。后者用 `drizzle-orm/pg-proxy` 适配三个只读工具；`drizzle-orm/pglite` 即使拿现成 client 也会 value-import 完整 PGlite runtime。`chatTools`/retrieval/vector-store 的 schema value import 均走 `@/lib/database/schema` leaf。2026-08-24 修复生产故障后，Background 固定为 WXT ESM service worker：默认单文件 IIFE 曾在共享 Chat/AI 依赖图上生成悬空 `init_locales()`，令 SW 启动崩溃并连带 app DB health RPC 超时。构建门现在从 manifest 入口递归扫描完整 Background module graph（ESM type、2 MiB 上限、PGlite runtime 与 dangling initializer markers）；实测 12 modules / 937,968 bytes，隔离 Chrome 等待超过 30 秒无 worker/page 异常。Phase 0 已实测调用链成功。PortBridge 对无 `sender.url` 的 SW 自连会忽略（`port-bridge.ts:36`），offscreen 的 `DatabaseRpcHandler` 直接接收同名 `chrome.runtime.connect`（`rpc-handler.ts:56`），所以无需新增中继特殊情况。
- **SW 已是长驻后台网络工作的宿主**：WebDAV 引擎只在 SW 跑，`chrome.alarms` 周期 + 防抖 + 启动补偿，状态全在 `local:` storage、listener 同步注册（`lib/sync/scheduler.ts:12-66`）。视频总结的 LLM 调用也只在 SW。新桥放 SW 是既有约定。
- **Manifest**：权限 `storage/unlimitedStorage/alarms/offscreen/declarativeNetRequest/cookies/webRequest/bookmarks/favicon`；无 `nativeMessaging`、无 `externally_connectable`；Phase 3 已设置 `minimum_chrome_version: '116'`（2026-09-01 因 MUI v9 浏览器下限抬到 `'117'`，见 docs/25 Step 0；Agent Bridge 自身只要求 ≥116），且未新增 host permission。CSP `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`，无 `connect-src` 限制；`http://localhost/*` host pattern 已因 Ollama 存在（`lib/providers.ts:184`）。
- **协议约定**：每个 runtime 边界一套 zod schema map + `encode/decode` + contract test（`lib/background/message-protocol.ts`、`lib/offscreen/protocol.ts`），envelope 带可选 `channel`/`protocolVersion`，未知 type/非法 payload 静默拒绝。新桥协议照此模板，独立成套。
- **导出**：JSON/CSV/Obsidian 均为 app.html 内一次性 `<a download>`（`lib/export/download.ts`），embedding 默认不导；无 `downloads` 权限、无 File System Access。
- **`lib/events` 只在 app.html 单 context**，跨 context 转发未实现。
- **工程**：`pnpm-workspace.yaml` 已纳入 `packages/*`；根 tsconfig 排除 `packages`，根 Vitest 排除 `packages/**` 后由 `pnpm -r` 分别运行包内 Node 配置。`packages/favbase-mcp` 精确锁定 MCP SDK `1.29.0`，以 tsup 打包相对 import 的共享 protocol leaf；`pnpm pack --dry-run` 只含 `dist/`、`LICENSE`、`package.json`。`wxt zip` 仍只打包 `.output/`。npm 包名 `favbase-mcp` 与 `@favbase/mcp` 均未被占用（2026-08-22 `npm view` 404）。仓库 `REPO_URL = https://github.com/InvisibleQAQ/favbase`（`lib/repo.ts:6`）。
- **设置页**：Connections tab 已有 `webdav-sync-card.tsx`、`github-connection-card.tsx`、`youtube-connection-card.tsx`（`entrypoints/app/sections/settings/`），新卡片照此模式。
- **文档**：`CONTEXT.md` 有 Chat 只读铁律（表级边界，ADR 0001）；ADR 0002 已由本任务占用；`docs/` 编号 21（本文）。

### 3.2 Chrome 平台事实（官方文档）

- `chrome.runtime.connectNative()` Port 打开期间 **SW 持续存活**（Chrome 105+）；宿主崩溃则 port 关、SW 按计时器终止。
- **WebSocket 只有收发消息才重置 30s 空闲计时**（Chrome 116+），官方示例每 20s 发 keepalive，需 `minimum_chrome_version: 116`。
- `chrome.alarms` 最小周期 30s（Chrome 120+）；SW 空闲 30s 终止、单事件 5min 上限。
- Native Messaging：host→Chrome **1 MB/条**，Chrome→host 64 MiB；Windows 写注册表 `HKCU|HKLM\Software\Google\Chrome\NativeMessagingHosts\<name>`；macOS/Linux 按 Chrome / Chromium / Chrome for Testing 各自目录；`allowed_origins` 不能通配；content script 不能调用。
- Chrome 内置 WebMCP（`navigator.modelContext`）**只面向浏览器内 agent**（官方对照表 "ephemeral, tab-bound"），与外部 agent 无关。

### 3.3 GitHub 参考项目（桥接机制归类）

| 机制 | 代表 | 外部 client 看到的 transport | 安装（扩展之外） | SW 生命周期 | 活跃度 |
|---|---|---|---|---|---|
| **Native Messaging 宿主内起本地 HTTP** | hangwin/mcp-chrome（MIT，12.3k★，2026-01）、MiguelsPizza/WebMCP（AGPL，fork 自前者，2025-10 停滞）、Anthropic Claude in Chrome（闭源） | Streamable HTTP `127.0.0.1:12306/mcp`，stdio 是反向代理 | `npm i -g` + `register`（写注册表）、`run_host.bat`、`doctor --fix`、`CHROME_MCP_NODE_PATH` | Port 保活 + 指数退避重连（500ms→60s，8 次后 5min 冷却） | mcp-chrome issue 活跃 |
| **扩展作 WS client 连 MCP 进程自起的本地 server** | microsoft/playwright-mcp `--extension`（Apache，36k★，活跃）、browsermcp/mcp（死，2025-04） | stdio（agent spawn 即 server） | `npx @playwright/mcp --extension` + 商店扩展 | Playwright：connect 页每 ~20s ping、SW 重启后对账；browsermcp：无 → #192 "永不重连" | Playwright 活 |
| **无扩展，直接 CDP** | chrome-devtools-mcp（49k★） | stdio | `npx` | n/a | 活 |
| **数据源产品：宿主能 listen** | Obsidian Local REST API（Electron 内置 `/mcp/` + bearer + 自签 TLS）、karakeep（服务端 REST，AGPL）、Readwise / Raindrop（弃本地改托管，并**同时发 Agent Skills**） | HTTP / 托管 | 无或 API key | n/a | 活 |

关键 gotcha（均来自 issue/源码）：
- **Windows native host**：管理员权限、nvm/volta 找不到 node、Bun 在 stdin 为 pipe 时 panic（claude-code #23739）、命名管道路径遗漏（#23526/#23828 open）。**Anthropic 自家 Claude in Chrome 已从本地 socket 退到云端 `wss://bridge.claudeusercontent.com`**（#34364/#27178/#25091）。PRODUCT.md：Windows Chrome 是参考环境。
- **WS 固定端口冲突**：browsermcp `lsof|kill -9` 抢端口是反面教材（≥6 个 open issue）；Playwright `listen(0)` 随机端口 + `connect.html?mcpRelayUrl&token` 交地址。
- **单例 server 多 client 互杀**：mcp-chrome #345/#321。
- **localhost 端点认证**：browsermcp 零认证；Playwright per-profile token + 人工确认；Obsidian bearer + TLS；mcp-chrome 12306 无认证 `[UNKNOWN 是否后续加固]`。
- **Streamable HTTP 心跳误杀会话**：playwright-mcp #1646（已修）。
- **PGlite**：`dumpDataDir()`/`loadDataDir` Node 可用；pgvector 在外部包 `@electric-sql/pglite-pgvector`（本仓库 vitest 已在 Node 用）；**双进程同开 data dir 不支持且无锁**（`--single` 模式、无 postmaster.pid）。官方出进程方案 `@electric-sql/pglite-socket` 只适用于 Node 持有的 DB，对扩展内 DB 无效。
- **License**：WebMCP 根 AGPL（子包 README 自相矛盾），karakeep AGPL——只参考，不复制代码。

### 3.4 Agent 侧事实

- Claude Code：`claude mcp add [--transport stdio|http|sse] <name> [-e KEY=VAL] -- <cmd>`；scope user（`~/.claude.json`）/ project（`.mcp.json`，需审批）；工具名 `mcp__<server>__<tool>`；大服务器有 tool search / 延迟加载；Plugin 可把 `.mcp.json` + `skills/` 打成一个安装单元（仅 Claude Code）。
- Codex CLI：`config.toml [mcp_servers.*]` / `codex mcp add`，stdio + HTTP；Skills 走 agentskills.io 标准。2026-08-24 已用官方 OpenAI 配置文档与本机 `codex mcp add --help` 验证 stdio env 语法为 `--env KEY=VALUE`。
- Cursor / Gemini CLI / OpenCode：均支持 MCP；Cursor、Gemini CLI 支持 agentskills.io Skill。
- Agent Skills 标准（agentskills.io，2025-12 发布）：`SKILL.md` YAML frontmatter（`name`/`description`，可选 `allowed-tools`）+ Markdown 正文；一份跨 40+ 产品。

## 4. 决策记录

### 已决（用户逐题确认，2026-08-22）

| # | 问题 | 决策 | 理由要点 |
|---|---|---|---|
| Q1 | 接受"只有 Chrome 开着且扩展在跑时才能查"？ | **接受** | 换实时数据、key 不出扩展、单一检索引擎；快照方案 A 否决 |
| Q2 | 检索在哪执行？ | **扩展 SW 内复用 `chatTools`**，Node 零工具知识 | Q1 的理由只有这样才成立；Chat 与 agent 永远同一套答案 |
| Q3 | 传输层 B（WS 出站）vs C（Native host）？ | **B**（ADR 0002） | 参考环境 Windows，C 的失败面全在安装且 Anthropic 自己退了；B 的代价运行时可观测、Playwright 背书；transport 做成接口，C 可后补 |
| Q4 | 扩展如何发现服务？ | **自动 + 开关**：设置页开关开启后 alarm 30s 试连 + app.html 打开时即时试连；固定端口（`lib/env.ts` 可覆盖）；默认关闭 | 随机端口要拉起 `chrome-extension://` 页面交地址，Windows 不可靠；手动点连接体验差 |
| Q5 | 多 agent 并发是 v1？ | **否**。第二实例 `EADDRINUSE` 明确报错退出，绝不 kill 占用者；B' daemon 拆分留 v2 | 单会话是主场景；B' 是 B 的纯增量，不返工 |
| Q6 | v1 工具面？ | **严格等于现有三个 `chatTools`** | 风险全在桥接层，工具面不动让验收一句话；`listItems`/`listSources` 另开任务（Chat 同享） |
| Q7 | Node 包放哪？ | **本仓库 `packages/favbase-mcp`，pnpm workspace 成员** | 协议 schema 单一文件共享；独立仓库必复制 schema；`pnpm compile/test` 含义扩大为"扩展 + Node 包"（已接受） |

### 已决（用户按推荐默认确认，2026-08-22）

| # | 问题 | 决策 | 备选与否决理由 |
|---|---|---|---|
| Q8 | 认证与信任边界 | 扩展生成 **Bridge Token**（随机 32 字节 base64url）存 `local:agent-bridge`；用户一键复制含 `-e FAVBASE_TOKEN=…` 的 add 命令；server 校验 token + WS upgrade 的 `Origin: chrome-extension://<id>`（允许经 env 追加 dev ID）；扩展校验 server `welcome` 回显 token（双向共享密钥）；只绑 `127.0.0.1`；不做 TLS | 无认证（browsermcp）：本机任意进程可读知识库，否决。TLS：127.0.0.1 上无意义，否决。token 显示在设置页与 provider key 同级风险，接受 |
| Q9 | Skill 范围 | v1 一份**无脚本** `skills/favbase/SKILL.md`（agentskills.io frontmatter，中英双语正文），仓库内 + README 安装段（`npx skills add InvisibleQAQ/favbase` `[UNKNOWN 命令最终形态]`）；Claude Code Plugin 打包留 v2 | 带脚本的 Skill = 绕过 MCP 的第二条数据路径，否决 |
| Q10 | 变更推送 / MCP resources | v1 纯请求-响应，不实现 `tools/list_changed`、resources、notifications | `lib/events` 单 context，桥订阅需先加跨 context 转发层；工具面固定三个，list_changed 无用 |

## 5. 方案空间回顾（为什么不是别的）

| 维度 | A 快照 + Node PGlite | **B WS 出站（选定）** | B' WS + daemon | C Native host |
|---|---|---|---|---|
| 安装（扩展外） | npm 包 + 导出设置 | 1 行 `mcp add` | 1 行 `mcp add` | `npm -g` + register（Win 注册表） |
| 数据新鲜度 | 陈旧 | 实时 | 实时 | 实时 |
| 检索引擎 | **第二套** | 复用 `chatTools` | 复用 `chatTools` | 复用 `chatTools` |
| embedding key | 外泄到磁盘 | 扩展内 | 扩展内 | 扩展内 |
| SW 生命周期 | n/a | 20s 心跳 + 30s 轮询 | 同 B | Port 保活（官方保证） |
| 多 agent 并发 | 天然 | v1 拒绝 | 天然 | 天然 |
| Chrome 未开 | 可用 | 不可用（已接受） | 不可用 | 不可用 |
| 消息尺寸 | n/a | 无限制 | 无限制 | 1 MB/条需分页 |
| Windows 风险 | 低 | 低（仅端口） | 中（detached） | **高** |
| 复杂度 | 高（引擎复刻） | 低-中 | 中 | 中-高 |

A 的否决理由：第二套真相源 + key 外泄，换来的"离线可查"不是需求。C 的否决理由见 ADR 0002。B' 是 B 的增量，留 v2。

## 6. 设计

### 6.1 拓扑

```
Claude Code / Codex ──stdio (MCP)──► favbase-mcp  (Node, packages/favbase-mcp)
                                        │  ws://127.0.0.1:<port>/bridge
                                        │  Bridge Token 双向校验 · Origin 校验 · 20s ping
                                        ▼
                    Background SW: lib/agent-bridge/  (scheduler + WS client + tool registry)
                                        │  chatTools[name].execute(args, { experimental_context: { db } })
                                        ▼
                    initDbProxy() ──Port──► Offscreen PGlite（唯一持有者，SELECT-only）
```

### 6.2 模块与归属

| 模块 | 位置 | 职责 | 依赖约束 |
|---|---|---|---|
| 协议 | `lib/agent-bridge/protocol.ts` | zod schema map（见 6.3）+ `encode/decode` + `BRIDGE_PROTOCOL_CHANNEL='favbase-agent-bridge'`、`BRIDGE_PROTOCOL_VERSION=1`、默认端口常量 | **leaf**：只依赖 zod，零 `chrome`/`@/lib/*`；进 `tests/lib-import-smoke.test.ts`；Node 包从 `../../lib/agent-bridge/protocol.ts` 相对路径打包 |
| 工具注册 | `lib/agent-bridge/tool-registry.ts` | `describeTools()` → `{ name, description, inputSchema }[]`（`z.toJSONSchema`）；`callTool(name, args, db)` → `inputSchema.parse` → `execute(args, { toolCallId, messages: [], experimental_context: { db } })` | 唯一来源 `lib/chat/tools.ts` 的 `chatTools`；加工具只改那一处 |
| 存储 | `lib/storage/keys.ts` 新增 `local:agent-bridge`（`{ enabled, port, token, tokenCreatedAt }`）与 `local:agent-bridge-status`（`{ state, lastConnectedAt, lastError, authFailureCount, nextRetryAt }`） | 经 `lib/storage` facade；`defaults` 集中；认证退避跨 SW 生命周期持久化 | 端口默认值经 `lib/env.ts` `envNumber('VITE_AGENT_BRIDGE_PORT', <默认>)`，`.env.example` / `.env.local` 同步 |
| 调度 | `lib/agent-bridge/scheduler.ts`（SW） | 镜像 `lib/sync/scheduler.ts`：listener 同步注册；开关开 → `chrome.alarms.create('agent-bridge-poll', { periodInMinutes: 0.5 })`；alarm → `tryConnect()`；开关关 → clear alarm + close；`onStartup` 补偿；`storage.watch` 响应设置变更 | 不得用 `setTimeout` 跨事件 |
| 客户端 | `lib/agent-bridge/client.ts`（SW） | `BridgeTransport` 接口 + `WebSocketTransport` 实现；open → `hello`；`welcome` 校验 token → connected；`tools.call` → registry；`ping` → `pong`；close → 写 status，等下一次 alarm；bad-token 指数退避到 5min | transport 接口留给将来的 Native Messaging 实现 |
| DB | `entrypoints/background.ts`、`lib/database/read-proxy-db.ts` | SW 静态导入只读 proxy leaf；首个 tool 调用时执行 `ensureOffscreen()` + `initReadDbProxy()`；共享 init state 保证并发只初始化一次 | 禁止 SW value-import `drizzle-orm/pglite`、database barrel/main；Phase 0 已实测调用链 |
| 页面即时连 | `entrypoints/app/` | app.html 打开/设置变更时向 SW 发 `AGENT_BRIDGE_CONNECT_NOW`（background 协议新消息，含 schema/route/contract test） | 不在页面里开 WS，连接只归 SW |
| 设置 UI | `entrypoints/app/sections/settings/agent-bridge-card.tsx` | Connections tab 新卡：开关、端口、token（生成/重置/复制，默认遮罩）、一键复制 Claude Code / Codex 命令、状态 chip（订阅 `local:agent-bridge-status`） | i18n zh/en；CJK 守卫 |
| Node 包 | `packages/favbase-mcp/` | `cli.ts`（shebang，stderr 日志，stdout 只走 MCP）；`mcp-server.ts`（`@modelcontextprotocol/sdk` 低阶 `Server` + `StdioServerTransport`，`tools/list` 回最近 `hello` 的工具表，`tools/call` 转发）；`bridge-server.ts`（`ws` `WebSocketServer({ host: '127.0.0.1', port })`，Origin + token 校验，单连接、新连接替换旧连接，20s ping）；`EADDRINUSE` → stderr 指引 + exit 1 | 依赖 `@modelcontextprotocol/sdk`、`ws`、`zod`；tsup 打包；`bin: { "favbase-mcp": "dist/cli.js" }`；自带 `tsconfig.json`（Node 类型）；测试文件 `// @vitest-environment node` |
| Skill | `skills/favbase/SKILL.md` | 何时用、先 `listTags` 探索、`platform` 取值语义、片段不足时 `getItemContent`、引用 `url`、只读、需 Chrome 运行 | 无脚本 |
| Manifest | `wxt.config.ts` | `minimum_chrome_version: '116'`（现为 `'117'`，MUI v9 下限，docs/25 Step 0）；`wxt.config.test.ts` 断言 | 无新权限（`alarms` 已有；Windows Chrome 149 实测 loopback WS 不需 host permission） |

### 6.3 协议（`favbase-agent-bridge` v1）

Envelope：`{ channel: 'favbase-agent-bridge', protocolVersion: 1, id: string, type, payload }`；未知 type / 非法 payload / 版本不符静默拒绝并关闭连接。

| 方向 | type | payload | 说明 |
|---|---|---|---|
| 扩展 → server | `hello` | `{ token, extensionId, extensionVersion, tools: ToolDescriptor[] }` | 连接后首条；工具表随 hello 下发，server 无需再问 |
| server → 扩展 | `welcome` | `{ token, serverVersion }` | 回显 token 供扩展校验 server 身份 |
| server → 扩展 | `reject` | `{ reason: 'bad-token' \| 'bad-origin' \| 'version' }` | 随后关闭 |
| server → 扩展 | `tools.call` | `{ callId, name, args }` | |
| 扩展 → server | `tools.result` | `{ callId, ok: true, result } \| { callId, ok: false, error: { code, message } }` | `error.code`：`unknown-tool` / `invalid-args` / `db-unavailable` / `execution-failed` |
| server → 扩展 | `ping` | `{}` | 每 20s；重置 SW 空闲计时 |
| 扩展 → server | `pong` | `{}` | |

`ToolDescriptor = { name: string, description: string, inputSchema: JsonSchema }`。

### 6.4 生命周期与错误矩阵

| 场景 | 行为 |
|---|---|
| 开关关闭 | 无 alarm、无连接、无轮询；设置页显示"未启用" |
| 开关开启、server 未启动 | 每 30s 试连，连接被拒即刻返回；status `disconnected` |
| server 启动、扩展在下一个 alarm 周期内连上 | `hello/welcome` 握手 → `connected`；server 端 `tools/list` 可用 |
| agent 在扩展连上之前调用工具 | server 有界等待 ≤75s（覆盖 Chrome 116–119 上被夹到 60s 的轮询周期），超时返回 MCP tool error（`isError: true`）：“favbase 扩展未连接：确认 Chrome 已开、favbase 已安装、设置 → Connections → Agent Bridge 已启用且端口/token 一致” |
| 工具执行中 SW 被终止 | 30s 空闲由 ping 覆盖、5min 单事件上限不会触发；server 侧调用超时（默认 60s，`searchKnowledgeBase` 含 embedding 调用需留余量）→ tool error；扩展重启后重连 |
| token 不匹配 | server `reject('bad-token')` 并关闭；扩展 status `lastError='bad-token'`，指数退避到 5min 再试（镜像 mcp-chrome 冷却） |
| Origin 非本扩展 | server 拒绝 upgrade（HTTP 403） |
| 第二个 `favbase-mcp` 实例 | `EADDRINUSE` → stderr："favbase bridge 端口 <port> 已被占用（可能是另一个 agent 会话）；关闭它，或两边同时改 `FAVBASE_BRIDGE_PORT` / 设置页端口" → exit 1 |
| agent 退出 | 进程随 stdio 关闭退出；扩展 close → `disconnected`，alarm 继续 |
| DB proxy 不可用（offscreen 创建失败） | `tools.result` error `db-unavailable`；不吞错 |
| 大正文（`getItemContent` 数 MB） | WS 无单条上限；MCP 侧不截断，由 agent 自行处理 `[UNKNOWN：Claude Code 对超大 tool result 的截断阈值]` |

### 6.5 安全基线

- 只绑 `127.0.0.1`；Bridge Token 双向校验；server 校验 `Origin`；工具面 SELECT-only（沿用 ADR 0001 的表级只读边界，桥不写任何表，含 `chat_conversations`）；默认关闭；token 可一键重置（旧连接立即失效）；stderr 不打印 token；设置页 token 默认遮罩。
- 泄露 token 的后果：本机进程可读知识库，不可写；与 provider key 同级风险。

### 6.6 用户安装流程（目标体验）

1. 设置 → Connections → Agent Bridge：打开开关，看到端口与 token，点"复制 Claude Code 命令"：
   `claude mcp add favbase -e FAVBASE_TOKEN=<token> -e FAVBASE_BRIDGE_PORT=<port> -- npx -y favbase-mcp`
   或"复制 Codex 命令"：
   `codex mcp add favbase --env FAVBASE_TOKEN=<token> --env FAVBASE_BRIDGE_PORT=<port> -- npx -y favbase-mcp`。
2. 终端粘贴执行。
3. 打开 Claude Code，提问；最坏 30s 内扩展连上；工具 `mcp__favbase__searchKnowledgeBase` 等出现。
4. （可选）`npx skills add InvisibleQAQ/favbase` 装 Skill。

## 7. 实施路线

| Phase | 内容 | 产出 / 验收 | 风险 |
|---|---|---|---|
| **0 Spike**（已完成，**GO**） | (a) SW 内 `ensureOffscreen()` → `initDbProxy()` → 跑一次 `hybridRetrieve`；(b) SW 出站 `new WebSocket('ws://127.0.0.1:<port>')` + 对端 20s ping，观察 SW 存活 >5min；(c) 是否需要 host permission；(d) `z.toJSONSchema` + `execute` 调用路径 | `spikes/agent-bridge/` + 第 9 节实测记录；四项均通过 | Windows Chrome 149 实测；未外推 Firefox |
| **1 协议 + 工具注册**（TDD，已完成） | `lib/agent-bridge/protocol.ts`、`tool-registry.ts` + contract test、import-smoke 清单、默认端口 `17836` | `describeTools()` 恰好 3 个且为 JSON Schema Draft 2020-12；`callTool` 以稳定错误码拒绝未知工具/非法参数；两模块无 `chrome` 全局可导入 | 低 |
| **2 Node 包**（已完成） | workspace `packages:`、根 tsconfig `exclude: ["packages"]`、根 `compile` 串 `pnpm -r compile`、vitest node 环境；MCP server + bridge server + 认证 + `EADDRINUSE` + 有界等待；用假扩展（ws client）做集成测试 | `tools/list` 在 hello 前返回空并写 stderr 提示；hello 后动态工具表/调用往返；bad-token 拒绝；非 `/bridge` / 非扩展 Origin upgrade 拒绝；第二实例退出码 1；根全量 1155 + Node 7 测试通过 | MCP SDK 精确锁定 `1.29.0`；tsup 已实证把 `../../lib` protocol leaf 打入 17.98 KB CLI，无未解析仓库相对 import |
| **3 扩展 SW 侧**（已完成） | storage key + defaults、scheduler、client（`BridgeTransport` 接口）、background.ts 接线、`AGENT_BRIDGE_CONNECT_NOW` 消息（schema/route/contract test）、`minimum_chrome_version` | 假 WebSocket 单测覆盖 hello/welcome/call/ping/close/退避；开关关→零 alarm；生产 background bundle 不含 PGlite 主实现 | SW 生命周期仍只能实机验证 |
| **4 设置 UI**（已完成） | `agent-bridge-card.tsx` + i18n + 复制命令 + 状态订阅；app.html 打开与配置变更即时请求连接 | CJK 守卫、card/settings-view/App 测试；Codex `--env` 已验证 | 低 |
| **5 Skill + 文档** | `skills/favbase/SKILL.md`、README 安装段、`lib/agent-bridge/CLAUDE.md`、`packages/favbase-mcp/CLAUDE.md`、设置页 CLAUDE.md、根 CLAUDE.md 索引、`.env.example` 变量 | 文档即代码 | 低 |
| **6 E2E + 发布** | Windows 实机：Claude Code 与 Codex 各走一遍；`pnpm compile` → `test` → `zip`；npm publish `favbase-mcp`；扩展 `version` 递增 | 验收：agent 调 `searchKnowledgeBase` 与 Chat 同查询同结果集；扩展未连接时可读错误而非挂起 | Windows 端到端；npm 首发 |

### v2 backlog（不进本任务）
- B' daemon 拆分（多 agent 并发）
- `listItems` / `listSources`（加在 `lib/chat/tools.ts`，Chat 同享）
- Claude Code Plugin（`.mcp.json` + `skills/`）
- Native Messaging 作为第二 `BridgeTransport`
- `tools/list_changed` / resources / 变更推送（需 `lib/events` 跨 context 转发层）
- Firefox（WS 与 alarms 语义相同，未验证）

## 8. 领域语言（已入 / 待入 CONTEXT.md）

- 已入：**Agent Bridge**、**Knowledge Tool**、**Bridge Token**，四条关系、一段对话、一条已解决歧义（"MCP 还是 Skill"）。

## 9. 未知与风险清单

### Phase 0 实测记录（2026-08-23）


环境：Windows，Google Chrome 149.0.7827.104，UUID 隔离 profile；扩展由
`--enable-unsafe-extension-debugging` + CDP `Extensions.loadUnpacked` 加载。
`run-phase-0.ps1` 只修改临时复制的 manifest，删除 `<all_urls>`、
`localhost`、`127.0.0.1` host pattern；正式 `wxt.config.ts` 未改。
原始证据为 `spikes/agent-bridge/phase-0-result.json`，共 19 个事件、0 个错误。

| 验证项 | 实测结果 | 判定 |
|---|---|---|
| (a) SW → Offscreen DB proxy → `hybridRetrieve` | `ensureOffscreen()` + `initDbProxy(ensureOffscreen)` 成功；关键词臂只读查询 2385ms，隔离空库返回 0 条 | **GO**；空结果是合法业务结果，链路未抛错 |
| (b) 出站 WS + 20s ping 保活 | 单连接持续 330.012s；17 个 pong；首尾跨度 319.993s；全过程仅 1 个 SW `instanceId` | **GO**；超过 5min 且未发生 SW 重启 |
| (c) loopback host permission | 实际运行 manifest 无 `<all_urls>` / `localhost` / `127.0.0.1`；仍从 `chrome-extension://<isolated-id>` 成功连接 `ws://127.0.0.1:17836` | **GO**；Chrome 149 无需新增 host permission |
| (d) `z.toJSONSchema` + `execute` | 三个 Knowledge Tool 均生成 JSON Schema Draft 2020-12；`searchKnowledgeBase` 先 `parse` 再以真实 `experimental_context.db` 执行，返回合法 `{count:0}` | **GO**；Phase 1 可直接做 registry adapter |

**Phase 0 总结论：GO，不重开 Q3。** 限定结论只覆盖上述 Windows Chrome
149 环境；Firefox 和 Chrome 更早版本仍未验证。Spike build 因打入 PGlite
约 52MB，只用于实测，不是生产 bundle 方案。

### 剩余风险

| 项 | 状态 | 解法 |
|---|---|---|
| 30s 轮询对电量/性能影响 | `[UNKNOWN]` | 只在开关开启时轮询；Phase 6 观察 |
| `pnpm compile`/`vitest` 与 workspace 共存 | **已解决**：根配置排除 packages，脚本再以 `pnpm -r` 执行包内 Node 配置 | Phase 2 根 `compile`、1155 + 7 测试通过 |
| Codex `mcp add` env 透传语法 | **已解决**：`--env KEY=VALUE`（可重复） | 官方 OpenAI 配置文档 + 本机 CLI help；Phase 6 仍做端到端验证 |
| `npx skills add` 命令最终形态 | `[UNKNOWN]` | Phase 5 查 agentskills.io |
| Claude Code 对超大 tool result 的截断 | `[UNKNOWN]` | Phase 6 用长正文实测 |
| 默认端口值 | **已解决**：`17836` | 扩展共享协议与 Node bundle 同源于 `protocol.ts` 常量 |
| 主工作区 `main` 同时有别的会话在改（CLAUDE.md 中-6） | 已知 | 本任务只在 worktree 改，合并时 rebase |

## 11. 2026-08-28 修订：Skill-first（MCP 前端下线）

用户决定「全面放弃 MCP，做 Skills」。桥不变，前端换掉：

| 原结论 | 修订 |
|---|---|
| §1「做 MCP，Skill 作为薄附件」 | 做 **CLI + daemon**，SKILL.md 教 agent 调 CLI；不提供 MCP server |
| Q5 多 agent 并发留 v2 的 B' daemon | **v1 必做**。CLI 每次调用是新进程，扩展 30 s 轮询出站，没有常驻 daemon 每次都要等一个周期再断线 |
| Q9 「带脚本的 Skill = 绕过 MCP 的第二条数据路径，否决」 | 原则不变（数据路径唯一，CLI 不碰 DB 只打 daemon），但 Skill 现在描述的就是那条路径的前端 |
| Q10 不实现 `tools/list_changed` | 无对象了；`/status?wait=1` 沿用 `listTools` 有界等待 |
| §6.6 `claude mcp add` / `codex mcp add` 两条命令 | 一条 `npx -y favbase-cli setup --token <token> --port <port>`：写 `~/.favbase/config.json` 并装 `~/.claude/skills/favbase/`、`~/.agents/skills/favbase/`；之后 `favbase doctor` 验证 |
| A1「Skill 碰不到数据」 | 仍成立，正因如此才必须有 daemon |

实现：`packages/favbase-cli`（取代 `packages/favbase-mcp`，删 `@modelcontextprotocol/sdk`），`skills/favbase/SKILL.md`，设置卡单按钮，`tests/agent-bridge-cli-aliases.test.ts`；细节见 ADR 0003 与 `packages/favbase-cli/CLAUDE.md`。剩余风险表中「Claude Code 对超大 tool result 的截断」改为「agent 对超大 stdout 的截断」，「`npx skills add` 命令最终形态」已解决为 `npx skills add InvisibleQAQ/favbase`（vercel-labs/skills）。

## 10. 参考

- Chrome：https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle · https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging · https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets · https://developer.chrome.com/docs/ai/webmcp/compare-mcp
- 参考项目：https://github.com/hangwin/mcp-chrome · https://github.com/MiguelsPizza/WebMCP · https://github.com/microsoft/playwright-mcp · https://github.com/microsoft/playwright/tree/main/packages/extension · https://github.com/BrowserMCP/mcp · https://github.com/ChromeDevTools/chrome-devtools-mcp · https://github.com/coddingtonbear/obsidian-local-rest-api · https://github.com/karakeep-app/karakeep/tree/main/apps/mcp · https://github.com/adeze/raindrop-mcp · https://github.com/readwiseio/readwise-mcp · https://github.com/electric-sql/pglite
- Claude in Chrome 退场证据：https://code.claude.com/docs/en/chrome · anthropics/claude-code #34364 #27178 #25091 #23828 #23526 #23739
- Agent 侧：https://code.claude.com/docs/en/mcp.md · https://code.claude.com/docs/en/skills.md · https://code.claude.com/docs/en/plugins.md · https://agentskills.io · https://modelcontextprotocol.io
