# Favbase 架构体检报告

日期：2026-08-17  
代码基线：`main@b49ada8`

## 结论

品味评分：**凑合**。

代码已经形成 Collection Item、Processing Coverage、Pipeline Run、Conversation 等可用域语言，也有若干正在变深的 Module；但关键不变量仍散落在调用方。最严重的不是文件数量，而是两个所有权漏洞：Settings 进入系统时没有 canonicalization，Conversation 的异步运行没有绑定所属会话。前者允许不完整配置覆盖本地可信状态，后者允许旧运行改写新会话状态。

不要做全仓目录重排。那只会制造 diff，不会增加 Depth。正确顺序是先把关键不变量收进已有调用链上的 Seam，再删除重复和死 Interface。

## 假设、盲区与范围

- 本报告只审计当前源码、配置、测试、`CONTEXT.md` 和 Trellis 任务状态。
- 按明确要求，**没有读取或引用任何审计前已存在的 `docs/**/*.md`**；因此也没有用历史 ADR 为候选背书或否决候选。
- 没有生产遥测、故障样本、数据规模和用户操作回放。实际发生频率均为 `[UNKNOWN]`，严重度按可达调用链、持久化破坏面、跨 Module 扩散和测试缺口判断。
- Trellis 任务存在不代表代码已修复。任务只用于标注已有所有者，技术判断仍以当前代码为准。
- 本轮只做架构体检，不定义具体 TypeScript Interface，不修改运行时代码。

## 验证记录

- `pnpm compile`：通过。
- `pnpm test`：独立最终复跑通过，121 个测试文件、930 项测试全部通过。
- `pnpm exec vitest run lib/bilibili/transcribe-utils.test.ts`：单文件复跑通过，6 项测试全部通过。
- 一次把 `compile` 与全套测试并行执行的验证中，
  `lib/bilibili/transcribe-utils.test.ts:137` 超过 5 秒预算，未结算任务随后把
  `BV-CONCURRENT` 事件泄漏到下一用例。单文件和全套独立复跑均未重现，是否会在 CI
  负载下稳定发生为 `[UNKNOWN]`。因此它不升级为生产架构发现；但该测试的超时清理并不
  完整，后续修改异步处理链时应补 settle/cleanup 约束。

## 严重度定义

| 等级 | 判定标准 |
| --- | --- |
| 严重 | 可污染持久化状态、串写用户数据或让核心配置失去可信不变量 |
| 高 | 当前调用链已出现语义漂移，或跨运行上下文的协议缺少运行时保护 |
| 中 | 当前功能大体可用，但修改扩散、调度语义或重复状态机显著增加回归概率 |
| 低 | 无直接运行时破坏，但持续占用理解和测试成本 |

## 问题总览

| 排名 | 严重度 | 问题 | 核心判断 |
| ---: | --- | --- | --- |
| 1 | 严重 | Settings 没有 canonicalization Seam | 远端任意对象可被强转并覆盖本地配置 |
| 2 | 严重 | Conversation 异步运行没有会话所有权 | 旧 stream/load 可修改新会话并再次持久化 |
| 3 | 高 | Collection pipeline eligibility 缺少 Locality | Coverage、Tags 与 Embedding 对同一 Item 的资格判断不一致 |
| 4 | 高 | 跨 runtime message 只有 TypeScript 类型，没有运行时协议 | 页面桥、Background 和 Offscreen 都信任未经解码的数据 |
| 5 | 高 | 远程平台 HTTP Adapter 没有请求 deadline | 一个不结算的 fetch 可永久占用 Pipeline Run |
| 6 | 中 | 手动同步与 daily auto-sync 重复平台编排 | X 已出现持久化副作用漂移 |
| 7 | 中 | Pipeline Run 调度策略泄漏在多个 Module | collision、retry、queue、gate 由三套状态共同决定 |
| 8 | 中 | 平台知识散落在多个注册表 | 新增平台需要横切修改路由、卡片、统计、任务和 onboarding |
| 9 | 中 | 公共 barrel 的 runtime Interface 不安全 | 纯调用方必须知道隐藏的 storage/DB 加载副作用 |
| 10 | 中 | Bookmarks 复制 Collection Library 状态机 | 共享 Module 的 Leverage 没有覆盖一个真实平台 |
| 11 | 低 | Embedding 暴露无生产调用的兼容 Interface | 代码和测试维护了一条不存在的生产调用链 |

## 1. 严重：Settings 没有 canonicalization Seam

### Files

