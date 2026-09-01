# Agent Bridge 重连延迟整改方案（2026-09-01）

状态：Step 0 已执行（2026-09-01，结论见 §9：§2 成立，可按方案执行）；**Step 1 已落地（2026-09-01，见 §6 Step 1 的「实施记录」）**；**Step 2 已落地（2026-09-01，见 §6 Step 2 的「实施记录」）**；Step 3-6 待实施
范围：`lib/agent-bridge/`、`lib/storage/agent-bridge.ts`、`packages/favbase-cli/`、`skills/favbase/SKILL.md`、`entrypoints/app/sections/settings/agent-bridge-card.tsx`
前置：ADR 0002（扩展出站 WebSocket）、ADR 0003（Skill-first CLI + Daemon）、`docs/21_agent-bridge-analysis-2026-08-22.md`

---

## 0. 结论先行

问题报告原话是「daemon 空闲 120 分钟自灭后，扩展侧持久退避涨到 5 分钟上限，重新用起来最坏等待接近 5 分钟」。

**这条因果链有一半在代码里不成立。** 逐行核对后的真实情况：

| 说法 | 核实结果 |
|---|---|
| daemon 自灭 → 扩展退避涨到 5 分钟 | **不成立**。连不上端口不写 `nextRetryAt`，30 秒 alarm 照常重试 |
| 最坏等待接近 5 分钟 | **只有 token 不匹配时成立**，且此时是永久 5 分钟，不是「涨到」 |
| SKILL.md 承诺首次调用最坏 ~35 秒 | **在 Chrome 120+ 勉强成立，116–119 上不成立** |
| 只能靠开关重开绕过 | **成立，且这是 bug**：设置页「立即重连」按钮在退避窗口内是空操作 |

真正要修的是四个缺陷（D1–D4），不是退避曲线。方案分三阶段：A 止血（必做，低风险）、B 常连（把「最坏等待」变成「常态零等待」）、C 迁 Offscreen（结构正解，可选）。

**Native Messaging、MCP、文件轮询三条路径已评估并否决**，理由见 §4.3。

---

## 1. 事实核对（代码证据）

| 事实 | 位置 |
|---|---|
| `AUTH_BACKOFF_BASE_MS = 30_000`，`AUTH_BACKOFF_MAX_MS = 5 * 60_000` | `lib/agent-bridge/client.ts:24-25` |
| 退避唯一触发点是 `applyAuthBackoff(connection, 'bad-token')`，来源仅两处：welcome token 不匹配、daemon 发 `reject: bad-token` | `client.ts` `handleHandshakeMessage` / `handleReject` |
| 退避门禁：`if (status.nextRetryAt !== null && status.nextRetryAt > now()) return;` | `client.ts:184`（`openConnection` 内） |
| 连接失败（ECONNREFUSED）走 `handleTransportError` → `disconnect(..., 'connection-error')`，**只写 `lastError`，不写 `nextRetryAt`** | `client.ts` `handleRemoteClose` / `handleTransportError` / `disconnect` |
| `authFailureCount` 只被两件事清零：收到合法 welcome、`close()`（disabled / config-changed） | `client.ts:162-163`、`client.ts:286-287` |
| 轮询 alarm 周期 `AGENT_BRIDGE_POLL_MINUTES = 0.5` | `lib/agent-bridge/scheduler.ts:9` |
| `connectNow()` → `enqueueRefresh(false)` → `refresh(false)` → `client.tryConnect()`，**不 close、不清退避** | `scheduler.ts` |
| 状态字段定义（`authFailureCount` / `nextRetryAt` 注释已写明「reset only by a valid welcome」） | `lib/storage/agent-bridge.ts:25-27` |
| 存储键 `local:agent-bridge` / `local:agent-bridge-status` | `lib/storage/keys.ts:25-26` |
| daemon idle 默认 120 分钟，`FAVBASE_DAEMON_IDLE_MINUTES` 可配，`0` 关闭 | `packages/favbase-cli/daemon.ts` `DaemonOptions.idleMinutes` / `touch()` |
| CLI HTTP 鉴权成功后的 `onActivity()` 与已认证 peer 的 `onPeerActivity` / `onPeerDisconnected` 都驱动 daemon idle 计时 | `packages/favbase-cli/rpc-server.ts:147`、`packages/favbase-cli/bridge-server.ts`、`packages/favbase-cli/daemon.ts` |
| WS 心跳 `DEFAULT_HEARTBEAT_MS = 20_000`（daemon 发 ping，扩展回 pong） | `packages/favbase-cli/bridge-server.ts:26` |
| daemon 等扩展 peer 的上限 `DEFAULT_HELLO_WAIT_MS = 35_000` | `packages/favbase-cli/bridge-server.ts:23` |
| SKILL.md 的「~35 s」和 `EXTENSION_HINT` 的「within 30 seconds」是两个独立硬编码文案 | `skills/favbase/SKILL.md:68`、`packages/favbase-cli/cli-main.ts:38-39` |

