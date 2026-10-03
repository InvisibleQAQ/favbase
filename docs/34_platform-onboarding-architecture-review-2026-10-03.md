# 34 平台接入架构体检（2026-10-03）

> 状态：**体检完成，零代码改动**。本文是候选清单：问题按严重度从高到低排序，每条附改进措施；未定接口，落地前逐条走 grilling（§7 的待决策先定）。
>
> 起因：用户要求用 `improve-codebase-architecture` 找出让「接入下一个 Collection Platform」更方便的改进点，目标低耦合、高内聚。「用户」指往本仓库接入平台 N+1 的开发者或编码 agent，不是终端用户的插件系统（`CONTEXT.md`：Collection Platform 一上线就对所有人可用）。
>
> 事实基线：体检开始于 `main` @ `235a495`。**体检期间另一个会话在同一工作树实现并提交了 docs/33 Step 1**（`9340ab4`：`lib/douyin/`、`.env.example`、env 守卫登记表、docs/33）。verifier 读到的是提交前的工作树，凡引用它们的地方标 `[WT]`；主会话已按 `9340ab4` 复核过正文点名的行（`lib/douyin/douyin-sync-service.ts:378`、`:265`，docs/33 `:290`、`:304`、`:320`、`:350`）。其余引用都是 `235a495` 的事实，`9340ab4` 没有改动那些文件。

---

## 0. 结论

### 0.1 一句话

docs/26 与 docs/32 之后，注册表与机制层的重复基本收干净了；**剩下的问题不在「要写多少行」，而在共享 Module 对「一次 Platform Sync 长什么样」的隐含假设**：整批、结束时一次入库、正文全在手、在 lib 里用 fetch、只多 host 权限。六个已上线平台恰好都满足，所以没人撞到；抖音一条都不满足。其中一条假设（高-1）在 HEAD 上已经是静默丢正文的缺陷，与抖音无关。

没有任何视角建议改动两份 Platform Descriptor、四处重值注册表或 Platform Sync funnel 的形状（§4）。

### 0.2 计分卡

| # | 问题 | 今天可达 | 相对抖音的时机 | 待决策 |
|---|---|---|---|---|
| **高-1** | `ingestCollection` 的 ghost sweep 把「这次没带」当成「没有正文」，条目永久落 `no_content` | **是**：x、youtube | Step 2 之前 | D1 |
| **高-2** | 泛型层假设 Platform Sync 原子、结束时一次入库：hook 只在成功时重读；逐条派发是没有名字的模式 | 否，抖音计划触发 | Step 2 之前 / 随 Step 2 | D2 |
| 中-1 | 契约只认识「lib 里 fetch + host 权限」；守卫按「判别符 × `lib/<p>/`」圈地 | 结构缺口 | Step 2 之前 | D3 |
| 中-2 | 翻判别符被绑成一次 CLI 的 npm 发版 | 翻判别符时 | Step 2 之前 | D4 |
| 中-3 | job namespace 是平台 id 的第二个名字，一套机制在替它同步 | 否 | Step 2 之前 | D5 |
| 中-4 | 限流锁没有 owner：只在内存、逐 view 手接、只锁一个入口 | 是，后果小 | Step 2 之前（第一层） | D6 |
| 中-5 | 平铺 view 手工重复装配 scaffold；两个可选 slot 漏传无人报 | 否 | A 档之前，B 档之后 | D7 |
| 中-6 | spec §9 之外还有一批翻判别符当天静默过期的手写副本 | 翻判别符当天 | 不晚于 Step 2 | D8 |
| 中-7 | 「不属于任何 Source」有两种矛盾的落库约定；Obsidian 导出的异常桶将成主路径 | 否 | 随 Step 2 | D9 |
| 中-8 | auth 错误在每个 view 手工拆成两个结论；github 与 youtube 已分叉 | 是：github token 被拒的呈现 | Step 2 之前 | D10 |
| 中-9 | `contentState` 与 `textOf` 声明两遍；ingest 不变量由平台测试代证 | 否 | 抖音之后 | D11 |
| 中-10 | 收藏时间在模型里没有位置（未经对抗验证） | 是：排序语义 | 抖音全量入库之前 | D12 |
| 低-1 | descriptor 的 meta key 与写入方无对账 | 否 | 独立 | — |
| 低-2 | `.env.local` 被守卫当成全量镜像 | 是：每加一个键都要手改 | 独立 | D13 |
| 低-3 | 根 `CLAUDE.md` 98.9 KB，71% 是流水账 | 是：每个会话都在付 | 独立 | D14 |
| 低-4 | 死 slot、死组件、死 locale 键、过期理由 | — | 独立 | — |
| 低-5 | `COLLECTION_PLATFORMS` 顺序背三份约定（未经对抗验证） | — | 独立 | — |
| 低-6 | 增量截断的前提（单账号）没写下来（未经对抗验证） | 是：x 换号 | 独立 | — |

另有 5 条观察项（§3）、12 条再次被提出但已有决定的方案（§5）。

### 0.3 最该先定的三件事

1. **高-1 不是重构，是缺陷**。x 或 youtube 首次同步时关掉 app.html，没写完正文的条目下次同步会被永久判成无正文，Processing Coverage 还显示正常。youtube 这一支连文档都写反了。修复只动 `lib/ingest` 一处判决规则。
2. **抖音 Step 1 已在体检期间提交（`9340ab4`），Step 2 还没开工**。高-2、中-1（transport 落点）、中-3（要不要发明 `'douyin-collections'`）、中-10（入库形状）都会被 Step 2 定型：这几条的决策（D2、D3、D5、D12）要赶在它开工之前。
3. **中-2 决定 Step 2 的 commit 是不是一次 npm 发版**（D4）。

### 0.4 接入成本现状

以 youtube（spec 的参考实现）为例，一个平台在自己两个目录之外要动 22 个源码 / 配置文件、会让 9 个测试文件变红、要更新 3 份完成定义里的文档，另有约 16 处不会报错的清单副本。app 侧必须手写 318 行（zhihu 343 行，docs/32 之前是 556 行）。明细见附录 A。

---

## 1. 方法与口径

**流程**：9 个只读 finder 各带一个视角（抖音 lib 探针、抖音 app 探针、手写产物普查、判别符扇出、app 侧 seam 深度、lib 侧 seam 深度、守卫与文档、非 app 表面、无清单的新手视角）→ 48 条原始发现归并成 18 个候选 → 每个中 / 高候选配一名 skeptic（逐行回查证据、追代码路径、two-adapter 检验）与一名 historian（对照 docs/13–17、20、26、30、32、33、ADR、spec、归档 PRD 的既有决定）→ 一名 critic 查漏。两条「高」的关键行由主会话再读了一遍。

**探针**：抖音（docs/33）是真实的第 7 个平台，它的形状恰好压在现有契约的薄弱处：注入式 transport、逐页入库加断点续传、逐条派发、标签页门、`scripting` 权限、不属于任何 Source 的条目。每条发现都问一句：抖音接进来时，哪个共享 Module 必须为它长分支。

**词汇**：架构用 Module / Interface / Seam / Adapter / Depth / Leverage / Locality（Interface 指调用方必须知道的一切，不只是类型签名）；领域用 `CONTEXT.md` 的词。两条判据：deletion test（删掉这个 Module，复杂度是消失还是散回 N 个调用方）；一个 adapter 是假想的 seam，两个才是真的。

**严重度**：

| 级别 | 判据 |
|---|---|
| 高 | 行为缺陷，或接入时静默产出错误产品的陷阱；共享 Module 必须为下一个平台长分支；下一个平台按字面无法满足的契约 |
| 中 | 真实 seam 缺失且 ≥2 个 adapter 在为它付重复 / 手工同步的代价；守卫在替缺失的 seam 兜底；接入平台被迫做无关的事（如发版） |
| 低 | 样板、命名、文档腐化、导航成本 |
| 观察 | 只有一个 adapter，或已有决定且没有新证据：写明触发条件，现在不做 |

skeptic 与 historian 定级不一致时取证据更硬的一方，并在条目里写明分歧。

**证据标准**：每个 `file:line` 都由 verifier 在本次体检中打开过。finder 说错的地方已按 verifier 的更正改写；对读者有用的更正收在附录 C。没验证的标 `[UNKNOWN]`。

---

## 2. 发现

### 高-1 `ingestCollection` 的 ghost sweep 把「这次调用没带这条」当成「这条没有正文」

**性质**：行为缺陷，HEAD 上 x 与 youtube 可达，静默。

**Files**：`lib/ingest/ingest.ts`、`lib/ingest/ingest.test.ts`、`lib/x/x-sync-service.ts`、`lib/youtube/youtube-sync-service.ts`、`lib/github/github-sync-service.ts`（已有平台侧补偿）、`lib/ingest/CLAUDE.md`、`lib/x/CLAUDE.md`、`lib/youtube/CLAUDE.md`、docs/33。

**问题**：sweep 对**全平台**的幽灵下判决，手里的证据却只有**本次调用**的 `textOf` 和已存的 `plainText`。链路：

1. 声明 `'chunked'` 的条目在事务内以 `'has_content'` 入库，正文留在调用方内存（`lib/ingest/ingest.ts:364`）。
2. phase 5a 在事务外逐条串行写正文（`:436-440`）。此时 app.html 被关或抛错，没轮到的条目停在 `has_content`，没有 `item_contents` 行。
3. 下一次同步，sweep 按 platform 选出全部幽灵（`:445-448`），先问本次 `textOf`（`:451`），再问已存 `plainText`（`:453-458`），都空就带空串去落定（`:460`），`settleItemContent` 写成 `'no_content'`（`:205-216`）。
4. 此后它不再是幽灵（谓词只含 `chunked` / `has_content`，`:143-145`），也不是新条目（`preExisting` 不进 `inserted`，`:407`）：没有任何补写路径。
5. `no_content` 算 Content 已完成，又不在 Embedding / Tagging 的分母里（`lib/collections/collection-processing-policy.ts:104`、`:81-84`）。Processing Coverage 看起来正常，条目永远不进向量、不打标。零错误，零红测试。

`textOf` 是否覆盖旧幽灵，五个带正文的调用方各不相同：

| 调用方 | `textOf` 覆盖旧幽灵吗 | 证据 |
|---|---|---|
| zhihu | 覆盖，全量重拉手握全文 | `lib/zhihu/zhihu-sync-service.ts:222` |
| github | 不天然覆盖，靠平台侧补偿：把幽灵仓库并进 README 重拉集合 | `lib/github/github-sync-service.ts:180` |
| x | 不覆盖：已存 id 即停，下一批不含它们 | `lib/x/x-sync-service.ts:152-153`、`:210` |
| youtube | 不覆盖：详情只为未知 id 拉取，旧幽灵的 `textOf` 返回空 | `lib/youtube/youtube-sync-service.ts:202`、`:295` |
| douyin `[WT]` | 不覆盖：`textOf` 只含本页 20 条 | `lib/douyin/douyin-sync-service.ts:378` |

