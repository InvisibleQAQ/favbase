# Agent Bridge 的外部面改为「favbase CLI + 常驻 Bridge Daemon + Agent Skill」，不再提供 MCP server

2026-08-28。用户决定放弃 MCP 前端、全面转向 Agent Skills（Claude Code / Codex 经 SKILL.md 学会调用一个本机 CLI）。ADR 0002 选定的数据路径——扩展出站 WebSocket → 本机 Node 进程，检索在扩展 SW 内复用 `chatTools`，Node 侧零工具知识零凭据——**保持不变**；本决策只替换那个 Node 进程对 agent 的接口：stdio MCP 变成 loopback HTTP + 薄 CLI，进程从「agent 拉起、随会话生死」变成「CLI 首次调用自启、空闲自灭」的 daemon。

## Decision

- `packages/favbase-cli`（npm `favbase-cli`，bin `favbase`）取代 `packages/favbase-mcp`；`@modelcontextprotocol/sdk` 依赖删除，`mcp-server.ts` 删除。
- 一个 loopback 端口（默认 `17836`）同时承载两半：`/bridge` 是扩展的 WebSocket（协议、Origin + Bridge Token 认证、心跳、有界等待全部沿用），`/rpc`、`/status`、`/shutdown` 是 CLI 的 JSON 路由，`/health` 无鉴权只回 `{ name, version, pid }`。
- CLI → daemon 必须带 `Authorization: Bearer <Bridge Token>`（timing-safe 比较）；任何携带 `Origin` 头的请求一律 403，把「网页 fetch 127.0.0.1」这条路在鉴权之前就关掉。
- daemon 由 CLI 首个数据命令 detached 自启（stdout/stderr 落 `~/.favbase/daemon.log`），`FAVBASE_DAEMON_IDLE_MINUTES`（默认 120，0 = 不退出）无 CLI 请求后自灭；`favbase daemon run|start|stop|restart` 显式控制。第二个 `daemon run` 遇端口占用退出码 1、绝不杀占用者；端口被非 favbase 程序占用时 CLI 退出码 2 并指引换端口。
- token / port 解析：`FAVBASE_TOKEN` / `FAVBASE_BRIDGE_PORT` 环境变量 > `~/.favbase/config.json`（`FAVBASE_HOME` 可改根目录）> 共享默认端口。`favbase setup --token T [--port P]` 写配置并顺手把 skill 装到 `~/.claude/skills/favbase/` 与 `~/.agents/skills/favbase/`。
- SKILL.md 单源在仓库 `skills/favbase/SKILL.md`（agentskills.io frontmatter + `allowed-tools: Bash(favbase:*)`），tsup 以 text loader 打进 CLI；也可 `npx skills add InvisibleQAQ/favbase`。
- CLI 的 `search` / `tags` / `get` 是三个 Knowledge Tool 的别名表（`commands.ts` 单一常量），根测试 `tests/agent-bridge-cli-aliases.test.ts` 用 `describeTools()` 对账；`favbase call <tool> --args <json>` 与 `favbase tools` 保持零知识通道，工具面变化不必改 CLI。
- stdout 只输出 JSON，诊断进 stderr；退出码 0 成功 / 1 用法或配置 / 2 daemon 或扩展不可达 / 3 Knowledge Tool 错误。

## Considered Options

- **保留 MCP 作为第二前端（bbx / Readwise 双前端）** — 拒绝。零用户时双前端是双倍测试面与文档面；MCP 只是 daemon 之上的一层 adapter，需要时百余行即可加回，不必现在背着。
- **CLI 每次调用自起 server、不做 daemon** — 拒绝。扩展靠 30 秒 alarm 轮询出站，每个新进程都要等一个周期再断线，比 MCP 时代还差；docs/21 的 Q5 把 daemon 推到 v2 的前提（一个进程活一整个会话）已不成立。
- **带脚本的 Skill 直接读 PGlite / 导出快照** — 拒绝，理由同 ADR 0002：第二套检索引擎 + embedding key 出扩展。
- **CLI ↔ daemon 用 named pipe / Unix socket** — 拒绝。参考环境是 Windows；同端口路径分流让扩展设置页零改动，且 Origin 拒绝 + Bearer 已覆盖 loopback 的暴露面。

## Consequences

- Node 包再无 `tools/list` 时序问题这一类 bug（MCP 客户端连接时一次性拉工具表的语义消失）；`bridge-server.ts` 的 `listTools` 有界等待与 `onPeerReady` 仍保留给 `/status?wait=1`。
- 多 agent 并发（原 Q5 v2）随 daemon 免费获得；daemon 重启时扩展在下一个 alarm 周期内重连。
- 首次调用最坏仍等一个轮询周期（~30 s）+ hello；CLI 侧请求超时 120 s 覆盖 35 s hello 等待 + 60 s 工具期限。
- agent 侧失去 MCP 的 schema 校验，CLI 的 argv 解析、JSON stdout、stderr 错误与退出码成为品质线，由包内测试锁定。
- CONTEXT.md 的 **Agent Bridge** 定义不变，新增 **Bridge Daemon** 与 **favbase CLI**；「MCP 还是 Skill」歧义的解决改为：桥不变、前端是 CLI + Skill。
- docs/21 的 Q5 / Q9 / Q10 与 §6.6 安装流程被本 ADR 取代；ADR 0002 中「agent 以 stdio 拉起 `favbase-mcp`」「一个进程对应一个 agent 会话」两句不再成立，其余仍有效。
- npm 发布与 Windows 实机 E2E 仍未做（`favbase-cli` / `favbase` 两个包名 2026-08-28 查询均未被占用）。