外部平台事实：

- Chrome 对 `chrome.alarms` 的最小周期是 **30 秒，且自 Chrome 120 起才放开**；此前最小 1 分钟，`periodInMinutes < 0.5` 会被忽略并告警。本项目 manifest 最低 Chrome 116，**116–119 上 `0.5` 被夹到 60 秒**。
- Chrome 116 起 WebSocket 收发会重置 SW 的 30 秒空闲计时器 —— 这是 20 秒心跳能保活 SW 的依据，也是 ADR 0002 选出站 WS 的前提。
- Offscreen Document 除 `AUDIO_PLAYBACK` 外的 reason **没有寿命上限**，不受 SW 30 秒空闲终止影响。

---

## 2. 「5 分钟」到底从哪来

能走到 5 分钟的路径只有一条：**扩展设置里的 Bridge Token ≠ `~/.favbase/config.json` 里的 token**（或 `FAVBASE_TOKEN` 环境变量覆盖成了旧值）。

此时每次连上都被 `reject: bad-token`，`authFailureCount` 单调递增且永不衰减，第 5 次起 `nextRetryAt` 永久钉在 `now + 5min`。因为 `connectNow()` 不清零（D1），用户点「立即重连」没反应；只有关掉再打开 Agent Bridge 开关走 `close()` 才能复位 —— **这正是「靠开关重开绕过去」这个现象的指纹**。

`Step 0` 的诊断动作就是为了确认这一点。**2026-09-01 已实测确认（§9.4）**：构造 token 不匹配后，即使把 token 修回正确、daemon 重启，扩展仍被自己的 `nextRetryAt` 锁在门外。不存在第四条路径 —— 全量 grep 证实 `AUTH_BACKOFF_MAX_MS` 是系统里唯一的 5 分钟量级常量。

---

## 3. 四个确凿缺陷

### D1 — 用户显式重连被自动退避吞掉（严重）

`AGENT_BRIDGE_CONNECT_NOW` 已经接了两个入口（`entrypoints/app/App.tsx:22` 挂载即触发、`agent-bridge-card.tsx:179` 按钮），但链路终点 `client.tryConnect()` 在 `client.ts:184` 被 `nextRetryAt` 无条件挡回。

**原则**：自动退避是用来保护对端的，用户显式动作是新信息，必须能穿透它。当前实现让用户唯一可用的自救手段变成了开关重开。

### D2 — daemon 的 idle 计时不认扩展（严重）

`touch()` 只被 `rpc-server.ts:147` 的 CLI 请求驱动。20 秒心跳在 WS 上跑得再欢也不算活动。结果：**daemon 会在扩展好好连着的情况下自杀，亲手砍掉自己唯一的保活链路**，把「热连接」打回「冷启动」。

### D3 — 常量之间没有契约（中）

三个数字各写各的，互相不知道对方存在：

- 扩展 alarm 周期 30 秒（旧 Chrome 上实际 60 秒）
- daemon 等 peer 上限 35 秒
- 文案里写死的「30 秒 / ~35 秒」两处

在 Chrome 116–119 上，alarm 实际 60 秒 > hello wait 35 秒 ⇒ **冷启动第一次 `favbase search` 必然超时退出码 2**，而文案还在说 35 秒内会好。

### D4 — 退避状态没有衰减，也不可观测（中）

`authFailureCount` 只增不减，一次配置事故会留下永久 5 分钟惩罚。而 `doctor` 输出只有 daemon 侧视角（`status.extension.connected`），**看不到扩展侧的 `lastError` / `authFailureCount` / `nextRetryAt`**，用户和排障者都是瞎的。

---

## 4. 为什么不能靠「换个连接方式」解决

### 4.1 硬约束

1. MV3 扩展**不能监听端口**，只能出站。
2. **外部进程没有任何官方 API 能唤醒已休眠的 Service Worker。** 可用唤醒源只有两个：Chrome 路由给它的事件（alarm 地板 30 秒）、一条已经开着的连接上的流量。

### 4.2 推论

> 零等待的充要条件是「连接一直开着」，等价于「对端一直在」。

换 MCP、HTTP 长轮询、gRPC、Unix domain socket、WebRTC —— 一条都不改变这个结论。**当前传输选型（ADR 0002/0003）没有问题，问题出在生命周期语义。** D2 就是这个语义写反了的直接后果。

唯一能绕开「SW 会休眠」这件事的，是把连接搬到不会休眠的 context —— 也就是 Offscreen Document（方案 C）。

### 4.3 已否决的路径