x 的损失是 2026-07-27 用户接受过的已知代价（`lib/x/CLAUDE.md:30`）。**youtube 不是**：`lib/youtube/CLAUDE.md:26` 写的是「全量重拉手握 description 顺手补写」，与代码相反，没人知道它有这个问题。抖音的「原样续传」靠调用顺序碰巧自愈（断点在入库后才写，续传首页就是被打断的那页）；头部有新收藏、全量重走或夹内步骤被打断时才判死，每次至多一页。docs/33 写的「正确性无影响」`[WT]` 不成立。

根因不是「逐页入库」（x 是单批 ingest 也触发），而是 Interface 上的一条隐藏不变量：`textOf` 必须覆盖全平台的幽灵。`IngestInput` 的形状看不出这条要求，spec §4.2 向平台作者承诺 ghost self-healing 时也没提。

**方案**：只改 `lib/ingest` 里 sweep 的判决规则，`IngestInput`、六个 sync-service、抖音代码都不动。幽灵分三种：有已存 `plainText` 的照旧重切；本次调用声明过的照旧（有正文治愈，没正文落 `no_content`）；**本次没见过且没有 `plainText` 的不再判死**，留在 `has_content`，等带着它的那次调用治愈。消失的是那条隐藏不变量。不采纳：正文进事务、让调用方声明「本批即全平台」、把 sweep 挪成 sync-service 的显式调用。

**收益**：Locality——「何时可以判 `no_content`」仍只有 `lib/ingest` 一个 owner，且不再取决于调用方的调用粒度。Leverage——整批、增量、逐页三种调用方都安全，下一个流式平台不必读懂 sweep，也不必在自己的 sync-service 里补偿。测试——不变量锁在 ingest 自己的 Interface 上：新增一例「事务后中断 → 用不含该条目的批次调用 → 仍是 `has_content` → 带它的批次治愈」，现有 hopeless 用例拆成「声明过」与「没见过」两例；平台测试不必各自复现中断场景。

**既有决定**：重开 07-26 幽灵修复任务的验收条「x 覆盖不到的幽灵回退 `no_content`」（用户 2026-07-27 选定）与 `lib/ingest/CLAUDE.md:12` 的「诚实回退」。新证据三条：youtube 同样触发且文档写反；抖音是第三个部分批次调用方；当时的前提「源文本已丢失」对 x 不成立——推文全文一直写在 `platform_meta.text`（`lib/x/x-sync-service.ts:194`）。

**待决策**：D1（§7）。**时机**：抖音 Step 2 之前，单独一个 commit。Step 1 只有 lib、判别符没翻，不可达。

**`[UNKNOWN]`**：phase 5a 的窗口时长没测过；现有库里是否已有被误判的 x / youtube 条目没查（库里是测试数据）；每次调用按 platform 全量重选 id-map 的耗时没测（docs/33 留给 Step 3，这一半降为观察）。

---

### 高-2 泛型层把一次 Platform Sync 当成「原子、结束时一次入库」，逐页入库的平台按字面接不上

**性质**：下一个平台必须改共享 Module 才能接入；今天六平台无缺陷（五个平铺平台都在结束时一次 `ingestCollection`）。skeptic 定中（不丢数据，页面能自愈），historian 定高；按判据取高。

**Files**：`entrypoints/app/hooks/use-collection-library.ts`、`entrypoints/app/hooks/background-jobs-store.ts`、`entrypoints/app/components/collection/collection-page-scaffold.tsx`、`entrypoints/app/hooks/platform-sync.ts`、`entrypoints/app/hooks/collection-processing-jobs.ts`、`entrypoints/app/sections/bookmarks/use-bookmark-extraction.ts`、`entrypoints/app/sections/bilibili/bilibili-processing-adapter.ts`、spec §4.4 / §7.2。

**问题**：两半。

**A. 重读规则**。`useCollectionLibrary` 只在 sync job 的 `generation` 变大时重读 meta 与当前页（`use-collection-library.ts:264-276`），而 `generation` 只在 runner 成功时加一（`background-jobs-store.ts:296`），失败不动（`:304`）。`libraryCount` 的唯一写入就在这次重读里（`:245`），scaffold 的骨架相位与错误相位都读它（`collection-page-scaffold.tsx:227-229`）。抖音计划原样使用这个 hook 并逐页入库（docs/33 `[WT]`）：首次全量约 20 分钟全程骨架屏；中途失败显示「空库错误框」，而库里已有上千条；重新挂载才恢复。view 在 hook 之外没有刷新口。`use-collection-library.test.tsx` 没有一例覆盖失败或运行中落库。

**B. 逐条派发是一个没有名字的模式**。funnel 成功后派发一次（`platform-sync.ts:78`），这是 docs/32 Step 1 的设计，有测试锁定。逐页入库的平台只能绕开它走 `enqueueCollectionProcessingItem`（`collection-processing-jobs.ts:266`）。HEAD 上已有两个 Adapter 各自手拼 `{ jobPlatform, itemPlatform, itemId }` 三元组并给 funnel 传 `newItemIds: []` 哨兵：`use-bookmark-extraction.ts:69`、`bilibili-processing-adapter.ts:10`；抖音是第三个（docs/33 D-b）。契约测试只守 `startCollectionProcessingJobs`，逐条门零守卫；`itemId` 一词两义（`items.id` 与 platformItemId），传错静默跳过；spec 没有把「逐页入库 → 逐条派发、funnel 收空 id」写成一种同步形状。

**方案**：只做前两件。

1. **重读规则**（Step 2 之前）：触发从「sync 成功次数变大」改成「本挂载看到的 sync run 结束，不论成败」；run 进行中有新行落库时去抖重读 meta，库从空变非空时连当前页一起重读。信号用现有领域事件总线，由全平台共用的 `ingestCollection` 在确有新行插入后发一次：原子平台自然只在结束时发一次，平台与 adapter 零改动。phase 阶梯、scaffold、funnel、Platform Sync Record 都不动。
2. **给逐条派发起名**（随 Step 2）：平台感知层放一个只收 Collection Platform 与 platformItemId 的逐条派发入口，内部派生 job 命名空间；书签提取、B 站处理 adapter、抖音 adapter 都调它，泛型层签名不动。spec §4.4 把 `items.id` 与 platformItemId 写成两个词，§7.2 写明这第三种同步形状。可仿 `startCollectionProcessingJobs` 加一条守卫：泛型逐条门只出现在定义处与新入口。
3. **不做**：funnel 增量上报、改 `PlatformSyncOutcome` 形状（只有抖音一个 adapter）；失败时改 Platform Sync Record 计数。

**收益**：Locality——「何时重读本地库」只在泛型 hook 一处；命名空间配对与 id 种类收进一个入口。Leverage——以后任何逐页入库的平台自动得到「边拉边可见」和「失败后落到网格加同步失败横幅，而不是空库错误框」。测试——用 fake `syncFn` 给泛型 hook 补上失败与运行中落库两例，这是今天完全没有的覆盖。

**既有决定**：07-20 的 core-store 任务假设四个消费方都在结束时一次入库，被抖音的逐页入库取代；funnel「成功才派发」不动。

**待决策**：D2（§7）。**时机**：Step 2 之前（与正在写的 `lib/douyin` 零文件交集）。**风险**：抖音约 6.5 s 一页，运行中若每页都重读当前页，按发布时间排序的网格会跳动；建议运行中只刷 meta，Step 3 实测后定。`lib/ingest` 今天不发任何领域事件，新增事件要在 `lib/ingest/CLAUDE.md` 写清它是「行已插入」，不是正文事件。

---

### 中-1 接入契约只认识「lib 里 fetch + host 权限」，守卫按「判别符 × `lib/<platform>/`」圈地

**性质**：契约与守卫覆盖的缺口，无运行时缺陷。7 个平台里 4 个是「例外」。

**Files**：`.trellis/spec/frontend/platform-onboarding.md` §3 / §4.1 / §12 / §13、`wxt.config.ts`、`wxt.config.test.ts`、`tests/platform-env-guard-contract.ts`、`tests/platform-sleep-guard.test.ts`、`tests/platform-env-constants-guard.test.ts`、`tests/lib-import-smoke.test.ts`、`tests/platform-completeness-contract.test.ts`、`tests/http-fetch-deadline-guard.test.ts`。

**问题**：三处。

1. **运行时足迹没有位置**。spec 的 manifest 足迹只认 `hostPermissions`（§12「只允许多出自己的 host」），全文不提 API 权限、SW listener、content script。HEAD 上 x（`webRequest` 加 SW listener）、bookmarks（`bookmarks` / `favicon`）、bilibili（`cookies` / DNR 加 content script）早已越出，抖音的 `scripting` 是第四个。`permissions` 是手写数组、零断言（`wxt.config.ts:49-65`；`wxt.config.test.ts:9` 只断言 host），host 列表却有黄金顺序锁。docs/33 只能把自己写成对 spec 的「偏离」。
2. **lib-first 阶段守卫看不见新目录**。spec §4 要求先建 lib 再翻判别符，但 sleep、env 裸常量、未登记键、孤儿键、import-smoke、错误基类继承这六项检查的目录都由 `COLLECTION_PLATFORMS` 派生（`tests/platform-env-guard-contract.ts:3`、`tests/lib-import-smoke.test.ts:111`、`tests/platform-completeness-contract.test.ts:721`）。只有 fetch 守卫按文件系统扫 `lib/**`（`tests/http-fetch-deadline-guard.test.ts:75`）。翻判别符后会补扫，所以是反馈延迟而不是漏洞，但 docs/33 Step 1 只能写「本 Step 自己先按它们的规则写」。
3. **守卫不看 `lib/<p>/` 之外**。抖音计划把注入式 transport 放 `sections/douyin/`：风控最敏感的平台，真正发请求的代码成了唯一不受策略守卫约束的平台代码。

**方案**：不派生、不建新 seam，四件事。

