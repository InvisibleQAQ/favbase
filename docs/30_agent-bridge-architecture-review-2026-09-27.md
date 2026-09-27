# 30 — Agent Bridge 全链路架构体检：扩展 × favbase CLI × Skill（2026-09-27）

**状态**：#1 已落地（2026-09-27，D1-a / D2-b，见 §1「实施记录」；#7 随之消失）。#2 已落地（2026-09-27，D3-a / D4-a，见 §2「实施记录」；顺带做了 #10 里「RPC 错误 code → 退出码」那一片）。**favbase 0.2.1 已于 2026-09-27T09:57Z 发布到 npm**（等价于 `2fbcc16`，含 #1 与 SKILL.md 的 `metadata.version`；本机全局安装与 registry tarball 的 `dist/cli.js` 逐字节一致），所以执行顺序第 2 步（#4 止血）已完成，#4 的结构修复（D6/D7）仍待做。其余条目未动。

**范围**：把 Agent Bridge 当成**一个系统**来审，三端一起看：

- **扩展端**：`lib/agent-bridge/`（`client.ts`、`scheduler.ts`、`protocol.ts`、`tool-registry.ts`）、`lib/storage/agent-bridge.ts`、`lib/background/agent-bridge-handlers.ts`、`entrypoints/app/sections/settings/agent-bridge-card.tsx`、`entrypoints/app/App.tsx` 的 connect-now、`lib/i18n/locales/{en,zh-CN}.ts` 的 `settings.agentBridge.*`，以及 Knowledge Tool 执行时经过的 `lib/chat/tools.ts`、`lib/chat/retrieval.ts`、`lib/database/db-state.ts`。
- **CLI 端**：`packages/favbase` 全部源码（CLI + Bridge Daemon）。
- **Skill 端**：`skills/favbase/SKILL.md`（打进 CLI 的 Skill）、`skills/favbase/INSTALL.md`（Agent Setup Guide，`main` 上的公开 raw URL）、`packages/favbase/README.md`（npm 页面）、根 `README.md` 的 agent 段落、`CONTEXT.md` 的相关术语。

**不在范围**：Knowledge Tool 的检索算法本身、扩展 UI 的视觉、Chat 页面。

**基线**：

- `main` @ `edb33f7`。
- `packages/favbase/package.json` 写的是 `0.2.1`，但 **npm 上最新只有 `0.2.0`**。2026-09-26 在本机跑 `npm view favbase time`（registry 为 `https://registry.npmjs.org/`），结果只有 `0.1.0`（2026-09-08）与 `0.2.0`（2026-09-24T22:35Z）两个版本。两个 release commit（`3ac6e23` 0.2.0、`49fbe8d` 0.2.1）的正文都写着 "Not published."。0.2.0 是事后手工发布的，0.2.1 至今未发布。（**2026-09-27 更新**：0.2.1 已发布，见文首状态；下文以「npm 最新是 0.2.0」为前提的叙述，都是撰写时的快照。）
- 扩展尚未上架 Chrome Web Store，没有真实用户（与用户 2026-09-21 的说明一致）。

**关于旧 docs/30**：本次开写时，`docs/30_favbase-cli-architecture-review-2026-09-26.md` 已不在工作区。那份文档只审了 CLI 一端，它的 7 条已逐条复核并**全部并入本文**，编号重排。它的基线写的是「favbase@0.2.1 已发布 npm」，这一句是错的，以本文为准。

**方法**：先读 `CONTEXT.md` 与 ADR 0002/0003/0005。然后两个只读探索 agent 分别扫扩展端和「markdown ↔ 代码」契约，主要结论再回源码逐条复核。只有 agent 给出、我没有亲自读过的行号，一律按符号名引用（例如 `applyAuthBackoff`），不写 `:NNN`。

---

## 严重度定义

| 级别 | 含义 |
|---|---|
| 高 | 已文档化的用户或 agent 流程**今天**就会走进死路；或同一类 bug 已复发，且仍有活实例 |
| 中高 | 今天没有活 bug，但结构保证不了下一次，而且下一次一旦发生就会被误诊；或安全性质的缺口 |
| 中 | 跨 module 或跨版本的 seam 没有 owner，靠手写镜像维持；或潜伏的失败，触发后持续且沉默 |
| 低 | 纯复杂度、死接口或小特判，删掉或合并后行为零变化 |

另有两个标签，与级别正交：「**安全**」，和「**时限**」（例如「扩展上架前」「下次 npm publish 前」）。

---

## 总表

| # | 严重度 | 问题 | 涉及端 | 时限 |
|---|---|---|---|---|
| 1 | 高 | Bridge Token 轮换不收敛：三份 token 副本只同步两份，认证退避又把修复后的重连推迟到最长 5 分钟 | 扩展 + CLI + Skill | — |
| 2 | 高 | 「失败 → 退出码 → 处置」没有 owner，多条已写进文档的处置是死路 | CLI + Skill | — |
| 3 | 高 | `doctor` 在 daemon 半边失败时不出报告（exit 2 让 agent 去跑 doctor，doctor 又是同一行 exit 2） | CLI + Skill | — |
| 4 | 高 | 发布时序：`main` 上给 agent 读的 markdown 跑在已发布 CLI 前面，今天就有活实例 | Skill + CLI 发布流程 | 下次 publish 前 |
| 5 | 中高 | 自动更新的扩展与手动更新的 CLI/Skill 之间，跨版本契约没有 owner | 扩展 + CLI + Skill | **扩展上架前** |
| 6 | 中高（安全） | Bridge Token 以明文交给任何占住 loopback 端口的进程；welcome 回显 token 不构成认证 | 扩展 + CLI | 随 #5 |
| 7 | 中 | `reject` → `close` 竞态可能吞掉 bad-token 状态、退避与修复按钮（代码可见，未实机复现） | 扩展 | — |
| 8 | 中 | SW 里数据库初始化失败的 Promise 被永久缓存，此后每次工具调用都是 `db-unavailable` | 扩展 | — |
| 9 | 中 | 扩展连接状态的错误词汇没有类型：`lastError` 是 `string`，设置卡的映射两条不可达、三条给错处置 | 扩展 + i18n | 随 #5 |
| 10 | 中 | CLI↔daemon 的 HTTP 线协议没有 owner（类型在一处、解码手写在另一处） | CLI（+ 协议 leaf） | — |
| 11 | 中 | 一次调用的时间预算横跨三个包、五个常量和五处散文，且不自洽 | 扩展 + CLI + Skill | — |
| 12 | 中 | Embedding provider 故障时整次检索失败，关键词结果被一起丢掉 | 扩展（Knowledge Tool） | — |
| 13 | 中 | 第五份安装说明（根 README）已经漂移；shipped markdown 里还有一批未守卫的副本 | Skill + 文档 | — |
| 14 | 低 | `BridgeServer` 的独立监听形态与 `onPeerReady` 只有测试在用 | CLI | — |
| 15 | 低 | 两个小特判：`--dir` 的第二套错误模型、`reportFailure` 回头嗅探 argv | CLI | — |
| 16 | 低 | 扩展端连接 module 的 interface 过宽，把顺序规则推给调用方；存储 facade 泄漏、有死状态 | 扩展 | — |
| 17 | 低 | 工具调用无法取消；bridge 对结果的 JSON 约束比 Chat 严；`sendToolError` 吞掉发送失败 | 扩展 | — |

---

## 待决策汇总（开工前必须拍板）

用户打算一次性全部解决。下面这些决策不先定，对应条目就动不了。每条都给了推荐。

| D | 关联 | 问题 | 选项 | 推荐 |
|---|---|---|---|---|
| D1（**已定 a**，2026-09-27） | #1 | daemon 的 token 收敛在哪里做 | a. 只在 `setup` 里做<br>b. 在 `ensureDaemon` 里对每条命令做 | **a**。`setup` 是用户显式说「以后用这个 token」。放进 `ensureDaemon`，两个 shell（一个用 `FAVBASE_TOKEN` 覆盖、一个读文件）会轮流替换对方的 daemon。这正是 D14 在版本维度上刻意避免的 ping-pong |
| D2（**已定 b**，2026-09-27） | #1 #11 | 扩展的 bad-token 指数退避（30 s 起、封顶 5 min）留还是删 | a. 保留，另加设置卡「立即重连」按钮，`setup` 的 `next:` 提示改成「刷新 favbase 标签页再跑 doctor」<br>b. 删除指数退避：bad-token 照普通 alarm 节奏重试；daemon 对重复的同因拒绝去重记日志；`lastAuthFailureAt` 证据保留 | **b**，但这**推翻 docs/24 Step 1-4 已落地的设计**，需要用户拍板。理由：对 loopback daemon，一次 hello 的成本是 daemon.log 里多一行，而退避的代价是 `setup → doctor` 这条主流程被锁在门外最长 5 分钟。删掉后，`authFailureCount`、`nextRetryAt`、`'user'`/`'schedule'` 的穿透逻辑和倒计时 UI 这一整类特殊情况一起消失。`connectNow`（省掉等下一个 alarm）照留 |
| D3（**已定 a**，2026-09-27） | #2 | 未分类错误默认给哪个码 | a. exit 1<br>b. 新开一个码 | **a**。已发布的 SKILL.md 对 exit 1 的处置是「不以 `Run favbase --help` 结尾，就把 stderr 给用户看」，对未分类错误恰好正确。新开码则两张表都要改，而且已发布的 SKILL 不认识它 |
| D4（**已定 a**，2026-09-27） | #2 | `timeout` / `db-unavailable` / `execution-failed` 归哪个码，exit 3 的处置文字怎么写 | a. `timeout` 归 exit 2，exit 2 那一行补「doctor 正常就重试一次」；exit 3 那一行按 stderr 里的 code 分支：`invalid-args`/`unknown-tool` 修命令（`unknown-tool` 也可能是版本漂移，见 #5），其余把消息给用户看<br>b. 全部保持 exit 3，只改文字 | **a**。今天 exit 3 一律写「adjust the arguments」，对这三种 code 都没用。stderr 形状本来就是 `favbase: <code>: <message>`，agent 读得到 code |
| D5 | #3 | daemon 探针失败时，doctor 还读不读扩展状态 | a. 不读，`extension` 写「未检查（daemon 不可用）」<br>b. 读 | **a**。没有 daemon 就没有扩展状态可读，也避免给出「确认 Chrome 在运行」这类与根因无关的建议 |
| D6 | #4 | `main` 上给 agent 读的 markdown 怎样才能不描述未发布的行为 | a. **删掉 INSTALL.md 的退出码表**，INSTALL 只保留跨版本稳定的步骤，排障交给版本一致的来源（`favbase --help`、CLI 自己的 stderr、setup 装下的 SKILL.md）；发布流程改成「版本号递增与 `npm publish` 同一步，并用 `npm view` 核验」<br>b. INSTALL 写死 `npm install -g favbase@X.Y.Z`，由测试对账 `package.json`<br>c. 维持现状，靠流程纪律 | **a**。INSTALL 的退出码表是 SKILL 那张表的第二份拷贝，也是唯一一份不随 CLI 版本走的拷贝（按 deletion test，删掉它复杂度只会消失）。b 挡不住「行为改了、版本号还没改」的那段窗口 |
| D7 | #4 | `npx skills add InvisibleQAQ/favbase` 这条安装路线留不留 | a. 从根 README 与 ADR 0003 删掉<br>b. 保留，doctor 容忍 `main` 版 | **a**（与 ADR 0003 Decision 第 6 条冲突，但值得重开）。它装的是 `main` 上的 SKILL，与已装 CLI 捆绑的逐字节比对永远是 `stale`；照 doctor 的提示跑 `install-skill` 会把它回滚，下次 `npx skills add` 又翻回去 |
| D8 | #5 | 跨版本兼容由哪一端负责 | a. **扩展负责**兼容所有已发布的 daemon：daemon 从下个版本起对未知字段宽松、对不支持的 `protocolVersion` 显式回 `reject: version`，扩展按 `welcome.serverVersion` 选择能力；Knowledge Tool 的名字、参数名和 SKILL.md 描述的结果字段只增不删，用一份「已发布契约」黄金文件守住<br>b. 冻结 v1，另起 v2 并行 | **a**。扩展会自动更新而 CLI 不会，只有扩展有能力适配对方。已发布的 0.1.0/0.2.0/0.2.1 daemon 是严格解码的，所以**首个上架的扩展仍必须对它们讲精确的 v1**，这一点改不了 |
| D9 | #6 | 「同机另一个 OS 用户或受限进程抢占 loopback 端口」算不算威胁 | a. 算：WS 与 HTTP 两条线都改成 challenge-response（交换 nonce、传 HMAC，token 本身不上线），随 #5 的协议改动一起做<br>b. 不算：订正 `CONTEXT.md` 的「verify each other」、删掉自欺的 welcome token 校验，并写 ADR 记录接受的风险 | **a**。单独做很贵，但和 #5 一起做的边际成本低；产品承诺是 "nothing leaves the machine"，而多用户机器上 loopback 端口是全机共享的。选 b 也必须把文档改成实话 |
| D10 | #10 | daemon HTTP 线协议的 schema 放哪 | a. `packages/favbase` 内<br>b. `lib/agent-bridge/` | **a**。这条线两端都在本包，扩展不参与；`lib/agent-bridge/protocol.ts` 只多导出一个拒绝原因常量 |
| D11 | #11 | CLI 的 HTTP 超时怎么定 | a. 由 daemon 的两段期限**取和**再加余量派生（约 150 s），同时让 embedding 请求超时严格小于工具期限<br>b. daemon 两段共享一个 deadline | **a**。daemon 行为不变；b 会把冷启动后的工具时间压到二十几秒，低于 embedding 自己的超时 |
| D12 | #12 | embedding provider 故障时，检索是降级还是失败 | a. 降级为只用关键词，并在结果里追加 `semantic: 'unavailable'` 之类的字段（`tools.result.result` 是自由 JSON，追加字段跨版本安全）<br>b. 维持失败 | **a**。Chat 与 Bridge 同时受益，agent 也不会因为 provider 故障把查询改写来改写去 |