| 路径 | 否决理由 |
|---|---|
| Native Messaging | 能把进程生命周期交给浏览器管、顺带干掉 token 配置。但要写 Windows 注册表键 / 各平台 manifest 文件、要内嵌扩展 ID（unpacked 与商店 ID 不同），纯 `npm i -g` 分发直接作废；**且它照样唤不醒休眠的 SW，30 秒地板还在**。为一个它解决不了的问题付这个代价，不划算 |
| 改回 MCP server | ADR 0003 已否决；且 MCP 是 stdio-per-client，比常驻 daemon 更贵，同样解决不了唤醒问题 |
| 文件 / localStorage 轮询 | 扩展侧仍需被唤醒才能轮询，回到 alarm 地板；纯粹多一层 |
| `chrome.webRequest` / DNR 当唤醒源 | 只观察浏览器发起的请求，外部进程发到 loopback 的包打不到扩展 |
| CLI 用 `chrome.exe chrome-extension://<id>/...` 强行唤醒 | 会抢焦点弹标签页，体验不可接受 |

---

## 5. 方案分级

| 阶段 | 目标 | 等待时间 | 改动量 | 建议 |
|---|---|---|---|---|
| **A 止血** | 修 D1–D4，让文档承诺与实现一致 | 冷启动 ≤ alarm 周期；显式重连即时 | 几十行 + 测试 | **必做** |
| **B 常连** | daemon 不再自杀，热连接成为常态 | ≈ 一次本地 RPC 往返 | 十几行 + 默认值决策 | **建议做** |
| **C Offscreen** | 连接彻底脱离 SW 生命周期 | ≈ 0，且不再需要心跳保活 | 真重构 | 下一阶段评估 |

A + B 做完，用户感知的「等待」在 99% 的场景下消失；剩下 1% 是 Chrome 冷启动 / daemon 首次拉起，那部分受 alarm 地板约束，**物理下界 30 秒，无法靠 A/B 突破**，只能靠 C。

---

## 6. 分步实施

> 每一步都是可独立提交、可独立回滚的最小单元。按顺序做，不要并行。
> 项目规矩：改代码同步对应目录 `CLAUDE.md`；每步列出的「文档同步」不是可选项。

### Step 0 — 诊断（不改代码，但**不能跳过**）

**目的**：确认 §2 的假设。假设不成立就停下重新调查，不要照着本方案往下改。

1. 复现场景：等 daemon idle 自灭（或 `favbase daemon stop`），然后跑一次 `favbase search "test"`（位置参数，不是 `--query`）。
2. 打开扩展的 Service Worker DevTools console，执行：
   ```js
   await chrome.storage.local.get(['agent-bridge', 'agent-bridge-status'])
   ```
   （WXT 的 `local:` 前缀不进实际 key，所以这里不带前缀。）
3. 记录 `agent-bridge-status` 的 `state` / `lastError` / `authFailureCount` / `nextRetryAt`，以及 `agent-bridge.token` 是否与 `~/.favbase/config.json` 的 `token` 一致。
4. 同时看 `~/.favbase/daemon.log` 最后几行。

**判读**：

- `lastError === 'bad-token'` 或 `authFailureCount > 0` ⇒ 配置事故，§2 成立，按本方案执行，并把「token 不匹配」列为 Step 4 文案的头号提示。
- `lastError === 'connection-error'` 且 `authFailureCount === 0` ⇒ **5 分钟这个数字另有出处**。停止实施，先查：alarm 是否真的存在（`await chrome.alarms.getAll()`）、Chrome 版本是否 < 120、`this.connection` 是否卡在非 null 状态（表现为 `state` 长期 `connecting`）。

**验收**：诊断结论写进本文件 §9「实测记录」。

> **注意**：成功握手会清零 `authFailureCount`/`nextRetryAt`（`client.ts:162-163`），事后快照无法反证退避发生过。2026-09-01 的执行改用主动构造 bad-token 的黑盒实验定因，见 §9.4。

---

### Step 1 — 让显式重连穿透退避（修 D1）

**文件**：`lib/agent-bridge/client.ts`、`lib/agent-bridge/scheduler.ts`

1. 给 `AgentBridgeClient.tryConnect()` 增加一个显式意图参数，例如
   `tryConnect(trigger: 'schedule' | 'user' = 'schedule')`。
   不要新增一个平行的 `forceConnect()` 方法 —— 两条路径会分叉，迟早不同步。
2. `openConnection()` 中的退避门禁（`client.ts:184`）改为：`trigger === 'user'` 时跳过门禁，**并在跳过前把 `authFailureCount` 归零、`nextRetryAt` 置 null**。归零要放在 `setStatus({state:'connecting'})` 之前，保证失败后重新从 30 秒基数开始爬，而不是接着上次的指数。
3. `scheduler.ts` 的 `connectNow()` 传 `'user'`；alarm、startup、config-watch 三条路径保持 `'schedule'`。
4. `AgentBridgeSchedulerClient` 接口同步加参数。

**注意**：`entrypoints/app/App.tsx:22` 是「打开 app.html 就触发」，语义上算不算「用户显式」？**算**——用户打开了扩展页面就是在表达使用意图，而且这条路径每次开页面最多触发一次，不构成对 daemon 的压力。