1. 守卫的平台目录集合 = 判别符派生 ∪ 文件系统发现（`lib/` 下含非测试 `*-sync-service.ts` 的子目录，HEAD 恰为六个）。契约测试里两条恒真断言随之变成真对账。守卫全部保留。
2. 落点规则一条：需要 `chrome.*` 的平台实现住 `lib/<p>/` 的独立 leaf（不进 sync-service 的静态图），入口与 sections 只接线。`lib/x/x-auth.ts`、`lib/bilibili/inject/` 已经如此。抖音 transport 照此进 `lib/douyin/`，注入函数里的 `fetch` 在裸 fetch 守卫的 allowlist 写明理由。
3. spec §3 加第六问「运行时足迹」（API 权限 / SW 监听 / content script / DNR / 页面注入请求，四个平台作参考答案）；§4.1 改述为不变量（请求有期限、等待走 `lib/http`），`fetchWithDeadline` 是默认机制；§12 / §13 改为「只多自己的 `hostPermissions` 与 §3 声明过的 API 权限」。
4. `permissions` 数组在 `wxt.config.test.ts` 加一例黄金断言。

**收益**：Locality——「平台在运行时还占了什么、请求与计时代码住哪」在 spec 有唯一答案，平台策略代码全在 `lib/<p>/`，守卫只有一个扫描范围。Leverage——平台 N+1 从第一个 sync-service 文件起就受约束；带 API 权限或页面注入的平台在 §3 回答一次，不用各写一份例外论证。

**既有决定**：不重开「manifest API 权限不由 descriptor 派生」（docs/32 §4）——这里只加断言与 spec 位置，不派生。**待决策**：D3（§7）。**时机**：transport 落点要在 Step 2 写它之前定；目录发现只动 `tests/`，翻判别符之前落地才对抖音有用。

---

### 中-2 翻 `COLLECTION_PLATFORMS` 被绑成一次 favbase CLI 的 npm 发版

**性质**：流程耦合，两条各自合理的用户决定在第 7 个平台上第一次撞到一起。4 个 finder 独立报出。

**Files**：`skills/favbase/SKILL.md`、`tests/agent-bridge-cli-aliases.test.ts`、`packages/favbase/CLAUDE.md`（Release）、spec §2 / §13、`skills/favbase/INSTALL.md`、`README.md`。

**问题**：翻判别符在机械上只强制一件事：同 commit 改 SKILL.md 的两份手写清单（id 集合相等 `tests/agent-bridge-cli-aliases.test.ts:89`；显示名逐项有序相等 `:110`）。「所以必须发版」来自 docs/30 #4 的发布纪律：改 SKILL.md 的 commit 就是发布 commit（`packages/favbase/CLAUDE.md:403`），无守卫（`:409`）。叠加后：接入一个平台 = 一次只有持 npm 2FA 的人能做的发版，回滚 = 再发一版。六个已上线平台从未触发过，抖音是第一次。

两份清单并不对称：

- **id 句**（`SKILL.md:52-54`）在运行时本来就拿得到：扩展的工具 schema 里 `platform` 是 `z.enum(COLLECTION_PLATFORMS)`，`favbase tools` 能列出。它是冗余副本。
- **frontmatter 显示名**是 agent 选不选这个 skill 的依据，运行时拿不到，只能手写。

两点更正：这条纪律约束的是 `origin/main`，分支或未推送的本地 commit 是存在的中间态，docs/33 写的「只能二选一」说重了；HEAD 上纪律已处于违反状态（`packages/favbase/CLAUDE.md:413`），0.2.2 本来就欠着，抖音不新增一次发版，只是把时点钉在 Step 2 推 main 之前。另外 spec §2 与 §13 都没写「改这两份 = 一次 CLI 发版」。

**方案**：

1. **id 句不再枚举**：改成「取值以 `favbase tools` 为准」，并订正「`--help` is authoritative」。相等对账换成两条不随平台数变化的断言：SKILL.md 正文不得出现平台 id；扩展公布的工具 schema 里 `platform` 取值集合等于 `COLLECTION_PLATFORMS`（今天没人钉住这条，改指运行时后它是唯一来源）。CLI 保持零平台知识。这次 SKILL.md 改动搭已欠的 0.2.2。
2. **frontmatter 显示名保留手写**，解耦只能改对账时机，需用户决定（D4）。
3. 无论怎么选：spec §2 写明「改这两份 = 一次 CLI 发版（或登记 pending）」。

**收益**：Locality——平台 id 的事实源只剩扩展一处，Skill 与 CLI 零副本，手写清单从两份减到一份。Leverage——`favbase tools` 在新旧 CLI × 新旧扩展四种组合下都给出正确取值，无需任何人同步。

**既有决定**：id 句的对账是 docs/26 Step 3 的用户决定，被 docs/30 D7-b 的后果取代（当时满足守卫 = 改一行 markdown，如今 = 一次发版）。finder 提的「frontmatter 改按类别措辞、不再穷举平台」是 docs/26 明确否决过的，没有新证据，丢弃。**待决策**：D4（§7）。**时机**：Step 2 之前，它决定 Step 2 的 commit 是不是发布 commit。

---

### 中-3 job namespace 是平台 id 的第二个名字，一整套机制在替它保持同步

**性质**：守卫在替一个本可以不存在的概念兜底。今天无缺陷。

**Files**：`lib/collections/platform-descriptor.ts`、`entrypoints/app/hooks/collection-job-platform.ts`、`entrypoints/app/components/library-gate/use-collection-gate.ts`、`tests/platform-completeness-contract.test.ts`、spec §6.1 / §11。

**问题**：job namespace 不携带 Collection Platform id 之外的任何信息。它只是 app.html 内存 job store 的键前缀：不落盘（知识库闸门存的是平台 id，`lib/storage/ui-state.ts:50`），不展示（指示器反译回平台名），lib 侧只进 console trace。四个不同名的值（`github-stars`、`x-bookmarks`、`zhihu-favorites`、`youtube-playlists`，`platform-descriptor.ts:139`、`:164`、`:175`、`:192`）源自 2026-07-17 的 console `logTag`，三天后被复用为 job key。bilibili / bookmarks 同名照常工作，说明差异没有行为意义。`useCollectionGate` 甚至把 id 与 namespace 混着送进同一个 string 通道，靠反向映射「两种拼写都收」兜住（`use-collection-gate.ts:24`、`collection-job-platform.ts:28`）。

为这个差异付出的：descriptor 一格加唯一性测试、31 行映射 Module（17 个非测试模块 import）、约 190 行 AST scanner 与自检、三张测试镜像表、spec 里一条 unique 规则和两行守卫条目。抖音计划发明第五个不同名的值 `'douyin-collections'`。

deletion test：四个值改成平台 id 之后，映射 Module 是恒等的 pass-through，可以整个删掉，零迁移。

**方案**：只做值统一，泛型层 Interface 一律不动。

1. github / x / zhihu / youtube 的 job namespace 改成平台 id，descriptor 删掉 `jobPlatform` 一格（七字段回六字段）。
2. `collection-job-platform.ts` 整个删除，平台感知层直接传平台 id；反向映射退化为已有的 `isCollectionPlatform` 收窄。
3. 随之消失：唯一性断言、往返测试、镜像表、spec 的 unique 规则、auto-sync「禁止手写 jobPlatform」检查。docs/32 Step 5 的 AST 守卫两个用例建议删除：它防的是「照抄平台 id 是错的」，统一后照抄就是对的。
4. **不做**：`useCollectionLibrary` 的 `platform` / `jobPlatform` 双键、processing-jobs 的成对入参、job store 的 string 入参全部保留（docs/32 Step 9 的已知缺口：派生会打破泛型 hook 测试靠唯一命名空间做的隔离）。冗余仍在，但不再是陷阱。

**收益**：Locality——平台身份只剩一个词，job 键、闸门、Platform Sync Record、DB 判别符同名。Leverage——平台 N+1 少发明一个名字、少守一条「禁止写出来」的规则。测试——净删约 250 行守卫与镜像。

**既有决定**：会架空用户 2026-10-01 批准的「`LOG_TAG` 提前派生」守卫，所以需要用户点头。不重开 docs/32 Step 9 的双键。**待决策**：D5（§7）。**时机**：Step 2 之前，单独一个 commit；先统一则抖音不必发明 `'douyin-collections'`。**风险**：console 前缀与 embedding trace 的值会变；删守卫后纯拼写错误只剩 `tsc` 兜底。

---

### 中-4 限流锁没有 owner：reset 时刻只活在内存 job error 里，逐 view 手接，只锁一个入口

**性质**：真 seam 缺失（github + x 两个 adapter，抖音是第三个），HEAD 上有两个小的可达缺口。skeptic 定低，historian 定中。

**Files**：`entrypoints/app/sections/x/x-view.tsx`、`entrypoints/app/sections/github-stars/github-stars-view.tsx`、`entrypoints/app/components/collection/collection-page-scaffold.tsx`、`entrypoints/app/hooks/use-collection-library.ts`、`entrypoints/app/sections/github-stars/github-sync-adapter.ts`、`lib/database/entities/platform-sync-records.ts`、spec §7.2。

**问题**：`<P>RateLimitError.resetAt` 只存在于内存 job store 的 error 里（`background-jobs-store.ts:102` 是模块级 Map），刷新 app.html 即解锁。锁由 github / x 两个 view 各自手接一份 `useCountdown(rateLimitRemainingMs(...))`（`x-view.tsx:70`、`github-stars-view.tsx:92`），只锁标题栏按钮：库为空时错误相位的 Retry 直接是 `onSync`，不看锁（`collection-page-scaffold.tsx:271`；锁只在 `:325` 加给标题栏）。跨午夜的每日自动同步也不看它：github 的 `probeReady` 只看 token（`github-sync-adapter.ts:91`），闸门只比尝试日期，所以会在 reset 之前重打一次并用掉当天名额。spec §7.2 要求带 `resetAt` 的平台「在 view 里锁」，抖音会抄第三份。

原 finder 把三件事捆成「设备本地同步状态没有家」，只有限流锁是真 seam。bilibili 的完成标记在 `sources.platform_meta` 里先读后写且有测试锁，不动；抖音的断点续传只有一个 adapter，是假想的 seam。

**方案**：分两层。

1. **零迁移**：「还要锁多久」的派生从两个 view 收到共享 app 层一处；scaffold 同时拥有标题栏按钮与错误相位的 Retry，同一把锁作用于两者。倒计时文案留在翻译半边，`components/collection/**` 照旧零 `t()`。x 的成功冷却仍归 x。spec §7.2 那句删掉。跨日窗口不靠新列：抖音的 `probeReady` 读现有记录的 `last_attempt_at` 加 `last_result`，失败后冷却内返回未就绪（x 的探针是先例）。
2. **需重开 docs/32 §5.1**：Platform Sync Record 加一个可空的「限流到何时」。只有这一层要问用户（D6）。

同时给 spec 补一句归属规则：有 DB 侧读者（闸门、探针、caption）的状态进记录；没有读者、丢了能自愈的由 adapter 存 `local:`。抖音断点照 docs/33 留在 `local:douyin-backfill`。