- `lib/storage/settings.ts:6-59`：`UserSettings` 把全部字段声明为已可信。
- `lib/storage/settings.ts:86-89`：`storage.defineItem<UserSettings>` 只有静态泛型和 fallback，没有运行时 normalize。
- `lib/storage/settings.ts:107-134`：迁移只处理旧 ASR 字段。
- `lib/sync/sync-schema.ts:19-38`：远端 `settings` 只校验为任意 record，随后强转为 `RemoteConfig`。
- `lib/sync/sync-engine.ts:85-100`：pull 路径把远端对象强转为 `UserSettings` 并直接覆盖本地。
- `lib/storage/resolve.ts:43-48`、`lib/hooks/useSettings.ts:61-65`：消费者直接索引 `providerApiKeys`、`providerModels`。
- `lib/sync/sync-schema.test.ts:5-8`：测试明确接受只有 `{ provider: 'openai' }` 的不完整 Settings。

### 调用链

`WEBDAV_SYNC_NOW` -> `doSync` -> `syncConfig` -> `parseRemoteConfig` -> `settingsStorage.setValue(remoteSettings)` -> Settings/LLM/ASR/Embedding 消费者。

### Problem

TypeScript 泛型不是运行时验证。当前 WebDAV envelope 拒绝垃圾 JSON，却接受缺失字段、非法 provider、错误数值和旧版本形状，然后用强转绕过编译器。下一步消费者依赖完整 record；至少 `providerApiKeys[providerId]` 和 `providerModels[providerId]` 在字段缺失时可直接抛错。

这还让迁移语义分裂：本地启动只迁移一组旧 ASR 字段，远端导入不经过同一个迁移路径。Settings 的 Interface 实际要求每个调用方知道“数据来自哪里、是否旧版本、哪些字段可能缺失”，这是典型 Shallow Module。

### Solution

深化 Settings Module。把本地读取、WebDAV 导入和迁移收进同一个 Seam；该 Module 对外只暴露 canonical Settings：完成版本识别、默认值补全、枚举和数值验证、受控迁移。非法远端配置不得覆盖最后一份可用本地配置，错误必须以可诊断结果返回。

不要只把 `DEFAULT_SETTINGS` 移到另一个文件。移动常量不建立不变量，也不增加 Depth。

### Benefits 与测试

- **Locality**：Settings 形状、迁移和错误策略集中在一个 Implementation。
- **Leverage**：React、Background、LLM、ASR、Embedding 和 WebDAV 不再各自防御缺字段。
- **测试 Surface**：通过 Settings Interface 覆盖缺字段、未知字段、旧版本、非法 provider、错误数值、远端畸形值和幂等迁移；删除“强转后假装完整”的测试。
- 必须增加兼容性夹具，证明旧本地数据和旧远端数据仍能得到与当前默认策略一致的 canonical 结果。

### Deletion test

删除当前 `defineItem<UserSettings>` 的类型包装后，运行时验证行为基本不变：数据仍原样进出 storage。它没有隐藏复杂度，说明当前 Interface 太浅。

### 活动任务覆盖

`07-10-refactor-centralize-all-default-values-into-lib-storage-defaults-module`（`planning`）只明确覆盖默认值集中；它没有覆盖运行时验证、版本迁移和 WebDAV 导入。只能算部分相关，不能关闭本问题。

## 2. 严重：Conversation 异步运行没有会话所有权

### Files

- `entrypoints/app/sections/chat/use-chat-agent.ts:271-276`：当前 Conversation、消息、draft、source 和 abort 都保存在共享 mutable refs。
- `entrypoints/app/sections/chat/use-chat-agent.ts:324-340`：`persistActive` 在执行时读取“此刻的”refs，没有捕获启动运行时的 Conversation 快照。
- `entrypoints/app/sections/chat/use-chat-agent.ts:366-390`：切换只 abort 旧 stream；异步 load 没有 generation 或 stale-result guard。
- `entrypoints/app/sections/chat/use-chat-agent.ts:395-415`：删除活跃 Conversation 时，先等待数据库删除和列表刷新，之后才间接 stop。
- `entrypoints/app/sections/chat/use-chat-agent.ts:452-555`：旧 stream 的 success、abort、catch 和 finally 都继续修改共享 refs 与 React state。
- `entrypoints/app/sections/chat/chat-view.test.tsx:29-30`：View 测试整体 mock `useChatAgent`；没有 hook 级并发测试。

### 调用链

Conversation A `send` -> `createChatStream(A)` -> 用户切换/删除 -> load Conversation B -> A 的 stream/abort handler 继续写共享 refs -> `persistActive()` 读取 B 的当前 id 和消息。

### Problem

Abort 是请求，不是结算屏障。代码没有证明旧 stream 在新 Conversation 装载前已经停止，也没有把 stream 结果绑定到启动时的 Conversation id。快速 A -> B -> C 切换还存在 load 乱序：较慢的 A/B load 可以在较新的选择后覆盖 state。