**测试**（`lib/agent-bridge/client.test.ts` / `scheduler.test.ts`）：

- 退避窗口内 `tryConnect('schedule')` 不建连；同一窗口内 `tryConnect('user')` 建连。
- `tryConnect('user')` 后状态里的 `authFailureCount` 为 0、`nextRetryAt` 为 null。
- `user` 触发后再次 bad-token，延迟回到 30 秒基数（不是 5 分钟）。
- `scheduler.connectNow()` 以 `'user'` 调用 client；alarm 路径仍是 `'schedule'`。

**文档同步**：`lib/agent-bridge/CLAUDE.md` 的 Contracts 段，把「reset only by a valid welcome or deliberate reconfiguration」改成包含「用户显式 connect-now」。

#### 实施记录（2026-09-01 已落地）

按上述四条实施，无偏离。落点：

- `client.ts` 导出 `AgentBridgeConnectTrigger = 'schedule' | 'user'`（默认 `'schedule'`），
  `tryConnect(trigger)` → `openConnection(generation, trigger)`。
- 门禁改为 `if (!explicit && status.nextRetryAt !== null && ...) return;`；归零与
  `state: 'connecting'` **合并成同一次 `setStatus`**（`...(explicit ? { authFailureCount: 0, nextRetryAt: null } : {})`），
  一次 storage 往返即满足「归零在 connecting 之前」的要求。
- `scheduler.ts` 的 `enqueueRefresh` / `refresh` 透传 trigger；`connectNow()` 是唯一 `'user'`，
  alarm / startup / config-watch / 初始 refresh 全部 `'schedule'`。
- 顺手落实 §8 第三条：`handleRemoteClose` 并入 `disconnect(connection, 'connection-closed')`，
  消除「远端关闭时不 close transport」的不对称（socket 已死时 `close()` 是 no-op，行为等价）。

**未做（按原文「无证据不动手」）**：§9.7 的 `createTransport` 同步抛出吞错路径、§8 的
`connect-timeout` 兜底。另记一条 doc 未提及的已知窗口：`tryConnect()` 在 `this.connectAttempt`
非 null 时 await 那个 in-flight attempt，因此恰好撞上 alarm 起跑瞬间的 `'user'` 意图会被降级成
`'schedule'`；窗口是两次 storage 读（~ms 级），加锁会把状态机复杂化，判定为过度设计，不修。

**测试**：`client.test.ts` 新增「explicit user reconnect pierces the backoff and restarts at the
base delay」（退避窗口内 `'schedule'` 不建连 / `'user'` 建连 / 计数归零 / 再失败回 30 秒基数），
并在原有 remote-close 用例补 `transport.closed` 对称性断言；`scheduler.test.ts` 新增
「marks only connect-now as an explicit user trigger」。`pnpm compile` 通过，
`pnpm test` 1259 passed —— 余下 2 个失败是 `lib/database/{db,proxy-db}.test.ts` 在全量并发下的
5 秒超时抖动，**stash 掉本次改动后基线同样失败**，与 Step 1 无关。

**文档已同步**：`lib/agent-bridge/CLAUDE.md`（Modules/Contracts/Tests 三段）、
`.trellis/spec/frontend/agent-bridge.md`（Bridge Client 场景的签名 / 契约 / 错误矩阵 /
Bad case / Tests / Wrong-vs-Correct）、根 `CLAUDE.md` 的 docs/24 条目。

---

### Step 2 — daemon idle 计时认扩展（修 D2）

**文件**：`packages/favbase-cli/bridge-server.ts`、`packages/favbase-cli/daemon.ts`

1. `BridgeServer` 增加一个活动回调（如 `onPeerActivity?: () => void`），在**扩展 hello 认证成功**和**收到 pong / 任意已认证帧**时触发。不要在 daemon 自己发 ping 时触发 —— 那是自说自话，永远不会 idle。
2. `Daemon` 把 `onPeerActivity` 接到现有的 `touch()`。
3. 更强的语义（**推荐**）：`touch()` 在「存在已认证 peer」时**根本不启动** idle 定时器；peer 断开时才开始计时。这样「有扩展连着的 daemon 永不自灭」是结构保证，而不是靠心跳频率 < idle 阈值这种巧合。

选 3 的话实现是：`touch()` 里 `if (this.bridge.peerSnapshot().connected) { clearTimeout; return; }`，并在 peer 断开的回调里调一次 `touch()` 启动计时。

**测试**（`packages/favbase-cli/daemon.test.ts`）：

- 用极小 `idleMinutes` + fake timers：有已认证 peer 时推进远超 idle 的时间，daemon 不退出。
- peer 断开后推进 idle 时长，daemon 退出。
- 无 peer 且无 CLI 请求，行为与现在一致（回归）。

**文档同步**：`packages/favbase-cli/CLAUDE.md` 的 `daemon.ts` 条目，把 idle 语义从「没有 CLI 请求」改成准确描述。