**收益**：Locality——「限流到何时 → 锁哪些入口」只在一处派生，标题栏与 Retry 不再各说各话。Leverage——下一个带 `resetAt` 的平台 app 侧零接线。测试——一处测「带 `resetAt` 的错误 → 两个入口都锁、到点解锁、与 x 冷却取较晚者」，取代三份 view 锁测试。

**既有决定**：Platform Sync Record 的形状与「不存下次可重试时刻」是用户 2026-09-29 的决定（docs/32 §5.1、§5.2）；09-30 的 sync-error-model 任务把持久锁列为 out of scope，理由只有迁移成本。新证据：抖音的账号级风控持续数小时，且它的 `resetAt` 是 favbase 自己合成的冷却，不是平台回报。**待决策**：D6（§7）。**时机**：第一层在 Step 2 之前。

---

### 中-5 平铺平台的 view 仍在手工重复装配 scaffold，两个可选 slot 漏传没人报错

**性质**：五个现役 Adapter 的样板，加一处潜在遗漏；今天无缺陷。skeptic 定低，historian 定中。

**Files**：`entrypoints/app/sections/{github-stars,x,zhihu,youtube,bookmarks}/*-view.tsx`、`entrypoints/app/components/collection/collection-page-scaffold.tsx`、`tests/platform-completeness-contract.test.ts`、spec §7.2。

**问题**：五个平铺 view 各自手写同一段装配：13 个 hook 字段原样转发，加 `hasSyncError` / `authFailed` 两个派生、caption 拼装、`PipelineProgressStrip` 与 `CollectionConfigurationNotice` 节点（`zhihu-view.tsx:78-94`；youtube `:90-106`、x `:104-122`、github `:127-149`、bookmarks `:82-98` 同形）。普查实测 zhihu-view 归一化后 145 个非空行里 93 行与 youtube 相同、107 行与 x 相同。

真正零守卫的是 scaffold 的两个可选 slot：`pipeline?` 与 `configurationNotice?`（`collection-page-scaffold.tsx:135`、`:137`）漏传 `tsc` 不报；契约测试对 view 的唯一要求是调用了 `useCollectionBreadcrumbs`（`tests/platform-completeness-contract.test.ts:458`）；spec §7.2 的 view 行没点名 `CollectionConfigurationNotice`。新平台照 spec 字面实现会漏掉配置提醒横幅，后果是 Tags 积压失去恢复入口（Embed 积压会在下次成功同步时自愈）。

两点更正：「pipeline 可见性规则漂成三种写法」不成立，几种写法是同一条规则（平台未就绪即隐藏）按各平台就绪信号的退化形式，没有行为不一致；view 层没有测试是 docs/32 已记录的既知状态，docs/33 引用的「照 zhihu / x 的 view 测试形状」并不存在，应改指 `sections/configuration-heading.test.tsx`。

**方案**：分两档。

- **A 档（Step 2 之前，小）**：`pipeline` / `configurationNotice` 改成必填、可显式传空。七个调用点今天都已传，漏传从此是 `tsc` 错误，不需要新守卫。零调用点的 `progressBar` / `backgroundJobsBar` 兼容分支顺手删（见低-4）。spec §7.2 与 docs/33 Step 2 各补「传横幅」一条。
- **B 档（抖音之后）**：在 scaffold 之上、`components/collection/**` 之外加一个只服务 `useCollectionLibrary` 消费者的平铺页装配 Module：整体接收 hook 返回值与平台声明，自己调 `useCollectionPipeline`、构造 strip 与横幅、拼 caption、算 `syncErrorText`。留在 view 的：配置门早退、github 两相位 settle、bookmarks 路由筛选与提取面板、x 冷却与本次新增。bilibili 继续直用 scaffold。

**收益**：A 档之后「漏横幅」由编译器点名。B 档让新平铺 view 少写约 40 行接线（按 zhihu-view 逐段数的估计，未实现），装配 Module 的 Interface 就是测试面，一份测试覆盖今天零测试的整层。

**既有决定**：不冲突。docs/14 警告过「把每个差异做成开关的浅 Module」：github 或 bookmarks 装不进就留在原 slot，不加模式分支。**待决策**：D7（§7）。**风险**：五个 view 没有 characterization 测试，B 档迁移容易漂（github 的 `authFailed=false`、x 的双锁、bookmarks 的原文错误）。

---

### 中-6 spec §9 自称只剩一条无守卫项，实际还有一批翻判别符当天静默过期的手写副本

**性质**：手工同步的平台事实。今天六个平台下产品无错；翻判别符当天变假，零红灯，docs/33 Step 2 一条都没列。skeptic 定低，historian 定中。

**Files**：`lib/i18n/locales/{zh-CN,en}.ts`、`skills/favbase/INSTALL.md`、`README.md`、`README_zh_CN.md`、`PRODUCT.md`、`CONTRIBUTING.md`、`packages/favbase/CLAUDE.md`、spec §2 / §9。

**问题**：

| 副本 | 位置 | 守卫 |
|---|---|---|
| welcome 首屏三句文案把平台数写死成「六」，中英共 6 串；同屏的 OrbitCore 与 PlatformPicker 却由 registry 派生 | `lib/i18n/locales/en.ts:659`、`:684`、`:773`；`zh-CN.ts:644`、`:669`、`:757` | 无 |
| INSTALL.md 开头的第三份手写显示名清单（2026-09-17 加入，使 `packages/favbase/CLAUDE.md:293` 的「SKILL.md 那两份是仅有的手写清单」事后失真） | `skills/favbase/INSTALL.md:5-6` | 无（`tests/agent-bridge-cli-aliases.test.ts:180-258` 不读平台清单） |
| README 两张来源表、PRODUCT.md 的清单 | `README.md:31-40`、`PRODUCT.md:21`、`:33` | 无；自由文案，描述当前发布版 |
| CONTRIBUTING.md 写的「两条」无守卫项与过期实测数字 | `CONTRIBUTING.md:94` | 无；今天就已过期 |
| scaffold 的 `configurationNotice` 可选 slot | 见中-5 | 无 |

不算缺陷的：会红的六平台金样（host 顺序、auto-sync 评估顺序、导航顺序、零快照）正是 spec §2 的机制在工作；`hint` 字段是 docs/26 刻意的「字段 + 证伪测试」。

**方案**：按「删 > 登记 > 守卫」处理，不新增 Module。

1. welcome 三句去掉平台数，改成对任意 N 成立的句子（文案需用户定稿，D8）。
2. INSTALL.md 开头删掉括号里的平台枚举。它从 `main` 被读，而用户装的扩展可能落后；ADR 0005 Amendment 只许它写跨版本稳定的内容，所以是删，不是对账。可在现有 INSTALL.md describe 里加一例拒绝平台显示名回流。
3. README 两表与 PRODUCT.md：不派生、不守卫，登记为 spec §9 的手工行，注明随 Chrome 发布更新。§9 删掉会过期的日期戳；CONTRIBUTING.md 删「two」与过期数字，只留指针。
4. 夹具不单独立项：Step 2 翻判别符时顺手把零快照、overview 两个夹具改为由 `COLLECTION_PLATFORMS` 派生；host 顺序、auto-sync 评估顺序金样保留手写。spec §2 加一句：`pnpm test` 是第三个 TODO 生成器。

**收益**：靠删除解决，零新机制。平台数只存在于 `COLLECTION_PLATFORMS`；agent 面的平台清单只剩 SKILL.md（见中-2）。spec §9 恢复可信。

**既有决定**：docs/26 D10 定过「会红的归 §2，只有静默项进 §9」，挡住了 finder 提的「§9 改成三类清单」；docs/26 附录 A 的清点漏了上表前三行。**待决策**：D8（§7）。**时机**：不晚于翻判别符。

---

### 中-7 「条目不属于任何 Source」有两种互相矛盾的落库约定，没有文档裁决

**性质**：未成文的约定加过期理由；抖音落地后有一处用户可见后果。skeptic 定低，historian 定中。

**Files**：`lib/github/github-sync-service.ts`、`lib/x/x-sync-service.ts`、`lib/collections/platform-descriptor.ts`、`lib/collections/collection-analytics.ts`、`lib/export/obsidian/serialize.ts`、`CONTEXT.md`、spec §3 / §4.3。

**问题**：github 与 x 各写一行合成 Source 并给每条 item 挂 link（`github-sync-service.ts:235`、`:265-268`；`x-sync-service.ts:177`、`:205-208`），同时 descriptor 声明 `source: null`，注释写「平台完全没有 Source」（`platform-descriptor.ts:149`、`:56-58`）。合成行注释里的唯一理由（让 UI 区分「从未同步」与「同步过但为空」）自 docs/32 Step 1 起失效：「上次同步」读 Platform Sync Record，`sources.lastFetchedAt` 在非测试代码里零读者。Collection Analytics 把合成行查出来再按 descriptor 丢掉（`collection-analytics.ts:78`）。

抖音计划（docs/33 D-a）对全部收藏里的条目不写 link。于是同一件事有两种写法，下一个平台得在两个矛盾的先例里猜。

合成行不是死数据：它唯一仍生效的读者是 Obsidian 导出，用它做目录名与 frontmatter（`lib/export/obsidian/serialize.ts:114`、`:41-44`）。零 membership 的条目导出到 `_unsorted/`，该目录的注释把它定义为「link 被丢」的异常桶（`serialize.ts:9-10`）。抖音开发账号 0 个收藏夹、2299 条收藏：异常桶会成为主路径。docs/33 全文没提导出。

**方案**：只留一种编码——Source 只表示平台的真实容器；没有容器，或条目不在任何容器里，就不写 Source 行、不写 link（`lib/douyin` `[WT]` 已是这个形状）。

1. 随抖音 Step 2：`CONTEXT.md` 把「属于一个或多个 Source」改成通用句「零个或多个」，不写成抖音特例；spec §3 Source shape 行把「single: github, x」改成「无 Source」，补第三种答案「有容器、membership 可选」；Obsidian 导出给零 membership 条目一个正常落点（D9）；`lib/ingest` 测试补一例「有 items 无 links 可入库、可查」（今天只锁在 `lib/douyin`）。
2. 独立小提交，可在抖音之后：github / x 停写合成 Source 与 link，删三处过期注释。

**收益**：Locality——「无容器怎么落库」只有一条规则，descriptor 的 `source: null` 与库内数据不再矛盾。Leverage——下一个无容器或 membership 可选的平台不必给假 Source 起名；lib 里两个会成为用户可见目录名的英文硬编码串消失。

