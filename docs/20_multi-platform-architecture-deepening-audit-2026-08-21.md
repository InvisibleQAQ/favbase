# Favbase 多平台架构深化审计（修正版）

日期：2026-08-21；修订：2026-08-22（逐条回到源码复核 + 无 mock import 冒烟实证）
范围：当前工作树中的 `lib/`、`entrypoints/`、`tests/`、`wxt.config.ts`、目录级 `CLAUDE.md` 以及可执行检查。
目标：提高多平台实现的内聚性，降低平台之间和平台与入口之间的耦合；本报告只诊断和排序问题，不修改运行时代码。

## 修订摘要

2026-08-22 对初版 9 条发现逐条回到源码、git 历史和可执行检查复核。结论：**8 条属实，1 条（中-7）半过时；4 处关键事实错误**，导致严重度和实施顺序需要重排。编号保留作稳定标识，括号内标注修订后的严重度。

| 编号 | 初版严重度 | 修订严重度 | 修订要点 |
| --- | --- | --- | --- |
| 高-1 | 高 | 中 | 泄漏属实且已实证；但 offscreen 风险是虚的（当前 offscreen 不加载任何平台 sync），x 的 mock 证据是错引 |
| 高-2 | 高 | 中 | 清单属实；"分层 catalog" 方案大部分已是现状，实质差异只剩嵌套路由登记 |
| 高-3 | 高 | 中 | registry 反向 import 属实；"backlog 语义复制六份"是错的，语义已单一 owner |
| 高-4 | 高 | 高 | 属实且比初版更糟：`INVALID_ATTR` 的 owner 在 UI 层，领域层裸写字面量 |
| 中-5 | 中 | 中（但最先做） | `[UNKNOWN]` 可消：`persistContent` 零生产调用方，`startProcessingDirectly` 生产不可达 |
| 中-6 | 中 | 中 | 属实；初版漏了两个迁移会踩的行为差异 |
| 中-7 | 中 | 低 | `buildPipelineSegments` 自 2026-07-25 已存在，初版建议的 builder 已落地，剩余只是再抽一层 |
| 中-8 | 中 | 中 | 属实；与高-4 是同一个 bilibili owner 问题，应合并做 |
| 低-9 | 低 | 低 | 不变 |

## 结论先行

当前项目不是“每个平台都重复一套数据库事务”。这部分已经被 `lib/ingest/ingest.ts` 深化：事务边界、批量写入、去重、ghost 修复和两阶段内容写入已有单一实现。`lib/database/collection-queries.ts` 也已经统一分页查询和最后同步时间，`useCollectionLibrary`、`CollectionPageScaffold`、`background-jobs-store`、`collection-processing-jobs`（post-processing 的唯一 owner）、`pipeline-segments`（纯 pipeline builder）和跨 runtime 协议同样已经承担了有效的共享职责。

真正的结构问题集中在六类（按修订后严重度）：

1. 通用 Collection processing policy 反向知道 Bilibili 的 `attr=9` 规则；平台专属 eligibility 泄漏进共享 SQL，而 `INVALID_ATTR` 常量定义在 UI 层。（高-4）
2. Bilibili 转录领域层保留了一条生产不可达的 Embedding/Tagging 直连路径和一个零调用方的兼容函数，使 `lib/bilibili` 的 import 图被 storage 污染。（中-5，修复最便宜）
3. 运行时能力通过 barrel 隐式泄漏：zhihu/youtube/bilibili 三个 sync service 走 `@/lib/embedding` barrel，加载即触碰 `chrome.runtime`；x/github/bookmarks 走 leaf 则干净，但靠注释维持规则，且注释已过期。（高-1）
4. 全局 auto-sync registry 反向 import 六个 section 文件，并把 job namespace 手写第二遍。（高-3）
5. 书签页面复制了共享 Collection Library 状态机；Bookmarks/Bilibili 的 platformMeta 解码在 UI 裸读。（中-6、中-8）
6. 平台事实分散在 11 处 `Record<CollectionPlatform,…>` 表；契约测试已做 AST 对账，唯一未登记项是 `main.tsx` 的两条嵌套路由。（高-2）

方向纠偏：不要创建一个“万能平台 Module”吞掉 API、数据库、认证、UI、welcome 和 manifest。那会把平台专属知识重新集中到错误位置，降低 Locality。应当统一稳定骨架，保留平台专属 Adapter，并让每个 Adapter 只暴露小而明确的 Interface。

## 审计前提、盲区和方法

### 隐含前提

- 用户要求的是架构报告，不是本轮重构；因此没有修改 runtime source。
- “平台重复代码”指行为/编排重复和跨层知识泄漏，不把平台自然不同的 API、认证、游标、内容类型视为重复。
- `Collection Item`、`Source`、`Pipeline Run`、`Processing Coverage` 等术语以根目录 `CONTEXT.md` 为准。

### 盲区（修订）

- ~~仓库外是否有直接 import `lib/*` 的消费者为 `[UNKNOWN]`~~ → **已消**：本项目是浏览器扩展，非 monorepo，不存在仓库外 import `lib/*` 的消费者。删除公开导出只需仓库内 grep。
- ~~生产环境中 offscreen 直接加载哪些平台 sync Module 没有运行时 trace~~ → **已消**：静态可判。`lib/offscreen/` 非测试代码只 import `@/lib/database`、`@/lib/runtime-message`、`@/lib/subtitle`、`@/lib/transcription`，不加载任何平台 sync service。X sync 曾在 offscreen 运行（f641afc 2026-07-16 加入 `lib/offscreen/x-sync.ts`），d2c69b6 2026-07-20 已删除。
- 平台同步接口的真实线上错误率、用户新增第 N 个平台的频率没有埋点，严重度按代码扇出、失败影响和测试成本评估。