#### 实施记录（2026-09-01 已落地）

- `BridgeServer` 增加 `onPeerActivity` / `onPeerDisconnected` 回调：合法 hello、已认证的
  `pong`/`tools.result` 入站帧触发活动回调；daemon 发出的 `ping` 不触发；当前 peer 断开触发
  断开回调。
- `Daemon.touch()` 在存在已认证 peer 时清除并保持无 idle timer；断开后重新启动完整 idle
  窗口。无 peer 时的原有 CLI 请求驱动计时和 `idleMinutes: 0` 语义保留。
- 测试覆盖 authenticated peer 超时不退出、断开后退出、无 peer 回归，以及入站活动/出站 ping
  回调边界。

---

### Step 3 — 常量对齐（修 D3）

**文件**：`lib/agent-bridge/scheduler.ts`、`packages/favbase-cli/bridge-server.ts`

问题的本质是 daemon 的 `helloWaitMs` 必须 **≥ 扩展 alarm 的实际周期 + 一次连接握手余量**，否则冷启动必超时。

1. 认清 alarm 实际周期的上界：Chrome < 120 会把 `0.5` 夹到 **60 秒**。所以实际上界是 60 秒，不是 30 秒。
2. 把 `DEFAULT_HELLO_WAIT_MS` 从 35 秒提到 **75 秒**（60 + 15 余量）。这不会让「热连接」变慢 —— 有 peer 时 `waitForPeer` 立即返回；它只影响冷启动那一次的耐心程度。
3. 在两处常量上互相写明依赖关系的注释（`scheduler.ts` 的 `AGENT_BRIDGE_POLL_MINUTES` 旁注明「daemon 的 helloWait 必须覆盖本周期在旧 Chrome 上被夹到的 60 秒」，反之亦然）。**这是跨包的隐式契约，注释是当前唯一可行的表达方式** —— CLI 包只允许 import `protocol.ts` 这一个 leaf（`packages/favbase-cli/CLAUDE.md` Boundaries），把周期常量塞进 protocol 会污染 wire contract，不要这么干。

**测试**：`bridge-server.test.ts` 现有 hello-wait 用例改用注入值，避免把 75 这个数字硬编进断言。

**替代方案（不推荐）**：把 alarm 周期改成 1 分钟以消除版本差异。这会让 Chrome 120+ 的用户白等一倍时间，为了旧版本惩罚新版本，方向反了。

---

### Step 4 — 可观测性与文案诚实化（修 D4）

**文件**：`packages/favbase-cli/rpc-server.ts`（或经由 `/status` 透传）、`cli-main.ts`、`skills/favbase/SKILL.md`、`entrypoints/app/sections/settings/agent-bridge-card.tsx`

1. **`doctor` 要能看到扩展侧状态**。当前 `/status` 的 `extension` 字段来自 `peerSnapshot()`，是 daemon 视角，扩展没连上时一片空白。两个选择：
   - 轻量（**推荐**）：不动协议。`doctor` 在 `extension.connected === false` 时，明确列出**待排查清单**：token 是否一致（可直接对比 `config.token` 与用户从设置页复制的值）、Agent Bridge 开关是否打开、Chrome 是否在运行、`daemon.log` 路径。
   - 重量：给 wire protocol 加一个 `status` 消息，让扩展把 `lastError`/`authFailureCount`/`nextRetryAt` 报给 daemon。**这会改 v1 envelope 的消息集合**，要动 `protocol.ts` + `protocol.test.ts` 的完备性断言，且只在扩展已经连上时才有数据 —— 恰好在最需要它的时候（没连上）没用。**否决**。
2. **设置页显示退避状态**。`agent-bridge-card.tsx` 已经订阅 status，增加：`nextRetryAt` 非 null 时显示「下次自动重试：mm:ss 后」，`lastError === 'bad-token'` 时显示「Token 与本机 CLI 不一致」并给出 `favbase setup --token ...` 的复制按钮。这是把 §2 那个事故变成用户自己能看懂的东西。
3. **文案分档**。`skills/favbase/SKILL.md:68` 的「~35 s」和 `cli-main.ts:38-39` 的「within 30 seconds」都改成同一套说法：
   - 扩展已连接：< 100 ms
   - 冷启动（Chrome 刚开 / daemon 刚拉起）：最坏一个 alarm 周期，Chrome 120+ 约 30 秒，更早版本约 60 秒
   - 超过这个时间仍失败：不是等待问题，跑 `favbase doctor`
4. 两处文案不要各写各的。`EXTENSION_HINT` 是 CLI 的单一事实源，SKILL.md 引用同样措辞。

**测试**：`cli-main.test.ts` 断言 `doctor` 失败时的排查清单包含 token 与开关两项；i18n 硬编码守卫（`tests/i18n-no-hardcoded.test.ts`）对新增中文文案会自动拦截，记得走 `lib/i18n/locales/{zh-CN,en}.ts`。