**既有决定**：合成 Source 出自 07-12 github 接入任务，唯一用途已被 docs/32 D1 取代；Obsidian 导出的 `_unsorted` 是 07-26 导出任务的已验收行为，改落点是用户可见变化。**待决策**：D9（§7）。**时机**：随 Step 2。

---

### 中-8 同一个 auth 错误在每个 view 里手工拆成两个结论，两个 `credentials` 平台已经写出不同的产品

**性质**：view 半边今天可达的产品不一致；preflight 半边是薄 seam，单看为低。skeptic 定中，historian 定低。

**Files**：`entrypoints/app/sections/{github-stars,youtube,x,zhihu}/*-view.tsx`、`entrypoints/app/components/collection/collection-page-scaffold.tsx`、`entrypoints/app/sections/bilibili/bilibili-sync-adapter.ts`、spec §3 / §7.2。

**问题**：一个已分类的 `syncError` 在每个 view 里被手工拆成 `authFailed` 与 pipeline 显隐两个结论。x / zhihu / youtube 逐字相同，github 已分叉：token 被拒时 github 与 youtube 抛的是同一基类、同一 `reason`，youtube 进「去设置 + 重试」引导，github 进通用错误框或横幅、没有设置入口，同一文件又按 auth 隐藏 pipeline。spec §7.2 写的是 youtube 那条路。

preflight 半边：「凭据已知缺失不算一次尝试」只靠 adapter 把门写在 `runPlatformSync` 之前表达（`entrypoints/app/hooks/platform-sync.ts:48-50`）。这是 docs/32 §5.2 明定的设计，四个门各有一例测试锁住「不进 funnel」。今天门与 `probeReady` 全部同源，只有 bilibili 用了两个名字（`checkAuth` 在 `bilibili-sync-adapter.ts:59`，`getBiliAuth` 在 `:81`），等价性藏在 lib 里。`'login'` 一个值下已有三种探法（本地可判：x；只能联网判：zhihu；抖音计划：标签页存在），descriptor 的 `readiness` 只喂 welcome 与凭据链守卫，spec §3 没写这三种做法。

**方案**：funnel 不动，不新增 Module。

1. scaffold 既然用 `authFailed` 决定相位，就由它在该相位不画 pipeline 行；四个 view 的三目删除。
2. github 传真实的 `authFailed`，凭据被拒改用 youtube 已在用的 `NeedsConfigState`（D10）。
3. bilibili 的 probe 与 run 门读同一个名字。
4. spec §3 Auth shape 行补三种做法，各指一个现存 adapter，写明可叠加，并写明 `probeReady` 的基础答案必须是 run 门那个本地判定。

**收益**：Locality——「auth 失败时页面长什么样」只在 `resolveCollectionPhase` 加 scaffold 一处，view 只报告事实。Leverage——新平台 view 少写一处三目；login 平台的 adapter 作者按 spec 表选路，不必读三个 adapter 加 docs/32 §5.2 才拼出规则。

**既有决定**：finder 提的「funnel 第一阶段执行前置解析」与已否决的通用 sync-adapter 工厂同方向，每平台只省一行门，丢弃。**待决策**：D10（§7）。**时机**：Step 2 之前最好，之后补做的代价只是多删一处三目。

---

### 中-9 inline 正文平台把同一个事实声明两遍；ingest 的不变量由平台测试代为证明

**性质**：留给新 Adapter 作者的静默坑，今天不可达。skeptic 定低，historian 定中。

**Files**：`lib/ingest/ingest.ts`、`lib/ingest/ingest.test.ts`、`lib/{github,x,zhihu,youtube}/*-sync-service.ts` 及其测试、spec §4.3 / §4.5。

**问题**：

1. **`contentState` 与 `content.textOf` 是同一个事实的两次声明**。四个 inline 平台都从同一段文本算出两者（youtube `youtube-sync-service.ts:269` 与 `:295`；zhihu `:202` / `:222`；github `:251` / `:273`；x `:192` / `:210`），抖音 `[WT]` 是第五份。`ingest.ts:438` 只信声明值：声明不是 `'chunked'` 的新条目直接跳过，不调 `textOf`。声明与文本不一致的几种组合都是静默的（正文被丢，或永远 `pending`），只靠 spec §4.3 的文字兜底。
2. **ingest 自己的不变量不在它自己的测试里**。first-write-wins、「取消收藏仍保留」、批内去重、已知条目新增 link、作者解析不到被丢弃，在 `ingest.test.ts` 的 17 例里零覆盖，只经平台测试间接证明：逐字同名的用例有 4 份（github `:178`、x `:176`、zhihu `:222`、youtube `:274`）；「空列表仍 upsert Source」在 4 个平台测试里各一份，而 `ingest.test.ts:525` 已经锁过。spec §4.5 把这种做法固化成对每个新平台的要求。接口即测试面：不变量该锁在拥有它的 Module 上。
3. 内存 PGlite 的建库三行在 `lib/` 下 26 个测试文件各抄一份，没有共享 helper。

**方案**：

1. inline 平台不再逐条声明状态。ingest 今天已经用「传没传 `content` 块」决定是否写正文（`ingest.ts:421`），让它顺势决定状态：传了的调用，`textOf` 有文本的条目走 `has_content → chunked`，没文本的落 `no_content`；没传的调用一律 `pending`。各平台那行同源判断、spec §4.3 的 `contentState` 规则一起消失。`textOf` 与 chunker 仍归平台。写得出来且静默的不一致组合变成写不出来。
2. 在 `ingest.test.ts` 用中性行各锁一次上述不变量。平台测试只瘦身：每平台留一例 re-sync（它兼证 Adapter 没绕过 ingest 自己写表），其余只断言映射、统计与查询。spec §4.5 改写成「测你的映射和查询；ingest 的不变量已在 ingest 锁定」。
3. 一个只被测试 import 的建库 helper 放 `tests/` 下。

**收益**：Locality——状态规则只在 ingest；不变量的回归在一处红，而不是在六个平台测试里各红一次。Leverage——新 inline 平台少写一行判断、少抄一条规则、少抄三类测试用例。收益主要是 Locality，对接入减负不大（每个平台测试文件约 35–75 行加 19 行样板）。

**既有决定**：docs/17 HIGH-1（2026-07-25）已建议过第 1 条；07-18 的 ingest-seam 任务以「管线无独立测试文件」为前提让平台测试代证，该前提已失效（`ingest.test.ts` 现有 553 行）。**待决策**：D11（§7）。**时机**：抖音之后——第 1 条改 `IngestItem`，而未提交的 `lib/douyin` 正用着这个形状。高-1 的 sweep 修复不依赖它。

---

### 中-10 「收藏时间」在模型里没有位置：`sortKey` 把收藏时间与发布时间当成同一种时钟

**性质**：建模缺口。**仅由 critic 一人提出，未经 skeptic / historian 对抗验证**；关键事实由主会话抽查过。有时效性：insert-only 之下事后补不回来。

**Files**：`lib/collections/platform-descriptor.ts`、`lib/collections/collections-query.ts`、`lib/x/x-sync-service.ts`、spec §3。

**问题**：一个 Collection Item 有三种时间：平台发布时间、平台收藏时间、favbase 首见时间。descriptor 的 `sortKey` 只问「原生新旧存在哪」（`platform-descriptor.ts:45`），spec §3 的 Sort key 一问也只问它在 `publishedAt` 列还是 meta 字段，不问是哪一种时钟。结果：bilibili（`fav_time`）、github（`starredAt`）、youtube（`addedAt`）、bookmarks 给的是收藏时间；x（`publishedAt` = 推文发布时间，`x-sync-service.ts:191`）、zhihu、抖音计划给的是发布时间。三个后果：

1. 按发布时间排的平台，新收藏的旧内容沉在列表深处，同步完第一页看不到新东西。x 为此单独加了「本次新增」。
2. 聚合页把两种时钟排进同一条 `ORDER BY`，跨平台的先后没有意义；每接一个不给收藏时间的平台就更乱。
3. docs/27 计划的 `listItems`（「我最近收藏了什么」）写明按收藏时间倒序并复用这条查询，对这些平台答非所问。

x 的接口按收藏新旧返回（增量截断正依赖这一点），这个顺序取数时在手、入库时丢掉。抖音同理。

**方案**：不推翻「知乎 / 抖音不给逐条收藏时间」这个事实，只做两件事。其一，descriptor 的排序键说清自己是哪种时钟，spec §3 的一问拆成两问；聚合页与将来的 `listItems` 据此只在同一种时钟内比较，或统一退到 favbase 首见时间并如实标注。其二，对「接口按收藏新旧返回、但不给时间戳」的平台，入库时留下一个能还原接口顺序的序位，平台页按它排，发布时间只作展示。

**既有决定**：逐平台的妥协已定（知乎用发布时间兜底，PRD 已决策；抖音沿用，用户 2026-10-03 同意默认项）。跨平台的语义没有定过。**待决策**：D12（§7）。**时机**：序位那一半若要做，必须在抖音第一次对真实账号全量入库之前；x / zhihu 已入库的条目要靠一次全量重拉才能补。

---

### 低-1 descriptor 里的 `platform_meta` key 是裸字符串，与平台写入方没有对账

**Files**：`lib/collections/platform-descriptor.ts`、`lib/{bilibili,github,youtube}/` 的写入方、`tests/platform-completeness-contract.test.ts`。

**问题**：descriptor 指向 `platform_meta` 的 key 有六个（bilibili `fav_time` / `intro`，github `starredAt` / `description` / `language`，youtube `addedAt`），类型都是裸 `string`（`platform-descriptor.ts:49`、`:72`、`:108`）。HEAD 上与写入方逐字一致，无缺陷。缺口在于每个 key 被手工钉了两次，两次互不相见：写入方由平台自己的测试钉住，descriptor 由共享读者测试里的手写字面量钉住。写入方改名时红的全在平台目录内，修完之后 descriptor 仍是旧 key 而全套绿——后果是排序、打标简介或 Dashboard 维度静默留空。新平台若选 meta 排序键，唯一自动遍历全平台的排序用例的夹具是从 descriptor 反推的，写错也绿。

**方案**：零生产代码改动。契约测试加一条独立用例：对每个平台取 descriptor 点名的 meta key，断言它是 `lib/<platform>/` 下写入方 `platformMeta` 对象字面量的属性名；按字面量定位、不按文件名，找不到字面量也算红，配探测器自检。

**不做**：finder 提的「平台页 `ORDER BY` 由 descriptor 的 `sortKey` 派生」撤掉——07-26 的 sort-key 任务明确排除过，spec §4.2 把 `ORDER BY` 列为平台自己声明的内容，且平台文件读 descriptor 就得等判别符翻转，打破 lib 层先行。**时机**：独立；抖音取 `publishedAt` / `null` / `null`，不受影响。