### 取证规则

- `docs/**/*.md` 的既有审计和历史报告不作为证据；它们只用于定位需要重新验证的候选。
- 每个结论都回到当前源码、测试、配置或命令结果。
- 对疑似浅 Module 使用 deletion test：删除它之后复杂度是否会在多个 caller 重新出现。
- 修订增加：对 import 图结论做可执行冒烟——在 vitest（happy-dom、无 `chrome` 全局、无任何 `vi.mock`）中逐模块单独进程 `import()`，统计加载期 `Cannot read properties of undefined (reading 'runtime')` 未处理错误数。

### 当前基线

- `pnpm.cmd compile`：通过。
- `pnpm.cmd test`：147 个测试文件、1107 个测试通过。
- 定向平台完整性、六个平台 Sync Adapter、书签 hook、共享 ingest 测试：10 个文件、54 个测试通过。
- 2026-08-22 import 冒烟（无 mock，单模块单进程）：

| 模块 | 加载期 `chrome.runtime` 未处理错误 |
| --- | --- |
| `@/lib/storage` | 7 |
| `@/lib/embedding`（barrel） | 7 |
| `@/lib/embedding/chunker`、`@/lib/embedding/char-split`（leaf） | 0 |
| `@/lib/collections`（barrel）、`@/lib/collections/platforms` | 0 |
| `@/lib/database`、`@/lib/ingest/ingest` | 0 |
| `lib/x`、`lib/github`、`lib/bookmarks` sync-service（leaf import） | 0 |
| `lib/zhihu`、`lib/youtube`、`lib/bilibili` sync-service（barrel import） | 7 |
| `@/lib/i18n` | 9（测试本身失败；不在本审计范围，同类问题） |

所有模块都能 resolve；错误是**异步未处理 rejection**，不是同步加载崩溃。vitest 会把未处理错误计为 run 失败，因此这种冒烟天然可做 contract。

这些结果说明当前行为基线是绿的；下面的问题是架构风险和变更成本，不是把现有绿灯伪装成故障。

## 严重度排序

严重度含义：

- **高**：会污染 runtime Seam、造成跨层故障，或新增平台必然触碰多个不相干 Module。
- **中**：不一定立即破坏用户，但会复制状态机/编排，扩大修复扇出并降低测试 Locality。
- **低**：主要是维护成本或潜在深化机会，当前没有足够证据证明应立即重写。

---

## 高-1（修订为中）：Embedding / Storage barrel 泄漏运行时能力

### 文件和证据（修订）

- `lib/embedding/index.ts`（65 行，初版行号 1-38 已漂移）同时 re-export provider、storage-backed config、indexing、vector store 和纯 chunker。
- `lib/embedding/config.ts:1-4` 导入 `settingsStorage`；`lib/storage/index.ts:1` 在 barrel 加载时导入 `settings.ts`，后者 `settings.ts:24` 模块级 `storage.defineItem`。
- `lib/zhihu/zhihu-sync-service.ts:49`、`lib/youtube/youtube-sync-service.ts:52`、`lib/bilibili/bili-sync-service.ts:16` 从 `@/lib/embedding` barrel 取 `charSplit`/`chunkSubtitleRows`；冒烟实证三者加载期各产生 7 个 `chrome.runtime` 未处理错误。
- `lib/x/x-sync-service.ts:41-46`、`lib/github/github-sync-service.ts:33-38`、`lib/bookmarks/bookmarks-sync-service.ts:40-42` 走 leaf import，冒烟实证干净；但三处注释都声称 "This sync runs in offscreen documents"——**已过期**（见盲区修订），github/bookmarks 的注释是从 x 抄的。
- `lib/zhihu/narrow-meta.test.ts:5`、`lib/youtube/narrow-meta.test.ts:5` 的 `vi.mock('@/lib/storage')` 是真需要的。**`lib/x/narrow-meta.test.ts:6` 的 mock 是冗余的**，其注释 "the service transitively imports @/lib/embedding + @/lib/tagging" 与现状不符（x 已走 leaf，不 import tagging）。初版把它列为"直接测试证据"属错引。
- `lib/collections/index.ts:1-26` 把纯 discriminator 与 DB query/analytics 从同一入口暴露。冒烟实证该 barrel **不触碰 storage**；它的问题是把 drizzle + `@/lib/database` 拖进 welcome.html 的静态 import 图（code-split），`entrypoints/app/collection-platform-registry.ts:1-6` 已用 leaf 规避并写明原因。这是 bundle 边界问题，与 storage 泄漏是两类，初版混为一谈。

### 问题

barrel 的 Interface 没有表达运行时能力要求。调用方必须知道某个 leaf 是否会触碰 `chrome.storage`；这些知识现在靠注释（且已过期）、测试 mock（且有冗余）和“导入路径记忆”维持。Deletion test 通过：删除宽 barrel 后，已有 leaf import 足以表达真实依赖。

修订后的风险评估：

- **当前 runtime 无故障**：所有平台 sync 的唯一调用方是 app.html 的六个 Sync Adapter（有 chrome.storage）；offscreen 不加载它们。
- 真实代价是测试层（纯 decoder 测试必须 mock storage）和未来 runtime（任何新 worker/offscreen 消费者都会踩）。
- 错误形态是异步未处理 rejection，不是同步崩溃；初版“业务错误处理根本没有机会执行”夸大。

### 深化方案（修订）