---

## 执行顺序

1. **先拍板 D1–D12**。其中 D6 必须最先定：后面每一步都要改 CLI 行为和 agent 读的 markdown，不先定发布规则，改完就会再造一个 #4。
2. ~~**止血 #4 的活实例**（用户动作）：发布 0.2.1，或者撤回 `1df12e6` 对 INSTALL.md exit-1 那一行的改动。二选一，与后续结构修复无关。~~ **已完成**：0.2.1 于 2026-09-27 发布。
3. **CLI 的失败链（#2 → #3 → #1）**（#1 已先行落地，2026-09-27；它新增的失败来源与 doctor 无报告路径留给 #2/#3，见 §1「实施记录」的残留。#2 已落地，2026-09-27，见 §2「实施记录」；下一步是 #3）：
   - #2 先做（**已完成**）。退出码分类收成一个 module。#3 的 `ok` 与退出码、#1 新增的失败都要在这个分类里有归属。
   - #3 再做。它是 #1 的验收手段：修完 #1 后，「setup → doctor」必须输出完整 JSON。
   - #1 最后。CLI 半边复用 `stopDaemon` 的 401 → 按 pid 结束进程路径，以及 `ensureDaemon` 的替换路径；扩展半边按 D2 改。
   - #10 的「哪些 RPC 错误 code 表示扩展不可达」与 #2 有交集，宜在 #2 同一批完成。#11 的常量收拢可以顺带做。
4. **下一次 `npm publish` 前**：#4 的结构修复（按 D6/D7）与 #13 的文档漂移一起清掉，然后按新流程发布。
5. **扩展上架前**：#5 与 #6 一起做（都是协议改动）；#9 依赖 #5 对 close code 的决定，随后做。#7 与 #8 是小修，随时可做，但也必须在上架前完成。
6. **随时可做**：#12、#14、#15、#16、#17。

---

## 1. 【高】Bridge Token 轮换不收敛

**文件**：`packages/favbase/cli-main.ts`、`packages/favbase/daemon-client.ts`、`lib/agent-bridge/client.ts`、`entrypoints/app/sections/settings/agent-bridge-card.tsx`、`lib/i18n/locales/{en,zh-CN}.ts`、`skills/favbase/INSTALL.md`

**问题**

一枚 Bridge Token 同时有三份副本：扩展 storage（`local:agent-bridge`）、`~/.favbase/config.json`、以及**运行中 daemon 的环境变量**（spawn 时冻结进去，`daemon-client.ts:192-197`）。用户在设置卡重置 token 后：

- `favbase setup` 只写配置和 skill，完全不看 daemon（`runSetup`，`cli-main.ts:437-450`）。第三份副本不会被更新。
- 「这个正在运行的 daemon 能不能用」的判断被拆成两半。`ensureDaemon` 只按**版本**决定复用还是替换（`daemon-client.ts:249`）；token 不符要等调用方各自拿到 401 才暴露（`rpcCall` `:293`、`fetchStatus` `:350`），暴露形式只是一句处方「run favbase daemon restart」（`:270`）。
- 扩展这一侧，旧 daemon 用 `reject: bad-token` 拒掉新 token 后，扩展进入指数退避（`client.ts:24-25`，30 s 起、每次失败翻倍、封顶 5 min）。只有 `'user'` 触发能穿透退避：打开或刷新 app.html（`App.tsx:19-27`，每次页面加载一次），或者一次配置写入（开关、改端口、重置 token，`agent-bridge-card.tsx:188-211`）。设置卡上的「复制修复命令」只复制，`favbase setup` 与 `favbase daemon restart` 也都不碰扩展配置。所以两条修复命令都跑完，扩展仍可能还要再等几分钟才重连。

**证据（可复现场景）**

1. 旧 token 的 daemon 还活着。扩展连着时它不会空闲退出（docs/24）。
2. 用户在设置卡重置 token。`persistConfig` 触发 `close('config-changed')` 加一次 connect-now，新 token 被旧 daemon 拒绝，退避开始，`nextRetryAt = +30 s`。
3. 用户复制修复命令，跑 `favbase setup --token NEW`，成功；stderr 打印 `next: run favbase doctor`（`cli-main.ts:448`）。
4. 照做 `favbase doctor`：`ensureDaemon` 看版本相同，复用旧 daemon；`fetchStatus` 拿到 401，抛 `DaemonError('unauthorized')`；**exit 2，没有 JSON**（叠加 #3）。
5. 照 stderr 再跑 `favbase daemon restart`：新 daemon 持有 NEW，但它的 `rejectedHelloCount` 从 0 开始，doctor 退回通用提示（`cli-main.ts:132`）。与此同时扩展仍在退避中：docs/24 §9.4 实测，修好 token 后仍被锁 43 秒；不匹配持续 7.5 分钟以上时，`nextRetryAt` 会永久钉在 `+300 s`。而 doctor 只等 75 s。

这个缺口今天靠**四处文字补丁**撑着，都要求读者记住两条命令：`INSTALL.md:114`、`en.ts:106` / `zh-CN.ts:104`（`errorBadToken`）、`daemon-client.ts:270`。SKILL.md 一处都没提。反方向同样没有出路：扩展 token 被重置、CLI 仍用旧 token 时，数据命令拿到 `extension hello rejected: bad-token`，doctor 第一条 troubleshooting（`extensionTroubleshooting`，`cli-main.ts:126-131`）只陈述「被拒」这件事，**不给修复动作**。

测试现状：`cli-main.test.ts:372-388` 与 `:392-411` 在有 fake daemon 的情况下跑 `setup`，并断言 `daemon.requests` 为空（`:387`、`:410`），**锁住的恰恰是「setup 不碰 daemon」**。没有任何用例覆盖「daemon 持旧 token，随后跑数据命令或 doctor」。`stopDaemon` 的 401 → `process.kill` 路径也没有测试（`daemon-client-ensure.test.ts` 的 `FAKE_PID` 注释自己写明了这一点）。

**方案**

- **CLI 半边**：把「哪个 daemon 能用」收进 `daemon-client.ts` 一处。`setup` 写完配置后，如果配置端口上有 favbase daemon，且它不接受新 token（一次带 token 的非等待 `/status`，401 即不符），就走与「旧版本 daemon」完全相同的替换路径：`stopDaemon`（已处理 401 → 按 `/health` 报的 pid 结束进程）加 spawn。token 相符时零动作，不断开扩展；端口上没有 daemon 时也零动作（不替 doctor 提前拉起）。两种替换理由共享「停旧 + 起新 + 等健康」这套机制，只在日志与错误文案里分别写明理由（版本旧 / 持有别的 pairing token）。
- **扩展半边**：按 D2 处理。选 b（删指数退避）时，替换后的 daemon 在一个 alarm 周期内（30/60 s）就能等到扩展，被 doctor 的 75 s 覆盖；选 a 时要补「立即重连」按钮，并把 `setup` 的 `next:` 改成先提示刷新 favbase 标签页。
- **文案**：四处补丁删掉 `daemon restart` 那半句。`unauthorized` 只留给真正的外部不一致，并按 `config.tokenSource` 分两种说法：`env` 时点名 `FAVBASE_TOKEN` 覆盖了配置文件；`file` 时让用户重新运行设置卡的配对命令。doctor 的 bad-token 那一条补上修复动作（复制设置卡的配对命令并运行）。

**收益**

- Locality：daemon 身份的三个维度（端口、版本、token）落在同一个 module，调用方不再各自处理 401。
- Leverage：一条 `setup` 命令完成配对与修复；设置卡、INSTALL.md、错误文案都变短。
- 测试：可以在 `integration.test.ts` 用真进程写端到端用例：旧 token 的前台 daemon，跑 `setup --token NEW --no-skill`，fake 扩展用 NEW 连上，doctor 返回 exit 0 且输出完整 JSON。收敛逻辑本身在 `daemon-client-ensure.test.ts` 用会校验 Bearer 的 fake daemon 覆盖，`process.kill` 用 spy 替身。

**会破坏什么**

- `cli-main.test.ts:387` 的 `daemon.requests toEqual([])` 要改写。`:410`（配置写失败）仍应为空。
- **测试隐患（实现者必看）**：`setup` 一旦开始探测 daemon，所有不带 `--port` 的 `setup` 用例都会打到默认端口 17836，也就是**开发机上真实运行的 daemon**。例如 `cli-main.test.ts:251` 的 `['setup', '--token', 'abc']`：它会拿 `abc` 拿到 401，然后**杀掉开发者自己的 daemon**，再去 spawn 一个不存在的 `never-spawned.js`。所有 `setup` 用例都必须显式给一个空闲端口或 fake daemon 的端口；写死的 `--port 2222` 也要换成动态空闲端口，否则在 2222 被占用的机器上会被判成 `foreign`。
- `setup --port` 换了端口时，探测只看新端口。旧端口上的 daemon 持旧 token、无人连接，会按空闲期限自行退出。无害，不处理。
- `setup` 的退出码多了一种来源：端口被非 favbase 程序占用（`foreign`），或旧 daemon 停不掉（例如跨用户的 `EPERM`）。配置此时已写好、stdout 已打印，stderr 给出原因。这属于 #2 的分类范围。
- ~~`[UNKNOWN]` Windows 上 `process.kill(pid)` 结束 detached daemon 后端口释放的时序~~：已由 `integration.test.ts` 的真进程用例在本机（Windows 10）覆盖：被杀的是经 `daemon start` 起的 detached、`windowsHide` daemon（与生产同形），杀旧、端口释放、起新全程约 1 s，连跑 3 次全绿，事后无残留 daemon 进程。