**文档同步**：`entrypoints/app/sections/settings/CLAUDE.md`、`packages/favbase-cli/CLAUDE.md`。

---

### Step 5 — 阶段 B：把常连变成默认（可选但强烈建议）

**文件**：`packages/favbase-cli/cli-main.ts`（`daemonOptions`）、`packages/favbase-cli/CLAUDE.md`

Step 2 做完之后，「有扩展连着的 daemon 不自灭」已经成立，`FAVBASE_DAEMON_IDLE_MINUTES` 的语义退化为「扩展也不在时，daemon 还等多久」。此时：

1. 把默认 idle 从 120 分钟降到一个**短**值（如 15 分钟）—— 因为它现在只在「扩展都没连」的废弃场景下计时，留 120 分钟没有意义。
2. 显式记录成本，让用户能自己判断：常驻状态下约一个 Node 进程（几十 MB RSS）+ 一个不休眠的 SW。对比 MCP stdio「每个 client 一个进程」，这是更省的。
3. 保留 `FAVBASE_DAEMON_IDLE_MINUTES=0`（永不自灭）作为显式选项。

**验收**：连续两小时不调用 CLI，保持 Chrome 开着，之后 `favbase search` 的端到端延迟 < 1 秒。

---

### Step 6 — 阶段 C：Bridge WS 迁入 Offscreen Document（下一阶段，先评估再排期）

**动机**：Offscreen Document（非 `AUDIO_PLAYBACK` reason）没有寿命上限，不受 SW 的 30 秒空闲终止影响。PGlite 本来就住在里面（`lib/offscreen/`）。WS 搬进去之后：

- 连接不再依赖心跳给 SW 续命
- Knowledge Tool 调用不用跨 context —— DB 就在同一个页面里
- 冷启动 30/60 秒地板消失（只要 offscreen document 在，连接就在）

**代价（诚实评估，这是真重构不是小改）**：

1. `lib/agent-bridge/tool-registry.ts` 目前被静态 import 进 Background SW bundle，且有两道契约在守：`tests/agent-bridge-background-bundle-contract.test.ts`、`scripts/check-background-bundle.mjs`（后者**禁止 PGlite runtime marker 进 SW bundle**）。搬到 offscreen 之后这两道契约的语义要重写，不能简单删掉 —— 否则丢掉的是当初 `b43992f` 那个 bug 的防线。
2. Offscreen document 的创建/存活由谁负责、SW 与 offscreen 之间的职责边界要重新划（现在 SW 是 dispatcher）。
3. `lib/agent-bridge/CLAUDE.md` 里「Background-only」「Background SW connection lifecycle」的表述全部作废。
4. 需要一个新 ADR 记录「Bridge 连接归属从 SW 迁到 Offscreen」，并说明它与 ADR 0002 的关系（**不推翻 ADR 0002 的出站决策，只换持有连接的 context**）。

**建议**：A + B 上线并实测一周后再决定。如果实测显示冷启动 30 秒只在「Chrome 刚启动」这一个场景出现，频率极低，那 C 的收益撑不起它的代价。

---

## 7. 风险与回滚

| 步骤 | 风险 | 缓解 |
|---|---|---|
| Step 1 | 显式重连穿透退避后，若真的是 token 不匹配，用户反复点按钮会反复打 daemon | 只有用户主动点才发生，频率天然受限；且 Step 4 会直接告诉用户「token 不一致」，不会让人盲点 |
| Step 2 | 选语义 3 时，`peerSnapshot().connected` 若有假阳性会导致 daemon 永不退出 | `connected` 已经是「hello token + extension ID + Origin 全部校验通过」后才置位；补一条 peer 断开必调 `touch()` 的测试 |
| Step 3 | hello wait 拉长到 75 秒，冷启动失败场景下 CLI 阻塞更久 | 只影响本来就要失败的那一次；Step 4 的文案会说明；`favbase doctor` 仍可用 |
| Step 5 | daemon 常驻的内存/电量成本 | 显式写进 README/SKILL；保留 idle 配置项 |
| Step 6 | bundle contract 语义变更可能放掉旧 bug 的防线 | 迁移前先把现有契约测试的**意图**写清楚，迁移后逐条确认新形态下等价物存在 |

每一步独立提交，回滚即 `git revert` 单个 commit。Step 1–4 之间没有依赖倒置，可以只回滚其中一步。

---

## 8. 未决问题