---

### 低-2 每个平台数值常量要求 gitignored 的 `.env.local` 也镜像一行

**Files**：`tests/platform-env-constants-guard.test.ts`、`lib/env.ts`、`.env.example`。

**问题**：守卫对 `.env.example` 与 `.env.local` 跑同一段检查（`tests/platform-env-constants-guard.test.ts:208`）；`.env.local` 只在文件不存在时跳过（`:216-217`），存在时必须含登记表的每个键（`:221-227`），且不得有未登记的平台前缀键（`:229-238`）。于是每新增一个 `envNumber` 键，持有 `.env.local` 的机器都要手改这个 gitignored 的密钥文件，agent 必须停下来征求同意——一周内已发生两次（09-30 的 x 冷却键、10-03 的抖音 12 键，docs/33 Step 1 写的「唯一的用户动作」就是它）。两半检查的价值不对称：缺键检查不保护任何行为（缺键即回退默认）；孤儿检查有意义，因为 `.env.local` 是 Vite 唯一真正读取的文件，改名后的旧覆盖会静默失效。

**方案**：只动一个测试文件加几处注释。`.env.example` 保持现状（必须存在，缺键与孤儿双向检查）；`.env.local` 只保留孤儿检查，删掉缺键检查，从全量镜像变回真正的覆盖文件。调用点、登记表、`.env.example` 三处手写不动（那是三把锁的既定设计，不重开命名与集中表）。

**既有决定**：08-18 的 env 迁移任务把「两个文件都须有文档」列在「已确认，不重开」下；当时两个文件都被 gitignore，`.env.local` 是文档唯一的落盘处，09-07 起 `.env.example` 被跟踪，前提已变。**待决策**：D13（§7）。**时机**：独立。

---

### 低-3 根 `CLAUDE.md` 98.9 KB，71% 是逐 Step 落地流水，每个会话与子 agent 无条件加载

**Files**：`CLAUDE.md`、`CONTRIBUTING.md`、`entrypoints/app/CLAUDE.md`。

**问题**：HEAD 上根 `CLAUDE.md` 是 98,915 字节 / 179 行，其中「关键文档」一节 70,653 字节（71.4%），主体是 docs/25–32 逐 Step 落地要点的再抄一遍；docs/32 那一条单行就有 17,639 字节。本次体检的 42 个子 agent 每个都载入了它。副本已在腐烂：`CLAUDE.md:58` 仍写被 `SETTINGS_NAV` 取代的 `ConnSection` / `connNavItems`（2026-09-16 起已不存在）；docs/32 自己三次记录订正根副本。用户 2026-07-01 做过同一次压缩（55.5 KB → 7 KB），涨回来的全在这一节。这与全局规则「文档要精准简短，指出位置而非复制」相反。平台作者真正需要从它拿的只有目录索引与两三条指针。

更正：finder 说「目录文档有两处与 spec 相反」不成立；平台计数短语（「六平台」「6 个平台」）47 处属实，分布在 26 个目录文档，只是低害过期。

**方案**：一个纯文档 commit。「关键文档」每条压成一行：路径 + 何时必须读 + 当前状态；逐 Step 落地要点只留在 docs/NN（抽查 10 个特征词全部能在原文找到）。守卫类条目压成「守什么 + 去读测试头注释」。技术栈、目录索引、跨 runtime 协议、i18n 不动。顺手修 `CONTRIBUTING.md:94` 与 `entrypoints/app/CLAUDE.md:17`。平台计数不单独扫：翻判别符时碰到的目录文档把「六平台」改成「每个平台」。

**待决策**：D14（§7）。**时机**：独立；最好赶在抖音 Step 2 之前，Step 2 还要往这一节加内容。

---

### 低-4 死表面与过期理由

**Files**：`entrypoints/app/components/collection/collection-page-scaffold.tsx`、`entrypoints/app/components/collection/index.ts`、`entrypoints/app/hooks/use-collection-library.ts`、`lib/i18n/locales/{zh-CN,en}.ts`、spec §4.3。

**问题**：

- 自 2026-07-25 换成 pipeline strip 起，scaffold 的 `progressBar` / `backgroundJobsBar` 两个 slot 与 fallback 分支（`collection-page-scaffold.tsx:139`、`:143`、`:343-348`）、`SyncProgressBar` / `BackgroundJobsBar` 两个组件与 barrel 导出（`index.ts:7-8`）、`useCollectionLibrary` 与 B 站 folders hook 的 `syncProgress`（`use-collection-library.ts:94`）、中英各 4 条 `*.syncProgress` locale 键（`zh-CN.ts:521` 等）都没有读者。各平台进度类型里 x 的 `page`、zhihu 的 `current` / `total`、youtube 的 `playlistIndex` / `playlistCount` 只写不读，界面只读 `fetchedCount`。
- spec §4.3 与另外六处写的「`'pending'` 会喂给 auto-transcribe」自 07-27 改成 producer-fed 后失效；规则保留，理由要换成真实后果。
- `lib/collections/collections-query.ts` 与 `lib/database/collection-queries.ts` 只差一个字母，职责不同；`use-*` 文件里住着 job 启动器。记录，不改名。

**方案**：全是删除或改一句话，不新增 Module、seam 或守卫。新平台作者少学两个不存在的 slot、少抄一个没人读的进度字段。**不做**：`components/collection-states/` 目录改名（其 `CLAUDE.md:32` 已记为接受的取舍）。**时机**：独立；spec 那两句值得赶在 Step 2 作者读 spec 之前改。

---

### 低-5 `COLLECTION_PLATFORMS` 的数组顺序同时背着三份互不相干的约定

**性质**：**仅由 critic 提出，未经对抗验证**。

**Files**：`lib/collections/platforms.ts`、`wxt.config.ts`、`lib/collections/platform-descriptor.test.ts`、`entrypoints/app/theme/core/palette.test.ts`、spec §6.1 / §12。

**问题**：一个数组的顺序同时是：manifest 的 `host_permissions` 顺序（`wxt.config.ts:37` 按它 flatMap，金样连顺序一起锁，`platform-descriptor.test.ts:16`）；全部界面的展示顺序（侧栏、welcome、Dashboard 环图与图例、给模型的平台清单）；配色相邻性的前提（品牌色只按相邻对验证过，github / x 两个 `'ink'` 品牌同色，抖音计划是第三个 `'ink'`）。结果是新平台只能排最后：想挪位置就得改金样、违反 spec §12、重跑仓库里没有的配色校验器。

spec 与 docs/26 的说法是「`host_permissions` 一变就要用户重新授权」。Chromium 的 `extensions/docs/permissions.md` 写的是：更新时停用扩展的条件是新版本的权限**高于已授予的权限**，被更宽 host 模式包含的 host 属于冗余、不另行警告。`<all_urls>` 已在清单里。主会话读到该文档的 Permission Increases 与 Permission Collapsing 两节，据此顺序不参与判断；critic 引用的 Determining Privilege Increase 一节主会话没读到，标 `[UNKNOWN]`。

**方案**：三份约定拆开。manifest 那份改成与展示无关的确定性排列，金样只锁集合，spec 里「重排即重新授权」按 Chromium 文档订正；展示顺序留给 `COLLECTION_PLATFORMS`，成为纯产品决定；配色前提写进测试（按环图真实相邻关系含首尾检查相邻两段不同色，`'ink'` 品牌多于一个时不得相邻）。

**既有决定**：docs/26 铁律 2（manifest 字节相同、flatMap 顺序不变）是为那次纯重构定的，没有讨论展示顺序。扩展未上线，现在改没有用户成本。**时机**：独立，落地前先把 Chromium 的行为实测一次。

---

### 低-6 增量截断「已知 id 即停」的前提没有写下来

**性质**：**仅由 critic 提出，未经对抗验证**。

**Files**：`lib/database/collection-queries.ts`、`lib/x/x-sync-service.ts`、`lib/x/x-api.ts`、spec §3 / §4.2。

**问题**：insert-only 之下，库里的 id 集合是「历史上见过的全部」，不是「当前账号此刻收藏的全部」，也没有账号维度（`collection-queries.ts:183`）。spec §4.2 把 `platformItemIds` 推荐为增量截断的依据（`:176`），没写它成立的前提：库的一生只有一个账号；取消收藏的条目不会回到列表头部。x 用的是最弱的形态，遇到第一个已知 id 就停（`x-sync-service.ts:152`、`x-api.ts:446`）：换一个账号登录后，只要新账号收藏过旧账号也收藏过的推文，那一条之后的历史永远不会被拉取。抖音 `[WT]` 的断点状态同样不带账号。全是静默的。「多账号不在范围内」只在 `lib/x/CLAUDE.md` 说过一次。

**方案**：不共享截断规则（停在哪里归平台）。spec §3 多问一句「全量重拉还是增量截断」，选增量的写明上述前提如何满足或为何可接受；把「不支持多账号」从 x 的目录文档提到 spec 或 `CONTEXT.md`，成为对所有平台明示的范围。登录态平台是否记下「这是谁的进度」并在换人时作废增量状态，留待用户决定是否值得做；x 侧可用的账号标识 `[UNKNOWN]`。

---

## 3. 观察项（写明触发条件，现在不做）