**决策**：D1-a、D2-b（用户 2026-09-27）。

### 实施记录（2026-09-27）

**CLI 半边**

- `daemon-client.ts`：从 `ensureDaemon` 抽出 `stopToReplace`（只停找到的那个 pid，失败包成点名的 `DaemonError`）与 `startDaemon`（spawn + 轮询 `/health`）；版本替换与 token 替换共用这两段，只有日志与错误文案各写各的理由。新增导出 `adoptSetupToken(target, options)` → `'no-daemon' | 'kept' | 'replaced'`：端口空闲零动作，一次非等待 `/status`（`HEALTH_TIMEOUT_MS`）200 零动作，401 则替换。`spawnDaemon`/`stopDaemon` 的参数收窄为 `DaemonTarget = Pick<ResolvedConfig, 'token' | 'port'>`。
- `cli-main.ts` 的 `runSetup` 顺序：写配置 → 装 skill → 打 stdout → skill 失败行 → `adoptSetupToken` → `next:`。收敛用的是**刚写下的** token 与端口，不是 `resolveConfig`（`FAVBASE_TOKEN` 会压过文件）。daemon 这一步失败时配置与 stdout 都已落地，exit 2。
- `unauthorized` 按 `tokenSource` 分两种说法（`env`：`FAVBASE_TOKEN` 覆盖了配置文件，unset 它；`file`：重新运行设置卡的 setup 命令），不再说 `daemon restart`。doctor 的 bad-token troubleshooting 补上修复动作。
- `bridge-server.ts`：同因拒绝在一次 accepted hello 之前只记一行日志，`/status` 的计数照旧逐次累加。
- `packages/favbase/README.md`（npm 页面，随发布版本走）补了一句：扩展里重置 token 后，重新运行 setup 命令即可，它会替换持旧 token 的 daemon。

**扩展半边（D2-b）**

- `client.ts`：删 `AUTH_BACKOFF_*`、`applyAuthBackoff`、`dropConnection`、`handleReject`、`AgentBridgeConnectTrigger`；`tryConnect()` 无参。bad-token（daemon 的 `reject` 与 welcome 回显别的 token 两种来源）与其他失败一样走 `disconnect()`，后者在 storage await **之前**同步摘掉连接，并在 `lastError === 'bad-token'` 时写 `lastAuthFailureAt`。这正是 #7 方案的「前者」，所以 #7 随本条消失，不再单独做。
- `connecting` 那一次写入**不再清 `lastError`**。没有退避后 bad-token 每个 alarm 都重试，清掉会让设置卡的 bad-token Alert 与「复制修复命令」按钮每 30/60 s 闪一次（`connection-error` 早就有这个闪烁）。`close()`（关闭开关、改端口/token）照旧清。
- `scheduler.ts` 的 trigger 参数、`lib/storage/agent-bridge.ts` 的 `authFailureCount`/`nextRetryAt`、设置卡的倒计时（`formatRetryCountdown`、`clockNow` effect）与 `settings.agentBridge.retryIn`（zh/en）全部删除。旧 storage 记录里残留的两个键无人读取，按「扩展未上线」不做迁移。
- `errorBadToken`（zh/en）删掉「然后执行 `favbase daemon restart`」半句。**它的正确性依赖 0.2.1 在扩展上架前发布到 npm**：0.2.0 的 `setup` 不替换 daemon。（已满足：0.2.1 于 2026-09-27 发布。）

**刻意没改**

- `INSTALL.md` 的 token mismatch 行（「ask for a fresh setup command, then run `favbase daemon restart`」）。它经 `main` 的 raw URL 被读，而读者 `npm install -g` 装到的是 0.2.0，那里 setup 不碰 daemon；现有措辞对 0.2.0 与新版都正确（对新版只是多一次无害的重启）。删掉它就是再造一个 #4 的活实例。等 #4 按 D6 删掉整张表时一起走。（0.2.1 发布后，这半句对 `npm install -g favbase` 装到的版本只是多余、不再必要，仍留给 D6 一起处理。）
- `setup` 的 stdout 形状不变，替换只体现在 stderr 的 `[favbase] replacing daemon <version> (pid <pid>): it holds a different pairing token` 一行。

**残留（属于 #2 / #3，未在本条修）**

- `setup` 新增的失败来源（端口被非 favbase 程序占用 → `foreign`；旧 daemon 停不掉，例如跨用户 `EPERM`）经 `reportFailure` 落成 exit 2（此前 setup 根本不看端口，这两种情况都是 exit 0，要到 doctor 才暴露）。`foreign` 的提示仍是跑不通的 `favbase setup --port <port>`（#2 表中那一行）。（**#2 已修**：两者的消息都改成能直接照做的修法，见 §2「实施记录」；退出码仍是 exit 2。）
- doctor 在 daemon 半边失败时仍不出 JSON（#3）。本条修完后，「setup → doctor」的主路径不再走那条分支。

**测试**

- `daemon-client-ensure.test.ts`：`adoptSetupToken` 五例（端口空闲 / token 相符 / 持别的 token → `/shutdown` 401 → `process.kill(FAKE_PID)` → spawn 带新 token / `kill` 抛 `EPERM` → 点名的 `DaemonError` / 端口被非 favbase 占用 → `foreign`）。`FAKE_PID` 的 kill 路径从此有覆盖。
- `integration.test.ts`：真进程端到端——持旧 token、经 `daemon start` 起的 detached daemon，fake 扩展用新 token 被拒，`setup --token NEW --no-skill` 后 fake 扩展用新 token 拿到 welcome，doctor exit 0 且 `ok: true`。去掉 `runSetup` 里那一行调用，该例红在 `holds a different pairing token` 断言上（已验证）。afterEach 的 daemon 清理改为携带各自的 token，否则替换出来的 daemon 会因 401 泄漏到开发机。
- `cli-main.test.ts`：所有会走到 `runSetup` 的用例改用动态空闲端口（原来的 `--port 2222` 与不带端口的 legacy-root 用例都会打到别处，后者正是默认端口上开发者自己的 daemon）；fake daemon 增加校验 Bearer 的 `/status`；「skill 写失败」那例的 `daemon.requests` 从 `[]` 改为 `['GET /health', 'GET /status']`，配置写失败那例仍为 `[]`。
- `client.test.ts`：退避两例换成「bad-token 下一次照常重试、`connecting` 期间保留错误、每次拒绝都打时间戳」「welcome 回显别的 token 算 bad-token」「reject 之后 close 事件在写状态期间到达，`lastError` 仍是 `bad-token`」三例；第一例与第三例在旧 `client.ts` 上是红的（已验证），第二例在旧代码上本就成立，锁的是删退避后不回退。`scheduler.test.ts` 删掉 trigger 分配那一例。设置卡测试删倒计时，改断言 bad-token Alert 在 `connecting` 期间不消失。`bridge-server.test.ts` 加同因日志去重一例。

---

## 2. 【高】「失败 → 退出码 → 处置」没有 owner，多条已文档化的处置是死路

**文件**：`packages/favbase/cli-main.ts`、`packages/favbase/daemon-client.ts`、`skills/favbase/SKILL.md`、`skills/favbase/INSTALL.md`、`packages/favbase/README.md`

**问题**

退出码在五个地方各自决定：

- `reportFailure` 按错误类分派（`cli-main.ts:519-548`），**任何未知错误都落到最后的 exit 2**（`:545-547`）。
- `runTool` 用字符串字面量判断哪些 RPC code 算「不可达」（`:175`），其余一律 exit 3（`:179`）。
- `runTools`（`:185-187`）、`runDoctor`（`:298`、`:321-325`）、`runDaemonForeground` 的 `CliExit`（`:343`）、`reportSkillFailures`（`:406-409`）各自返回。

退出码到处置的映射又**手写在三张 markdown 表里**：SKILL.md 的「Errors and exit codes」、INSTALL.md 的「When something is wrong」、npm README 的退出码段。三张表之间只有 exit 1 那一行被对账（`tests/agent-bridge-cli-aliases.test.ts:225`）。

**证据：处置本身就是死路的活实例**

| 失败 | 今天的码 | 文档处置 | 实际结果 |
|---|---|---|---|
| `~/.favbase/daemon.log` 或 `~/.favbase` 不可写（`spawnDaemon` 的 `mkdir`/`openSync` 在 `daemon-client.ts:184-186`，不在 `writingFile` 里） | 2（未分类兜底） | run doctor | doctor 在 `ensureDaemon` 撞上同一处 `EACCES`，又是 exit 2 且无报告：**死循环** |
| `FAVBASE_DAEMON_IDLE_MINUTES` 非法 | 子进程在 `idleMinutes`（`cli-main.ts:146-148`）就退出，父进程等满 10 s 报 `spawn-failed`，exit 2 | run doctor | doctor 同样 `spawn-failed`；原因只写在 `daemon.log` 里 |
| 端口被另一个用户的 favbase daemon 占用，`stopDaemon` 的 `process.kill` 抛 `EPERM`（`:383`） | 2 | run doctor | 同上 |
| 端口被非 favbase 程序占用 | 2 | `foreignPort` 让用户跑 `favbase setup --port <port>`（`daemon-client.ts:123`） | `parseSetup` 没有 `--token` 就是 usage error（`cli-main.ts:428-429`）：**给出的修复命令本身跑不通**。`daemon run` 端口占用的提示（`:345`）同理 |
| 扩展 60 s 没回答（`timeout`） | 3 | SKILL：「adjust the arguments」 | 改参数没用 |
| SW 数据库不可用（`db-unavailable`，见 #8） | 3 | 同上 | 改参数没用，而且会一直持续 |
| embedding provider 故障或超时（`execution-failed` / `timeout`，见 #12） | 3 | 同上 | agent 会反复改写查询 |
| 版本漂移导致 `unknown-tool` / `invalid-args`（见 #5） | 3 | 同上 | 要升级的是 CLI，agent 修不了 |
| doctor 的配置错误路径（`cli-main.ts:288-299`） | 1 | SKILL 与 INSTALL：「把 stderr 给用户看，它会点名怎么修」 | stderr 要么是空的，要么只有 skill 提示；而 SKILL 恰好禁止 agent 自己跑 `install-skill`。真正的修复动作（`setup`）只在 stdout 的 `config.problem` 里 |
| INSTALL.md 的 exit 2 行 | — | 「Chrome closed, or Agent Skills switched off」 | exit 2 还包括端口被占、token 不符、spawn 失败、全部未分类错误。agent 会对用户说错话 |

**复发记录**：这一类 bug 在 2026-09-24 一天内出现两次，已记为 Gotcha 5（`.trellis/spec/guides/silent-failure-thinking-guide.md`；修复 `5ffe0b8`、`1df12e6`，记录 `edb33f7`）。每次修法都是给新失败补一个类型，默认值没动，所以下一个没类型的失败还会掉进去。上表前三行就是还没补上的那几个。

**方案**

新建一个退出码分类 module，作为**唯一**把「失败」映射成「退出码 + stderr 形状」的地方：