- ~~`[UNKNOWN]` **那次 5 分钟究竟是不是 token 不匹配**~~ —— **2026-09-01 已定因：是**。主动构造 bad-token 实验证明退避会把「token 修好之后」的等待继续锁住（实测 43 秒 / 3 次失败），且曲线永不衰减、上限钉死 5 分钟。见 §9.4。§2 无需重写。
- `[UNKNOWN]` **`this.connection` 是否存在卡死路径**。`tryConnect()` 在 `this.connection` 非 null 时直接返回；若某种情况下 socket 既不触发 `open` 也不触发 `error`/`close`（loopback 上罕见，但 daemon 被 SIGSTOP、防火墙丢包时可能），bridge 会永久卡在 `connecting` 直到 close/reconfigure。**Step 0 若观察到 `state` 长期为 `connecting`，需要补一个连接超时兜底**（在 `openConnection` 里挂一个定时器，超时则 `disconnect(connection, 'connect-timeout')`）。这条没有列进 Step 1–6，因为目前没有证据它发生过。
- `[UNKNOWN]` `handleRemoteClose` 只置 `this.connection = null` 而不调 `connection.transport.close()`（`disconnect` 会调）。远端主动关闭时底层 socket 通常已经死了，但这是一处不对称，值得在 Step 1 顺手统一。

---

## 9. 实测记录

### 9.1 执行说明

2026-09-01 执行。环境：Chrome 149.0.7827.104（≥ 120，`chrome.alarms` 30 秒周期生效，**D3 的「116–119 被夹到 60 秒」在本机不成立**）、扩展 ID `ifnlocdgkmdkkokbgddfpjjpngddkopk`、CLI `packages/favbase-cli/dist/cli.js` 0.1.0（未全局安装，`doctor` 给出的安装口令是 `npx -y favbase-cli setup`）。

**方案 §6 Step 0 自身的两处缺陷（已在执行中暴露，实施时须一并修正）**：

1. Step 0.1 的命令 `favbase search --query test` 是错的 —— CLI 收位置参数，该写法直接 `exit 1: favbase search expects exactly one <query>`。正确写法 `favbase search "test"`。
2. **Step 0 的判读规则不可证伪**。`client.ts:162-163` 在收到合法 welcome 时把 `authFailureCount` 归零、`nextRetryAt` 置 null，即**任何一次成功重连都抹掉事故现场**。事后读 `chrome.storage.local` 只能看到 `connected / 0 / null`。靠事后快照定因的设计站不住，本次改用**主动构造 bad-token 的黑盒实验**定因。

### 9.2 状态快照

| 日期 | Chrome 版本 | `state` | `lastError` | `authFailureCount` | `nextRetryAt` | token 是否一致 | 结论 |
|---|---|---|---|---|---|---|---|
| 2026-09-01 | 149.0.7827.104 | `connected` | `null` | 0 | `null` | **一致** | 事故现场已被成功重连抹除，见 9.1-2；快照对定因零信息量 |

`state`/`lastError` 未经 SW DevTools 直读，由 `favbase doctor` 的 `extension.connected === true`（daemon 侧只在 hello token + extension ID + Origin 三项全过后才置位）反推；`authFailureCount`/`nextRetryAt` 由 `client.ts:162-163` 的归零语义推定。

### 9.3 实验一：冷启动基线（daemon 已自灭）

前置：`~/.favbase/daemon.log` 有两条 `daemon idle for 120 minutes; exiting`，端口 17836 无监听，Chrome 在运行。

| 观测 | 值 |
|---|---|
| `favbase search "test"` 端到端 | **20 秒，exit 0，返回 8 条结果** |

**「daemon 自灭 → 扩展退避涨到 5 分钟」不成立**，与 §0 的核对一致。冷启动代价就是一个 alarm 周期，与 `AGENT_BRIDGE_POLL_MINUTES = 0.5` 吻合。

### 9.4 实验二：主动构造 bad-token（定因）

把 `~/.favbase/config.json` 的 token 换成不匹配值并重启 daemon —— 复现「扩展侧 token 与 CLI 侧 token 不一致」这一 §2 假设场景。daemon 侧走 `bridge-server.ts:360` 的 `reject(socket, id, 'bad-token')`，扩展侧走 `client.ts:277` 的 `applyAuthBackoff`。

| 阶段 | 观测 |
|---|---|
| bad-token 窗口，连跑 3 次 `search` | 每次**恰好阻塞 35 秒**后 `exit 2 / extension-unavailable`（= `DEFAULT_HELLO_WAIT_MS`），窗口共 106 秒 |
| 恢复正确 token 并重启 daemon，立刻跑第 1 次 | **仍然 35 秒 exit 2** —— daemon 健康、token 已正确，扩展依然连不上 |
| 第 2 次（恢复后 t+36 s） | 7 秒 exit 0，`count: 8` |
| **恢复正确 token 后的实际等待** | **43 秒** |

**结论：H1（token 轮换事故）机制被端到端实证。** 106 秒窗口内扩展按 30 秒 alarm 撞上约 3 次 reject，`authFailureCount` 爬到 3 左右、`nextRetryAt` 推到约 +120 秒，于是**修好 token 之后仍被自己的退避锁在门外 43 秒**。这条曲线按 30/60/120/240/300 递增且**永不衰减**：token 不匹配只要持续超过 ~7.5 分钟（现实里一次误点「重新生成」可以挂几小时），`nextRetryAt` 就永久钉在 `now + 300 s`。**报告里的「最坏接近 5 分钟」由此完全成立，且不是「涨到」，是钉死。**