| # | 观察 | 现状 | 触发条件 | 现在可做的小事 |
|---|---|---|---|---|
| 观-1 | 同步拒绝的第三种形状：「用户得去平台站点做一件事」（验证页、刷新标签页） | 两个基类之外一律 `'unknown'`，英文原文进 UI，这是 docs/32 Step 4 明文保留的设计。zhihu 的 200 挑战页走这条路（`lib/zhihu/zhihu-api.ts:465`），但没有真实样本、没有测试。抖音 `[WT]` 把验证页归限流（`resetAt: null`），而 `SyncErrorCopy` 本就按 `resetAt` 有无选两个文案键，验证与冷却已经能分开说 | 抖音 Step 3 实机观察到验证页或 SDK 未就绪成为常见失败；或 zhihu 挑战页出现真实样本 | 对齐 `sync-errors.ts` 的 `resetAt` 字段注释（改成「favbase 何时可以再试：平台报告的，或平台 Adapter 自己定的冷却」）；抖音 Step 2 的文案不要照手册写成「验证码与限流共用」一条；zhihu 挑战页是否现在就在 `lib/zhihu` 内并入现有形状（D15） |
| 观-2 | 一次 Platform Sync 内请求之间的等待没有 owner | `lib/http` 只共享 `sleep`、延迟算术与重试等待；「首个请求不等、其后每个请求前等」手写在 6 个文件 11 处，checkpoint 与等待的先后也不一致。运行级节奏的显式实现只有抖音 `[WT]` 的 pacer 一份 | 第二个平台要复制这个 pacer；或用户决定给 B 站补夹间等待 | 抖音落地后 spec §4.1 加一句「节奏按整次运行算，跨端点、跨 Source 容器也算」。**B 站相邻收藏夹的第 1 页之间零等待**（`lib/bilibili/favorites-sync-runner.ts:84`，`page` 每夹重置），每日自动同步现在遍历全部公开夹，对出过 412 的端点连发 N 个请求：这是风控语义，07-24 的验收条写的是「不在第一页之前等待」，是否补等待由用户决定（D16） |
| 观-3 | 延迟正文的「同步后链式 drain」只有 bookmarks 一个 Adapter | 两个延迟正文 Adapter 真正共享的部分（正文写入、「落定 → 事件 → 逐条派发」尾巴）已由 docs/32 Step 5 收进 `lib/ingest` 与 spec §4.4。队列谓词、串行 worker、job hook、进度面板（约 490 行）只有 bookmarks 用。spec 把它叫 Template 是如实的照抄模板 | 第二个不透明文本延迟平台立项 | spec §4.4 的 Template 拆两栏：可直接调用的与只能照抄的；补一条隐性规则：声明 `'pending'` 且不传 `content` 时，同步的 ghost sweep 不为你运行，队列谓词是唯一重试路径 |
| 观-4 | 转录管线在 `lib/bilibili` 之外带着 B 站形状 | string 键的 handler 表、`cid` 必填、小写 cache id、唯一一条 DNR 规则，都只有一个 Adapter | 第二个要转录的平台立项。抖音是视频平台，但正文只取 `desc`，不触发 | 无。泛化已被 docs/32 §4 否决 |
| 观-5 | 每次 `ingestCollection` 调用按 platform 全量重选 id-map，逐页调用方按页数重复支付 | 有记录的语义理由（已知条目新加入另一个 Source 仍要得到 link）；耗时零测量 | 抖音 Step 3 实测全量同步时它可感知 | 无；docs/33 已排在 Step 3 记录 |

---

## 4. 确认健全，不要动

多个视角独立确认的部分。抖音的六个受力点都能放进它们，不需要共享 Module 长平台分支。

- **Platform Sync funnel** 的顺序与职责（checkpoint → 记尝试 → 同步 → 成功先派发再记成功 / 失败记失败并原样抛出）是 deep Module：`entrypoints/app/hooks/platform-sync.ts:61-88`。
- **同步错误分类**只认两个基类、零平台知识；基类文件零 import：`entrypoints/app/hooks/collection-sync-error.ts:23-30`、`lib/collections/sync-errors.ts`。
- **Chat / Knowledge Tools / Agent Bridge 对第 7 个平台零改动**：平台清单与 `contentKind` 清单全部派生：`lib/chat/tools.ts:50`、`lib/chat/prompts.ts:18`。
- **导出零改动**：CSV / JSON 由 schema 派生（`tests/export-schema-sync.test.ts`），Obsidian 查询的 platform 是 string（落点规则见中-7）。
- **Collection Analytics / overview 零改动**；新维度名词是真实的逐名词事实（一个标签键加一个图标），漏了 `tsc` 报错，不值得派生：`entrypoints/app/sections/overview/analytics-dimension-ranking.tsx:17`、`:31`。
- **welcome 的 OrbitCore 与 PlatformPicker** 由 registry 派生，第 7 个平台零手写：`entrypoints/welcome/components/orbit-core.tsx:17`。
- **locale 机制**：被引用的键由 `LocaleKeys` 把关，`en` 是 `Record<LocaleKeys, string>`，键集不一致即编译错误。
- **bilibili 的离群不外溢**：共享代码对 bilibili 的 import 只有三处注册表与一张转录 handler 表，新的平铺平台不需要读 bilibili 代码。
- **接入平台永不需要迁移**：`items.platform` 是没有 CHECK 的 text：`lib/database/entities/items.ts:9`。
- **`lib/http` 的重试与等待原语吃回调而不吃 `Response`**，注入式 transport 可原样复用：`lib/http/retry.ts:48-51`。
- **daily auto-sync 的求值顺序**（闸门 → 暂停 → 探针 → `startJob`）天然支持「未就绪 = 静默跳过、不记尝试」，抖音的标签页门不需要新分支：`entrypoints/app/hooks/use-daily-auto-sync.ts:87-95`。
- **两份 Platform Descriptor 加四处重值注册表**的形状（ADR 0004）没有任何视角建议改动。

---

## 5. 本次被再次提出、已有决定且没有新证据的方案（丢弃）

| 被提出的方案 | 挡住它的决定 |
|---|---|
| SKILL.md frontmatter 改按类别措辞、不再穷举平台 | docs/26 Step 3 D9（agent 靠这份清单选 skill，漏列是静默的） |
| funnel 增加「前置解析」第一阶段，把凭据句柄交给闭包 | docs/32 §4「通用 sync adapter 工厂」：每平台只省一行门 |
| 平台页 `ORDER BY` 由 descriptor 的 `sortKey` 派生 | 07-26 sort-key 任务明确排除；spec §4.2 把 `ORDER BY` 归平台文件 |
| 六个平台都在请求入口调共享 pacer | docs/32 Step 3：对 youtube / github / bilibili 那是新增等待，行为变化不能随重构带入 |
| 加第三个错误基类；把失败冷却持久化进 Platform Sync Record | docs/32 §5.1 / §5.2 与 09-30 sync-error-model 任务的 out of scope（其中限流时刻一项因新证据列为 D6） |
| 抽共享的延迟正文 worker 与进度面板 | docs/32 D5 |
| 泛化转录协议 | docs/32 §4：等第二个转录平台 |
| manifest API 权限由 descriptor 派生 | docs/32 §4（中-1 只加断言与 spec 位置，不派生） |
| spec §9 改成三类清单；README 进完成定义 | docs/26 D10：会红的归 §2，只有静默项进 §9 |
| 合并 `useCollectionLibrary` 的 `platform` / `jobPlatform` 双键 | docs/32 Step 9 的已知缺口（中-3 只统一值，不动双键） |
| `components/collection-states/` 目录改名 | 该目录 `CLAUDE.md` 已记为接受的取舍 |
| env 常量改名或集中成一张表 | 08-18 env 迁移任务「已确认，不重开」（低-2 只动 `.env.local` 那一半） |

---

## 6. 执行顺序（相对 docs/33）

每项一个独立 commit、一次对话只做一项。抖音 Step 1 已提交（`9340ab4`），下面各项不再与它抢文件；开工前先确认没有别的会话正在改同一批文件。

**抖音 Step 2 之前**（按顺序）：

1. 高-1：ghost sweep 判决规则（先定 D1）。
2. 高-2 的第 1 件：泛型 hook 的重读规则。
3. 中-3：job namespace 统一成平台 id（先定 D5）。先做，抖音就不必发明 `'douyin-collections'`。
4. 中-1：定 transport 落点（D3）；守卫目录发现；`permissions` 黄金断言。
5. 中-2：定 D4（它决定 Step 2 是不是发布 commit）；SKILL.md 的 id 句改指运行时，搭已欠的 0.2.2。
6. 中-4 第一层：限流锁收进 scaffold。
7. 中-5 的 A 档与中-8：两个 slot 必填；scaffold 在 auth-failed 相位不画 pipeline（先定 D10）。
8. 中-6：welcome 文案与 INSTALL.md（先定 D8）。
9. 低-3：根 `CLAUDE.md` 压缩（先定 D14）。
10. 中-10：定 D12。序位那一半若做，要改 `lib/douyin` 的入库形状。

**随抖音 Step 2**：高-2 的第 2 件（逐条派发入口）；中-7 的文档与导出落点（D9）；中-1 的 spec 改写；中-6 的夹具派生；观-1 的文案拆分。

**抖音之后**：中-5 的 B 档（平铺页装配 Module）；中-9（`contentState` 推导与测试归位）；中-7 的 github / x 合成 Source 清理；观察项按触发条件。

**独立，随时可做**：低-1、低-2、低-4、低-5、低-6。

---

## 7. 待决策汇总