- 输入是错误（含 RPC 错误 code），输出是退出码加一行 stderr。已知错误类在这里显式列举。抛出的错误类型 TypeScript 查不了穷举，所以安全性不能靠「记得列举」，而靠下一条。
- **翻转默认值**（D3）：未分类错误落到「本地问题，把消息给用户看」那一档，也就是 exit 1。只有明确表示不可达的错误（`DaemonError`、RPC 的 `extension-*`、按 D4 的 `timeout`）才能拿到 exit 2。
- 修复命令从分类出发生成，并且必须是能直接跑的命令。例如 `foreignPort` 改成指向设置卡换端口，再重新运行设置卡给出的配对命令。
- doctor 的配置错误路径也经分类出一行 stderr，写明 `config.problem` 与修复动作。
- 三张 markdown 表的**每一行**都与分类对账，不止 exit 1。INSTALL.md 那张按 D6 可能直接删掉。

**收益**

- Locality：Gotcha 5 从「每加一个失败都要记得补类型」变成「不补类型也能拿到安全的默认处置」。
- Leverage：`reportFailure`、`runTool`、doctor 都只调用分类，不再各自判断。
- 测试：一个表驱动测试（错误 → 退出码 → stderr 形状）取代散落在各命令用例里的退出码断言；markdown 表的对账从一行扩到全部行。

**会破坏什么（Never Break Userspace 核对）**

已发布的 0.2.0 捆绑的 SKILL.md，对 exit 1 的处置是「stderr 不以 `Run favbase --help` 结尾，就把它给用户看」。未分类错误的 stderr 本来就是 `favbase: <message>`、没有 usage 行，所以**翻到 exit 1 对已发布的那张表仍然给出正确处置**。反过来，今天的 exit 2 对这些错误给的处置（run doctor）是错的。`timeout` 挪到 exit 2 后，已发布 SKILL 的处置从「改参数」变成「跑 doctor」，比现状好，但仍不完整（doctor 正常时无事可修），所以 exit 2 那一行要补「doctor 报告正常就重试一次」。

**决策**：D3-a、D4-a（用户 2026-09-27）。

### 实施记录（2026-09-27）

**分类 module**：新建 `packages/favbase/exit-codes.ts`，是唯一把失败映射成「退出码 + stderr 行」的地方。`describeError(error)` 管命令抛出的错误，`describeToolError(code, message, advice?)` 管 daemon 回答的 Knowledge Tool 错误；`EXIT_*`、`EXIT_CODES`（`--help` 的退出码摘要由它生成）、`USAGE_LINE`、`EXTENSION_LATENCY_HINT` 都从 `cli-main.ts` 搬到这里。`cli-main.ts` 不再有任何命令自己选退出码：`runTool`、`runTools`、`runDoctor`（配置错误路径与未连接路径）、`reportSkillFailures`、`reportFailure` 都经 `printFailure(io, describe*(...))`；`reportFailure` 只剩给 `daemon run` 加时间戳这一件事。`CliExit` 删除：`BridgePortInUseError` 直接在分类里处理。

- **默认值翻转（D3-a）**：未分类错误 → exit 1，stderr 只有 `favbase: <message>`，没有 usage 行。`ConfigError`、`LocalFileError` 不再单列分支，它们本来就走这条默认路径。只有 `UsageError` 以 `Run favbase --help for usage.` 结尾（表驱动测试钉住「只有它」）。
- **exit 2 只留给 doctor 查得了的失败**：`DaemonError`（五种 code），以及工具错误 `extension-unavailable` / `extension-disconnected` / `timeout`（D4-a）。
- **工具错误表 `TOOL_ERRORS` 是 `Record<BridgeCallErrorCode, …>`**：扩展或 daemon 新增一个 code，不给它定退出码就编译不过（这是 #10「哪些 RPC code 表示不可达」那一片，字符串字面量从 `cli-main.ts` 消失）。daemon 回来的 code 仍按 `string` 处理：更新的 daemon 发来本 CLI 不认识的 code，一律 exit 3、消息给用户看。建议行：`extension-*` 沿用原 `EXTENSION_HINT`；`timeout` 是「run favbase doctor, and if it reports ok, retry once」；`invalid-args` / `unknown-tool` 指向 `favbase tools`；`db-unavailable` / `execution-failed` / `cancelled` 不加建议行。
- **stderr 形状统一成两行**：`favbase: <code>: <message>`，再加一行建议（若有）。`tools` 与 doctor 的「扩展未连接」原来各自拼成一行，现在也是这两行；doctor 用 `advice` 参数把自己的 troubleshooting + 冷启动延迟文案放在第二行。只改 stderr，stdout 的 JSON 不变。

**表中死路逐行处理**

| 失败 | 现在 |
|---|---|
| `daemon.log` / `~/.favbase` 不可写 | `spawnDaemon` 的 `mkdir` + `openSync` 包进 `writingFile(daemonLogPath)`，exit 1，`favbase: cannot write <daemon.log>: <OS 原因>`。数据命令与 doctor 都是这一行，不再循环。`spawn` 本身没包（坏的 `execPath` 不是「文件写不了」） |
| `FAVBASE_DAEMON_IDLE_MINUTES` 非法 | 解析函数从 `cli-main.ts` 搬到 `config.ts`（`daemonIdleMinutes`），`spawnDaemon` 在 spawn 前先调一次：`ConfigError`，exit 1，立即返回（原来要等满 10 s 的 `spawn-failed`）。只在要 spawn 时检查：已有 daemon 在跑时，这个变量对本次命令没有意义 |
| 旧 daemon 停不掉（跨用户 `EPERM`，或 5 s 内没退出） | 仍是 `DaemonError`、exit 2（doctor 会撞上同一个 daemon，而且在 #3 之前没有报告），但 `stopToReplace` 的消息补上两条能照做的出路：`end process <pid> yourself, or <CHANGE_PORT_HINT>`。没有按 errno 分支：跨用户的进程结束不了，换端口那一条总是成立 |
| 端口被非 favbase 程序占用（`foreign`） | 消息改用 `config.ts` 新增的 `CHANGE_PORT_HINT`：「pick another port in favbase Settings > Connections > Agent Skills, then copy the setup command there and run it」。设置卡的 setup 命令同时带 `--token` 与 `--port`，所以能直接跑。`daemon run` 端口被占的提示（`BridgePortInUseError`）同样改用它，退出码保持 exit 1 |
| `timeout` | exit 2（D4-a），建议行见上 |
| `db-unavailable` / `execution-failed` | exit 3 不变；exit 3 那一行改成按 code 分支，这两个落在「把消息给用户看」 |
| 版本漂移的 `unknown-tool` / `invalid-args` | exit 3，建议行指向 `favbase tools`：工具改了名，agent 在那里看得到；彻底的跨版本处理仍是 #5 |
| doctor 的配置错误路径 | JSON 之后（skill 提示行之后）打一行 `favbase: <config.problem>`，与其他命令对同一错误打的那行相同；exit 1 那一行「把 stderr 给用户看」从此有东西可看，修复动作（`favbase setup --token …`）也在 stderr 上 |
| INSTALL.md 的 exit 2 行 | 重写，见下 |

**三张 markdown 表**：SKILL.md「Errors and exit codes」、INSTALL.md「When something is wrong」、npm README「Exit codes」。

- exit 1：意思从「local file problem」放宽为「other local problem」（未分类错误也落在这里），处置不变。
- exit 2：「run `favbase doctor` and act on what it reports: the Chrome, Agent Skills, port or pairing token fix in its `troubleshooting` list, or its stderr message when it prints no report; if it reports `ok: true`, retry the command once」。后半句覆盖 timeout；「its stderr message when it prints no report」覆盖 #3 修完之前 doctor 在 daemon 失败时只打一行的情况。
- exit 3：「For `invalid-args` or `unknown-tool`, fix your command (`favbase tools` lists …); for any other code, show the stderr message to the user」。
- README 的「Exit code 2 usually means Chrome is closed」改成先跑 doctor、它没查出问题就值得重试一次。
- **跨版本核对（#4 的教训）**：INSTALL.md 从 `main` 被读，而读者 `npm install -g favbase` 装到的是已发布的 0.2.1，所以每一行都按两个版本核对过。0.2.1 上未分类错误是 exit 2、`timeout` 是 exit 3：未分类错误走新 exit 2 行 → doctor 撞上同一错误、没有报告 → 「its stderr message」→ 把消息转述给用户，仍然有出路；`timeout` 走新 exit 3 行 → 不在修命令的两个 code 里 → 给用户看，比旧文字「adjust the arguments」对。新文字对两个版本都成立，所以本条不依赖 D6 先拍板，也不产生新的 #4 活实例。SKILL.md 捆绑进 CLI，npm README 随发布快照，这两份本来就跟版本走。
- 未改：INSTALL.md 的 token mismatch 行（留给 D6，理由同 §1）；三处「Chrome 116–119」措辞（#11）。
- ADR 0003 的 Decision 一节写着旧的退出码语义（「1 用法或配置 / 2 不可达」），补了 2026-09-27 的 Amendment，正文照惯例不改（Trellis check 发现）。

**测试**

- 新增 `exit-codes.test.ts`：`describeError` 覆盖 `UsageError` / `ConfigError` / `LocalFileError` / 未分类 `Error` / 非 Error 值 / 五种 `DaemonError` / `BridgePortInUseError`；`describeToolError` 覆盖八个已知 code 加一个未知 code，并断言 `AGENT_BRIDGE_TOOL_ERROR_CODES` 每一个都有期望值。markdown 对账：三张表的行恰好是 CLI 会用的码（INSTALL 只列非零码）；SKILL 与 INSTALL 的 exit 1 行引用 usage 行并「show the stderr message to the user」；exit 2 行点名 `favbase doctor`、「no report」时读 stderr、`ok: true` 时重试一次；exit 3 行里反引号括起的工具 code **集合相等于**分类里「exit 3 且带修命令建议」的那些 code。根测试 `tests/agent-bridge-cli-aliases.test.ts` 原有的「reads exit code 1 the way SKILL.md does」并入这里（它只对账 exit 1）。
- `cli-main.test.ts` 新增一组端到端：`tags` 与 `doctor` 遇到只读 `daemon.log` → exit 1 且点名路径（只读文件而不是目录：Windows 上 `openSync(目录, 'a')` 会成功，本机实测）；非法 `FAVBASE_DAEMON_IDLE_MINUTES` → exit 1 且 `daemon.log` 不存在（没 spawn）；未分类异常 → exit 1、无 usage 行；fake daemon 回 `timeout` / `invalid-args` / `db-unavailable` → 2 / 3 / 3 与对应建议行。`fakeDaemon` 加了 `rpcAnswer` 参数。`cli-main-doctor.test.ts` 的配置错误用例补断言 stderr 倒数第二行是 `favbase: <config.problem>`；`daemon-client-ensure.test.ts` 的 `EPERM` 用例补断言消息里的出路。
- 变异验证（改回旧行为逐一跑）：去掉 spawn 前的 idle 检查 → idle 用例 10 s 超时变红；`daemon.log` 不包 `writingFile` → 两个日志用例红；默认值改回 exit 2 → 分类表与既有 exit-1 用例红；`timeout` 改回 exit 3 → 三例红；doctor 配置路径不打 stderr → 一例红；SKILL exit 3 行删掉 `unknown-tool`、INSTALL exit 2 行改回「Chrome closed」→ 对应两例红。
- `pnpm test`（`packages/favbase`，含真进程集成）247 通过；根 `tests/agent-bridge-cli-aliases.test.ts` 18 通过。

**残留**

- doctor 在 daemon 半边失败时仍不出 JSON（#3，下一步）。exit 2 行已经写成对这种情况也有出路。
- #10 只做了 RPC code 分类这一片；daemon HTTP 线协议的 schema、拒绝原因三处字面量、token 上限两处，都未动。
- #11 的期限常量、15b 的 `reportFailure` 回头嗅探 argv，都未动。
- SKILL.md 改了，已装的 0.2.1 副本对 `main` 构建的 CLI 会报 `stale`（仅开发机）。下次发布照 Release 流程递增两处版本号。