最坏结果不是一个错误提示，而是 Conversation 串写：旧响应进入新 Conversation，已删除 Conversation 被后续异步路径重新保存，或旧 finally 清空新运行的 UI 状态。实际生产发生频率为 `[UNKNOWN]`，但调用链在当前代码中可达。

### Solution

深化 Conversation runtime Module。每次 stream/load/delete 必须携带不可变的运行身份和所属 Conversation 快照；只有仍拥有当前运行权的结果才能提交 state 或持久化。React hook 只订阅状态并发出命令，不再充当数据库协调器、stream 状态机和会话所有者的混合 Implementation。

不要按行数把 hook 拆成多个文件。共享 refs 不变，竞态就不变。

### Benefits 与测试

- **Locality**：Conversation 的切换、取消、删除、持久化和 stream 结算规则集中。
- **Leverage**：View 不需要知道 abort 时序和 stale-result 规则。
- **测试 Surface**：通过 Conversation runtime Interface 测快速 A -> B -> C、stream 中删除、abort 后持久化、load 乱序、旧 finally 不得清理新运行。
- View 测试继续只验证渲染；并发正确性不再依赖整体 mock 后的假状态。

### Deletion test

当前 hook 本身有 Depth：删除它会把大量复杂度推回 View。问题不是“hook 不该存在”，而是它内部缺少运行所有权 Seam。应深化，不应机械拆散。

### 活动任务覆盖

未发现标题或范围直接覆盖该问题的活动 Trellis 任务。

## 3. 高：Collection pipeline eligibility 缺少 Locality

### Files

- `lib/collections/downstream-eligibility.ts:8-21`：Bilibili `attr != 9` 是唯一平台特殊资格规则。
- `lib/collections/processing-coverage.ts:35-69`：Processing Coverage 使用该规则。
- `lib/tagging/tagging-service.ts:183-199`：Tags backlog 使用该规则。
- `lib/embedding/indexing.ts:573-588`：Embedding backlog 只检查 platform、`chunked` 和 chunk 存在，漏掉资格规则。
- `lib/tagging/tagging-service.test.ts:421-434`：测试明确锁定 Bilibili `attr=9` 不进入 Tags 的契约。
- `lib/database/entities/items.ts:18-31`：生命周期是 text + SQL check；状态写入散落在 ingest、bookmarks、Bilibili 和 embedding。

### 调用链

`startCollectionProcessingJobs` -> `embedPlatformBacklog` -> 查询所有 `chunked` Item；同一页面的 `getProcessingCoverage` 却从 total 排除不合资格 Item，`tagPlatformBacklog` 也会排除它。

### Problem

同一 Collection Item 在三个 pipeline 视图中有三种事实来源。现在共享 helper 只被 Coverage 和 Tags 使用，Embedding 自己重写候选 SQL。结果是 UI 可以认为某 Item 不属于 Embedding total，而后台仍尝试向量化它。

`attr=9` 且已有 chunks 的真实存量是否存在为 `[UNKNOWN]`；但测试已经把“不合资格 Item 不应进入下游”定义为现行契约，Embedding 明确违反该契约。

### Solution

深化 Collection processing policy/lifecycle Module。每个 stage 的候选资格、允许状态转换和 Coverage 聚合必须来自同一个 Implementation；各 pipeline Adapter 只执行其 stage，不再复制候选规则。

不要继续给第三条 SQL 手工补一个条件后结束。那只能修当前症状，下一个平台特殊规则还会再次漏接。

### Benefits 与测试

- **Locality**：Collection Item 的 stage 资格和状态转换只在一处定义。
- **Leverage**：Coverage、Embedding、Tags 共享同一事实，新增平台规则不再修改三条查询。
- **测试 Surface**：用同一组 fixture 对 Coverage、Embedding、Tags 做契约测试；至少覆盖 Bilibili `attr=9`、无 chunks、`no_content`、`error` 和已完成状态。

### Deletion test

删除当前 `downstream-eligibility` 后，只需把一条 SQL 搬回两个调用者，Embedding 甚至不受影响。复杂度不会在全部消费者重现，说明它仍是 Shallow Module。

### 活动任务覆盖

未发现直接覆盖该问题的活动任务。`07-02-embedding-consumer-chunk-index-search` 与 Embedding 有关，但当前代码仍保留分裂的资格判断。

## 4. 高：跨 runtime message 只有 TypeScript 类型，没有运行时协议

### Files