1. `zhihu-sync-service.ts:49`、`youtube-sync-service.ts:52` 改为 `@/lib/embedding/char-split` leaf；`bili-sync-service.ts:16` 改为 `@/lib/embedding/chunker` leaf（`embedPlatformItem` 的 import 随中-5 一并删除）。
2. 删除 x/github/bookmarks 三处过期的 "runs in offscreen" 注释，改为陈述真实规则：“lib 层平台 service 不得 import storage-backed barrel；守卫见 import-smoke contract”。
3. 删除 `lib/x/narrow-meta.test.ts:6` 的冗余 mock；zhihu/youtube 的 mock 在第 1 步后也可删。
4. 新增 `tests/lib-import-smoke.test.ts`：列出纯入口清单（六个 sync-service、`embedding/chunker`、`embedding/char-split`、`collections/platforms`、`ingest/ingest`、`database`），逐个 `import()`；依赖 vitest 对未处理错误的 run 级失败作为断言。六个 sync-service 用 `COLLECTION_PLATFORMS` 派生路径，新平台自动入围。
5. `@/lib/collections` barrel 的 DB 拖入问题单独处理：welcome/registry 继续 leaf，不扩大 barrel；不与 storage 泄漏混做。

### 收益和测试面

- **Locality**：runtime 能力要求由 import graph 和 contract 表达，不再散落在注释。
- **Leverage**：纯 decoder 测试零 mock；新平台只需通过 contract。
- **测试 Surface**：一个 contract 替代散落的防御性 mock。

### 处置（2026-08-22，已落地）

- 方案第 1-4 步完成：zhihu/youtube → `@/lib/embedding/char-split`，bilibili → `@/lib/embedding/chunker`（`persistContent` 随中-5 第 1 步一并删除，`embedPlatformItem` import 消失）；x/github/bookmarks 三处 "runs in offscreen" 注释改为陈述真实规则并指向 contract；`tests/lib-import-smoke.test.ts` 新增，用 `process.on('unhandledRejection')` 逐入口捕获、`vi.resetModules()` 保证归因到触发的入口，先红（bilibili/zhihu/youtube 各 7 条）后绿。
- 超出方案的一处：除 narrow-meta 三处外，x/zhihu/youtube 的 `*-sync-service.test.ts` 中同样防御性的 `vi.mock('@/lib/storage')` 也一并删除（contract 证明不必要）。
- 第 5 步（`@/lib/collections` barrel 的 DB 拖入）按原判断不动。中-5 第 2-3 步（`startProcessingDirectly` 删除、`startProcessing` 改必填）未做，`transcribe-utils.test.ts:49`、`auto-transcribe-adapter.test.ts:28` 的 storage mock 因此保留。

### 严重度理由（修订）

初版列最高优先级的前提是 offscreen 可能加载平台 sync；该前提已被静态证伪。剩余是测试卫生与未来风险，修复成本三处 import + 一个 contract，降为中。但因为它与中-5 共享一半改动，实施顺序仍靠前。

---

## 高-2（修订为中）：平台事实分散在多个注册表

### 文件和证据

同一个 `CollectionPlatform` 的事实分别位于（2026-08-22 逐处复核，行号准确）：

- `lib/collections/platforms.ts:2-11`：持久化 discriminator。
- `entrypoints/app/collection-platform-registry.ts:18-28`：标题、图标。
- `entrypoints/app/collection-platform-pages.ts:11-18`：lazy page。
- `entrypoints/app/main.tsx:23-24,71-72`：Bilibili `:mediaId`/Bookmarks `:folderId` 嵌套路由。
- `entrypoints/app/hooks/collection-job-platform.ts:7-14`：job namespace。
- `entrypoints/app/hooks/auto-sync-registry.ts:52-96`：readiness、Sync Adapter、silent error。
- `lib/collections/collection-analytics.ts:64-92`：analytics dimensions。
- `entrypoints/app/sections/collections/collection-item-card.tsx:18-25`：Tagged Item Card Adapter。
- `entrypoints/welcome/landing.ts:6-13`：welcome readiness。
- `wxt.config.ts:33-49`：host permissions。
- `entrypoints/app/theme/core/palette.ts:111-127`：品牌色。

`tests/platform-completeness-contract.test.ts:203-345` 已把上述清单做成 AST 对账，且是“一次失败列出所有缺项”（`it('reports every missing platform Adapter in one failure')`）。

### 问题（修订）

新增平台要同时理解 domain、app、welcome、manifest、analytics、cards、jobs、auto-sync、theme 和 env guard——扇出属实。但每层一个 adapter 是平台接入的**本质复杂度**（每层确实需要平台专属知识），不是结构缺陷；`Record<CollectionPlatform, …>` + AST contract 已经把“漏一张表”变成编译/测试期错误。

初版提出的“分层 platform catalog”与现状的实质差异，逐项对比后只剩：

- `main.tsx:71-72` 的嵌套路由没进 `collection-platform-pages.ts`，是唯一没被 `Record` 约束的平台事实。
- ~~契约错误列出缺失平台和缺失能力~~ → 已是现状。
- ~~domain manifest 不导入 React/storage~~ → `lib/collections/platforms.ts` 已是纯 leaf。
- ~~app catalog 由每平台提供 lazy page/card/adapter~~ → 三张表已存在。

初版的一个真实遗漏：`lib/collections/collection-processing-policy.ts:42` 的 `'bilibili'` 字面量不在契约清单内（归高-4）。

### 深化方案（修订）