---

## 3. 【高】`doctor` 在 daemon 半边失败时不出报告

**文件**：`packages/favbase/cli-main.ts:283-326`、`packages/favbase/cli-main-doctor.test.ts`、`skills/favbase/INSTALL.md`

> 旧 docs/30 把这条定为中高。本文升为高：按严重度定义，SKILL 的 exit 2 那一行（「run `favbase doctor`」）今天就会走进死路，属于「已文档化流程今天就会走进死路」。

**问题**

`runDoctor` 手写了两条输出路径：配置错误（`:288-299`）与成功连上 daemon（`:300-325`）。第三种情况是 `ensureDaemon`（`:300`）或 `fetchStatus`（`:301`）抛出 `DaemonError`：`foreign`、`spawn-failed`、`unauthorized`、`protocol`、旧 daemon 停不掉的 `unreachable`、超时。这时错误直接抛出 `runDoctor`，由 `reportFailure` 打一行 stderr，**没有 JSON，没有 `cli`、`skills`、`troubleshooting`**。

而这恰恰是用户最需要 doctor 的场景：exit 2 的处置就是「run `favbase doctor`」。INSTALL.md 还专门承诺 doctor「checks the config file, the background daemon and the link to the extension **separately**」，而实现并不是分开检查的。`packages/favbase/CLAUDE.md` 特意强调 `cli` 与 `skills` 要在「**both** its output paths」都报，这条规则本身就是结构出了问题的症状：报告是在多个分支里命令式拼出来的，每加一个探针都要记得在每条路径补上，而第三条路径已经漏了。

**证据**

- `cli-main-doctor.test.ts:13` 整体 `vi.mock('./daemon-client')`，并且总让 `ensureDaemon` 成功：doctor 的 interface 不是它的测试面，只能靠替换整个下游 module 来测。
- 全部 doctor 用例没有一个覆盖 `foreign` / `spawn-failed` / `unauthorized`；`integration.test.ts:379-391` 的 foreign 用例跑的是 `tags`，不是 `doctor`。
- 与 #1 叠加：setup 之后的 doctor 正好走这条无报告路径。

**方案**

把 doctor 做成独立的深 module：一组探针（配置、daemon、扩展连接、CLI 版本、skill 副本），**每个探针把自己的失败变成自己字段里的状态值，而不是抛异常**。最后组装出一份报告，`ok`、退出码（经 #2 的分类）、`troubleshooting`、skill 提示行全部从这份报告推导，只有一条输出路径。

**收益**

- Locality：探针失败怎么呈现，只在该探针里决定；「两条路径都要报」的规则随多余的路径一起消失。
- Leverage：doctor 在任何失败下都给出完整 JSON，agent 与用户看到同一份结构化诊断。
- 测试：报告组装是纯函数，可以直接对「探针结果 → 报告」断言，不再需要整模块 mock `daemon-client`；daemon 失败路径变成普通的表驱动用例。

**会破坏什么**

doctor 的 JSON 在 daemon 失败时多出字段形状，属于纯追加。退出码在 #2 的分类下保持 exit 2（不可达）不变。`cli-main-doctor.test.ts` 的整模块 mock 可以改成对报告组装的直测，旧用例的语义全部保留。

**待决策**：D5。

---

## 4. 【高】发布时序：`main` 上给 agent 读的 markdown 跑在已发布的 CLI 前面

**文件**：`skills/favbase/INSTALL.md`、`skills/favbase/SKILL.md`、`packages/favbase/README.md`、根 `README.md`、`packages/favbase/CLAUDE.md` 的 Release 一节、`docs/adr/0003`、`docs/adr/0005`

**问题**

三份 markdown 的「版本」不是同一个：

| markdown | 读者拿到的是哪个版本 | 描述的是哪个版本的 CLI |
|---|---|---|
| INSTALL.md | `main` 上的实时 raw URL（ADR 0005 把路径和分支钉死了） | `main` 的代码；但它让 agent 执行 `npm install -g favbase`，装到的是**已发布的最新版** |
| SKILL.md，经 `setup` / `install-skill` 安装 | 打进 CLI 的那份 | 与已装 CLI 一致 ✓ |
| SKILL.md，经 `npx skills add InvisibleQAQ/favbase` 安装（根 README 第 96 行、ADR 0003 Decision 第 6 条） | `main` 上的那份 | `main` 的代码 |
| npm README | 发布时的快照 | 与发布版一致 ✓ |
| GitHub 上的 `packages/favbase/README.md`、根 README | `main` | `main` 的代码 |

所有守卫测试都拿 `main` 的 markdown 对 `main` 的代码，没有任何东西拿它去对 `npm install -g favbase` 真正装到的那个版本。`packages/favbase/CLAUDE.md` 的 Release 步骤也没有「给 agent 读的 markdown 不得先于发布合入」这一条；两个 release commit 都是「版本号改了、没发布」（"Not published."）。

**证据：今天的活实例**

- `package.json` 写 0.2.1，npm 最新是 **0.2.0**（见基线）。0.2.0 等价于 `3ac6e23`。
- `main` 上的 INSTALL.md exit 1 那一行（`1df12e6`）描述的是 0.2.1 的行为：本地文件写不了是 exit 1，并点名路径。在 0.2.0 上，同样的失败（例如 `~/.claude/skills` 不可写，或 `~/.agents/skills` 是悬空链接）是原始 OS 错误加 exit 2，因为 0.2.0 的 `reportFailure` 没有 `LocalFileError` 分支，`installAgentSkills` 在第一个副本就抛出。INSTALL.md 的 exit 2 行随后告诉 agent「Chrome closed, or Agent Skills switched off」，agent 就会对用户说假话。
- GitHub 上的 `packages/favbase/README.md` 描述「已有旧版 Codex 副本时不再建 `.agents` 副本」（`9ca609f`），0.2.0 没有这个行为。它还把 `main` 上的 SKILL.md 链接成「The Agent Skill this package installs」。
- `npx skills add` 路线：它装的是 `main` 的 SKILL，与 0.2.0 捆绑的那份逐字节不同，doctor 判 `stale`。CLI 与 registry 同为 0.2.0，被判为 `current`，于是 `skillHint` 让用户跑 `install-skill --agent ...`，把副本回滚成 0.2.0 的版本；下一次 `npx skills add` 又翻回去。`[UNKNOWN]` `npx skills add` 实际写到哪个目录。如果不在 `~/.claude/skills` / `~/.agents/skills`，doctor 会报「no favbase skill is installed」，而 skill 其实已经加载。

没有真实用户，所以今天没有人真的踩到。但结构保证不了下一次，而且下一次正是扩展上架、用户照 welcome 页的 URL 让 agent 自助安装的时候。

**方案**（按 D6、D7）

- **删掉 INSTALL.md 的退出码表**。它是 SKILL 那张表的第二份拷贝，也是唯一一份不随 CLI 版本走的拷贝。INSTALL 只保留跨版本稳定的内容：Node 版本、安装命令、停下来要配对命令、运行配对命令、跑 doctor。另外只写一条通用规则：「命令失败时，把它的 stderr 给用户看；排障以 `favbase --help` 与刚装好的 skill 为准」。这两者都随已装 CLI 的版本走。
- **发布纪律进流程**：版本号递增与 `npm publish` 是同一步；Release 步骤加一条 `npm view favbase version` 必须等于 `package.json`。「改了版本号但不发布」的 commit 不再存在。可选：每次发布打 `favbase-vX.Y.Z` tag，让将来的守卫可以对「上一个发布版」做 diff（今天仓库一个 tag 都没有）。
- **`npx skills add` 路线**：从根 README 与 ADR 0003 删掉（D7）。只保留 CLI 自己安装 skill 这一条路，doctor 的逐字节比对才有意义。
- ~~**止血**（用户动作，见执行顺序第 2 步）：发布 0.2.1，或者撤回 INSTALL.md 那一行。~~ 已完成：0.2.1 于 2026-09-27 发布。

**收益**

- Locality：「这段文字描述的是哪个版本」对每份 markdown 都有唯一答案。
- Leverage：INSTALL 变短，也不再需要与 SKILL 的逐行对账（`tests/agent-bridge-cli-aliases.test.ts:225` 那一例随表删除）。
- 测试：「main 上的描述 ⊆ 已发布版本的行为」测不了（需要网络），但删掉那张表后，这个问题就不存在了。

**会破坏什么**

- ADR 0005 的 URL 契约不受影响：路径与分支不动，只是内容变短。
- ADR 0003 的一条 Decision 要写 Amendment。
- `tests/agent-bridge-cli-aliases.test.ts` 里 INSTALL 的 exit-1 对账用例随表删除；路径、设置区名、包名、setup 命令形状、默认端口这几项对账保留。（#2 起该对账已移到 `packages/favbase/exit-codes.test.ts` 并扩到全部行；按 D6-a 删表时，删掉那里 INSTALL 的一半。）
- `skills/favbase/CLAUDE.md` 里「INSTALL 的 exit-1 行必须与 SKILL 对齐」那一段要同步改写。

**待决策**：D6、D7。

---

## 5. 【中高】自动更新的扩展与手动更新的 CLI/Skill 之间，跨版本契约没有 owner（时限：扩展上架前）

**文件**：`lib/agent-bridge/protocol.ts`、`lib/agent-bridge/client.ts`、`packages/favbase/bridge-server.ts`、`packages/favbase/commands.ts`、`skills/favbase/SKILL.md`、`lib/chat/tools.ts`、根 `CLAUDE.md`「跨 runtime 协议」一节

**问题**

扩展经 Chrome Web Store 自动更新；CLI 与它捆绑的 SKILL.md 只有用户手动 `npm install -g` 才会变。两者之间有三层契约，**没有一层有跨版本的 owner**：

1. **WS 线协议**：所有 envelope 与 payload 都是 `z.strictObject`（`protocol.ts:43`、`:68`），`protocolVersion` 是 `z.literal(1)`（`:58-62`），错误码与拒绝原因是 `z.enum`（`:85`、`:103`）。
   - 新扩展给 `hello` 加任何字段（哪怕 optional），旧 daemon 解码得 `null`，以 `1002 invalid-message` 关闭（`bridge-server.ts:357`）。
   - 新扩展给 `AGENT_BRIDGE_TOOL_ERROR_CODES` 加一个错误码：握手照常，但任何返回新码的调用会让旧 daemon 在调用中途关闭 socket，CLI 拿到 `extension-disconnected`，扩展约 30 s 后重连。**这个 enum 陷阱在现有文档里没有记录**（`lib/agent-bridge/CLAUDE.md` 只写了 `hello` 加字段的情况）。
2. **诊断信号被双向丢弃**：
   - daemon 关闭时带着原因（`1002 invalid-message` / `unexpected-message` / `hello-required`、`1008 hello-timeout`、`1012 extension-reconnected`），扩展收到 `BridgeTransportCloseEvent { code, reason }`（`client.ts:27-30`），却在 `onClose: () => this.handleRemoteClose(connection)`（`:216`）把它扔掉，一律记为 `connection-closed`。
   - daemon 丢掉 `hello.extensionVersion`（`AuthenticatedPeer` 与 `BridgePeerSnapshot` 都没有版本字段），扩展丢掉 `welcome.serverVersion`（`client.ts:297-304`）。doctor 和设置卡都看不到对端版本。
   - `invalid-message` 关闭**不计入** `rejectedHelloCount`，也不写日志（`bridge-server.ts:357` 直接 `close`），所以 doctor 看不到任何痕迹。
   - `reject: version` 没有任何 daemon 会发送；即使将来的 v2 daemon 发了，也会因为 `protocolVersion: 2` 解码失败，被扩展记成 `protocol-error`。所以 `errorVersion` 从构造上就不可达。