- `lib/bilibili/messaging.ts:11-36`：Main World 与 Isolated World 通过 `window.postMessage` 通信，只检查 source 和 type 后就强转 payload。
- `entrypoints/bilibili-video.content/hooks/useSubtitle.ts:93-100`：未经验证的字幕 payload 直接进入处理链。
- `lib/bilibili/subtitle-processor.ts:43-48`：畸形 text/content 可在 `.replace()` 处抛错。
- `lib/background/messages.ts:26-41`：Background 请求只是 TypeScript union。
- `entrypoints/background.ts:100-133`：运行时输入直接标注为 `BgMessage`，未经 decode 就读取 `msg.type` 并分发。
- `lib/offscreen/main.ts:9-37`：Offscreen listener 同样直接信任 `OffscreenRequest`。
- `lib/bilibili/transcribe-utils.ts:68-80`：status listener 强转后直接调用 `videoId.toLowerCase()`。
- `entrypoints/bilibili-video.content/hooks/useTranscribe.ts:99-104`：响应强转为 `TranscribeResponse`。
- `entrypoints/bilibili-video.content/hooks/useSummary.ts:121-137`：响应强转为 `SummaryResponse`。
- `entrypoints/app/sections/settings/webdav-sync-card.tsx:90-103`：WebDAV 响应强转为 `SyncResult`。
- 仓库没有 Bilibili message、Background dispatcher 或跨 runtime 协议拒绝测试；现有测试主要覆盖单个 handler。

### 调用链

页面脚本 -> `window.postMessage(unknown)` -> Content Script listener -> subtitle processing/cache。  
Content Script/App/Offscreen -> `runtime.sendMessage(unknown)` -> Background/Offscreen listener -> switch dispatcher -> handler -> `Promise<unknown>` -> 客户端强转后读取字段。

### Problem

消息跨运行上下文后，静态类型已经失效。当前发送方、dispatcher、handler 响应各自持有一部分协议知识，没有任何 Module 对请求和响应的运行时形状负责。未知消息被静默忽略；畸形已知消息会把错误推入 handler 深处；畸形响应则在 UI 处以无关异常暴露。

Bilibili 页面桥的风险更直接：同一页面内任意脚本都能发送相同 type，Content Script 只验证 `event.source === window`。伪造字幕可触发缓存污染或异常；超大 payload 还没有大小限制。页面中是否存在实际恶意脚本为 `[UNKNOWN]`，但消息可伪造是当前 Implementation 的事实。

浏览器升级期间旧 Content Script 与新 Background 共存时的实际失败频率为 `[UNKNOWN]`，但当前 Interface 没有版本或兼容策略。

### Solution

把每个跨 runtime Seam 加深为协议 Module：集中请求/响应 schema、运行时 decoder、发送者能力、payload 上限、route table 和 typed client Adapter。dispatcher 只接收 decoder 产出的可信消息；客户端只接收校验后的结果。未知 type、非法 payload 和 handler 失败必须有一致错误语义。

不要创建一个横跨 page、Background、Offscreen 和 Database RPC 的全知协议 Module；这些 Seam 的信任模型不同，只应复用 decoder 和错误表达模式。

### Benefits 与测试

- **Locality**：新增消息或改变字段只修改所属协议 Implementation 和对应 handler Adapter。
- **Leverage**：所有 Content Script/App 调用者共享验证、错误格式和兼容策略。
- **测试 Surface**：每个 message type 做请求、响应、非法 payload、超大数组、unknown type、错误 sender 和 handler rejection 的 table-driven contract test；dispatcher 不再只能靠端到端手测。

### Deletion test

删除 `lib/background/messages.ts` 或 `lib/bilibili/messaging.ts` 后，运行时发送和分发仍可照常执行；只会失去编译期提示。它们没有控制真实协议行为，是典型 Shallow Module。

### 活动任务覆盖

`06-24-refactor-harden-database-rpc-bridge-serialization-timeout-transaction-pending-cleanup`（`planning`）处理 Database RPC bridge，是相邻问题，不覆盖 browser runtime messages；两者不能合并成一个无差别“大协议重构”。

## 5. 高：远程平台 HTTP Adapter 没有请求 deadline

### Files

- `lib/github/github-api.ts:174-230`：三个生产 `fetch` 没有 signal/deadline。
- `lib/youtube/youtube-api.ts:288`、`lib/zhihu/zhihu-api.ts:411`、`lib/x/x-api.ts:499`：各平台请求没有 signal/deadline。
- `lib/bilibili/bilibili-api.ts:85-242`：六个生产 `fetch` 没有 signal/deadline。
- `lib/bookmarks/bookmark-page-fetch.ts:96-101`：唯一已有的 deadline 先例，使用 `AbortSignal.timeout(FETCH_TIMEOUT_MS)`。
- `lib/collections/cooperative-checkpoint.ts:1-23`：cooperative control 只在工作项之间 checkpoint，无法终止已进入的 `fetch`。
- `entrypoints/app/hooks/background-jobs-store.ts:198-223`：runner Promise 结算后才把 Pipeline Run 标为 completed/failed。

### 调用链