| # | 问题 | 推荐默认 | 另一选项的代价 | 归属 |
|---|---|---|---|---|
| D1 | x 首次全量被打断留下的幽灵怎么处理 | x 像 github 那样在平台侧为自己的幽灵供回正文（推文全文已在 `platform_meta.text`），幽灵全部可治愈，ingest 仍零平台知识 | 维持 07-27 原判：sweep 得保留「没见过也判死」并让调用方声明自己是全量批次，Interface 多一条须知，x 被打断的推文永久无正文。或什么都不补：x 旧幽灵停在 `has_content`，Content 覆盖率永远差这几条 | 高-1 |
| D2 | 成功的 Platform Sync 收尾要不要像 embed 那样也排空 tag 积压 | 不要。维持 07-18 的「无重试 / 无回填」，漏打标靠逐条派发加保存 LLM 配置时的积压重跑 | LLM 判零标签或失败的条目不留痕迹，每次同步都会重新请求 LLM；要避免就得加持久的「已尝试」标记，那是一次撤不掉的迁移 | 高-2 |
| D3 | 抖音注入式 transport 放 `lib/douyin/` 还是按 docs/33 留在 `sections/douyin/` | `lib/douyin/` 的独立 leaf（不进 sync-service 静态图，同 `lib/x/x-auth.ts`），sections 只接线；docs/33 铁律 1 改述为「douyin-api / sync-service 的加载图零 chrome」 | 要么把 sleep / env / fetch 三条守卫扩到 `sections/<p>/`（那里有 UI 数值常量，得开 allowlist），要么接受风控最敏感平台的真实请求路径是唯一不受策略守卫约束的平台代码 | 中-1 |
| D4 | SKILL.md frontmatter 显示名清单的对账，是否从「常驻双向相等」放宽为「不得列出产品已没有的平台 + 测试里的显式 pending 清单，CLI 发版时清零」 | 放宽。pending 让欠账在测试里可见，「main 的 SKILL.md 等于 npm 最新版」不受影响 | 维持：每次翻判别符都是一次只有你能做的 2FA 发版，平台 commit 与发版原子绑定，回滚 = 再发一版。放宽的代价：新平台上线到下一次 CLI 发版之间，全新安装的 CLI 的 description 也不提它。抖音这次怎么选都差不多，0.2.2 本来就欠着 | 中-2 |
| D5 | 是否把 github / x / zhihu / youtube 的 job namespace 改成平台 id，并删掉 descriptor 的 `jobPlatform`、映射 Module 与 docs/32 Step 5 的 AST 守卫 | 是 | 抖音成为第五个不同名平台，守卫、映射层与 spec 三处规则继续保留，日后统一要多改一个平台。最低限度也应让抖音那一格直接取 `'douyin'` | 中-3 |
| D6 | 是否给 Platform Sync Record 加一个可空的「限流到何时」（迁移 v008），让锁跨刷新、跨标签页 | 不加。先做零迁移的第一层，抖音 Step 3 实机见到风控后再议 | 不加：刷新 app.html 即解锁，用户可在冷却内再打一次抖音（单次请求，遇 403 即停）。加：迁移撤不掉；把一个时长未知的猜测值变成手动也绕不过的硬锁 | 中-4 |
| D7 | 平铺页装配 Module 放在抖音 Step 2 之前还是之后 | 之后；Step 2 前只做 A 档 | 之后：`douyin-view` 把约 40 行接线抄第六遍，随后六个一起迁。之前：在零 view 测试、另一会话正在写抖音的情况下先动五个 view | 中-5 |
| D8 | welcome 首屏三句文案里的「六个平台 / Six platforms」怎么处理 | 改写成不含数量的句子（与 07-29 README PRD「不把 favbase 定义成六平台产品」一致） | 插值派生：首屏的「六个」变成阿拉伯数字 7，句首是数字的英文句要重写。保留手写并登记进 spec §9：每个平台手改 6 个串，漏了零红灯 | 中-6 |
| D9 | 是否把「无容器 = 不建 Source 行」定为唯一规则，并让 Obsidian 导出把零 membership 条目直接放在平台根目录下（取消 `_unsorted`） | 是。扩展未发布，无存量用户 | 保留合成 Source 加 `_unsorted`：零代码，但两种编码都要在 spec 里写成合法，抖音无公开收藏夹的用户全部条目落进读作「出错」的 `_unsorted/` | 中-7 |
| D10 | GitHub token 被拒时，页面是否改成与 YouTube 密钥被拒相同的「前往设置 + 重试」引导 | 是。youtube 是 spec 的参考实现 | 否：spec 要写明两种呈现及何时选哪种，下一个 `credentials` 平台抄谁得谁。是的代价：token 被拒且本地库非空时整页换成引导，卡片网格被遮住直到错误清除 | 中-8 |
| D11 | inline 正文平台是否不再逐条声明 `contentState`，改由 ingest 推导 | 是（docs/17 HIGH-1 已建议，最终状态不变） | 每个新 inline 平台继续手写一行同源判断，不一致组合仍只靠 spec 文字兜底 | 中-9 |
| D12 | 是否让 descriptor 的排序键声明时钟种类；是否为「按收藏新旧返回但无时间戳」的平台存一个接口序位 | 时钟种类：做（纯声明加 spec 一问）。序位：需要你判断「新收藏的旧内容沉底」是不是你在意的产品问题 | 不做：聚合页与将来的 `listItems` 继续混排两种时钟；抖音一旦全量入库，序位只能靠清库重拉补 | 中-10 |
| D13 | `.env.local` 继续当全量镜像，还是变回只写覆盖项的私有文件 | 变回覆盖文件，守卫只拒绝无代码读取的平台键 | 保持镜像：每新增一个数值键都要手改这台机器的密钥文件，agent 每次都要停下来征求同意 | 低-2 |
| D14 | 根 `CLAUDE.md`「关键文档」是否压成每条一行，逐 Step 落地要点只留 docs/NN | 是 | 每个会话和子 agent 继续多载约 60–70 KB，每个 Step 继续手工同步两份 | 低-3 |
| D15 | zhihu 的 200 挑战页要不要现在就在 `lib/zhihu` 内并入现有错误形状 | 现在做：一处抛出点加一例测试，属平台自己的判断 | 等真实样本：该分支继续零覆盖，出现时中文用户看到英文加 HTML 片段 | 观-1 |
| D16 | B 站同步时，相邻收藏夹的第 1 页请求之间要不要也等 7–10 s | 维持不等，在 `lib/bilibili/CLAUDE.md` 写成有意决定，重开条件是同步路径第一次观测到 412 | 补等待：几十个公开夹的账号每日自动同步从几秒变成 5 分钟以上；换来的是不再对出过 412 的端点连发 N 个请求 | 观-2 |

---

## 附录 A 接入成本普查（youtube 与 zhihu 为基线，HEAD 实测）

普查由一名 finder 用 `wc -l` 与逐项计数完成，57 行原始记录；app 侧行数与 locale 键数由主会话复核过。「会红」是按代码阅读判断的，没有运行。

**平台自己两个目录之外要动的文件数**：

| 形态 | 源码 / 配置 / 内容文件 | 会红的测试文件 | 完成定义要求的文档 | 不会报错的清单副本 |
|---|---|---|---|---|
| youtube（凭据链、有色品牌、两个新维度名词） | 22 | 9 | 3 | 约 16（10 份文档、6 个测试夹具） |
| zhihu（无凭据链） | 17 | 9 | 3 | 同上 |
| 抖音（`'ink'` 品牌、复用维度、多一个权限与一个 storage key） | 约 17–18 | 8 | 5 | 同上 |

**app 侧必须手写的行数**（docs/32 §7 口径：adapter + hook + view + card + tagged card + chips + skeleton）：zhihu 343 行（docs/32 之前 556，估计值约 283），youtube 318 行。差距在 view（153，估约 110）与 adapter（53，估约 30）。

**主要手写产物**：

| 产物 | youtube | zhihu | 漏了谁报 |
|---|---|---|---|
| `lib/<p>/<p>-api.ts`（获取 / 风控 / 凭据三轴，平台自有） | 500 行 | 619 行 | fetch / sleep / env 守卫管内容 |
| `lib/<p>/<p>-sync-service.ts` | 392 行 | 325 行 | import-smoke |
| sync-service 测试 | 480 行 | 383 行 | 无 |
| api 测试、narrow-meta 测试 | 161 行 | 272 行 | 无 |
| Sync Adapter 及测试 | 49 + 95 行 | 53 + 69 行 | `tsc`（adapter） |
| 数据 hook | 34 行 | 31 行 | `tsc` |
| view | 167 行 | 153 行 | 契约只查面包屑调用 |
| card / tagged card / skeleton | 56 / 6 / 6 行 | 94 / 6 / 6 行 | `tsc` |
| 两份 descriptor 条目加四处重值注册表 | 约 31 行 | 约 30 行 | `tsc` |
| locale 键（每种语言） | 35 | 20 | `tsc`（被引用的键） |
| 凭据链（settings 字段、zod、draft / save、设置页 section、连接卡） | 约 246 行 | 0 | 契约只查结构存在 |
| `.env.example` 块、登记表行、`.env.local` 块 | 7 / 3 / 3 | 15 / 7 / 7 | env 守卫 |
| SKILL.md 两份清单加 CLI 版本号 | 2 + 1 | 2 + 1 | cli-aliases 测试；连带一次 npm 发版 |
| welcome marquee 药丸、离线图标 | 1 + 5 行 | 1 + 3 行 | 契约 / `tsc` |
| 目录 `CLAUDE.md` 两份、根索引、路由表、spec「已接入」清单 | 5 处 | 5 处 | 无 |

大头仍是平台专属代码，这与 docs/26 §0.4 的结论一致：注册表从来不是工作量的主体，是会被忘掉的那部分。本文的发现集中在三处：共享 Module 对「一次同步长什么样」的隐含假设（高-1、高-2），替缺失 seam 兜底的机制（中-1、中-3），以及翻判别符当天静默过期的副本（中-2、中-6）。

---

## 附录 B `[UNKNOWN]`

- 高-1：phase 5a 的窗口时长；现有库里是否已有被误判的 x / youtube 条目；抖音用同一 cursor 重拉是否返回同一页。
- 高-2：运行中重读的合适频率（等抖音 Step 3 实测）。
- 中-2：`favbase tools` 需要扩展在线；删掉 id 句后 agent 首次带 `--platform` 猜错 id 的频率。
- 中-10、低-5、低-6：仅 critic 一人提出，未经对抗验证。低-5 所依据的 Chromium 行为没有实测。
- 观-1：zhihu 挑战页的真实出现频率与形态。
- 观-2：B 站同步路径是否触发过 412，无观测记录（docs/32 附录 A 同一条）。
- 本次体检没有运行 `pnpm compile`、`pnpm test` 或 `pnpm build`；所有结论来自读代码。`lib/douyin/**` 与 docs/33 在体检期间持续变动；正文点名的 `[WT]` 行已按 `9340ab4` 复核，verifier 中间引用过而正文没点名的行没有复核。

---

## 附录 C 体检顺带发现的文档失实（与代码不符）

| 位置 | 写的是 | 实际 |
|---|---|---|
| `lib/youtube/CLAUDE.md:26` | 幽灵由「全量重拉手握 description 顺手补写」 | 详情只为未知 id 拉取（`lib/youtube/youtube-sync-service.ts:202`），旧幽灵拿不到正文（高-1） |
| docs/33 `:290`（`9340ab4`） | 逐页 ingest 的幽灵清扫「正确性无影响」 | 有条件路径下页外幽灵会被判死（高-1） |
| docs/33 `:350` | view 测试「照 zhihu / x 的 view 测试形状」 | 平铺 view 没有测试文件；可参照的是 `sections/configuration-heading.test.tsx` |
| docs/33 `:304` | 提交与发版只有 (a) / (b) 两条路 | 发布纪律约束的是 `origin/main`，分支或未推送的 commit 是存在的中间态（中-2） |
| `packages/favbase/CLAUDE.md:293` | SKILL.md 那两份是仅有的手写平台清单 | `skills/favbase/INSTALL.md:5-6` 是第三份，零守卫（中-6） |
| spec §9 | 只剩一条无守卫项 | 见中-6 的表 |
| `CONTRIBUTING.md:94` | spec §9 有两条 | 一条（且该数字本身不可信，见上） |
| `CLAUDE.md:58` | 凭据链守卫查 `ConnSection` 联合成员与 `connNavItems` | 两者 2026-09-16 起已被 `SETTINGS_NAV` 取代 |
| spec §4.3 等七处 | `'pending'` 会喂给 auto-transcribe | 07-27 起 auto-transcribe 改为 producer-fed；规则仍对，理由已过期（低-4） |
| `lib/collections/platform-descriptor.ts:56-58` 注释 | `source: null` 表示平台完全没有 Source | github / x 的库里各有一行合成 Source 与逐条 link（中-7） |
| `sync-errors.ts` 的 `resetAt` 字段注释 | 平台说的解除时刻 | 抖音 `[WT]` 用它装 favbase 自定的冷却（观-1） |