1. `collection-platform-pages.ts` 的 `CollectionPlatformRoute` 增加 `childRoutes?: readonly string[]`，bilibili 登记 `':mediaId'`、bookmarks 登记 `':folderId'`；`main.tsx` 用 `flatMap` 展开，删除 71-72 两行特殊行。约 10 行。
2. 契约测试同步对账 `childRoutes`（可选，仅当未来第三个平台加嵌套路由时再补）。
3. 不做“分层 catalog”重构：它会把现有三张表重新命名搬家，没有消除任何 caller 复杂度。

### 严重度理由（修订）

当前 contract 已把风险压到“改动扇出大但不会静默漏项”。剩余改动 10 行，降为中。

---

## 高-3（修订为中）：auto-sync registry 反向 import section 目录

### 文件和证据（修订）

- `entrypoints/app/hooks/auto-sync-registry.ts:10-16` 直接 import 六个 `entrypoints/app/sections/*/*-sync-adapter.ts`。
- `auto-sync-registry.ts:54,59,71,77,85,91` 手写 `jobPlatform: 'github-stars'` 等六个值，与 `collection-job-platform.ts:7-14` 的 `JOB_PLATFORM_BY_COLLECTION` 是同一事实写两遍；`jobPlatformForCollection(itemPlatform)` 已能派生。
- 六个 Sync Adapter 各重复 `ITEM_PLATFORM`/`JOB_PLATFORM` 两行常量 + `startCollectionProcessingJobs({jobPlatform, itemPlatform, itemIds})` 一个调用：`github-sync-adapter.ts:8-9,75-79`、`x-sync-adapter.ts:9-10,47-51`、`zhihu-sync-adapter.ts:7-8,43-47`、`youtube-sync-adapter.ts:11-12,37-41`、`bookmarks-sync-adapter.ts:7-8,42-46`、`bilibili-sync-adapter.ts:11-12,62-66`。
- `use-collection-library.ts:245-250`、`use-bookmarks.ts:124-133` 手动触发和 `use-daily-auto-sync.ts:50-58` daily 触发引用同一 Sync Adapter，契约测试已验证。
- **初版错误**：“把 itemIds、backlog 语义、job namespace 和失败后的处理策略复制到六个文件”不成立。backlog/explicit-id 语义**只在** `entrypoints/app/hooks/collection-processing-jobs.ts:147-175` 定义一次（embed 总派发走 backlog、`ids.length === 0` 不派 tag）；adapter 复制的是一个 3 行调用，不是语义。初版验收指标“post-processing 的 backlog/explicit-id 语义只有一个 owner”**已经满足**。
- `runBilibiliSync`（`bilibili-sync-adapter.ts:39-43`）带第三个 `options` 参数，其余五个没有；`AutoSyncPlatform.runSync` 类型靠 TS 参数协变吞掉差异。

### 问题（修订）

剩余的真实问题只有两个：

1. 全局 hook 目录反向依赖 UI section 目录，平台接入必须改全局文件。
2. `jobPlatform` 手写重复。

### 深化方案（修订）

- `auto-sync-registry.ts` 用 `jobPlatformForCollection(itemPlatform)` 派生 `jobPlatform`，删除六处手写。
- 每个 `*-sync-adapter.ts` 额外 export 一个 `autoSyncPolicy: { probeReady, isSilentError? }`，registry 只做聚合。**聚合点不可消灭**——总要有一个文件 import 六个 adapter（dynamic import 或 side-effect 注册更糟）；只能把它从 `hooks/` 挪到 `sections/collections/` 或一个 `platform-adapters.ts`。初版“不再 import 六个 section 文件”做不到。
- 六个 adapter 的 `startCollectionProcessingJobs` 三行调用可以收成 `finishCollectionSync(itemPlatform, result.newItemIds)`，但收益约 6×4 行，可做可不做。
- 统一 runner 签名时处理 `runBilibiliSync` 的第三参数（把 `preferFolderId`/`onFolders` 放到手动页闭包里，不进 `AutoSyncPlatform.runSync`）。

### 严重度理由（修订）

行为已经一致、语义已单一 owner；剩余是依赖方向和一处重复表，降为中。

---

## 高-4（维持高）：Bilibili 的无效视频规则泄漏进通用 Collection processing policy

### 文件和证据（修订）

- `lib/collections/collection-processing-policy.ts:40-45` 的通用 `createCollectionProcessingPolicy()` 写死 `items.platform = 'bilibili'` 和 `platformMeta->>'attr' = '9'`，作为所有平台的 `downstreamEligible` 例外。
- **`INVALID_ATTR = 9` 的唯一命名常量定义在 UI 层** `entrypoints/app/sections/bilibili/video-card.tsx:53`，由 `bilibili-view.tsx:30,278` 和 `video-card.tsx:76` 使用。
- **领域层裸写字面量**：`lib/bilibili/transcription-coordinator.ts:112`（`v.attr !== 9`）、`:169`（`video.attr === 9`）；`entrypoints/app/sections/bilibili/auto-transcribe-runtime.ts:93`（`video.attr !== 9`）。
- `tagged-video-card.tsx:29` 从宽松 `platformMeta` 重建 `attr`，默认 `0`。
- 既有测试依赖该规则：`lib/collections/collection-processing-policy.test.ts:97-179`、`processing-coverage.test.ts:95-96`——迁移时这些是 parity test 的现成基底，不删。

初版说“没有统一的 Bilibili eligibility owner”——修订：owner 存在但在错误的层（UI），领域层和共享 SQL 反而各自裸写。比初版描述更糟。

### 问题

共享 processing policy 不应该知道某个平台的 JSONB 字段和业务数值。新增另一个平台的“不可进入 Embedding/Tagging”规则必须修改 `lib/collections` 的通用 SQL；Bilibili 的内存判定、SQL、自动转录和 UI 四处复制同一判断，规则变更会出现“一处改了、另一处没改”的静默漏处理。