Collection Fetch Pipeline Run -> 平台分页循环 checkpoint -> platform HTTP Adapter `fetch` -> 请求不结算 -> runner Promise 不结算 -> job 永久保持 running -> 后续 content/Embedding/Tags 无法正常收尾。

### Problem

精确检索六组平台目录得到 13 个生产 `fetch` 入口；只有 Bookmarks 页面抓取的一处设置 timeout，其余 12 处没有截止时间，也没有与 Pipeline Run control 合并的 abort signal。

checkpoint 只能阻止“领取下一项工作”，不能让已经进入网络 I/O 的 Implementation 收敛。暂停按钮、路由切换和 job store 都无法修复一个永不 resolve 的底层请求。实际网络挂死频率为 `[UNKNOWN]`，但状态没有收敛上限是确定事实。

### Solution

建立负责请求预算、deadline、abort 合并和一致 timeout 分类的深 HTTP execution Module；平台 Adapter 继续拥有认证、分页、响应解释和 rate-limit 语义。不要创建一个仅转发 `fetch` 的假 Seam，真实价值是统一执行策略。

### Benefits 与测试

- **Locality**：deadline 和中止策略只在一个 Implementation 修改。
- **Leverage**：一次实现覆盖当前 12 个遗漏和后续平台。
- **测试 Surface**：在 HTTP execution Interface 上用永不 resolve 的 Adapter 验证 deadline 与主动 abort；平台测试只验证 timeout 到领域错误的映射。

### Deletion test

删除任一平台 HTTP Adapter 会让认证、分页和错误分类散回调用者，说明平台 Module 本身有 Depth。缺失的是所有 Adapter 共同使用的执行策略 Seam；逐文件补常量只会继续复制。

### 活动任务覆盖

未发现直接覆盖全平台 HTTP deadline 的活动任务。Database RPC 的 request deadline 不覆盖浏览器 `fetch`。

## 6. 中：手动同步与 daily auto-sync 重复平台编排

### Files

- `entrypoints/app/hooks/auto-sync-registry.ts:45-136`：独立维护六个平台的 readiness、认证读取和 `runSync`。
- `entrypoints/app/sections/github-stars/use-github-stars.ts:113-153`：手动路径再次读取认证、同步并派发后处理。
- `entrypoints/app/sections/youtube/use-youtube-playlists.ts:103-122`：手动路径再次解析配置、同步并派发后处理。
- `entrypoints/app/sections/x/use-x-bookmarks.ts:109-140`：手动路径额外写 `xLastSyncStorage`、`lastInserted` 和 cooldown seed。
- `entrypoints/app/hooks/auto-sync-registry.ts:57-72`：X 自动路径没有上述副作用。
- `entrypoints/app/hooks/use-daily-auto-sync.test.tsx:13-14`：协调器测试 mock 掉真实 registry；真实 platform Adapter 与手动路径没有一致性测试。

### 调用链

手动：Collection page -> platform hook `syncFn` -> platform sync -> platform-specific side effects -> `startCollectionProcessingJobs`。  
自动：`useDailyAutoSync` -> `AUTO_SYNC_PLATFORMS.runSync` -> platform sync -> generic processing dispatch。

### Problem

触发策略确实不同，但平台同步语义不该复制。现在认证、进度、后处理和平台副作用分布在两条编排中，已经出现可见漂移：X 的自动同步不会更新手动路径使用的 “N new” summary，UI 可能继续显示上一次手动结果。

其余平台是否还有未发现的漂移为 `[UNKNOWN]`；结构本身保证了今后修改必须记得同步两处。

### Solution

每个平台保留一个真实 Sync Adapter，封装认证解析、领域同步、平台持久化副作用和需要共享的后处理结果；手动与 daily coordinator 都调用它。手动进度展示、daily readiness/节流和静默错误策略继续留在各自触发方，不要塞进平台 Adapter。

### Benefits 与测试

- **Locality**：平台同步成功意味着什么，只在一个 Implementation 中定义。
- **Leverage**：手动、daily 和未来其他触发器复用同一平台行为。
- **测试 Surface**：同一 Adapter 分别经 manual/auto coordinator 调用，断言持久化、processing 和平台副作用一致；触发策略仍单独测试。

### Deletion test

删除当前 auto registry 后，平台知识已经完整存在于页面 hooks，只剩 daily 触发器需要重建。registry 没有隐藏足够平台复杂度，Depth 不足。

### 活动任务覆盖

`07-20-x-fab-last-sync-status-panel-with-5min-cooldown`（`in_progress`）可能覆盖 X 的显示和 cooldown 症状，但不消除六个平台的双重编排。属于部分覆盖。

## 7. 中：Pipeline Run 调度策略泄漏在多个 Module

### Files