**§2 成立。** 本方案可以按原计划执行，「token 不匹配」应列为 Step 4 文案的头号提示。

佐证唯一性：全量 grep `lib/agent-bridge/` + `packages/favbase-cli/`，**`AUTH_BACKOFF_MAX_MS = 5 * 60_000`（`client.ts:25`）是整个系统里唯一的 5 分钟量级常量**；CLI 侧最长的两个是 `REQUEST_TIMEOUT_MS = 120_000` 与 `DEFAULT_HELLO_WAIT_MS = 35_000`。不存在第二个能产生 5 分钟的源头。

### 9.5 §1 代码事实复核

逐条核对通过，无漂移：`client.ts:24-25`（30 s / 5 min）、`:162-163` 与 `:286-287`（仅 welcome 与 `close()` 清零）、`:184`（退避门禁）、`:309-319`（指数递增写 `nextRetryAt`）、`scheduler.ts:9`（`0.5`）。

`handleRemoteClose` / `handleTransportError` / `disconnect`（`client.ts:379-394`）三条路径**确实只写 `lastError`，不写 `nextRetryAt`** —— 连接失败不进退避这一点，代码与实验一互相印证。

### 9.6 诊断新增的三项发现

**F1 — 事故现场自我抹除（D4 的严重度应上调）。** 成功握手即清零 `authFailureCount`/`nextRetryAt`（`client.ts:162-163`），事后无任何痕迹可查。D4 现在的描述是「不可观测」，实际是「**不留痕**」—— 排障者连事后取证的可能性都没有。Step 4 只做「设置页显示当前退避状态」不够，至少要留一个 `lastAuthFailureAt` 之类的、**不被成功握手清掉**的痕迹字段。

**F2 — daemon 丢掉了它独有的 ground truth。** `bridge-server.ts` 的 `reject()` **不写任何日志**：整个 bad-token 实验期间 `daemon.log` 只有 `listening` 行。daemon 是全系统唯一同时握有两侧 token 的组件，它算出 `tokensMatch === false` 之后把这个事实直接扔了。

这直接改良 Step 4-1：doc 里「轻量方案 = doctor 列排查清单（让用户自己猜）」与「重量方案 = 加 wire 消息让扩展上报（要动 v1 envelope，且恰好在没连上时没数据）」这个二选一是**伪二分**。第三条路更好：**daemon 侧记录 reject 的 reason 与计数，`/status` 直接透出**。不动 `protocol.ts`、不动 v1 envelope 完备性断言，而且**恰好在「扩展连不上」时才有数据** —— 正是最需要它的时刻。建议 Step 4 改采此方案。

**F3 — `daemon.log` 无时间戳。** 所有行都是裸文本，`daemon idle for 120 minutes; exiting` 无法与用户报告的时间点对齐。Step 4 顺手补上。

### 9.7 尚未证伪的 UNKNOWN

- `[UNKNOWN]` §8 的「`this.connection` 卡死路径」本次**未观察到** —— 三次 bad-token 与冷启动均正常收敛，`state` 未见长期 `connecting`。按方案原文，无证据即不动手，连接超时兜底仍不列入 Step 1-6。
- 顺带记一处代码不对称（与本次诊断无关，Step 1 可顺手统一）：`openConnection` 只对 `createTransport` 的**同步**抛出兜底（`client.ts:205-209`），且此时 `this.connection` 尚未赋值 —— 若某个 transport 实现在构造期同步触发 `onError`，`isCurrent()` 会因 `this.connection === null` 返回 false 而吞掉该错误，随后 `this.connection = connection` 把一个已死连接装进去。真实 Chrome `WebSocket` 的 `onerror` 是异步派发，**当前不可达**；但这正是 §8 那条卡死路径唯一具体的候选形态。

### 9.8 环境复原

`~/.favbase/config.json` 已 diff 校验还原为原 token，备份删除；`favbase doctor` 复测 `ok: true`、`extension.connected: true`。

---

## 10. 参考

- [chrome.alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms) — 最小周期 30 秒
- [What's new in Chrome 120 for Extensions](https://developer.chrome.com/blog/chrome-120-beta-whats-new-for-extensions) — 30 秒最小周期的引入版本
- [Use WebSockets in service workers](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets) — Chrome 116 起 WS 活动重置 SW 空闲计时器
- [chrome.offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen) — 非 AUDIO_PLAYBACK reason 无寿命限制
- `docs/adr/0002-agent-bridge-extension-outbound-websocket.md`
- `docs/adr/0003-agent-bridge-skill-first-cli-daemon.md`
- `docs/21_agent-bridge-analysis-2026-08-22.md`