Deletion test 通过：删除共享 policy 中的 Bilibili 分支，只保留通用 scope 和由调用方注入的 eligibility，复杂度不会回到 caller。

### 深化方案（修订）

1. 在 `lib/bilibili/` 新建纯 leaf（建议 `video-eligibility.ts`）：`export const INVALID_VIDEO_ATTR = 9`、`isProcessableVideo(attr: number): boolean`。`video-card.tsx:53` 改为 re-export 或直接 import；`transcription-coordinator.ts:112,169`、`auto-transcribe-runtime.ts:93`、`bilibili-view.tsx:278` 全部改调用。
2. 同一 owner 下提供 SQL adapter（依赖 drizzle，**不能**放进 `lib/collections/platforms.ts` 纯 leaf）：`bilibiliDownstreamEligibleSql(): SQL`。
3. `createCollectionProcessingPolicy(db, platform?)` 改为接受 `eligibility: Partial<Record<CollectionPlatform, SQL>>` 注入；默认平台无关。**初版未处理的设计点**：`platform` 为 `undefined`（全库 coverage/analytics）时，必须把所有平台的 predicate 按 `platform = X AND NOT eligible(X)` 取反后 `and(...)` 合并——需要一张 per-platform SQL adapter 表，这就是高-4 依赖高-2 domain-pure/domain-db 分层的原因。初版顺序（高-2 在高-4 前）是对的，但高-2 的范围缩小后，这张表可以直接放在 `lib/collections/platform-eligibility.ts`（DB 层），用 `Partial<Record<CollectionPlatform, SQL>>` 约束。
4. 内存判定与 SQL predicate 的 parity test：用同一组 `attr` 夹具分别跑 `isProcessableVideo` 和 seed+query。
5. 契约测试增加守卫：`lib/collections/collection-processing-policy.ts` 不得出现平台字面量。

### 收益和测试面

- **Locality**：Bilibili 的失效视频规则只在 Bilibili Module 及其 SQL adapter 中定义。
- **Leverage**：新增平台不修改通用 SQL。
- **测试 Surface**：parity test + 契约守卫；删除分散的 `=== 9`。

### 严重度理由

共享数据库处理路径中的平台专属分支，可能让内容静默跳过 Embedding/Tagging，且错误发生在 UI 之外。owner 倒置（UI 持有常量）使其比初版评估更值得优先。维持高。

---

## 中-5（维持中，实施顺序第一）：Bilibili 转录领域层直接耦合 Embedding/Tagging

### 文件和证据（修订）

- `lib/bilibili/bili-sync-service.ts:16` 导入 `chunkSubtitleRows, embedPlatformItem`（barrel）；`persistContent()`（`:181-189`）持久化后立即调用 `embedPlatformItem()`。
- `lib/bilibili/transcribe-utils.ts:3,5` 导入 `embedPlatformItem`、`tagPlatformItem`；`startProcessingDirectly`（`:26-29`）作为 `hooks?.startProcessing ?? startProcessingDirectly`（`:58`）的 fallback。
- **初版 `[UNKNOWN]` 已消**：
  - `persistContent` 仓库内**零生产调用方**；唯一引用是 `lib/bilibili/transcribe-utils.test.ts:250-254` 的“向后兼容”测试。`lib/bilibili/CLAUDE.md:11` 仍把它记为“兼容组合入口”。
  - `startProcessingDirectly` **生产不可达**：`transcribeAndPersist` 的两个生产调用方——`entrypoints/app/sections/bilibili/use-video-transcribe.ts:35-37`（经 `TranscriptionCoordinator` 构造注入）和 `auto-transcribe-runtime.ts:24`（经 `createBiliAutoTranscribeAdapter` 注入）——都传入 `enqueueBiliCollectionProcessing`（`bilibili-processing-adapter.ts:7-12` → `enqueueCollectionProcessingItem`）。Content Script 与 inject 不使用 transcribe-utils。
  - 仓库外消费者不存在（浏览器扩展，非 monorepo）。
- 正确的部分已存在：`persistContentChunks()` 是 durable seam；`enqueueCollectionProcessingItem` 是 app-runtime 的 per-item 处理入口；`lib/bilibili/CLAUDE.md:16` 已声明“领域层不 import app queue/store”。

### 问题（修订）

问题不是“绕过统一 runner”（生产路径没有绕过），而是**死代码把 storage 依赖留在 `lib/bilibili` 的 import 图里**：`bili-sync-service` 和 `transcribe-utils` 各保留一条永远不走的 embedding/tagging 直连，导致冒烟 7 个 `chrome.runtime` 错误，且 `transcribe-utils.test.ts:49`、`auto-transcribe-adapter.test.ts:28` 必须 mock storage。

### 深化方案（修订，比初版激进）

1. 删除 `bili-sync-service.ts:181-189` 的 `persistContent` 及 `transcribe-utils.test.ts:250-254` 对应测试；`:16` 改为 `import { chunkSubtitleRows } from '@/lib/embedding/chunker'`。
2. 删除 `transcribe-utils.ts:26-29` 的 `startProcessingDirectly`；`TranscribePersistHooks.startProcessing` 改必填，`:58` 直接调用 `hooks.startProcessing(bvid)`。删除 `:3,5` 的 `@/lib/embedding`、`@/lib/tagging` 导入；`PersistContentResult`/`IndexedContentState` 保留为 `import type`（类型不污染 runtime）。
3. `TranscriptionCoordinator` 构造函数（`transcription-coordinator.ts:79-82`）和 `createBiliAutoTranscribeAdapter` 的 `startProcessing` 同步改必填；现有两个生产调用方已满足。
4. 更新 `lib/bilibili/CLAUDE.md:11` 删去 `persistContent` 描述。
5. 此步完成后 `lib/bilibili` 应通过高-1 的 import-smoke contract；`transcribe-utils.test.ts:49`、`auto-transcribe-adapter.test.ts:28` 的 storage mock 可删。