3. **Knowledge Tool 面**：已发布 CLI 的别名表（`commands.ts`，工具名 + 参数名）与捆绑的 SKILL.md（结果字段的含义，例如 `found`/`item_exists`、`coverage` 的形状）在发布那一刻就冻结了。`tests/agent-bridge-cli-aliases.test.ts` 只拿同一 commit 的两端对账。扩展一旦重命名工具或参数，旧 CLI 就得到 `unknown-tool` / `invalid-args`，exit 3，处置是「adjust the arguments」（#2）。docs/27 Step 6 曾经手工避免过一次（`found` 不改义），但没有结构性守卫。

用户看到的症状全部被误诊：设置卡显示 `errorConnectionClosed`（「下一次 favbase 命令会自动重新拉起」，而下一次只会复现同样的失败）或 `errorConnection`（「运行任意 favbase 命令并确认端口一致」）；CLI 等 75 s 后提示「confirm Chrome is running … pairing token match」；doctor 的 troubleshooting 全是 token/Chrome 方向。

根 `CLAUDE.md` 写着「外部 Agent Bridge 没有 legacy userspace」。**这一前提在 CLI 这一侧已经不成立**：npm 上已有 0.1.0、0.2.0 与 0.2.1（2026-09-27），它们的 daemon 就是严格解码的 legacy userspace。

**方案**（按 D8）

- 兼容责任归扩展：扩展是唯一会自动更新的一端，只有它有能力适配对方。
- daemon 从下一个版本起：对已知消息的未知字段宽松、忽略未知消息类型、对不支持的 `protocolVersion` 显式回 `reject: version`（先按 envelope 读出版本，再做严格的 payload 解码）；把 `invalid-message` 关闭计入诊断（计数 + 最后原因），经 `/status` 纯追加给 doctor。
- 扩展：读取 close code，把 `1002` 映射成独立的 `protocol-mismatch` 状态（见 #9）；记录 `serverVersion` 进状态，设置卡显示「本机 favbase CLI 版本过旧，请升级」。发送新字段或新错误码前，先按 `serverVersion` 判断对端是否支持。
- Knowledge Tool 面：一份「已发布契约」黄金文件（工具名、参数名、SKILL.md 描述的结果字段），测试断言当前 `describeTools()` 是它的超集，只增不删。
- 根 `CLAUDE.md` 的那一句改成实话：CLI 侧有 legacy userspace，扩展负责兼容。

**收益**

- Locality：「这次协议改动会不会打断已发布的 CLI」有一个 module、一份文件可查，而不是靠记忆 docs/27 的某段话。
- Leverage：第一次改 `hello` / 加错误码 / 改工具时，不会让所有已装 CLI 的用户同时断开且被告知错误原因。
- 测试：一个「旧 daemon 解码器 × 新扩展消息」的兼容用例（把已发布版本的 `protocol.ts` 快照成测试夹具），外加黄金文件超集断言。

**会破坏什么**

- 已发布的 0.1.0/0.2.0/0.2.1 daemon 仍然严格解码，**改不了**（0.2.1 没有改线协议）。所以首个上架的扩展对它们必须讲精确的 v1：新能力只能在 `serverVersion` 表明对端支持时启用。这是本条必须在扩展上架前完成的原因：上架之后，两端都有 legacy userspace。
- `lib/agent-bridge/CLAUDE.md` 的「Strict means no field is additive」一节要改写。

**待决策**：D8。

---

## 6. 【中高 · 安全】Bridge Token 以明文交给任何占住 loopback 端口的进程；welcome 回显不构成认证

**文件**：`lib/agent-bridge/client.ts`、`packages/favbase/bridge-server.ts`、`packages/favbase/daemon-client.ts`、`packages/favbase/rpc-server.ts`、`CONTEXT.md`

**问题**

- **扩展 → 端口占用者**：扩展每个 alarm 周期向 `ws://127.0.0.1:<port>/bridge` 发 `hello`，**明文携带 token**（`client.ts:236`）。它对 daemon 的唯一「验证」是 welcome 回显的 token 是否等于自己的（`:292-294`）。真 daemon 回显的就是刚才已经比对过的那个值，这个校验永远不会失败；占用者刚从 `hello` 里收到 token，照抄回去就能通过。按 deletion test，删掉这一行不损失任何安全性质。通过之后，扩展会执行占用者发来的 `tools.call`，并返回用户收藏库的检索结果。
- **CLI → 端口占用者**：CLI 只要 `/health` 回 `{name:'favbase', version, pid}` 就认为是自己人（`isHealth`，`daemon-client.ts:101-107`），随后在 `Authorization: Bearer` 里明文发送 token（`requestJson`，`:66`）。
- **窗口**：daemon 只在第一次 CLI 调用时启动。从开机到第一次调用之间，以及空闲退出之后，端口是空的；只要 Agent Skills 开关开着，扩展每 30/60 s 就向「任何在听的人」送一次 token。**loopback 端口是全机共享的**：同一台机器上的另一个 OS 用户，或者一个受限的沙箱进程，都能占住 17836。
- `CONTEXT.md` 对 Bridge Token 的定义写着「so both ends of the Agent Bridge can verify each other」（第 112 行），docs/21 也这样声称。代码并没有做到。

**证据**：以上均为代码可见。攻击的前提是有同机的另一个 OS 用户，或者能监听 loopback 的受限进程；单用户桌面上，任何以该用户身份运行的恶意程序本来就能读 Chrome profile，这时不构成新增风险。

**方案**（按 D9）

- 纳入威胁模型：WS 与 HTTP 两条线都改成 challenge-response。两端各出一个 nonce，用 token 作 HMAC 密钥证明自己持有 token，token 本身不上线。这是线协议改动，必须随 #5 的版本协商一起做；已发布的 daemon 不会支持，扩展按 `serverVersion` 决定是否要求。
- 不纳入：订正 `CONTEXT.md` 与 docs/21 的「verify each other」，删掉 welcome token 校验这个自欺的检查，写 ADR 记录接受的风险。

**收益**：token 不再因为端口被抢占而泄漏；文档与代码说同一件事。

**会破坏什么**：纳入时是协议改动，兼容性按 #5 处理。不纳入时零代码风险。

**待决策**：D9。

---

## 7. 【中】`reject` → `close` 竞态可能吞掉 bad-token 状态、退避与修复按钮

**文件**：`lib/agent-bridge/client.ts`、`lib/agent-bridge/client.test.ts`

**问题**

daemon 拒绝 hello 时先发 `reject`，紧接着 `socket.close(1008, reason)`（`bridge-server.ts:568-569`）。扩展这一侧，`WebSocketTransport` 把每个事件各自放进一条不排队的 microtask 链（`client.ts:54-67`）：

1. `message` 事件 → `handleReject` → `applyAuthBackoff`。它在 `await this.options.getStatus()`（`:323`，一次 `chrome.storage` IPC）**之前**还没有摘掉连接。
2. 如果 `close` 事件在这次 IPC 返回前到达：`disconnect()`（`:405-410`）同步把 `this.connection` 置空，写入 `lastError: 'connection-closed'`。
3. `applyAuthBackoff` 恢复后，`isCurrent` 为假（`:324`），直接返回。

结果：没有 `authFailureCount`、`nextRetryAt`、`lastAuthFailureAt`。设置卡显示「本机 favbase 已断开，下一次 favbase 命令会自动重新拉起」，而不是 bad-token 提示和「复制修复命令」按钮（`badToken` 取决于 `lastError === 'bad-token'`）。doctor 那一侧却正确地报了 bad-token，两端说法不一致。`bad-origin` 没有这个问题，因为 `disconnect()` 在第一个 await 之前就摘掉了连接。

**证据**：代码可见，**未实机复现**。docs/24 §9.4（2026-09-01）的黑盒实验观测到了退避生效（修好 token 后仍被锁 43 秒），说明这个竞态至少不是必现。`FakeTransport`（`client.test.ts`）会完整 await 每个 handler，也从不在 `reject` 之后接 `onClose`，表达不了真实的交错。`WebSocketTransport` 本身没有任何测试。

**方案**：`applyAuthBackoff` 在任何 await 之前同步摘掉连接（与 `disconnect()` 相同的顺序），再写状态。或者让 transport 事件按到达顺序串行处理。前者改动三行。按 D2 选 b（删退避）的话，这条的大部分内容会随之消失，只剩「bad-token 状态必须先于 close 落盘」这一点。

**收益**：bad-token 的 UI 与修复入口可靠出现。

**测试**：`FakeTransport` 加一个能模拟「`onMessage` 挂起期间触发 `onClose`」的交错用例。

---

## 8. 【中】SW 里数据库初始化失败的 Promise 被永久缓存

**文件**：`lib/database/db-state.ts:10-19`、`lib/database/read-proxy-db.ts`、`entrypoints/background.ts`（`getDb: () => initReadDbProxy(ensureOffscreen)`）

**问题**

`initializeDb` 把 `factory()` 的 Promise 存进模块级的 `initPromise`，没有 `catch`，也没有失败后清空。factory 一旦 reject（例如 offscreen 的健康 RPC 在 PGlite 冷启动时超过 30 s 超时，或 `ensureOffscreen` 失败），同一个被拒绝的 Promise 会在这个 SW 实例的整个生命周期里原样返回。之后每一次 Bridge 工具调用都是 `db-unavailable`（`client.ts` 的 `handleToolCall`）。daemon 的 20 s 心跳会让 SW 保持存活（Chrome 116+ 语义），所以「直到 SW 重启」实际可能意味着「一直」。CLI 把 `db-unavailable` 报成 exit 3，SKILL 让 agent「adjust the arguments」（#2）。

**证据**：缓存结构是亲自读过的。`[UNKNOWN]` 冷启动时 PGlite 初始化实际会不会超过 30 s。`read-proxy-db.test.ts` 只有成功用例。

**方案**：factory reject 时清空 `initPromise`，让下一次调用重试（成功之后仍然保持去重）。

**收益**：一次偶发的慢启动不再变成永久故障。

**测试**：一个「第一次 factory reject、第二次 resolve」的用例。

---

## 9. 【中】扩展连接状态的错误词汇没有类型；设置卡映射两条不可达、三条给错处置（时限：随 #5）

**文件**：`lib/storage/agent-bridge.ts:23`、`lib/agent-bridge/client.ts`、`entrypoints/app/sections/settings/agent-bridge-card.tsx:96-113`、`lib/i18n/locales/{en,zh-CN}.ts`、`lib/i18n/CLAUDE.md`

**问题**

`AgentBridgeStatus.lastError` 声明成 `string | null`。客户端写的是散落的字面量：`missing-token` / `invalid-port`（`:187`）、原始异常消息（`:224`，来自 `createTransport` 抛错）、`protocol-error`、`bad-token`、`bad-origin` / `version`（`:315`）、`connection-closed`、`connection-error`。设置卡用带 `default:` 的字符串 switch 做映射（`statusErrorKey`）。客户端加一个新码能编译通过，然后静默落进通用文案。`lib/i18n/CLAUDE.md` 里写的「稳定 error code」契约，没有类型或测试来执行。

逐项的可达性与处置：