- `entrypoints/app/hooks/background-jobs-store.ts:48-68`、`:142-223`：维护 active job、settlement、progress 和 gate reader。
- `entrypoints/app/hooks/collection-processing-jobs.ts:177-190`：batch collision 后由调用方递归注册 retry。
- `entrypoints/app/hooks/collection-processing-jobs.ts:278-391`：streaming item 又维护独立 `streamLanes` queue、active、done、total。
- `entrypoints/app/hooks/library-gate.ts:145-158`：gate 依赖 import-time self-registration 和 storage watcher。
- `entrypoints/app/hooks/collection-processing-jobs.test.ts:44-68`：只证明两个相撞 batch 最终运行两次，没有定义三个以上碰撞的 coalesce/queue 语义。

### 调用链

平台 sync/transcription/extraction -> batch 或 stream enqueue -> `collection-processing-jobs` 自行选择 retry/queue -> `background-jobs-store.startJob` 再做去重和 born-paused -> import side effect 注入 library gate。

### Problem

调用者必须同时理解 job store 的 collision 返回值、settled promise、外部 queue 和 gate 初始化顺序。到底是 drop、coalesce、queue 还是 latest，不是 Interface 中的显式策略，而是控制流偶然形成的结果。

当前两个碰撞的行为有测试；三个并发 batch、batch 与 stream 相撞、gate 尚未注册时启动的行为没有完整契约。实际故障频率为 `[UNKNOWN]`。

### Solution

深化现有 Pipeline Run scheduler Module，不另起一套平行调度器。让 enqueue 时明确选择 drop/coalesce/queue/latest 策略，并由同一 Implementation 负责 gate、settlement、progress 和 lane 生命周期；Collection pipeline 只声明所需策略。

### Benefits 与测试

- **Locality**：并发与暂停语义集中，不再散落在 store、processing jobs 和 import side effect。
- **Leverage**：Fetch、Embed、Tags 以及 streaming/batch 共用一套可解释的调度行为。
- **测试 Surface**：围绕 scheduler Interface 覆盖三个并发 batch、batch + stream、born-paused、恢复、失败后的队列继续和初始化顺序。

### Deletion test

当前 `startJob` 通过 deletion test：删除它会让去重、settlement、gate 和 progress 在多个调用者重现。不要替换它；应把仍泄漏在外的 scheduling policy 收回去，让已有 Module 更深。

### 活动任务覆盖

未发现直接覆盖统一 scheduler policy 的活动任务。

## 8. 中：平台知识散落在多个注册表

### Files

- `lib/collections/platforms.ts:2-16`：持久化 discriminator。
- `entrypoints/app/collection-platform-registry.ts:18-36`：标题、图标和路径。
- `entrypoints/app/main.tsx:20-29`、`:68-79`：lazy page 与 route。
- `entrypoints/app/hooks/collection-job-platform.ts:7-18`：job namespace。
- `lib/collections/collection-analytics.ts:64-92`：Creator/Source 统计维度。
- `entrypoints/app/sections/collections/collection-item-card.tsx:18-25`：Card Adapter。
- `entrypoints/welcome/sections/platform-picker.tsx:24-41`、`entrypoints/welcome/landing.ts:8-12`：onboarding readiness 与提示。
- `entrypoints/app/sections/overview/overview-view.tsx:46-53`：平台颜色。
- `entrypoints/app/collection-platform-registry.test.ts:18-22`：只验证基础 registry 与 discriminator/path 对齐。

### 调用链

新增 Collection platform -> discriminator -> 数据 ingest/query -> route/page -> job namespace -> Card Adapter -> Collection Analytics -> navigation/onboarding -> visual metadata。

### Problem

`Record<CollectionPlatform, ...>` 能让部分映射在编译期补齐，但 route、lazy import、welcome 和跨入口资源不受同一个完整性检查控制。新增平台必须在多个目录回忆隐含清单；任何漏项都表现为局部功能缺失，而不是一个明确失败。

把所有内容塞进一个巨型 registry 也不对：那会把页面代码拉进 welcome bundle，并制造依赖环。

### Solution

深化 platform catalog Module，但按依赖方向分层：纯 domain manifest 保存 discriminator、job/analytics 等无 UI 事实；app 与 welcome 各自提供真实 Adapter。用一处完整性契约验证每个平台是否拥有所需 route、Card Adapter、统计和 onboarding 映射。

### Benefits 与测试

- **Locality**：平台能力清单有明确归属，入口专属实现仍留在正确位置。
- **Leverage**：新增平台时，一个失败的契约测试列出所有缺项，不靠人工记忆。
- **测试 Surface**：建立“新增平台完整性”测试，覆盖 route、job、card、analytics、navigation/onboarding；不要只测试 title/icon。

### Deletion test

删除现有 UI registry 只会让 title/icon/path 映射回到调用方；job、route、analytics、card 和 welcome 不受影响。它只覆盖平台概念的一小部分，仍然浅。