不需要 deprecated 过渡期：零调用方、零外部消费者，过渡期只是给死代码续命。

### 收益和测试面

- **Locality**：Bilibili 领域层只维护转录和持久化。
- **Leverage**：与高-1 共享一半改动；bilibili 成为第四个 leaf-clean 平台。
- **测试 Surface**：领域测试零 storage mock。

### 严重度理由（修订）

没有用户可见故障，也没有真正的编排绕过；严重度维持中。但它是全部发现中**成本最低、零行为风险、且直接消掉高-1 三分之一污染**的一项，实施顺序第一。

---

## 中-6：Bookmarks 复制 `useCollectionLibrary` 的查询/分页/同步状态机

### 文件和证据

- `entrypoints/app/hooks/use-collection-library.ts:96-250`：搜索 debounce、分页、query cancellation、meta refresh、generation refresh、sync job。
- `entrypoints/app/sections/bookmarks/use-bookmarks.ts:55-179`：逐行对比，`SEARCH_DEBOUNCE_MS`/`mountedRef`/debounce effect/`refreshMeta`/paged query effect 与共享 hook 同构。
- Bookmarks 的真实特殊性：`use-bookmarks.ts:102-105` folder route 重置、`:135-137` mount auto-sync、`bookmarks-sync-adapter.ts:36-37` 动态 extraction 链。

### 初版漏掉的两个行为差异（迁移必踩）

1. **metaLoading 语义不同**。`use-bookmarks.ts:139-148` 的 meta effect 以 `syncJob?.running` 为依赖：sync 进行中不刷新，sync 结束后才 `setMetaLoading(false)` + `queryVersion++`。共享 hook（`:212-222`）在 meta 首载即 `setMetaLoading(false)`，只在 generation 跳变时再刷新（`:228-240`）。bookmarks 挂载即 sync，generation 必跳，数据最终一致；但空态判定 `libraryCount === 0 && !metaLoading` 会在首次同步期间闪一帧空态。`autoSyncOnMount` 策略必须同时延后 metaLoading。
2. **filter 事实源不同**。bookmarks 没有内部 `filter` state，`folderId` 来自路由参数；共享 hook 的 `filter` 是内部 state。迁移要把 `filter` 改为可受控输入（`controlledFilter?: string | null`），否则路由与 `setFilter` 两个事实源。

### 深化方案

深化现有 `useCollectionLibrary`，加入有限的策略 Seam：

- `controlledFilter` 可选受控输入，变化时 `setPage(1)`（对应 `use-bookmarks.ts:102-105`）。
- `autoSyncOnMount?: boolean`：为真时挂载即 `sync()`，且 `metaLoading` 延后到首个 sync 结束。
- post-sync action 已由 `runBookmarksSync` 自己承担（extraction 链 + backlog dispatch），不需要额外注入点。
- Bookmarks 仅保留 `folder` 查询映射、`getBookmarks` 参数适配、bookmark-specific display model。
- 不要创建第三个“更通用 hook”。

### 收益和测试面

- **Locality**：分页/取消/generation 只有一个 Implementation。
- **Leverage**：五个平台共享同一修复；bookmarks 自动获得 `embedJob`/`tagJob` 暴露。
- **测试 Surface**：共享 hook 加 `autoSyncOnMount`/`controlledFilter` 两个用例；Bookmarks 测 route→filter 映射与 extraction chain。

### 严重度理由

Bookmarks 的行为差异真实存在且初版漏记；中等深化机会，不是高危重写。

---

## 中-7（修订为低）：四个 Collection view 的 pipeline 编排重复

### 文件和证据（修订）

- `entrypoints/app/components/collection/collection-page-scaffold.tsx` 已统一 phase ladder、tag wiring、grid、pagination。
- **初版建议的“纯 pipeline stage builder”已存在**：`entrypoints/app/hooks/pipeline-segments.ts` 的 `buildPipelineSegments`/`backgroundJobRuntime`/`readJobProgress`，自 2026-07-25（5f6b396）加入，四个 view 均已使用（`github-stars-view.tsx:159`、`x-view.tsx:145`、`zhihu-view.tsx:138`、`youtube-view.tsx:158`）。
- 剩余重复：每个 view 约 35 行的三阶段 `stages` 数组声明（fetch/embedding/tagging 的 id、label、coverage key、`completedProgress: 'last-run'`、三个 `backgroundJobRuntime` 调用）、`useProcessingCoverage` 的 key 字符串模板 `${syncing}:${embedJob?.generation}:${tagJob?.generation}`、`captionParts` 拼接。
- 四个 view 各 230-260 行，大头是 auth/config 空态与 Card/Chip Adapter，这部分是合理的平台差异。

### 深化方案（修订）

- 可选：再抽一层 `buildStandardPipelineStages({ syncJob, embedJob, tagJob, fetchProgress, labels })`，各平台只提供 `fetchProgress` 映射。收益约 4×40 行。
- `useProcessingCoverage` 的 key 可改为接受 jobs 对象自行派生。
- 不再作为独立重构项；顺手做。

### 严重度理由（修订）

初版要求的主体已落地，降为低。

---