| `lastError` | 设置卡文案 | 问题 |
|---|---|---|
| `bad-origin` | 「本机 favbase 拒绝了当前扩展身份」，没有给动作 | 对真实扩展**不可达**：`hello.extensionId` 取自 `browser.runtime.id`，Origin 头是同一个 id，`bridge-server.ts:386` 必然通过 |
| `version` | 「协议版本不兼容，请升级 favbase CLI」 | **不可达**（#5） |
| `connection-closed` | 「本机 favbase 已断开，下一次 favbase 命令会自动重新拉起」 | 对 daemon 空闲退出或 stop 是对的；对版本漂移（1002）、hello 超时、#7 被吞掉的 bad-token 都是错的 |
| `protocol-error` 或原始异常 | 落进 `default`，显示 `errorConnection`：「尚未连接本机 favbase：运行任意 favbase 命令…」 | 对新版 daemon 不兼容、`hello` 编码失败（例如工具描述超过 50k 字符）、注册表 bug 都是错的。docs/27:600 说用户会看到「协议错误」，但 en/zh 两份 locale 里都没有这样的串（已 grep 核实），用户实际看到的是「尚未连接」 |
| `errorConnection` 的措辞本身 | 「运行任意 favbase 命令」 | `setup`、`install-skill`、`--version`、`daemon stop` 都不会拉起 daemon |

`statusErrorKey` 是私有函数；卡片测试只渲染了 `bad-token`。

**方案**

- `lastError` 改成穷举的联合类型，由 `lib/agent-bridge/` 导出；原始异常只进日志，不进状态。
- 设置卡的映射改成 `Record<AgentBridgeErrorCode, LocaleKeys>`，靠编译器保证穷举。
- 删掉或合并两个不可达的码。
- 新增 `protocol-mismatch`（由 #5 的 close code 映射得到），配上「升级 CLI」的文案。
- `errorConnection` 的措辞改成点名 `favbase doctor`。

**收益**：新增错误码时，编译器会指出每一个要翻译、要给处置的地方。

**测试**：`it.each` 覆盖每个码，断言 en/zh 两边都有文案，且文案里给出了动作。

---

## 10. 【中】CLI↔daemon 的 HTTP 线协议没有 owner

**文件**：`packages/favbase/rpc-server.ts`、`packages/favbase/daemon-client.ts`、`packages/favbase/cli-main.ts`、`lib/agent-bridge/protocol.ts`、`lib/agent-bridge/client.ts`、`packages/favbase/config.ts`

**问题**

`/health`、`/status`、`/rpc` 的响应类型定义在 `rpc-server.ts:31-45`，解码却是 `daemon-client.ts` 里约 70 行手写的类型守卫：`isHealth` / `isStatusDaemon`（`:101-118`）、`isRpcResponse`（`:274-281`）、`normalizeStatus`（`:300-342`）。编码方与解码方之间没有共享的 schema，只有「两边碰巧写得一致」。

这是一条**真实的跨版本线**：D14 规定较新的 daemon 会被保留给较旧的 CLI 使用（`daemon-client.ts:249`），两个版本的代码会在这条线上相遇。扩展那条线有 `protocol.ts` 的 zod schema 与 encode/decode 对，这条线没有，尽管 zod 已经是本包依赖。

**证据（手写镜像点）**

- hello 拒绝原因的三个字面量写了三遍：`protocol.ts:103`（`z.enum`）、`daemon-client.ts:320-322`、`client.ts:309`，另有设置卡的 switch。只有 `bridge-server.ts` 的 `BridgeHelloRejectReason` 是从协议派生的。
- 「哪些 RPC 错误 code 表示扩展不可达」用字符串字面量写在 `cli-main.ts:175`，离定义这些 code 的 `bridge-server.ts` 隔了两个文件。
- `/status` 对旧 daemon 的缺省值（`daemon-client.ts:330-339`）写在解码侧，编码侧不知道哪些字段是「后来加的、必须可缺省」。
- token 长度上限 512 写了两遍：`protocol.ts:40` 的 `tokenSchema` 与 `config.ts:9` 的 `MAX_TOKEN_LENGTH`，而 `config.ts` 已经 import 了 `protocol.ts`。

**方案**

新建一个 daemon 线协议 module，拥有：路由表、三个响应的 schema（对未知字段宽松，保证较新 daemon 加字段不会打断较旧 CLI）、以及「RPC 错误 code → 是否表示扩展不可达」的分类。`rpc-server` 经它编码，`daemon-client` 经它解码。`protocol.ts` 导出拒绝原因常量与 token 上限，`daemon-client.ts`、`client.ts`、`config.ts` 都从它派生。

**收益**

- Locality：这条线的形状与演进规则集中在一处；新增 `/status` 字段时，「必须可缺省」写在 schema 上，而不是解码侧的注释里。
- Leverage：#2 的退出码分类直接消费这里的错误分类，不再有字符串字面量。
- 测试：一个 encode → decode 的 round-trip 契约测试，加一个「较新 daemon 多出字段仍能解码」的向前兼容用例，取代散落的 `normalizeStatus` 边界测试。

**会破坏什么**：对外行为不变。schema 如果写成严格模式，会打断向前兼容，这一点必须由测试钉住。

**待决策**：D10。

---

## 11. 【中】一次调用的时间预算横跨三个包、五个常量和五处散文，且不自洽

**文件**：`lib/agent-bridge/scheduler.ts:12-14`、`lib/agent-bridge/client.ts:24-25`、`packages/favbase/bridge-server.ts:25-28`、`packages/favbase/daemon-client.ts:25-26`、`lib/ai/embedding.ts:8`、`packages/favbase/cli-main.ts:56-57`、`skills/favbase/SKILL.md`、`skills/favbase/INSTALL.md`、`packages/favbase/README.md`、`lib/i18n/locales/{en,zh-CN}.ts`、`docs/adr/0003`

**问题**

| 常量 | 位置 | 值 | 依赖关系 |
|---|---|---|---|
| alarm 周期 | `scheduler.ts:14` | 0.5 min（Chrome 117–119 被钳到 60 s） | daemon 的 hello 等待必须覆盖它：**只有注释**（`scheduler.ts:12-13`、`bridge-server.ts` 注释） |
| hello 等待 | `bridge-server.ts:25` | 75 s | 同上 |
| 工具期限 | `bridge-server.ts:26` | 60 s | 与 hello 等待**串行**：`waitForPeer` 之后才起工具计时器，最坏 135 s |
| CLI HTTP 超时 | `daemon-client.ts:26` | 120 s | 注释与 ADR 0003 写的是「覆盖 75 s **或** 60 s」，没有算两者之和 |
| embedding 请求超时 | `embedding.ts:8` | 60 s | **等于**工具期限：provider 一挂，先触发的永远是 bridge 的 `timeout`，provider 自己的错误到不了用户手里 |
| 认证退避 | `client.ts:24-25` | 30 s → 5 min | 只在设置卡的倒计时里看得到；CLI 的 `EXTENSION_LATENCY_HINT` 和 SKILL / INSTALL / README 的延迟说明都没提 |

散文层面：

- SKILL、INSTALL、npm README、`EXTENSION_LATENCY_HINT` 都写「约 30 s，Chrome 116–119 约 60 s」。但 manifest 的最低版本是 117（`wxt.config.ts:48`），116 的用户根本装不上扩展（结论没变，数字写错了）。只有 `en.ts:70` 写的是「earlier supported versions」。
- 在 bad-token 退避期间，「一个 alarm 周期」的承诺是假的（#1）。
- 设置卡的倒计时数到 `nextRetryAt` 就结束，但真正的重试发生在其后的下一个 alarm tick，可能再晚 30/60 s。
- `integration.test.ts` 与 `cli-main-doctor.test.ts` 把「116-119」这个措辞钉死在自己身上，而不是对账 manifest。

**证据（场景）**：冷启动时扩展在第 60–75 s 才连上，紧接着工具执行 45–60 s。CLI 先超时，打印 `unreachable: timed out after 120000ms`，exit 2；daemon 随后取消调用，扩展端的工具照样跑完。概率低（检索通常远低于 60 s），列入是因为这些常量没有一个 owner。

**方案**（按 D11）

- 三个 daemon/CLI 期限放到本包的同一个导出位置。CLI 超时由 hello 等待与工具期限**相加再加余量**派生。
- 测试钉住三组关系：「CLI 超时 > hello 等待 + 工具期限」、「hello 等待 > 钳制后的 alarm 周期 + 余量」（跨包，读 `scheduler.ts` 的常量）、「embedding 超时 < 工具期限」。
- 散文里的「116–119」改成「117–119」，或者改成 `en.ts:70` 的「earlier supported versions」，并由测试对账 manifest。
- 倒计时文案改成「最早于 mm:ss 后重试」，或者按 D2 随退避一起删除。
- ADR 0003 Consequences 的那一句随之订正。

**收益**：改任何一个期限，都不会再静默打破另一端。

**待决策**：D11（以及 D2）。

---

## 12. 【中】Embedding provider 故障时整次检索失败，关键词结果被一起丢掉

**文件**：`lib/chat/retrieval.ts`（`semanticArm` 与两臂的 `Promise.all`）、`lib/ai/embedding.ts`

**问题**

`semanticArm` 在未配置 embedding（`embedQuery` 返回 `null`）或向量维度漂移（`EmbeddingDimensionError`）时返回 `[]`，也就是降级成只用关键词。但 `embedQuery(query)` 本身在 `try` 之外：provider 超时、5xx、key 失效都会原样抛出。它的注释称这是「real bug」，但 provider 故障不是 bug。两臂用 `Promise.all` 并发，所以关键词臂已经拿到的结果会被一起丢掉。Chat 与 Agent Bridge 共用这个 Knowledge Tool，两边一起受影响。在 Bridge 上：60 s 后（#11）变成 `timeout` 或 `execution-failed`，exit 3，agent 按 SKILL 改写查询再试，每次都再等 60 s。

**方案**（按 D12）：provider 故障与「未配置」同样降级为只用关键词，并在 `searchKnowledgeBase` 的结果里追加一个说明字段（例如 `semantic: 'unavailable'`，附原因）。`tools.result.result` 是自由 JSON，追加字段跨版本安全。SKILL.md 与工具描述同步说明这个字段：它表示关键词结果仍然可用，只是语义召回缺席了。

**收益**：provider 故障只降低召回，不再让整个检索功能停摆；agent 与 Chat 模型都能向用户如实说明。

**测试**：`retrieval.test.ts` 加「embedQuery 抛错 → 仍返回关键词命中 + 标记」的用例。

---

## 13. 【中】第五份安装说明（根 README）已经漂移；shipped markdown 里还有一批未守卫的副本

**文件**：根 `README.md:84-99`、`skills/favbase/SKILL.md`、`skills/favbase/INSTALL.md`、`packages/favbase/README.md`、`lib/chat/tools.ts`、`CONTEXT.md`

**问题**

ADR 0005 数过「四份手写安装说明」，漏了第五份：根 README 的 agent 段落。它**已经漂移**：

- 第 88 行写的是「Settings > Connections > **Agent Bridge**」，而这个区的名字是 Agent Skills。
- 第 93 行用 `<Bridge Token>` 作为用户可见的占位符，违反 `packages/favbase/CLAUDE.md` 的用户词汇规则（用户看到的应该是 pairing token）。
- 第 99 行只列了 `search`/`tags`/`get`，漏了 `coverage`。

它没有任何守卫。

其他未守卫的副本（按风险排序）：