### 活动任务覆盖

- `07-17-youtube-liked-videos-platform`（`in_progress`）会再次经过这条横切路径，但任务标题不能证明它建立了 catalog。
- `07-26-fix-collections-sort-key-else-null-sinks-new-platforms`（`planning`）处理一个新增平台漏接症状，不覆盖根因。

## 9. 中：公共 barrel 的 runtime Interface 不安全

### Files

- `lib/collections/index.ts:1-24`：纯 discriminator 与 DB query/analytics/coverage 从同一 barrel 暴露。
- `lib/collections/collections-query.ts:1-8`：该导入图在模块顶层触达 Drizzle 和 database。
- `lib/embedding/index.ts:5-21`：barrel 同时暴露 AI provider 和 storage-backed config。
- `lib/embedding/config.ts:1-4`、`:90-96`：纯 resolver 与 `settingsStorage` 位于同一 Module。
- `lib/storage/index.ts:1-25`、`lib/storage/ui-state.ts:7-20`：根入口加载会执行多个 `storage.defineItem`。
- `lib/embedding/config.test.ts:6-15`：测试纯 resolver 也必须 mock storage。
- `lib/github/github-sync-service.ts:33-38`、`lib/ingest/ingest.ts:36-38`：生产调用方用注释提醒必须绕开 barrel 并使用 leaf import。

### 调用链

welcome/offscreen/纯单测 -> 需要 discriminator、type 或纯 resolver -> 根 barrel -> DB/storage/provider 顶层 import -> 调用方被迫具备本不需要的 runtime 能力，或手工绕到 leaf import。

### Problem

调用方必须知道 barrel 背后的加载图以及某个 runtime 是否具备 database、`chrome.storage` 或 provider 环境。这些隐含知识已经成为 Interface 的一部分。至少多个生产文件用长注释维护“不要从 barrel 导入”的规则；纯函数测试也必须 mock storage，说明 Seam 放错了。

当前主路径通过 leaf import 规避了多数事故，已发生的直接崩溃为 `[UNKNOWN]`。但公共入口默认不安全，下一次常规 import 就可能重新引入同类问题。

### Solution

按 runtime 能力深化公开入口：纯领域值和纯转换必须能在无 database、无 storage 的环境安全导入；storage-backed orchestration 和 DB query 从显式入口暴露。默认 Interface 应表达依赖能力，不能依靠调用方注释记忆加载陷阱。

### Benefits 与测试

- **Locality**：runtime 要求由入口和导入图表达，不再散落在调用方注释中。
- **Leverage**：welcome、offscreen、测试和未来 worker 共享可安全导入的纯入口。
- **测试 Surface**：增加 import-smoke 测试，在没有 `chrome.storage` 或未初始化 DB 时导入纯入口；纯 resolver 测试不再 mock storage。

### Deletion test

删除这些 barrel 后，许多调用方已经能用现存 leaf import 正常表达依赖，隐藏副作用约束反而减少。当前 barrel 是 Shallow Module；应缩小或按能力拆分，而不是继续追加导出。

### 活动任务覆盖

未发现直接覆盖公共 runtime import Surface 的活动任务。

## 10. 中：Bookmarks 复制 Collection Library 状态机

### Files

- `entrypoints/app/hooks/use-collection-library.ts:96-277`：已有 debounce、分页、query cancellation、meta、sync job、generation refresh、Embed/Tags job 状态。
- `entrypoints/app/sections/bookmarks/use-bookmarks.ts:57-215`：再次实现 debounce、分页、query cancellation、meta、sync job 和 generation refresh。
- `entrypoints/app/sections/bookmarks/use-bookmarks.ts:126-152`：Bookmarks 的真实特殊性是 mount auto-sync、extraction 链和 backlog dispatch。
- 测试只存在 `entrypoints/app/sections/bookmarks/use-bookmarks.test.tsx`；没有 `use-collection-library` 的直接状态机测试，也没有多数平台 hook 的 Adapter 测试。

### 调用链

GitHub/X/Zhihu/YouTube page -> platform Adapter -> `useCollectionLibrary`。  
Bookmarks page -> `useBookmarks` 自有状态机 -> 相同 DB/query/job primitives。

### Problem

共享 Module 已经承担四个平台，但 Bookmarks 因 folder route、mount sync 和 extraction 特例复制了大部分 Implementation。特殊策略与通用状态机缠在一起，使 debounce、取消、generation refresh 或错误处理的修复必须检查两套代码。

### Solution

深化现有 `useCollectionLibrary`，让 route facet、sync trigger policy 和 post-sync action 作为内部策略进入现有 Seam；Bookmarks 只保留 folder/extraction Adapter。不要再创建第三个“更通用”hook。

### Benefits 与测试