## 中-8：`platformMeta` 的解码知识仍在平台服务和 Tagged Card 之间分裂

### 文件和证据

- GitHub/X/知乎/YouTube 已有单一 decoder 并被 Tagged Card 复用：`narrowGithubMeta`（`github-sync-service.ts:372`）、`narrowXMeta`（`x-sync-service.ts:322`）、`narrowZhihuMeta`（`zhihu-sync-service.ts:318`）、`narrowYoutubeMeta`（`youtube-sync-service.ts:399`）；四个 `tagged-*-card.tsx:18` 调用同一函数。
- **Bookmarks 有两个 `toBookmarkItem`**：`lib/bookmarks/bookmarks-sync-service.ts:367-385` 和 `entrypoints/app/sections/bookmarks/tagged-bookmark-card.tsx:11-21`，`typeof meta.domain`/`meta.dateAdded` 的收窄逐行重复，且 fallback 不同（lib 版 `dateAdded` 回退 `publishedAt`，UI 版回退 `null`）。
- **Bilibili 在 UI 裸读**：`tagged-video-card.tsx:12-30`；`lib/bilibili` 对 item `platformMeta` 只写（`videos-sync.ts:47`）不读，没有任何 decoder。
- `collection-item-card.tsx:18-25` 通过 `CARD_ADAPTERS` 选择 Adapter。

### 问题

`platformMeta` 的持久化 schema 是平台事实，但 bookmarks/bilibili 两个平台的读取规则没有单一 owner；JSONB 形状变化不会得到跨读路径的提示。bookmarks 的两份 fallback 已经出现分歧。

### 深化方案

- Bookmarks：`bookmarks-sync-service.ts` 导出 `narrowBookmarkMeta(meta: unknown, fb: { authorName, publishedAt })`，`toBookmarkItem` 与 `tagged-bookmark-card.tsx` 都调用，统一 fallback。
- Bilibili：在 `lib/bilibili/` 新建 `narrowBiliVideoMeta`，与高-4 的 `video-eligibility.ts` 同 owner（`attr` 的解码与判定在一处）；`tagged-video-card.tsx` 调用。
- parity test 模式已有三份（`lib/{x,youtube,zhihu}/narrow-meta.test.ts`）可直接复制。
- 不要把不同平台的 meta 合并成一个大 union。

### 收益和测试面

- **Locality**：平台 meta schema、fallback 和防御式解码集中在一个 Seam。
- **Leverage**：查询页和 Tag Drill-down 共用同一规则。
- **测试 Surface**：decoder 的 malformed input 测试，代替分散的 UI 默认值。

### 严重度理由

四个平台已有 SSOT；剩余两个平台未收敛，且与高-4 共享 bilibili owner，应合并实施。维持中。

---

## 低-9：平台 sync service 文件职责过宽，但不应立即机械拆分

### 文件和证据

`lib/github/github-sync-service.ts`（402 行）、`lib/x/x-sync-service.ts`（357）、`lib/zhihu/zhihu-sync-service.ts`（347）、`lib/youtube/youtube-sync-service.ts`（428）、`lib/bookmarks/bookmarks-sync-service.ts`（385）同时包含远程 API 编排、归一化行、`ingestCollection` 调用、分页 SQL、facet 查询、平台 meta decoder 和 UI read model mapper。

### 问题

单文件变大后，API 改动、DB 查询改动和 Card model 改动容易互相触发。但这些文件仍以“一个平台的 domain 知识”保持较好的 Locality，且共享骨架已经抽出。机械拆成 `api.ts`、`persist.ts`、`query.ts`、`meta.ts` 可能只会制造更多浅 Module 和 barrel。

### 建议

暂不作为第一批重构。当某个平台再次出现以下信号时再拆分：

- 同一平台出现两个以上独立 runtime Adapter；
- 某一文件的测试必须在多个 runtime 中反复 mock；
- API/持久化/查询变更经常在同一发布中互相冲突；
- deletion test 证明拆出的 Module 能隐藏真实复杂度。

如果触发，优先拆出无副作用的 meta/read-model leaf（中-8 会自然产生这个 leaf），再拆 API。

### 严重度理由

可观测到的复杂度，但没有证据证明拆分能降低复杂度；列低。

---

## 已经做对的部分：不要重复重构

以下 Module 已通过 deletion test，继续复制它们会降低架构质量：

| 已有 Module | 当前职责 | 结论 |
| --- | --- | --- |
| `lib/ingest/ingest.ts` | 五阶段 insert-only ingest、批量、id map、ghost 修复、content seam | 保留并继续作为平台写入骨架唯一 owner |
| `lib/database/collection-queries.ts` | `pagedItemsQuery`、`getPlatformLastSyncedAt` | 保留；平台只提供 WHERE/ORDER/mapRow/facet |
| `entrypoints/app/hooks/use-collection-library.ts` | 四个平台的 query/pagination/sync state machine | 深化，吸收 Bookmarks 策略；不要新建平行 hook |
| `entrypoints/app/components/collection/collection-page-scaffold.tsx` | phase、tag、grid、pagination、section order | 保留 |
| `entrypoints/app/hooks/pipeline-segments.ts` | 纯 pipeline stage builder（`buildPipelineSegments`） | 保留；初版误以为缺失 |
| `entrypoints/app/hooks/collection-processing-jobs.ts` | post-processing 的 backlog/explicit-id 语义、lane/collision policy、per-item enqueue | 保留；已是唯一 owner，初版误以为复制六份 |
| `entrypoints/app/hooks/background-jobs-store.ts` | job collision policy、queue、gate、settlement | 保留；不要在平台 Adapter 重新实现 retry/queue |
| `tests/platform-completeness-contract.test.ts` | 11 处平台表的 AST 一次性对账 | 保留；只补嵌套路由与 processing-policy 字面量守卫 |
| `lib/runtime-message/`、`lib/background/`、`lib/offscreen/` 协议 Module | runtime decoder/encoder 与 sender 校验 | 保持 transport 协议分开 |