- SKILL.md 命令概要里的 `--platform`、`--tag` 拼写。只有 `--limit` 由别名表派生并对账，把 `commands.ts` 里的 `tag` flag 改个名，SKILL 就错了，而且不会有任何测试失败。
- SKILL.md 对 `search` / `coverage` / `get` 结果形状与含义的英文描述，与 `lib/chat/tools.ts` 给模型看的中文描述是两份独立写的。`skills/favbase/CLAUDE.md` 只对 `get` 承认了这一点。它们也是 #5 的「已发布契约」的一部分。
- 设置区路径「Settings > Connections > Agent Skills」在 SKILL.md、`config.ts` 的 `SETUP_HINT`、`cli-main.ts`、`daemon-client.ts` 里各写一遍，只有 INSTALL.md 那份被守卫。INSTALL 只给英文标签，而中文 UI 显示「账号连接」「复制 setup 命令」；bad-token 时出现的「复制修复命令」按钮，没有任何 markdown 提到。
- 用户可见文案里用 **pairing token**、不用 Bridge Token，这条规则只写在两个 CLAUDE.md 里。`CONTEXT.md` 登记了「Agent Skills 是 Agent Bridge 的 UI 名」，却没有登记「pairing token 是 Bridge Token 的 UI 名」。
- `CONTEXT.md` 说 CLI 只联系「the public npm registry」，实际上还联系 `registry.npmmirror.com`（`update-check.ts`）。
- `favbase tools` 把中文工具描述原样交给英文 agent。这是不是问题取决于产品意图，列在这里备查。

**方案**：根 README 的 agent 段落删到只剩一句话，外加一个指向 INSTALL.md（或 npm README）的链接，按 deletion test 它本就不该是第五份。SKILL.md 的 flag 拼写由别名表对账（与 `--limit` 同一个测试）。结果形状的描述并进 #5 的黄金契约。`CONTEXT.md` 补上 pairing token 一词，并订正 npm registry 那一句。

**收益**：手写副本从五份降到三份，而且剩下的全部有守卫。

---

## 14. 【低】`BridgeServer` 的独立监听形态与 `onPeerReady` 只有测试在用

**文件**：`packages/favbase/bridge-server.ts`、`packages/favbase/daemon.ts`、`packages/favbase/bridge-server.test.ts`、`docs/adr/0003`

**问题**：生产中 `BridgeServer` 只有一种用法：挂在 `Daemon` 的 HTTP server 上。但它还保留着第二种形态，也就是自己监听端口：`start()` 的后半段、`port` 选项、`listeningPort`，以及把 EADDRINUSE 翻译成 `BridgePortInUseError`（与 `daemon.ts` 里的翻译重复了一遍）；另外还有 `onPeerReady`。删掉独立形态与 `onPeerReady`，生产行为零变化，唯一的调用方是 `bridge-server.test.ts`。这是典型的「一个 adapter = 假想的 seam」：第二个 adapter 只为测试存在。ADR 0003 Consequences 写着「`onPeerReady` 仍保留给 `/status?wait=1`」，与代码不符：`/status?wait=1` 走的是 `listTools` → `waitForPeer`（`rpc-server.ts:172-179`）。

**方案**：删掉独立监听形态与 `onPeerReady`；测试自己 `createServer()` 再把 `BridgeServer` 挂上去，走与生产相同的路径。端口占用只在 `Daemon` 里翻译一次。ADR 0003 那一句订正。

**收益**：`start()` 只剩单一路径；`BridgeServer` 的 interface 少三项；测试覆盖的就是生产形态。

---

## 15. 【低】两个小特判

**文件**：`packages/favbase/cli-main.ts`、`packages/favbase/skill-install.ts`

**15a. `--dir` 的第二套错误模型**：`installAgentSkills` 逐个副本收集失败，`installSkill` 却直接抛出。`runInstallSkill` 为此做了特判：`--dir` 分支手工包成 `{ written, failures: [] }`（`cli-main.ts:413-415`），失败时 stdout 什么都不打印。这与按 agent 安装时「先打印已写入的，再逐条报失败」的形状不一致，`packages/favbase/CLAUDE.md` 还要专门用一句话解释这个例外。**方案**：`--dir` 也返回同一种结果形状，`runInstallSkill` 只剩一条路径。

**15b. `reportFailure` 回头嗅探 argv**：`reportFailure` 从原始 argv 重新判断「这是不是 `daemon run`」，以决定 stderr 要不要加时间戳（`cli-main.ts:521`），而 `plan` 早就知道命令是什么。**方案**：`plan` 产出的命令自带 stderr 格式，运行期失败由命令自己决定格式。注意 `parseArgv` / `plan` 阶段的 `UsageError` 发生在命令对象存在之前，所以嗅探只会缩小到「解析期失败」这一种情况；也可以接受 `daemon run` 的解析期错误不带时间戳，因为自启的 daemon 用的是固定 argv，永远走不到这里。宜并入 #2 一起做。

---

## 16. 【低】扩展端连接 module 的 interface 过宽，把顺序规则推给调用方；存储 facade 泄漏、有死状态

**文件**：`lib/agent-bridge/client.ts`、`lib/agent-bridge/scheduler.ts`、`lib/background/agent-bridge-handlers.ts`、`lib/storage/agent-bridge.ts`、`lib/storage/index.ts`

**问题**

- `tryConnect` 只要已有连接就什么都不做（`client.ts:144`），从不拿 `connection.config` 与最新配置比较。「活着的 socket 与当前端口/token 一致」这条不变量，因此要靠 scheduler 在 `tryConnect` 之前先 `close('config-changed')` 来维持（`scheduler.ts:72`）。
- 「是否启用」检查了两遍（`scheduler.ts:66-70` 与 `client.ts:180-183`）。第二遍之所以存在，是因为 alarm 监听器直接调 `client.tryConnect`（`scheduler.ts:79-85`），绕过了 startup、config-watch、connect-now 三条路径共用的串行 `queue`（`:49-59`）。
- `AgentBridgeClientOptions` 有 10 个注入项；状态的每次更新都是跨 await 的读改写（`patchStatus` `:444-447`），这正是 #7 的根源。
- connect-now 是一串 pass-through：页面 → 消息 schema → 路由 → `agent-bridge-handlers.ts`（一行 `await ctx.connectAgentBridge()`）→ `BackgroundContext` 字段 → `scheduler.connectNow`。按 deletion test，删掉 handler 文件只是把一行挪进 `routes.ts`。它的存在是因为仓库惯例「一消息一 handler」，可以接受。
- `agent-bridge-handlers.test.ts` 断言「scheduler 失败会传播」，但 `enqueueRefresh` 吞掉了所有错误，`connectNow` 在生产中永远不会 reject：这个测试覆盖的是一条不存在的路径。
- 存储：`lib/storage/agent-bridge.ts:48-56` 定义的原始 `storage.defineItem`，经 `lib/storage/index.ts` 再导出，违反 `lib/storage/CLAUDE.md`「UI 与 scheduler 只能用 typed API」的规定（生产中没有使用者）。config 没有 normalizer（status 有），以后给 config 加字段，旧记录读回来会是 `undefined`。`tokenCreatedAt` 由设置卡写入，**全仓库无人读取**，是死状态。

**方案**

- 更深的 interface 是一个 `client.reconcile(config)`：自己负责「配置变了就先关再连」与启用检查，alarm 也经同一个队列进来。
- 状态写入收成一个串行的 `updateStatus(fn)`。
- 删掉原始 storage item 的再导出与 `tokenCreatedAt`，并给 config 补 normalizer。
- 删掉那个测不存在路径的用例，或者改成测真实行为（错误被记录、不抛出）。

**收益**：scheduler 变薄；#7 这一类交错问题从结构上消失；少一份死状态。

---

## 17. 【低】工具调用无法取消；bridge 对结果的 JSON 约束比 Chat 严；`sendToolError` 吞掉发送失败

**文件**：`lib/agent-bridge/tool-registry.ts:87-91`、`lib/agent-bridge/client.ts`（`handleToolCall` / `sendToolError`）、`lib/agent-bridge/protocol.ts`

**问题**

- **取消**：协议没有 cancel 消息。daemon 的 60 s 超时、CLI 的 Ctrl-C 与 120 s 超时，都不会让扩展停下，远程 embedding 请求照样跑完；迟到的 `tools.result` 被 daemon 静默丢弃（`bridge-server.ts:431-432`）。`callTool` 没有传 `abortSignal`，`toolCallId` 还是常量 `agent-bridge:${name}`。
- **JSON 约束**：结果发送前要过 `jsonValueSchema`（`protocol.ts:26-35`）。含 `undefined` 值、`Date`、`NaN` 的对象会失败（探索 agent 用 zod 4.4.3 实测过），而 Chat 经 AI SDK 会直接 JSON 序列化这些值（丢掉 `undefined`）。今天的工具只返回数据库的 null，没问题；将来某个工具写出 `{ foo: maybe }`，就会在 Chat 里正常、在 Bridge 上报 `execution-failed: Knowledge Tool returned a non-JSON result`。没有测试把真实 `chatTools` 的输出过一遍 `encodeAgentBridgeMessage`。
- **`sendToolError`**：丢弃了 `sendInput` 的返回值。错误消息超过 50k 字符时编码失败，什么都没发出去，daemon 要等满 60 s。

**方案**

- 发送前先 `JSON.parse(JSON.stringify(result))` 归一化，与 Chat 的序列化语义对齐。
- 错误消息截断到上限以内。
- 取消语义留给 #5 的协议演进（加 `tools.cancel` 属于新消息类型，受兼容规则约束）；在那之前，工具内部的远程调用至少要受工具期限约束（见 #11 的 embedding 超时）。

---

## 附录 A：考虑过但不列入 / 已推迟

写在这里，免得下一次体检重复提出。

- **四个 errno 判定 helper**（`config.ts` 的 `isMissingFile`、`skill-install.ts` 的 `isMissing`、`bridge-server.ts` 的 `isPortInUseError`、`daemon-client.ts` 的 `hasErrno`）。它们的语义各不相同（ENOENT / ENOENT+ENOTDIR / EADDRINUSE / 任意码），合并的收益低于成本。
- **`cli-main.ts` 576 行**。体量本身不是问题；#2、#3 完成后，doctor 与退出码分类会移出去，剩下的 dispatch 与命令实现合在一个 module 里是合理的。
- **`stopDaemon` 按未鉴权的 `/health` 报告的 pid 结束进程**。同一用户的本地进程本来就能结束该用户的任何进程；跨用户时 `process.kill` 抛 `EPERM`，已作为 #2 的活实例列出。#6 若选 D9-a，`/health` 的身份声明也会随 challenge-response 一起变得可验证。
- **设置卡 519 行**。它同时管配置持久化、token 生成、状态展示和复制，但每一块都薄，没有发现跨块耦合带来的具体 bug，不列。
- **`missing-token` / `invalid-port` 两个状态实际几乎不可达**（设置卡在开启时就生成 token，也拒绝非法端口；只有 storage 损坏或越界的 `VITE_AGENT_BRIDGE_PORT` 能触发）。它们作为防御性状态保留是合理的，在 #9 的联合类型里照留。
- **旧 docs/30 附录 A 的「扩展线协议全是 `z.strictObject`」**：已升级为本文 #5，不再是推迟项。

## 附录 B：本次没有覆盖或没有验证的部分

- **未实机复现**：#7 的竞态（代码可见；docs/24 §9.4 的实验说明它不是必现）、#8 的冷启动是否真会超过 30 s、#1 里 Windows 上 `process.kill` 之后端口释放的时序、#4 里 `npx skills add` 的实际落盘位置。
- **扩展端**：`client.ts` 除了 reject/close 与退避之外的状态机细节、`scheduler.ts` 的 alarm 钳制行为与 SW 保活，都需要真 Chrome 才能确认。docs/27 Step 5 的实机 E2E checklist 仍未执行，本文所有跨端场景都是按代码路径推导的。最容易实机验证的是 #1：重置 token → setup → doctor。
- **Knowledge Tool 本身**：检索质量、打标与 coverage 的计算不在范围内；#12 只讨论失败语义。
- **行号**：本文亲自读过的行写了 `:NNN`；只来自探索 agent 的位置，一律按符号名引用。代码改动后，以符号名为准。