- **Locality**：分页、查询取消、sync generation 和错误状态只维护一份。
- **Leverage**：五个平台共享一次修复和一组状态机测试。
- **测试 Surface**：直接测试共享 Interface；平台测试只验证 Adapter 的 query mapping、触发策略和 post-sync 行为。

### Deletion test

删除 `useBookmarks` 后，大部分行为可以由现有共享 Module 重建，只剩少量平台策略；这说明重复没有隐藏独有复杂度。相反，删除 `useCollectionLibrary` 会在四个平台重现整套状态机，证明应深化它而不是替换它。

### 活动任务覆盖

未发现直接覆盖该重复状态机的活动任务。

## 11. 低：Embedding 暴露无生产调用的兼容 Interface

### Files

- `lib/embedding/indexing.ts:201-238`：导出 `persistItemChunks` 和 `indexItemChunks`。
- `lib/embedding/index.ts:37-38`：继续从 barrel 暴露两者。
- `lib/embedding/types.ts:1-4`：公共说明仍围绕 `indexItemChunks`。
- `lib/embedding/indexing.test.ts:75-336`：大量测试只覆盖 `indexItemChunks` 的 best-effort 路径。
- 全仓生产代码检索没有这两个导出的调用者；引用只存在于定义、barrel、注释和测试。

### 调用链

实际生产路径使用 `embedPlatformItem`、`embedPlatformBacklog` 和 rebuild；`persistItemChunks`/`indexItemChunks` 没有生产 caller。

### Problem

无 caller 的兼容路径保留独立错误策略、注释和大段测试，让维护者误以为有两套需要兼容的 Embedding 流程。它扩大 Interface，却不给调用者提供 Leverage。

### Solution

先删除死导出、只服务死入口的分支与测试，再围绕真实生产调用链评估 Embedding Module。不要为了保留“以后可能用”而继续深化不存在的 Seam。

### Benefits 与测试

- **Locality**：Embedding 的行为说明和测试回到真实 backlog/item/rebuild 路径。
- **Leverage**：更小的 Interface 减少调用者和维护者需要理解的错误策略。
- **测试 Surface**：删除死入口测试，把预算转移到 eligibility、失败继续、状态落库和真实 coordinator 契约。

### Deletion test

删除两项导出不会让复杂度在任何生产 caller 重现，deletion test 明确失败。它们是死 Interface，不是 Deep Module。

### 活动任务覆盖

`07-02-embedding-consumer-chunk-index-search`（`planning`）与此区域相关，但当前代码仍没有生产 caller；任务存在不能替代删除验证。

## 活动任务对账

| 任务 | 状态 | 本报告处理 |
| --- | --- | --- |
| `07-25-audit-codebase-architecture` | `in_progress` | 本报告所属任务 |
| `06-24-refactor-harden-database-rpc-bridge-serialization-timeout-transaction-pending-cleanup` | `planning` | Database RPC 已有明确所有者，不重复扩展为 Background message 问题 |
| `07-10-refactor-centralize-all-default-values-into-lib-storage-defaults-module` | `planning` | 只部分关联 #1；默认值集中不等于 canonicalization |
| `07-20-x-fab-last-sync-status-panel-with-5min-cooldown` | `in_progress` | 只部分关联 #6 的 X 症状 |
| `07-17-youtube-liked-videos-platform` | `in_progress` | 会触发 #8 的横切修改，但未证明解决 catalog 缺失 |
| `07-26-fix-collections-sort-key-else-null-sinks-new-platforms` | `planning` | 处理 #8 的一个症状，不是平台完整性契约 |
| `07-02-embedding-consumer-chunk-index-search` | `planning` | 关联 #3/#11；当前代码证据仍成立 |

## 建议执行顺序

1. 先处理 #1 Settings。它是多个 AI provider、平台连接和 WebDAV 的共同输入，兼容性测试必须先于重构。
2. 再处理 #2 Conversation。先写并发失败测试，再建立运行所有权；不要在没有失败测试时改异步状态机。
3. #4 先收紧不可信页面消息，再处理 Background/Offscreen；与 Database RPC 分开推进。
4. #5 必须一次覆盖全部平台请求入口，不能逐文件补 timeout 常量。
5. 将 #3 与 #7 作为同一 Collection pipeline 设计阶段的两个独立改动：先统一资格事实，再收回调度策略，避免一次大爆炸式重写。
6. #6、#8、#9、#10 属于平台扩展和 runtime 可导航性成本，应在继续新增平台前完成最小可行深化。
7. #11 可独立删除，风险最低，但删除前仍需确认没有仓库外消费者；仓库外消费者存在与否为 `[UNKNOWN]`。

下一步应从一个候选进入设计 grilling，而不是同时实现十一项。优先选择 #1 或 #2。