## 活动任务对账

| 活动任务 | 与本报告关系 | 处理决定 |
| --- | --- | --- |
| `07-25-audit-codebase-architecture` | 本次审计任务 | 本报告交付物，不另建同类任务 |
| `07-17-youtube-liked-videos-platform` | 新平台接入会触碰高-2/高-3 | 不能把一次 YouTube 修改当成 catalog 根因修复 |
| `07-02-embedding-consumer-chunk-index-search` | Embedding 功能演进 | 与高-1 的 import Seam 相关但不等价，先记录契约再改功能 |
| `08-18-unify-platform-http-deadline` | 共享 HTTP deadline | 属于请求基础设施，不能替代平台 catalog 或 sync runner 收敛 |
| `07-10-refactor-centralize-all-default-values-into-lib-storage-defaults-module` | Storage 默认值 | 不会自动解决 barrel runtime 能力泄漏 |
| `07-20-x-fab-last-sync-status-panel-with-5min-cooldown` | X UI/cooldown 症状 | 只覆盖单个平台策略，不能当作高-3 完成 |

## 推荐实施顺序（修订）

按“成本最低、风险最小、顺手消掉后续前置”排序，与初版的严重度顺序不同。

### 第 0 阶段：锁定不变量

- 保留 `ingestCollection`、`pagedItemsQuery`、`useCollectionLibrary`、`CollectionPageScaffold`、`background-jobs-store`、`collection-processing-jobs`、`pipeline-segments`。
- 每一步保持 `pnpm compile` 和 `pnpm test` 绿灯。
- 明确 `Bilibili` 的视频转录流和 `Bookmarks` 的本地树 + extraction 是真实差异，不强行塞进远程收藏抽象。

### 第 1 阶段：删 Bilibili 死代码（中-5）

删 `persistContent`、`startProcessingDirectly`，`startProcessing` 改必填，`lib/bilibili` 改 leaf import。零行为风险。

### 第 2 阶段：修 import 图 + 加 contract（高-1）

zhihu/youtube 改 leaf，删三处过期 offscreen 注释，删 x 冗余 mock，新增 `tests/lib-import-smoke.test.ts`（平台清单由 `COLLECTION_PLATFORMS` 派生）。

### 第 3 阶段：Bilibili owner 收拢（高-4 + 中-8 合并）

`lib/bilibili/video-eligibility.ts`（常量 + 内存判定 + SQL predicate）+ `narrowBiliVideoMeta`；通用 policy 改注入；parity test；契约守卫“policy 无平台字面量”。顺手给 bookmarks 收敛 `narrowBookmarkMeta`。

### 第 4 阶段：registry 小修（高-3）

`jobPlatform` 派生；adapter 导出 `autoSyncPolicy`；聚合点移出 `hooks/`；统一 `runSync` 签名。

### 第 5 阶段：吸收 Bookmarks 状态机（中-6）

共享 hook 加 `controlledFilter` + `autoSyncOnMount`（含 metaLoading 延后语义）。

### 第 6 阶段：嵌套路由登记（高-2）

`collection-platform-pages.ts` 加 `childRoutes`，`main.tsx` 删两行特殊行。约 10 行。

### 第 7 阶段（可选）：pipeline 再抽一层（中-7）

### 第 8 阶段：按证据拆宽 service（低-9）

## 验收指标（修订）

- `tests/lib-import-smoke.test.ts` 通过：六个平台 sync-service、纯 chunker、`collections/platforms`、`ingest`、`database` 在无 `chrome` 全局、无 mock 环境下加载零未处理错误。
- `lib/bilibili` 不含 `@/lib/embedding`/`@/lib/tagging` 的 value import；`persistContent`、`startProcessingDirectly` 不存在。
- `lib/collections/collection-processing-policy.ts` 不包含平台字面量（契约守卫）；Bilibili 内存判定与 SQL predicate 有 parity test；`=== 9` 字面量只出现在 `lib/bilibili/video-eligibility.ts`。
- `auto-sync-registry.ts` 不手写 `jobPlatform`。
- `use-collection-library` 是所有“单列表 + facet + manual sync”页面的唯一状态机；`use-bookmarks.ts` 不再含 debounce/paged query/generation 主循环。
- Tagged query 和 Tag Drill-down 使用同一平台 meta decoder；`tagged-bookmark-card.tsx`、`tagged-video-card.tsx` 不直接 `typeof meta.*`。
- `main.tsx` 不含平台专属路由行。
- 运行时行为保持兼容：`pnpm.cmd compile`、`pnpm.cmd test` 以及平台完整性 contract 全部通过。

## 最终判断（修订）

本项目的共享骨架已经足够好，且比初版认定的更好：post-processing 语义、pipeline builder、完整性契约都已经是单一 owner。初版高估了三项（高-1 的 offscreen 前提被证伪、高-2 的方案已是现状、高-3 的语义复制不成立），低估了一项（高-4 的 owner 倒置），并把一项已解决的事当待办（中-7）。

修正后的主线只有两条：**把 Bilibili 的平台事实收回 `lib/bilibili`**（中-5 → 高-4/中-8），**用可执行 contract 取代注释维持的 import 规则**（高-1）。其余是小修。先做巨型 registry 或万能 hook 的方向错误判断不变。
