# 32 跨平台流程统一度审计与分步整改（2026-09-29）

> 状态：**审计完成；D1、D2 已决（2026-09-29，§5.1、§5.2）；Step 1 已落地 2026-09-30（代码 + 单测；运行时验证待人工，见 §6 Step 1 落地记录）；D6 已决（用户 2026-09-30，按推荐）；Step 2 已落地 2026-09-30（代码 + 单测；运行时验证待人工，见 §6 Step 2 落地记录）；Step 3 已落地 2026-09-30（代码 + 单测；运行时验证待人工，见 §6 Step 3 落地记录）；Step 4 已落地 2026-09-30（代码 + 单测；运行时验证待人工，见 §6 Step 4 落地记录）；Step 5 已落地 2026-10-01（代码 + 单测；运行时验证待人工，见 §6 Step 5 落地记录）；Step 6 已落地 2026-10-01（代码 + 单测；运行时验证待人工，见 §6 Step 6 落地记录）；D3 已决（用户 2026-10-02，按推荐：删除）；Step 7 已落地 2026-10-02（代码 + 单测；运行时验证待人工，见 §6 Step 7 落地记录）；Step 8–9 均未实施**。执行任一 Step 前先读 §2 否决清单与 §5 对应决策；一次对话只做一个 Step。
>
> 起因：用户观察「接入新平台时，数据处理、备份、展示都高度统一，真正不同的只有数据获取和风控」，要求找出仍未统一的流程并给出分步整改。
>
> 方法：六平台（bilibili / github / bookmarks / x / zhihu / youtube）× lib 同步链路、app section、横切子系统逐层对比，再对 docs/13–17、20、26、architecture-audit-2026-08-17 与 `.trellis/spec/frontend/platform-onboarding.md` 做决议盘点。本文所有 `file:line` 已于 2026-09-29 逐条回查。

---

## 0. 结论

### 0.1 计分卡

| 阶段 | 统一程度 | 证据 | 本文编号 |
|---|---|---|---|
| 写库（五阶段 insert-only 事务） | 统一 | 六平台都调 `ingestCollection`（`lib/ingest/ingest.ts`）；B站按页调用、不传 `content` 块 | — |
| Embedding / 打标 lane | 统一 | `startCollectionProcessingJobs`：embed 吃平台整个 `chunked` 积压、tag 吃本次 id（`entrypoints/app/hooks/collection-processing-jobs.ts:101-109`）；`lib/embedding`、`lib/tagging` 无平台调用点 | 例外见中-4 |
| 备份（WebDAV） | 统一 | 只同步 `settingsStorage` + `localeStorage`，零平台分支（`lib/sync/sync-engine.ts:100-131`）；数据库同步是未做的二/三期 | — |
| 导出 | 统一 | `EXPORT_TABLES = Object.values(schema)`（`lib/export/query.ts:12`），JSON/CSV 无平台分支 | — |
| Chat / Agent Bridge | 统一 | 平台清单派生（`lib/chat/tools.ts:50`，`lib/chat/prompts.ts:18`），检索按 `platform` 过滤不分支 | — |
| 页面编排 | 统一 | `CollectionPageScaffold` / `useCollectionPipeline` / `useCollectionBreadcrumbs` 六平台强制（spec §10） | — |
| **同步收尾与同步记录** | **未统一，且是行为缺陷** | 自动同步失败不留记录、空库永远算「从未同步」；X 自建 storage | **高-1** |
| 风控**机制**（重试循环、响应读取） | 复制 | x / zhihu 两份重试循环、`bodySnippet` 逐字节相同 | 中-1 |
| 错误模型 | 复制 ×4 | 4 个分类器、4 个 `syncErrorMessage`、5 个互不相关的 AuthError | 中-2 |
| platformMeta 解码 | 4/6 | bookmarks 两份已分叉，B站无 decoder（docs/20 中-8 未落地） | 中-3 |
| 共享模块里的平台特例 | 2 处无守卫 | tagging 读 B站专属 `meta.intro`；analytics 写死 `'github'` | 中-4 |
| 平台页外壳 / 数据 hook | 复制 | 4 个平铺 view 约 70% 相同接线；hook 60–70% 是字段改名 | 中-5 |
| 正文来源（延迟获取） | 两条平行管线 | 书签网页提取与 B站转录各写各的，job 命名空间硬编码 | 中-6 |
| 查询 WHERE 片段 | 部分 | `pagedItemsQuery` 已共享，片段仍复制 | 低-1 |
| tagged card / facet chips | 复制 | 外壳 ×6、chips ×3 | 低-2 |

### 0.2 对用户假设的两处修正

**(a) 平台真正不同的是四个轴，不是两个。** 除了获取（分页模型 / diff 策略）和风控（节流 / 重试 / 限流语义），还有：

- **凭据获取**：PAT 头、`webRequest` 捕获、cookie jar、API key、无——五种机制，已有决议认定「凭据链不可派生」（§2）。
- **正文来源**：随同步到手（x / zhihu / youtube、github 的 README 在同步内拉）vs **延迟获取**（书签网页提取、B站字幕/ASR 转录）。domain descriptor 的 `contentKind` 已经承认这一轴（`lib/collections/platform-descriptor.ts:60-77`），但延迟获取没有契约（中-6）。

**(b) 复制不在这四个轴里，而在包住它们的两层：**

- **机制层**：重试循环、响应读取、错误分类、同步收尾、查询片段。四个轴的**语义**属于平台，但执行这些语义的骨架每个平台都重写了一遍。
- **外壳层**：页面状态组件、数据 hook 的改名层、tagged card、chips、i18n 同文键。

「备份一样」「处理一样」这两半是对的，本文直接确认，不再动。

### 0.3 最该先修的一条

**高-1 不是重构，是风控缺陷。** 自动同步失败（例如知乎 403、B站 412）后不留任何记录，每次标签页重新可见（30 s 节流）就再打一次**刚刚风控了我们的平台**；知乎未登录用户同理。见 §3 高-1。

---

## 1. 四个轴：该留在平台里的东西

| 轴 | bilibili | github | bookmarks | x | zhihu | youtube |
|---|---|---|---|---|---|---|
| 获取：分页模型 | 页号 + `has_more`，逐夹基线（`lib/bilibili/favorites-sync-runner.ts:70-129`） | 页号 + `Link rel=last`（`lib/github/github-api.ts:193-214`） | `chrome.bookmarks.getTree` 全树（`lib/bookmarks/bookmarks-api.ts:164-167`） | Bottom cursor，遇已知即停（`lib/x/x-api.ts:421-469`） | `paging.next` + offset（`lib/zhihu/zhihu-api.ts:501-615`） | `pageToken`（`lib/youtube/youtube-api.ts:370-502`） |
| 风控语义 | 页间 7–10 s 抖动，源于 412 封禁事故（`favorites-sync-runner.ts:6-10`） | `x-ratelimit-remaining=0` 的 403 → 限流（`github-api.ts:60-70`） | 网页抓取 1 s 间隔 | remaining/reset 头 + 200 体里的 `code:88` + 5 分钟冷却 | 403 是反爬、**不重试**（`zhihu-api.ts:420-423`）；429 指数退避 | quota reason 的 403 / 429 |
| 凭据 | cookie jar + `chrome.cookies` 登录门（`bilibili-api.ts:60-77`） | PAT Bearer 头 | 无 | `webRequest` 捕获（`entrypoints/background.ts:82-95` → `lib/x/x-auth.ts`） | cookie jar `credentials:'include'` | API key 查询参数 |
| 正文来源 | **延迟**：字幕 / ASR 转录 | 同步内拉 README | **延迟**：SW 抓网页 + defuddle | 推文正文随列表 | HTML → Markdown 随列表 | description 随列表 |

这四行的差异全是平台事实，受已有决议保护：

- 「平台 Adapter 继续拥有认证、分页、响应解释和 rate-limit 语义」（`docs/architecture-audit-2026-08-17.md:256`）。
- 凭据链「It genuinely is not」derivable（`.trellis/tasks/archive/2026-09/09-07-credentials-chain-completeness-guard/prd.md:111`）。
- env 常量名是 TS 常量名的机械映射，「已确认，不重开」；v2 集中 policy 表「已否决，不再讨论」（`.trellis/tasks/archive/2026-08/08-18-refactor-migrate-platform-numeric-constants-to-env-configurable-via-lib-env-ts/prd.md:3,9`）。

**所以本文的所有 Step 都只动机制和外壳，不统一任何一个轴的语义或数值。**

---

## 2. 历史否决清单（后续 Step 不得重提）

| 否决项 | 出处 | 本文如何避开 |
|---|---|---|
| 四处重值注册表不动；不修 `App.tsx` eager 图；marquee 不派生；不做 `platforms/<id>/` 同居 | `docs/26:28-35`，ADR 0004 | 不碰 `COLLECTION_PAGE_LOADERS` / `CARD_ADAPTERS` / auto-sync / eligibility 的形状 |
| 不做「万能平台 Module」；不做分层 catalog；聚合点不可消灭 | `docs/20:36,175,210` | 新增的只是机制 helper 与 descriptor 纯数据字段 |
| 不把各平台 meta 合并成一个大 union | `docs/20:412` | 中-3 按 docs/20 中-8 原方案逐平台 decoder |
| sync-service 不机械拆分 | `docs/20:426-449`（低-9） | 不拆文件，只抽已重复的片段 |
| `finishCollectionSync`「收益约 6×4 行，可做可不做」，未做 | `docs/20:211,224` | 高-1 重提收尾 funnel，**理由是同步记录（行为缺陷），不是省行数** |
| readiness / 节流 / 静默错误策略留在触发方，不塞进平台 Adapter | `docs/architecture-audit-2026-08-17.md:296` | 高-1 的「失败后不再重试」判定放在 daily 触发方，记录由共享收尾写 |
| 不做横跨 runtime 的全知协议 Module | `docs/architecture-audit-2026-08-17.md:217` | 本文不动任何消息协议 |
| B站不走 `useCollectionLibrary` 是「documented scope boundary, not debt」 | `platform-onboarding.md:401-405`（引 docs/15 HIGH-1） | 列为 D4，推荐维持 |
| i18n 共享键「单独做不值得，搭车做零成本」 | `docs/15:121` | 并入 Step 6，不单做 |
| 凭据链不可派生；env 命名不重开；集中 policy 表否决 | §1 | 不碰 |

---

## 3. 发现

### 高-1 同步记录不是一等公民：自动同步对失败 / 空库平台无退避地重打

**现状**

- 「上次同步」唯一来源是 `max(sources.lastFetchedAt)`（`lib/database/collection-queries.ts:80-89`），而 `sources` 只在 ingest **成功**时写。
- daily 触发方：`shouldAutoSync(null) === true`（`entrypoints/app/hooks/daily-sync-gate.ts:24-27`）；同步失败直接 rethrow，不留任何痕迹（`entrypoints/app/hooks/use-daily-auto-sync.ts:95-102`）；挂载与每次标签页可见都会重新评估，只有 30 s 节流（`use-daily-auto-sync.ts:18`）。
- 空库在 ingest 前早退，不写 source 行：zhihu（`lib/zhihu/zhihu-sync-service.ts:174-176`）、youtube（`lib/youtube/youtube-sync-service.ts:243`）、bookmarks（`lib/bookmarks/bookmarks-sync-service.ts:126-128`）、bilibili 收藏夹（`lib/bilibili/favorites-sync.ts:87`）。
- 知乎自动同步的就绪探针恒为 `true`，未登录靠静默错误吞掉（`entrypoints/app/sections/zhihu/zhihu-sync-adapter.ts:55-58`）——静默也不留记录。
- 旁支漂移：
  - X 自建 `local:x-last-sync`（`lib/storage/ui-state.ts:35`，写入点 `x-sync-adapter.ts:58-59`），六平台只有 X 能显示「本次新增 N」。
  - B站页面的 `lastSyncedAt` 只活在 mount 内存里（`entrypoints/app/sections/bilibili/use-bili-fav-folders.ts:35,74`），刷新即丢。

**真实代价**

- 知乎 403（反爬，代码注释明说「立即重试只会更糟」）、B站 412 之后，每次切回 app 标签页（间隔 ≥30 s）自动同步都会再打一次同一个平台，直到当天某次成功为止。
- 知乎未登录、YouTube 零播放列表、知乎零公开收藏夹的用户，每次切回标签页都发一轮请求（YouTube 每次约 2 个 quota 单位，代价小；知乎是风控敏感面，代价不小）。
- 「上次同步 / 本次新增」对六平台不一致。

**方案**：同步运行记录（每平台一条：最近尝试时间、结果、最近成功时间、fetched / inserted），由共享收尾 funnel 在**成功和失败时都写**；daily 触发方改为按最近**尝试**判定（D2）。X 的 5 分钟冷却继续以最近**成功**为锚——「失败的同步从不锁按钮」这条既有 UX 决定（`sections/x/cooldown.ts:3-8`）不变。

**与决议的关系**：收尾 funnel 正是 docs/20:211 的 `finishCollectionSync`。当时判定「可做可不做」的依据是只省 6×4 行；本条的新依据是同步记录必须有唯一写入点，否则失败和空库都记不下来。判定策略留在 daily 触发方，符合 architecture-audit:296。

### 中-1 风控机制层复制

**现状**

- `bodySnippet` 在 `lib/x/x-api.ts:367-374` 与 `lib/zhihu/zhihu-api.ts:469-476` **逐字节相同**（diff 验证）。
- 429 / 5xx 重试循环两份：`x-api.ts:508-528`、`zhihu-api.ts:424-439`，结构相同（attempt 计数、上限、`sleep(backoffDelayMs(...))`、耗尽抛错），只有消息前缀和等待计算不同。
- 「读一次 body → 解析 → 非 JSON 抛带片段的错」三份：`x-api.ts:536-542`、`zhihu-api.ts:445-452`、`youtube-api.ts:313-318`。
- 绕过 `lib/http/backoff.ts` 的裸 `setTimeout` 三处：`github-api.ts:206`、`lib/bilibili/bili-sync-service.ts:135`、`lib/bilibili/bilibili-transcription-adapter.ts:29,36`。（**勘误 2026-09-30**：实为四个文件五行，漏了 `lib/github/github-sync-service.ts:202` 的 README 仓间等待；Step 3 一并改掉，见 Step 3 落地记录。）

**真实代价**：下一个需要 429 / 5xx 重试的平台只能复制 X 的循环；github / youtube / bilibili 今天完全没有瞬时错误重试，想加时同样只能复制。

**方案**：`lib/http/` 增加响应读取 helper 与重试循环骨架，平台注入「何时重试、等多久、耗尽抛什么」和全部数值。这正是 `lib/http/backoff.ts` 头注释的原则：只共享机制，数值留在各平台。

### 中-2 错误模型复制 ×4

**现状**

- 四份几乎相同的 `{kind:'auth'} | {kind:'rate-limit'} | {kind:'unknown'}` 分类器：`entrypoints/app/sections/github-stars/use-github-stars.ts:72-76`、`sections/zhihu/use-zhihu-favorites.ts:34-38`、`sections/youtube/use-youtube-playlists.ts:35-39`、`lib/x/x-messages.ts:28-32`（只有 X 放在 lib）。bookmarks 返回裸字符串，B站在 hook 里直接 `instanceof BiliAuthError`。
- 四份 `syncErrorMessage` switch：`github-stars-view.tsx:40-51`、`x-view.tsx:36-47`、`zhihu-view.tsx:34-43`、`youtube-view.tsx:36-45`。
- 五个 AuthError 各自 `extends Error`，没有共同基类；限流类四个，`resetAt` 语义各异。
- B站 HTTP 412（反爬）没有限流类，只是 `Error('Bilibili API HTTP 412')`（`lib/bilibili/bilibili-api.ts:116-118`），UI 显示为泛化的「同步失败」。
- X 的 `auth.reason`（`'no-token' | 'rejected'`）从未被读：`x-view.tsx:38-39` 把两种情况都显示成「未检测到登录」。
- `resetAt` 只进一次性文案，不禁用按钮，尽管 scaffold 已有 `syncDisabled` seam（X 的冷却就在用它，`x-view.tsx:168-169`）。

**方案**：一个零依赖的 leaf 模块定义 Auth / RateLimit 基类，平台类继承（`instanceof` 不破）；app 侧一个分类器、一个消息函数（平台只传 i18n 键）；B站 412 归入限流；`resetAt` 接 `syncDisabled`。

### 中-3 platformMeta 解码：docs/20 中-8 未落地

**现状**

- bookmarks 同一份解码写了两遍，fallback 已分叉：`lib/bookmarks/bookmarks-sync-service.ts:383-384` 的 `dateAdded` 回退 `row.publishedAt`，`entrypoints/app/sections/bookmarks/tagged-bookmark-card.tsx:18-19` 回退 `null`。
  - **今天不可见**：写侧恒写数字（`lib/bookmarks/bookmarks-api.ts:144` 缺失时写 `0`），两条回退都走不到。这是潜伏漂移，只要写侧形状一变就会显形。
- B站没有 decoder，也没有写侧类型：写入是裸对象字面量（`lib/bilibili/videos-sync.ts:42-50`），读取在 UI 里 `typeof` 内联（`sections/bilibili/tagged-video-card.tsx:11-31`）。

**方案**：照 docs/20 中-8 原文（`docs/20:409-412`，位置已指定），不开新决策。注意 docs/17 MEDIUM-5 曾主张 decoder 移到纯 model 模块，与 docs/20 / spec 冲突；以时间更晚的 docs/20 与 spec 为准。

### 中-4 共享模块里的平台特例（无守卫）

**现状**

- 打标 prompt 的「简介」只读 B站专属的 `meta.intro`（`lib/tagging/tagging-service.ts:114`）。GitHub 的仓库 description（`meta.description`）因此永远进不了打标 prompt。
  - 影响面窄：youtube 的正文就是 description，知乎 excerpt 由正文派生，X 正文即推文。真正的损失是**没有 README 的 GitHub 仓库**，打标只剩标题与 owner。定为中偏低。
- Collection Analytics 手写 `${items.platform} = 'github'` + `platformMeta->>'language'`（`lib/collections/collection-analytics.ts:158-175`）。descriptor 的 `dimensions` 能表达 author / source 轴，却没有「来自 meta 字段的维度」这一格。
- 契约测试的「共享模块禁平台字面量」只扫 `collection-processing-policy.ts` 一个文件（`tests/platform-completeness-contract.test.ts:553-558`），上面两处都漏网。

**方案**：domain descriptor 增加两项纯数据字段，形状照抄已有的 `sortKey: { source:'meta', field }`，让特例变成数据；守卫从单文件扩成共享模块清单。

### 中-5 平台页外壳与数据 hook 改名层

**现状**

- github / x / zhihu / youtube 四个平铺 view（229 / 212 / 194 / 227 行）约 70% 是相同接线。
  - `copy={{…}}` 块里有四个键在 7 处调用点（五个 view + B站两处）恒为同一常量：`zhihu-view.tsx:154-166` 与 `youtube-view.tsx:177-189` 替换平台前缀后**逐行相同**（diff 验证）。
  - `EmptyLibraryState` 三份（`github-stars-view.tsx:75`、`zhihu-view.tsx:87`、`youtube-view.tsx:97`，x 另有一份 `x-view.tsx:93`）；`NotLoggedInState` 两份（`x-view.tsx:74`、`zhihu-view.tsx:69`）；打开站点按钮两份（`x-view.tsx:56`、`zhihu-view.tsx:51`）。
- 五个数据 hook（115–163 行）60–70% 是把 `useCollectionLibrary` 的通用字段改名（`repos: lib.items`、`language: lib.filter`…，约 25 行 / 个）。docs/15 当年的目标是「各平台 hook 退化为 ~40 行薄 adapter」（`docs/15:55`），没有兑现。（**已于 Step 7 删除改名层**，2026-10-02；五个 hook 现为 34–60 行，见 Step 7 落地记录。）
- `LOG_TAG` 手写五份（`use-github-stars.ts:21` 等），与 adapter 里 `jobPlatformForCollection` 派生的值是两个事实源，今天恰好相同。（**已于 Step 5 改派生**，2026-10-01，用户决定从 Step 6 提前；它是 job 命名空间而不只是日志前缀，见中-6 勘误②。）
- `SEARCH_DEBOUNCE_MS = 300` 三份：`hooks/use-collection-library.ts:9`、`sections/bilibili/bilibili-view.tsx:33`、`sections/collections/use-collections.ts:20`。
- i18n 第一类同文键 30 个：`*.lastSynced`「上次同步 {{time}}」×6、`*.syncFailed`「同步失败: {{error}}」×6（`lib/i18n/locales/zh-CN.ts:501-605`，已 grep 验证）、`showMore*` ×6、`showLess*` ×6、`all*` ×4（`allCollections.*` 与 `tags.*` 另有两组同文的展开/收起）。docs/16:11 把 docs/15 LOW-7（`common.*` i18n）记为「已修复」，实际只迁了 `retry` / `loadFailed`，**此记录需勘误**。
  - **勘误（2026-10-01，Step 6 落地时）**：「30 个」与它自己列的分项对不上——6+6+6+6+4 = **28** 个平台副本。Step 6 连同 `tags.*` / `allCollections.*` 两组（5 个）、`bookmarks.allFolders`（把计数烤进字符串的「全部」）与两个 `*.goToSettings`，两个 locale 各删 **36** 个，新增 6 个 `common.*`。docs/16:11 已同步勘误。
- B站时间用 `toLocaleTimeString()`（`bilibili-view.tsx:204`），其余五平台用 `formatDateTime`。

**方案**：共享状态组件 + scaffold 默认文案 + 共享 i18n 键（Step 6）；hook 改名层去留见 D3（Step 7）。

### 中-6 正文来源轴没有契约

**现状**

- 书签网页提取与 B站转录是两条平行的延迟正文管线：触发时机（同步后链式 vs 同步中流式）、状态位置（`useJob` + DB 计数 vs pipeline 单例）、冲突策略（`'drop'` vs `'queue'`）都不同。
- 两边真正重复的部分：
  - **job 命名空间硬编码**，绕过 `jobPlatformForCollection`：`sections/bookmarks/use-bookmark-extraction.ts:58,66-67,77-79`、`sections/bilibili/bilibili-processing-adapter.ts:5`、`sections/bilibili/use-video-transcribe.ts:20`、`sections/bilibili/auto-transcribe-runtime.ts:22`、`sections/bilibili/use-bili-fav-folders.ts:15`、`sections/bilibili/bilibili-view.tsx:32`（供 `:179-181` 与 `:327-329` 两组 `useJob`）。今天 bilibili / bookmarks 的 `jobPlatform` 恰好等于平台 id，所以没出错；新平台的 `jobPlatform` 一旦不等于 id（github 就是 `github-stars`），照抄就会错。
  - **正文落定逻辑**：`saveBookmarkContent`（`lib/bookmarks/bookmarks-sync-service.ts:344-357`）复制了 ingest 私有的 `settleContent`（`lib/ingest/ingest.ts:395-409`）。
  - `(text) => charSplit(text, { preferParagraph: true })` 写了四份：github `:271`、zhihu `:221`、youtube `:305`、bookmarks `:349-350`。
- spec 没有「延迟正文」一节：下一个需要转录或网页提取的平台，只能去读 bookmarks 或 bilibili 的源码来抄。

**方案**：只收契约与已经重复的零件，**不统一面板**（两个面板的差异来自上面三点本质差异）；保留 `'extract'` / `'transcribe'` 两个 job kind。

**勘误（2026-10-01，Step 5 落地时）**：

1. **只按字面量判定的守卫只会红 2 个文件**（`use-video-transcribe.ts` 与 `use-bookmark-extraction.ts`，共 6 处）。上面列的另外 4 个文件经模块常量 `const PLATFORM = 'bilibili'` 传入，字面量不在调用点上，所以守卫必须解析同模块常量。上面的行号也已漂移，以 Step 5 落地记录的先红清单为准。
2. **`LOG_TAG` 就是 job 命名空间**，不只是日志前缀（中-5 记的是后者）。`useCollectionLibrary` 拿 `logTag` 做 `useJob(logTag, 'sync'|'embed'|'tag')` 与 `startJob(logTag, 'sync', …)`（`use-collection-library.ts:148,159,160,274`；HEAD `65e7e02` 时是 `:145,156,157,271`，Step 5 在 `:45` 的注释多了三行），github / x / zhihu / youtube 又恰是 `jobPlatform ≠ 平台 id` 的四个。新平台照抄 `const LOG_TAG = '<id>'`、而 descriptor 写的是 `'<id>-items'` 时：手动同步跑在 `'<id>'`，funnel 派发的 embed / tag lane 在 `'<id>-items'`，页面的 `embedJob` / `tagJob` 永远是 null，知识库闸门暂停的也是另一个命名空间。Step 5 的判据「零字面 job 命名空间」与 Step 6 的「`LOG_TAG` 改派生」因此互相矛盾，**用户 2026-10-01 决定提前到 Step 5**（先例：Step 1 D-g）。
3. **preset 在 `lib/embedding/char-split.ts`，不在 `chunker`**。`charSplit` 住在 `char-split.ts`；`chunker.ts` 是字幕行打包器。Step 5 文件清单里的「`lib/embedding/chunker`」是笔误。

### 低-1 查询 WHERE 片段

`pagedItemsQuery` 已被五个平台共用（`lib/database/collection-queries.ts:47-73`，五处调用已验证）。仍然复制的是片段：

- source 成员子查询 ×3（`zhihu-sync-service.ts:251-257`、`youtube-sync-service.ts:335-341`、`bookmarks-sync-service.ts:203-209`，只有最后一个参数不同）；
- 每 source 计数 ×2（`zhihu-sync-service.ts:284-296` 与 `youtube-sync-service.ts:365-377` 只差一个别名）；
- 搜索条件 ×5；已知 id 集合 ×4（含 `ingest.ts:310-314`）；三行 `getLastSyncedAt` 包装 ×5。

### 低-2 tagged card 外壳 ×6、facet chips ×3

- 六个 `tagged-*-card.tsx` 组件壳相同，只有卡片组件、prop 名和 mapper 不同（例如 `tagged-repo-card.tsx:23-31` 对 `tagged-zhihu-card.tsx:23-31`）。
- x / zhihu / youtube 的 chips 组件 props 接口相同，label helper 在三个文件的同一行号、同一写法 `${名称 || id} (${count})`，只有字段名不同（`author-chips.tsx:15-17`、`collection-chips.tsx:15-17`、`playlist-chips.tsx:15-17`）。
- 骨架文件六份只有三种形态，但 `components/collection/CLAUDE.md` 已声明这是有意为之，**不动**。

### 低-3 守卫缝隙（并入相关 Step，不单列）

- env 守卫只扫 `lib/<platform>/`（`tests/platform-env-guard-contract.ts:3`），漏掉 `sections/x/cooldown.ts:11` 的 `COOLDOWN_MS = 5 * 60 * 1000`。**Step 4 已修（2026-09-30）**：常量迁到 `lib/x/cooldown.ts`，经 `envNumber('VITE_X_COOLDOWN_MS', 300_000)`，env 守卫三方同步。
- X 的 `webRequest` filter 手抄 `['*://x.com/*']`（`entrypoints/background.ts:93`），与 descriptor 的 `hostPermissions`（`lib/collections/platform-descriptor.ts:132`）是两个事实源。

### 低-4 过期文档与注释（并入触碰它们的 Step）

- `lib/ingest/CLAUDE.md:30` 仍说处理 lane 由 hook / syncFn 触发，实际在各 `*-sync-adapter.ts`。
- `github-sync-service.ts:21-23`、`x-sync-service.ts:16-20,81-82`、`zhihu-sync-service.ts:20-22`、`youtube-sync-service.ts:23-25` 头注释仍写「hook」「四个平台」「embedding 等设置页重建」。

---

## 4. 不做（附理由，防止后续重提）

| 项 | 理由 |
|---|---|
| B站浏览改为本地优先 | 重开两条既有决定，见 D4 |
| manifest API 权限 / DNR 规则由 descriptor 派生 | docs/13 M4 判为低摩擦；且 manifest 字节变化会触发已装扩展重新授权（docs/26 Step 2 的教训） |
| 转录协议泛化（`platformSchema: z.string()`、`cid?` 在通用消息里，`lib/background/message-protocol.ts:56,151-153`） | 只有一个视频平台；第二个视频平台到来时再议 |
| env 常量改成统一命名 | 已否决（§1） |
| sync-service 拆文件 | docs/20 低-9 |
| 合并 github / youtube 两张连接设置卡 | 只有两张，约 60% 结构相同但收益有限；唯一值得抽的是 7 张卡共用的密码框（与平台流程无关，不在本文范围） |
| 通用 sync adapter 工厂 | 除收尾 funnel（Step 1）外，每平台只能再省约 10 行 |
| 六个骨架文件合并 | 有意为之（`components/collection/CLAUDE.md`） |
| WebDAV / 导出改动 | 已统一；凭据漫游不均来自各平台登录态存放位置（cookie jar / session storage），不是代码分支 |

---

## 5. 待决策（每项附推荐默认）

| # | 问题 | 推荐 | 备选与代价 |
|---|---|---|---|
| D1 | 同步运行记录存哪里 | **已决（用户 2026-09-29，按推荐）：DB 新表**（迁移 v007，随 Step 1 建；形状与理由见 §5.1）：daily 触发方与页面 caption 已经读 DB；自动进导出；X 冷却可直接读 | WXT `local:` storage：免迁移，但「上次同步」变成 DB + storage 两个来源，且不进导出。扩展未发布，无旧数据迁移问题 |
| D2 | 自动同步节奏 | **已决（用户 2026-09-29，按推荐）：按最近尝试判定，每平台每天最多自动尝试一次**（成功、失败、静默都算；判定细则、代价落在哪些平台、Step 1 的硬约束见 §5.2）：最简单，风控最安全 | 失败后指数退避：要多一套退避状态。推荐方案的真实代价有两条：<br>① 探针不联网就判断不了登录的平台（今天只有知乎，`probeReady: () => true`）一天只有一次机会——00:05 未登录静默一次，09:00 登录后当天不会再自动同步；<br>② funnel 是手动与自动共用的，**手动同步失败也算当天的尝试**，会压掉当天的自动同步。<br>两种情况都只影响自动触发，手动按钮不受限。启动时网络抖动导致当天不再自动重试属于同一类，较少见 |
| D3 | 数据 hook 的字段改名层 | **已决（用户 2026-10-02 以「开始 step7」选定，按推荐）：删除**（落地见 §6 Step 7 落地记录）：view 直接消费 `useCollectionLibrary` 的通用字段，平台 hook 只留真正平台特有的部分（凭据门、X 冷却）；兑现 docs/15:55 的「~40 行」目标 | 保留：零 churn，但每个新平台继续手写约 25 行改名 |
| D4 | B站视频网格走远端 API 分页（`use-bili-fav-videos.ts:41` → `bili-sync-service.ts:85-101`） | **维持** | 改本地优先，需要重开 `platform-onboarding.md:401-405` 与 `sections/bilibili/CLAUDE.md:28-29` 两条决定。现状的真实张力：<br>① 同一平台有两条展示路径——B站页走远端，聚合页 / 标签页 / Chat 读本地；<br>② 翻页、换排序、搜索都直接打 `x/v3/fav/resource/list`，这正是同步 runner 因 412 事故限速到 7–10 s / 页的同一端点，而浏览路径没有任何节流。<br>浏览路径是否触发过 412 为 [UNKNOWN]；**观察到第一次就是重开的触发条件** |
| D5 | 正文来源统一到什么程度 | **只收契约与已重复零件** | 统一进度面板：两个面板的差异来自触发时机、状态位置、冲突策略三处本质不同，强行合并会引入模式分支 |
| D6 | 共享模块平台特例怎么消 | **已决（用户 2026-09-30，按推荐）：domain descriptor 加纯数据字段**（照 `sortKey` 的 `{ source:'meta', field }` 形状；落地见 §6 Step 2 落地记录） | decoder 暴露函数：tagging / analytics 要 import 六个平台的 decoder，重新引入平台扇入 |

### 5.1 D1 决策记录（用户 2026-09-29 决定：按推荐）

**决定**：同步记录存 PGlite 新表，迁移 v007。**表随 Step 1 建，本次只定形状、不写代码。** 理由有两条：Step 1 还依赖 D2（D2 若选退避，表要多一列失败计数）；迁移又撤不掉（docs/29 §7）。在 D2 之前建表，等于先冻结一个可能要改的形状。（D2 已于同日按推荐决定，下表形状不变，见 §5.2。）

**推翻的旧决定**：07-26 daily auto-sync 任务定过「复用 `sources.lastFetchedAt` 作为 single source of truth，**不建新表、不加新 storage 记录**」（`.trellis/tasks/archive/2026-07/07-26-daily-first-open-auto-sync-all-platforms/prd.md:11`，代码里是 `entrypoints/app/hooks/daily-sync-gate.ts:1-6` 的头注释）。它的前提是「同步成功必写 source 行」，而高-1 的失败与空库两种情况正好落在这个前提之外。§2 否决清单漏记了这一条，见附录 B。

同一份 PRD 还有一半**不归 D1、归 D2**：知乎登出「视为未就绪，不写时间戳」（`prd.md:18`），是故意不留痕，好让验收条「首次评估未就绪的平台，登录后切回 tab 时被补拉一次」（`prd.md:30`）成立。D2 的推荐方案对探针不联网的平台（X、B站、github、youtube）仍满足这条，因为未就绪时根本不开跑、不记尝试；对知乎则推翻它，也就是 D2 代价 ①。定 D2 时要知道推翻的是一条已上线的验收标准，不只是一句注释。（D2 已按此决定，07-26 各条的结局见 §5.2。）

**为什么是 DB 而不是 `local:` storage**（2026-09-29 逐条回查）：

- **读方已经在 DB。** daily 触发方（`use-daily-auto-sync.ts:74`）读 `getPlatformLastSyncedAt`；五个平台页的「上次同步」经各自的 `getLastSyncedAt` 也读它（`use-collection-library.ts:222-234`）。
- **双来源的代价今天就看得到。** X 的冷却锚点取 DB 时间与 storage 时间两者较晚的那个（`sections/x/use-x-bookmarks.ts:115-120`）。选 storage，等于把这种合并推广到六个平台。
- **storage 独有的 `watch` 在这里用不上。** 手动与自动两个触发方都经 `startJob(jobPlatform, 'sync')`，页面已经按 sync job 的 generation 刷新 meta（`use-collection-library.ts:250-266`）。所以 X 的 `xLastSyncStorage.watch`（`use-x-bookmarks.ts:84-99`）是一条冗余通道。
- **导出自动带上，但有前提。** `EXPORT_TABLES = Object.values(schema)`（`lib/export/query.ts:12`）由 `tests/export-schema-sync.test.ts` 守着，前提是 entity 从 `lib/database/schema.ts` 导出。新增表的四件套见 `lib/database/entities/CLAUDE.md:19`（entity + `schema.ts` + `types.ts` + 迁移），已补进 Step 1 文件清单。
- **有先例。** ADR 0001 以同样的理由把 Conversation 从 `local:` storage 迁进了 PGlite：持久结构化数据同库，导出零改动。
- **记录与它描述的库同存同删。** 删掉 PGlite 库（`idb://favbase`）重建时，storage 里的记录会活下来，并压掉当天的自动同步。产品内没有清库入口，所以这条只影响开发机。

**钉住的形状**（Step 1 照此建表；列名可调，语义不改）：

| 列 | 语义 |
|---|---|
| `platform` 主键 | 条目平台 id（`CollectionPlatform`），与 `sources.platform`、`getPlatformLastSyncedAt(platform)` 用同一判别符。**不是 `jobPlatform`**：github 的 `jobPlatform` 是 `github-stars` |
| `last_attempt_at` NOT NULL | 最近一次开跑的时刻 |
| `last_result` 可空 | 最近一次的结果：`'success'` / `'failure'`，迁移里写具名 CHECK（`lib/database/migrations/CLAUDE.md` 约定）。开跑时置 NULL，所以 **NULL = 未结束**，同步中途关页也停在 NULL。按 D2（§5.2），「静默」不需要单独的取值：静默是触发方的策略，funnel 不认识它（architecture-audit:296） |
| `last_success_at` 可空 | 最近一次**成功完成**的时刻，从未成功为 NULL，失败不改它。「上次同步」与 X 冷却都读它 |
| `last_fetched` / `last_inserted` | 与 `last_success_at` 在同一次成功里写入的计数，失败不改。六平台的「本次新增 N」都来自它 |

- 表名 `platform_sync_records`，术语 **Platform Sync Record**，已写进 `CONTEXT.md`。本文的「同步运行记录」就是它。不叫 run，因为 **Pipeline Run** 已被占用，**Platform Sync** 的 _Avoid_ 列表里也有它。
- 这是一平台一行、upsert 的状态行，与 `sources` 同类。它不是历史日志，只留最近一次尝试与最近一次成功；它也不是 insert-only 业务表，两处旁注已在 Step 1 列出。
- 不存错误文本，错误形状归 Step 4。
- `sources.lastFetchedAt` 不删。ingest 照写，它仍是每个 Source 的新鲜度，只是不再回答「平台上次同步」。
- **这是设备本地的事实。** WebDAV 数据同步（`lib/sync/CLAUDE.md` 第二期）靠 insert-only 做主键并集，本表既不是 insert-only，也不该跨设备：A 设备的记录合并到 B，B 会以为今天已经同步过。二期落地时必须排除本表。
- **D2 的影响范围**：D2 已选推荐方案（§5.2），上表就是最终形状，不加列、不加取值。以下只作记录：没选的方案会**加列或加取值**，例如退避要的失败计数，或者让静默不占当天名额所需的标记；后一种还要让触发方也成为写入方，funnel 就不再是唯一写入点。

### 5.2 D2 决策记录（用户 2026-09-29 决定：按推荐）

**决定**：daily 触发方改读 Platform Sync Record 的 `last_attempt_at`，每个平台每个本地自然日至多自动开跑一次。当天只要已有一次尝试，当天的自动名额就用掉了：手动或自动、成功或失败、静默或未结束，都算。手动按钮不受限。§5.1 的表原样可用，funnel 仍是唯一写入点。

**判定细则**（Step 1 照此实现，2026-09-29 逐条回查）：

- `daily-sync-gate.ts:11-27` 的 `isSameLocalDay` / `shouldAutoSync` 逻辑不改，只把入参从「最近成功」换成「最近尝试」。日界仍是本地自然日。
- 求值顺序不变：闸门 → 暂停 → 探针 → `startJob`（`use-daily-auto-sync.ts:83-95`）。暂停中的平台不开跑、不记尝试，恢复后当天照样补一次。
- 闸门改读 `last_attempt_at`；`getPlatformLastSyncedAt` 改读 `last_success_at`（§5.1），只供「上次同步」caption 与 X 冷却用。
- **什么算一次尝试**：funnel 开跑时写 `last_attempt_at`，同时把 `last_result` 置 NULL。在 funnel 之前返回的都不算、不写记录：闸门挡下、暂停、探针为 false、adapter 因缺凭据空转。一句话判据：**尝试 = 即将联系平台**。联网之后的任何失败都算，凭据被拒也算（X `rejected`、github 401）。bookmarks 只读本地，也算，因为它没有未就绪态。
- **未结束也算**：`last_attempt_at` 是今天而 `last_result` 为 NULL（同步中途关页，或仍在跑），当天不再自动重试。这就是「每天至多一次」的字面含义，不是 bug。
- **静默只是呈现**：知乎的 `isSilentError`（`zhihu-sync-adapter.ts:57`）只决定 job 显示为完成还是失败，funnel 照样记 `'failure'`，`last_result` 不需要第三个取值。
- **X 冷却不变**：仍以 `last_success_at` 为锚，`xAutoSyncPolicy` 里的冷却检查保留（`x-sync-adapter.ts:62-73`，`cooldown.ts:3-8`）。它注释的 23:58 → 00:01 跨日场景依然成立：闸门看尝试的**日期**，冷却看成功的**时刻**，两者互不替代。

**代价 ① 落在哪些平台**（按 `probeReady` 回查）：

| 平台 | 探针 | 探针联网吗 | 代价 ① |
|---|---|---|---|
| bilibili | `getBiliAuth() !== null`（`bilibili-sync-adapter.ts:73`），读 cookie | 否 | 不付 |
| github | token 非空（`github-sync-adapter.ts:85`） | 否 | 不付 |
| youtube | key 与 channel 都非空（`youtube-sync-adapter.ts:47-50`） | 否 | 不付 |
| x | `getXAuth()` 非空 + 冷却已过（`x-sync-adapter.ts:69-73`） | 否 | 不付 |
| bookmarks | `() => true`（`bookmarks-sync-adapter.ts:52`） | 否 | 无登录态，不适用 |
| zhihu | `() => true`（`zhihu-sync-adapter.ts:56`） | 不联网就判断不了 | **唯一付的** |

**Step 1 的硬约束：凭据缺失必须在 funnel 之前判定。** 上表只覆盖 daily 路径。手动路径上，X 与 B站的 adapter 要进了 lib 调用才发现未登录：

- X 把 `getXAuth()` 的 null 原样传进 `syncBookmarks`，由 lib 抛 `XAuthError('no-token')`（`x-sync-adapter.ts:40-41`，`lib/x/x-sync-service.ts:145`）；
- B站由 `fetchAndSyncFolders` 里的 `checkAuth()` 抛 `BiliAuthError`（`lib/bilibili/bili-sync-service.ts:64-74`）。

而这两个页面的未登录态，正是靠一次失败的手动同步识别出来的，并且都在未登录态上给了重跑同步的按钮（X：`x-view.tsx:74-84,201`；B站：`use-bili-fav-folders.ts:40-46`，`bilibili-view.tsx:386` 的 `onRetry={onSync}`）。如果 funnel 直接包住 lib 调用，未登录时点一下就记一次失败，登录后当天不再自动同步，代价 ① 就从知乎一个扩到三个平台。所以：

- 不联网就能判定的凭据缺失，在 funnel **之前**判定。缺失时照旧抛同一个错误类（页面的未登录态靠它识别），但不写记录。
- github / youtube 今天已经这样做：在 lib 调用前空转返回（`github-sync-adapter.ts:45`，`youtube-sync-adapter.ts:28`）。
- 知乎做不到，这正是代价 ① 本身。

**顺带修掉一条今天已失效的验收条**：B站页挂载时会直接拉收藏夹列表（`use-bili-fav-folders.ts:84` → `fetchAndSyncFolders` → `syncFavFoldersToDb` → `ingestCollection`，`lib/bilibili/favorites-sync.ts:108`），这会写 `sources.lastFetchedAt`，闸门随即把 B站当成「今天已同步」，当天的自动全量同步（夹列表 + 视频 + 转录）就不跑了。这正是 07-26 `:30` 的场景在 B站上悄悄失效：首次评估时未登录（探针 false，不开跑）→ 用户登录后打开 B站页 → 挂载拉夹列表刷新了 `lastFetchedAt` → 之后每次评估都读到「今天」，不再补拉。Step 1 之后，闸门只认 funnel 写的尝试；挂载拉夹列表不经 adapter，不是一次完整的 Platform Sync（`CONTEXT.md`），不算尝试，`:30` 对 B站重新成立。

**推翻与保留的 07-26 条目**（`.trellis/tasks/archive/2026-07/07-26-daily-first-open-auto-sync-all-platforms/prd.md`）：

| 行 | 内容 | 结局 |
|---|---|---|
| `:12`、`:29` | 手动拉过当天即视为「今天已拉」 | 保留并扩大：手动**失败**也算（代价 ②） |
| `:18` | 知乎登出「视为未就绪，不写时间戳」 | 推翻：记一次 `'failure'`，占当天名额 |
| `:24` | X 冷却在自动路径下仍尊重 | 保留 |
| `:30` | 首次评估未就绪的平台，登录后切回 tab 时被补拉一次 | 探针不联网的平台保留（前提是上面的硬约束）；B站今天其实已失效，Step 1 后恢复（见上段）；**知乎推翻** |
| `:66` | 已知边缘：youtube 零播放列表每次评估都重拉 | 消解：空库成功也写记录（D1 + D2） |

**为什么不选失败后指数退避**：

- 退避要一套额外状态（失败计数、下次可重试时刻），而且「静默不占名额」这类变体还要让触发方也写记录，破坏 funnel 唯一写入点（§5.1）。
- 退避的本意是当天稍后再试，而高-1 要阻止的恰恰是当天对刚风控过我们的平台重打；知乎 403 的代码注释明说立即重试只会更糟（`zhihu-api.ts:420-423`）。
- 被推荐方案挡住的，只有「当天稍后自动再试一次」。手动按钮始终是逃生口，第二天也会自然恢复。

---

## 6. 分步整改

每个 Step 独立提交，一次对话做一步。格式同 docs/26 / 27：目标 / 依赖 / 文件 / 改法 / 测试 / 验证 / 回滚 / 判据。

### Step 1 同步运行记录 + 共享收尾 + 自动同步限次（高-1，并入低-4）

- **目标**：
  - 每次平台同步（手动或自动，成功或失败）都落一条记录；
  - daily 触发方据此每平台每天至多自动尝试一次；
  - 「上次同步 / 本次新增」对六平台统一。
- **依赖**：D1（已决，§5.1）、D2（已决，§5.2）。
- **文件**：
  - 新表 `platform_sync_records` 的 entity + 迁移 v007（`lib/database/entities/`、`lib/database/migrations/`），列与语义照 §5.1。新增表四件套缺一不可：entity 必须从 `lib/database/schema.ts` 导出，并补 `types.ts`，导出（`tests/export-schema-sync.test.ts`）才会自动覆盖它。它与 `sources` 同属「状态行」，不是 insert-only 业务表。insert-only 规则只约束 ingest 的四张表，记录在 `lib/ingest/CLAUDE.md:16` 与 `platform-onboarding.md:117`，新表需在这两处旁注「不适用」（`ingest.ts:11` 引用的 ADR 文件不存在，见附录 B）。
  - `lib/database/collection-queries.ts`：`getPlatformLastSyncedAt` 改读记录的最近成功时间。
  - 新 app 侧收尾 funnel（`entrypoints/app/hooks/`）：先记尝试 → 跑平台同步 → 成功则派发 `startCollectionProcessingJobs` 并记成功，失败则记失败并 rethrow。
    - **funnel 在各 adapter 函数体内部调用，包住 lib 同步调用；不包 adapter 本身。** `run<P>Sync` 的对外签名保持 `(onProgress, control) => Promise<void>`，`useCollectionLibrary`（`use-collection-library.ts:40-43`）、`AutoSyncDefinition.runSync` 与 `AUTO_SYNC_PLATFORM_BY_COLLECTION` 都不动。docs/20:224 已记录：在外面包 wrapper 会破坏 `collection-platform-auto-sync.test.ts` 的 `toBe` 身份锁定。
  - 六个 `*-sync-adapter.ts`：同步结果统一成 `{ fetched, inserted, newItemIds }`；bookmarks / bilibili 继续传空 id。x / bilibili 的凭据缺失判定提到 funnel 之前，缺失时抛原错误类、不写记录（§5.2 硬约束）。
  - `hooks/use-daily-auto-sync.ts`：闸门改读记录的 `last_attempt_at`；`daily-sync-gate.ts` 的判定逻辑与本地自然日边界不改，闸门 → 暂停 → 探针的顺序不改（§5.2）。
  - `sections/x/`：删 `xLastSyncStorage`（`lib/storage/ui-state.ts:35`、`lib/storage/keys.ts:16`），caption 改读记录；冷却仍以最近成功为锚，`use-x-bookmarks.ts:115-120` 的 DB / storage 双来源合并随之删掉。
  - `sections/bilibili/use-bili-fav-folders.ts`：caption 改读记录。
  - 文档：`lib/ingest/CLAUDE.md:30`、`lib/ingest/ingest.ts:9-10`（「items 为空也执行，让 UI 区分从未同步」这份职责移交给新记录）、四个 sync-service 头注释、`entrypoints/app/hooks/CLAUDE.md`、`lib/database/**/CLAUDE.md`。
  - 仍写着「`sources.lastFetchedAt` 是唯一事实源」的注释（D1 推翻了它，§5.1）：`hooks/daily-sync-gate.ts:1-6`、`hooks/use-daily-auto-sync.ts:85-87,111-112`、`sections/x/cooldown.ts:4-7`、`lib/zhihu/zhihu-sync-service.ts:180-181`。
- **改法要点**：
  - 空库不需要改那四处早退——记录由 funnel 写，与 ingest 是否执行无关。
  - 静默错误的判定仍留在 daily 触发方（architecture-audit:296）；funnel 只记结果，不做策略。
- **测试**：`use-daily-auto-sync.test.tsx` 新增四例，先红后绿：
  1. 失败后同日不再尝试；
  2. 空库成功后同日不再尝试；
  3. 静默（未登录）后同日不再尝试；
  4. 跨日恢复。

  funnel 单测（成功派发 + 记录 / 失败不派发 + 记录 + rethrow）取代六个 adapter 测试里重复的「fails → no dispatch」例；x / bilibili adapter 各加一例「凭据缺失：抛原错误类、funnel 未被调用、不写记录」，锁住 §5.2 的硬约束；另加迁移测试。
- **验证**：dev 构建。知乎登出状态下反复切换标签页，DevTools Network 当天只出现一轮知乎请求；X 登出时在 X 页点「立即获取」，页面照旧进入未登录态，记录表里 x 行不变；X 同步后冷却倒计时照常；B站页刷新后 caption 仍有「上次同步」。
- **回滚**：revert 代码即可；已执行的迁移撤不掉，空表无害（同 docs/29 §7 先例）。
- **判据**：
  - `xLastSyncStorage` 全仓零引用；
  - `startCollectionProcessingJobs(` 只出现在定义处与 funnel（**勘误 2026-09-30**：原文写「funnel 与 bookmarks / bilibili 的逐条路径」，比事实宽——逐条路径走的是 `enqueueCollectionProcessingItem`，从来不调这个函数）；
  - 四个新测试与 x / bilibili 两例凭据缺失测试绿。

#### Step 1 落地记录（2026-09-30）

代码与单测已落地，运行时验证（上面「验证」四项）需要用户的浏览器，尚未做。判据三条都成立：`xLastSyncStorage` / `XLastSync` / `x-last-sync` 在代码里零引用（只剩 docs 与已归档任务）；`startCollectionProcessingJobs` 只出现在定义处与 funnel，由契约测试锁住；T3 四例与 x / bilibili 两例凭据缺失测试绿。

**落在哪**：表 `lib/database/entities/platform-sync-records.ts` + `migrations/v007-platform-sync-records.ts`（`schema.ts` / `types.ts` 已登记）；读写 `lib/database/platform-sync-record.ts`；funnel `entrypoints/app/hooks/platform-sync.ts` 的 `runPlatformSync(platform, control, sync)`；六个 adapter 在函数体内调用它；`getPlatformLastSyncedAt` 改读 `last_success_at`；daily 闸门改读 `last_attempt_at`（`DailyAutoSyncDeps.getLastAttempt`）；X 的 `local:x-last-sync` 删除，「本次新增」读 `last_inserted`；B站 caption 读记录并改 `formatDateTime`。

**先红后绿**：

- 契约守卫（`tests/platform-completeness-contract.test.ts` 新增的独立用例，按 AST 找标识符，注释里的字样不会误报）：改 adapter 之前跑，红在恰好六个 adapter，每个两处（import 与调用），共 12 条 `file:line`，没有别的文件。
- T3 四例（`use-daily-auto-sync.test.tsx`）：在旧闸门上先写好再跑，四例全红。前三例红在「同日切回标签页又开跑了第二次」（`started` 为 2）。第 4 例（跨日恢复）红在「闸门根本没读尝试记录」（`getLastAttempt` 零调用）：旧闸门本来就会在次日重试，所以这一例单靠「是否重试」红不了，锁住的是读的是哪个字段。

**默认决定**（PRD 已定，用户未逐条过目）：

- **D-a 记录模块位置**：`lib/database/platform-sync-record.ts`，与 `collection-queries.ts` 同档（显式吃 `db`、只 import entity leaf 与 drizzle）。不放 `lib/collections`（它自述只读领域层），也不放 `lib/ingest`（ingest 管的是条目落库）。读函数 `(platform, db)`，与 `getPlatformLastSyncedAt` 一致；写函数 `(db, platform, …)`，与 lib/ingest 的写 operation 一致。模块 doc comment 写明了这条区分。成功与失败都是 UPDATE，那一行由 attempt 的 upsert 开出。
- **D-b funnel 签名带 `control`，并先 `checkpoint()`**：知识库暂停时点手动按钮，job 是 born-paused 的，恢复之前不记尝试。§5.2「暂停中不开跑、不记尝试」因此在手动路径上也成立。lib 同步里的第一个 checkpoint 随之变成 no-op。原文只写了 `sync` 闭包。
- **D-c 成功路径先派发、后记成功**：如果记成功失败，job 显示失败，`last_result` 停在 NULL，仍占当天名额；lane 已经派发，数据不丢。失败路径上，记失败本身出错只 `console.error`，rethrow 的是原错误。
- **D-d `fetched` 的口径** = 该平台进度 caption 最后显示的数：github 是 stars 数，x 是推文数，zhihu 是条目数（含跨夹重复），youtube 是 membership entries，bookmarks 是去重前的书签数，bilibili 是本次翻到的视频数。今天没有 UI 读它，只入记录。
- **D-e x 的 lib `syncBookmarks` 收窄为 `auth: XAuth`**：null 判定移到 adapter，lib 里的分支删除。这是消掉一个特殊情况，而不是把一行 throw 复制一份。
- **D-f X 的 `lastInserted` 留在 X hook 里读**，不改 `useCollectionLibrary`。同一 PK 行读两次，可以接受。
- **D-g B站 caption 改 `formatDateTime`**，从 Step 6 提前到本步。原因是本步让 `lastSyncedAt` 活过刷新，只显示时刻会把上周的同步显示成「10:32」。
- **D-h 不改名 `SyncBookmarksResult`**：六个 lib 结果类型不统一，统一只发生在 adapter 层的 `PlatformSyncOutcome`（见附录 B）。
- **D-i 表不加 `platform` CHECK，也不加 `created_at` / `updated_at`**：接新平台不许要迁移；`last_attempt_at` 就是更新时间。

**与 PRD 的偏离**（都是实现时被代码事实逼出来的，没有改变任何决策）：

1. **`getPlatformLastSyncedAt` 的参数从 `string` 收窄为 `CollectionPlatform`**。entity 的 `platform` 列是 `$type<CollectionPlatform>()`，drizzle 的 `eq` 不收 `string`。全部调用方传的本来就是平台字面量（五个 sync-service 的 `const PLATFORM`、x adapter 的 `ITEM_PLATFORM`），所以不需要 cast，也不需要运行时分支。形状与 arity 不变，五个 `getLastSyncedAt` 包装零改动。`DailyAutoSyncDeps.getLastAttempt` 同样收 `CollectionPlatform`。
2. **默认 deps 用 `await initDbProxy()` 取 db，不用裸 `getDb()`**。涉及 funnel 的三个写入、`getLastAttempt` 的默认实现，以及 X / B站两个 hook 的读取 effect。`initDbProxy()` 幂等，ready 后返回的就是 `getDb()` 那个实例；`getDb()` 则会在 app 启动那个 fire-and-forget init 尚未 settle 的窗口里抛错。另一个好处：现有测试（如 `use-bookmarks.test.tsx`）对 `@/lib/database` 只 mock 了 `initDbProxy`。
3. **PRD T5 清单之外还有一个测试要改**：`sections/bookmarks/use-bookmarks.test.tsx` 走的是真实 adapter，现在它断言的 backlog dispatch 由真实 funnel 发出。为此给它加了 `@/lib/database/platform-sync-record` 的 no-op mock，并给 `syncBookmarks` 的返回值补上 `inserted: 0`；dispatch 断言本身一字未改。`use-bili-fav-folders.test.tsx` 同样让真实 funnel 跑（只 stub 记录写入），并按 PRD 新增一例：同步成功后 `lastSyncedAt` 从记录重读。
4. **bookmarks 里两件事的先后换了**：backlog embed 的派发现在由 funnel 在同步成功时发出，`startBookmarkExtraction()` 在 funnel 返回之后才调；原来是先提取、后派发。两条 lane 互相独立，先后没有语义。
5. **`database-bridge.md` 悬空引用已全部改指 `lib/ingest/CLAUDE.md`**。PRD 原只点了 `ingest.ts:11`，实施时只修了那一处；**用户 2026-09-30 追加范围**，trellis-check 同一轮把五个 sync-service 头注释、六个测试文件头注释与四个 `lib/<platform>/CLAUDE.md` 的引用一并改掉，`lib/ingest/CLAUDE.md` 与 `platform-onboarding.md` §4.3 的措辞随之从「从未存在」改成「曾引用、已全部改指」；docs/ 与归档任务之外该路径零残留。来龙去脉见附录 B。

**行为变化与验证备注**：

- **X 冷却上锁晚一次 DB 往返**：原来 adapter 写 `local:x-last-sync` 的瞬间就上锁；现在锚点是 `last_success_at`，要等 sync job 完成、`useCollectionLibrary` 按 generation 重取 meta 读到它之后才锁。人工验冷却时知道这一点；不是缺陷。
- **T3 的先红叙述由实施子 agent 报告**，trellis-check 没有复现（新测试注入的是 `getLastAttempt`，旧 hook 读的是 `getLastSynced`，红的具体原因无法事后重放），记为已报告、未复核。契约守卫的先红另经 check 放探针文件实证。
- **`pnpm test` 默认并行度下的偶发超时与本步无关**：`tests/lib-import-smoke.test.ts` 按 `COLLECTION_PLATFORMS` 顺序加载，bilibili 排第一，承担整张 `@/lib/database` / ingest 依赖图的冷加载，202 个文件并发时偶尔超过 5 s。2026-09-30 在干净 HEAD（`3ea0095`）的临时 worktree 上跑两次全量，第二次挂在同一例；本步工作区连跑两次也挂同一例，单跑该文件 17/17 绿（2.95 s）。check 另见过 PGlite 套件 `beforeAll` 10 s 超时，失败集合每次不同。`--maxWorkers=8` 全量 1606/1606 绿且更快（67 s 对默认的 112–142 s）。**用户 2026-09-30 决定**在 `vitest.config.ts` 设 `maxWorkers: 8`，与 Step 1 同一 commit 落地。

### Step 2 meta decoder + 共享模块去平台特例（中-3、中-4）

- **目标**：六平台 meta 都有唯一 decoder；tagging 与 analytics 不再含平台知识，并有守卫。
- **依赖**：D6。
- **文件**：
  - `lib/bookmarks/bookmarks-sync-service.ts`：导出 `narrowBookmarkMeta(meta, fb)`，`toBookmarkItem` 与 `tagged-bookmark-card.tsx` 都调用它；统一回退到 `publishedAt`。
  - `lib/bilibili/`：`BiliItemMeta` 类型（`videos-sync.ts:42-50` 加 `satisfies`）+ `narrowBiliVideoMeta`，与 `video-eligibility.ts` 同一 owner（docs/20:410）；`tagged-video-card.tsx` 改为调用它。
  - `lib/collections/platform-descriptor.ts`：新增一个「条目简介字段」（bilibili `intro`、github `description`，其余 `null`，因为正文已覆盖）和 `dimensions` 的 meta 维度格（github `{ kind:'language', field:'language' }`，其余 `null`）。
  - `lib/tagging/tagging-service.ts:114`、`lib/collections/collection-analytics.ts:158-175`：改读 descriptor。
  - `tests/platform-completeness-contract.test.ts:553-558`：「禁平台字面量 / 禁字面 meta key」从一个文件扩成清单（`lib/tagging/**`、`collection-analytics.ts`、`lib/embedding/**`、`lib/chat/**`、`lib/export/**`，非测试文件）。正则在实施时先红后绿校准。
- **测试**：两个 decoder 的 malformed-input 测试（照 `lib/{x,youtube,zhihu}/narrow-meta.test.ts`）；tagging 测试断言 github 条目的 prompt 带上 description；analytics 快照不变。
- **验证**：Dashboard 的 GitHub 语言维度数值与改前一致；给一个无 README 的 star 仓库重新打标，结果里出现与 description 相关的标签。
- **回滚**：revert。
- **判据**：守卫对今天的 `tagging-service.ts:114` 与 `collection-analytics.ts:167` **先红**，改完转绿；bookmarks 解码全仓只剩一份。

#### Step 2 落地记录（2026-09-30）

代码与单测已落地；上面「验证」两项（Dashboard 的 GitHub 语言数值、给无 README 的 star 仓库重新打标）需要浏览器，**待人工**。判据成立：守卫先红，且红的位置比判据写的更细（见下）；改完转绿。bookmarks 的 meta 收窄全仓只剩 `narrowBookmarkMeta` 一份，B站只剩 `narrowBiliVideoMeta` 一份。两个 tagged card 不再内联 `typeof meta.*`。

**落在哪**：

- **descriptor 从六字段变成七字段**（`lib/collections/platform-descriptor.ts`）：
  - 新增 `descriptionField: string | null`：bilibili `'intro'`，github `'description'`，其余四个平台 `null`。youtube 那条带注释，说明它的 meta 有 `description` key，但那只是 Content 的截断片段。
  - `PlatformDimensions` 新增 `meta: { kind, field } | null`：github 是 `{ kind: 'language', field: 'language' }`，其余 `null`。
  - 两条铁律（只值导入 `./platforms`、不进 barrel）不变，`platform-descriptor.test.ts` 照绿。
- **tagging**：`tagPlatformItem` 用 `isCollectionPlatform` 判定平台，再按 `PLATFORM_DESCRIPTORS[platform].descriptionField` 读简介。签名仍是 `string`，未注册平台视为没有简介。
- **analytics**：新函数 `metaDimensionRows(db, platform, field)`，对每个 `dimensions.meta !== null` 的平台跑一次，结果经 `Promise.all(...).then(flat)` 作为原 `Promise.all` 的第六项。
  - 内层子查询只投影一次 `platform` + `value`（`platform_meta->>${field}`），类型和非空过滤放在 WHERE。
  - 外层按 `(platform, value)` 分组，排序为 `count desc, value asc`。
  - `groupRankedRows` 的维度改读 `dimensions.meta?.kind`；查找链里的 `languageDimensions` 改名 `metaDimensions`。
- **bookmarks**：`bookmarks-sync-service.ts` 导出 `narrowBookmarkMeta(meta, { authorName, publishedAt })`，私有的 `toBookmarkItem` 与 `tagged-bookmark-card.tsx` 都展开它的结果。
- **bilibili**：
  - `video-eligibility.ts` 导出 `BiliItemMeta`（`Pick<BiliFavVideo, …七个字段>`）和 `narrowBiliVideoMeta`。
  - `videos-sync.ts` 的写入字面量加 `satisfies BiliItemMeta`。
  - `tagged-video-card.tsx` 展开 decoder 的结果，再补 `id`、`title`、`bvid`、`upper` 四个信封字段。
- **守卫**：`tests/platform-completeness-contract.test.ts` 新增独立用例「keeps platform knowledge out of shared modules」。
  - 扫描范围：`lib/{tagging,embedding,chat,export}/**` 的非测试 `.ts`，加上 `collection-analytics.ts`、`collection-processing-policy.ts`、`collections-query.ts`。
  - 聚合用例里原来只查 policy 一个文件的正则删除。
  - 维度检查多了一条：`meta.kind` 必须在 `ranked` 里。

**先红后绿**：

- **共享模块守卫**：在改 descriptor / tagging / analytics 之前跑，红的恰好是下面八条，没有别的文件，也没有别的行。本段的行号都是改动前的，今天打开文件对不上。
  - 没有红的位置：tagging 的 `platformMeta` 整列透传（`:91,240,276`）、`tagging-service.ts:108` 的 `item.platformMeta`、`collections-query.ts:60` 的 `->>${sortKey.field}`、chat 注释里的 `` `bilibili` ``、`lib/embedding/config.ts` 的 `import.meta.env`。
  - 红态原样：
    ```
    - lib/tagging/tagging-service.ts:114: literal meta key meta.intro
    - lib/collections/collection-analytics.ts:161: literal JSON key ->>'language'
    - lib/collections/collection-analytics.ts:162: literal JSON key ->>'language'
    - lib/collections/collection-analytics.ts:167: platform literal 'github' in SQL text
    - lib/collections/collection-analytics.ts:168: literal JSON key ->'language'
    - lib/collections/collection-analytics.ts:169: literal JSON key ->>'language'
    - lib/collections/collection-analytics.ts:171: literal JSON key ->>'language'
    - lib/collections/collection-analytics.ts:174: literal JSON key ->>'language'
    ```
- **实现自己的第一次红**：改完 analytics 后，守卫报了 `collection-analytics.ts:200: literal meta key meta.field`，来源是装 descriptor `dimensions.meta` 的局部变量 `meta`。守卫按名字认 meta，所以变量改名为 `facet`，没有放宽规则。这条限制已写进 spec §11 和 `lib/collections/CLAUDE.md`。
- **维度检查证伪（T2）**：把 github 的 `meta.kind` 临时改成合法但不在 `ranked` 里的 `'domain'`，聚合用例红，且只有一条：`github: meta dimension 'domain' is absent from the ranked list`。改回后转绿。
- **守卫探针**：临时建 `lib/export/zz-guard-probe.ts`，跑一次后删除。
  - 命中五条：`meta['intro']`、`row.platformMeta.language`、裸 `'x'`、模板文本里的 `"zhihu"`、`->>'k'`。
  - 放过四条：`row.platformMeta` 整列、`meta[field]`、`import.meta.env`、`` `${field}->>${field}` ``。
- **trellis-check 复核（2026-09-30）**：
  - 独立复现了先红：只把 `tagging-service.ts` 与 `collection-analytics.ts` 换回 HEAD 版再跑守卫，红的正是上面八条，恢复后转绿。T2（`kind: 'domain'`）与 T3（1 failed | 32 passed）也各复现一次。
  - 守卫补了三处漏网，改后探针全部命中：
    - 解构读 key：`const { intro } = meta`、`const { language } = row.platformMeta as …`。rest 元素和计算 key（`{ [field]: v }`）不算，因为它们没有写出 key 名。改之前先用探针证实漏过。
    - `#>` / `#>>` 路径运算符：`#>> '{language}'`。改之前先用探针证实漏过。
    - `??` / `||` 兜底之后的读取：`(row.platformMeta ?? {}).language`。本仓库的 decoder 就用 `(meta ?? {})` 兜底。这一处没有先跑探针：`unwrap` 不剥 `??`，从代码就能看出它会漏。
  - 反例探针照旧放过：`const { platformMeta } = row`、`{ ...rest } = meta`、`{ [field]: v } = meta`、`#>>${field}`。
  - 扩展后改动前的代码仍然恰好红那八条。
  - 守卫的失败信息补了一句：它按名字认 meta，如果被点名的 `meta` 局部变量装的是 descriptor 数据，就改名。原信息只说「移进 descriptor」，这正是 `facet` 那次误报时的错误建议。
  - **仍然是已知缺口，不修**：
    - 别名不追踪，例如 `const m = row.platformMeta; m.intro`。那要做数据流分析，spec §11 已写明守卫按名字认 meta。
    - 平台 id `x` 只有一个字母，扫描范围里任何 `'x'` 字符串字面量都会被当成平台字面量。今天是绿的。
- **T3**：只把 `tagging-service.ts` stash 回旧版再跑 `tagging-service.test.ts`，结果是 1 failed | 32 passed，红的恰好是新增的 GitHub description 用例。youtube 与空串 / 非字符串两例在旧代码上也绿：它们锁的是新语义，不是在证明旧 bug。

**默认决定**（PRD 已定，用户未逐条过目）：

- **D-a** 字段名用 `descriptionField`，不用 `description`：youtube 的 meta 有同名 key，而这里它的值是 `null`。
- **D-b** `dimensions.meta` 只做单格 `{ kind, field } | null`，不做数组（YAGNI，今天只有 github 用）。
- **D-c** tagging 签名不收窄：`string` 一路穿过 `CollectionProcessingItemDeps.tag`。平台判定照 `collection-processing-policy.ts` 的先例用 `isCollectionPlatform`。
- **D-d** B站 decoder 放在 `video-eligibility.ts`（docs/20:410）。parity 测试让内存侧经 decoder 读同一份 meta，decoder 的缺失 `attr` 默认值于是也被 SQL 谓词锁住。
- **D-e** `BookmarkItemMeta` 不导出，只导出 `narrowBookmarkMeta`。fallback 统一为 `publishedAt`，也就是 lib 版原来的行为。
- **D-f** 守卫是独立 `it`，按 AST 扫描、逐条列 `file:line: reason`。扫描清单是本节列表加原 policy 文件，再加 `collections-query.ts` 作为合法反例。`lib/collections/**` 不整目录扫描，因为那里的注册表写平台字面量是本职。
- **D-g** analytics 用子查询处理参数化 key，没有用位置式 GROUP BY：`id` 与 `label` 投影的是同一个表达式，位置式要写 `1, 2, 3`，更难读。
- **D-h** 有 meta 维度的平台各跑一条查询再拼接，不合成一条 CASE。今天只有 github 一个，一条 CASE 的收益为零。
- **D-i** `narrowBiliVideoMeta` 的缺省值写在函数体内，不提成模块级常量：`lib/<platform>/` 下的 SCREAMING_CASE 常量归 `platform-env-constants-guard` 管，而这些缺省值不是可调参数。

**与 PRD 的偏离**：

1. **policy 文件被管得比以前窄**。原检查是 `/platformMeta|->>/` 正则，任何 `platformMeta` 字样和任何 `->>` 都算违规。新规则按 PRD 放过整列引用（`items.platformMeta`）和参数化 key（`->>${…}`）。policy 文件两种规则下都干净，今天没有差别。
2. **tagging 测试的 `seedItem` 多了一个可选参数**：第三参数 `platformMeta`，默认值就是原来写死的 `{ intro: 'intro text' }`。bilibili 的「title/author/intro」用例一行未改；改的是 helper，不是用例。
3. **类别 1 也扫普通字符串字面量里的引号平台 id**，不只扫模板文本；同时跳过 import / export 的模块路径。PRD 只点了模板文本；这里覆盖 `sql.raw("… = 'github'")` 这类写法。
4. **spec §6 开头的字段总数改成「twelve fields — seven domain, five app」**。PRD 只说「字段数凡是写明的地方都要改」，这是 spec 里 §6.1 表之外唯一写明的总数。
5. **根 `CLAUDE.md` 的 `lib/collections/CLAUDE.md` 索引行原本就过期**：它写「五字段」，漏了 `contentKind`。这次一并改成七字段并列全字段名。docs/26 条目里的「领域五字段」是 docs/26 落地时的历史事实，没有改。

**行为变化与验证备注**：

- **打标**：
  - GitHub 条目的 prompt 现在带上仓库 description，没有 README 的仓库因此不再只剩标题和 owner。
  - B站不变。
  - x / zhihu / youtube / bookmarks 的写侧从不写 `intro` key，这四个平台原来就没有简介，现在也没有，不变。
- **tagged bookmark card**：`dateAdded` 的回退从 `null` 改成 `publishedAt`，与书签页查询一致。今天不可见：写侧总是写数字（`bookmarks-api.ts:144` 缺失时写 `0`），两条回退都走不到。
- **tagged video card**：`cnt_info` 从不检查的 `as` 强转改成逐字段收窄，只在 meta 形状错误时有差别。
- **analytics**：快照不变，`collection-analytics.test.ts` 一行未改就全绿，包括「ignores malformed GitHub language metadata」和排名、并列、截断各例。`->${field}` 里的未知类型参数解析成 `jsonb -> text`，不需要 `::text`。证据是「ignores malformed GitHub language metadata」这一例：它走的正是 `jsonb_typeof(… -> field)`。`collections-query.ts:60` 只是 `->>` 的先例，证明不了 `->` 也这样解析。
- **manifest**：`pnpm build` 前后的 `.output/chrome-mv3/manifest.json` **逐字节相同**。基线是在改动前从干净 HEAD 构建的。
  - 这是实施子 agent 的报告，trellis-check 没有重建 HEAD 基线。
  - check 核对的是两件事：
    - diff 里 manifest 的唯一输入是 descriptor，而它的 `hostPermissions` 一行没动；
    - 重新 build 后，`host_permissions` 的平台段与 descriptor 顺序一致。
- **SW 体积**：background bundle 检查照过，13 个模块，946 589 → 947 185 字节（+596）。descriptor 在 SW 图里，新字段是纯数据。
- **测试**：
  - 聚焦的 32 个测试文件共 202 例绿；
  - `pnpm compile` 绿；
  - `pnpm test` 全量绿：主仓库 204 个文件 1619 例，`packages/favbase` 15 个文件 263 例；
  - `pnpm build` 绿。
  - trellis-check 扩展守卫后重跑：
    - `pnpm compile` 绿；
    - `pnpm test` 的计数与上面相同（主仓库 204 / 1619，`packages/favbase` 15 / 263）；
    - `pnpm build` 的 bundle-contract 行是 `13 modules / 947185 bytes`。

### Step 3 风控机制层（中-1，并入低-3 的 X filter）

- **目标**：重试循环与响应读取只有一份实现；数值与语义留在平台。
- **依赖**：无。
- **文件**：
  - `lib/http/`：新增 `bodySnippet`、读一次 body 的 JSON helper、重试循环骨架（attempt 计数、上限、sleep、checkpoint 钩子）。平台注入「这个响应是否重试、等多久、耗尽抛什么」。
  - `lib/x/x-api.ts`、`lib/zhihu/zhihu-api.ts`、`lib/youtube/youtube-api.ts`：迁入。
  - `lib/github/github-api.ts:206`、`lib/bilibili/bili-sync-service.ts:135`、`lib/bilibili/bilibili-transcription-adapter.ts:29,36`：裸 `setTimeout` 改 `backoff.sleep`。（**勘误 2026-09-30**：漏了 `lib/github/github-sync-service.ts:202`，已一并改。）
  - `entrypoints/background.ts:93`：filter 改由 `PLATFORM_DESCRIPTORS.x.hostPermissions` 派生（descriptor 是 leaf，SW 体积锁不受影响，`scripts/` 的检查照跑）。
- **改法要点**：github / youtube / bilibili 今天没有瞬时错误重试，本 Step **不给它们加**（那是行为变化，属于平台风控语义，要单独决定）。
- **测试**：现有 `x-api` / `zhihu-api` / `youtube-api` 测试**一行不改就绿**，这是行为零变化的判据；新增重试骨架单测；在 `tests/http-fetch-deadline-guard.test.ts` 旁加守卫，禁止 `lib/<platform>/` 出现 `setTimeout(` 等待。
- **验证**：各平台手动同步一次。
- **回滚**：revert。
- **判据**：`bodySnippet` 全仓一份；`lib/<platform>/` 零 `setTimeout` 等待；`lib-import-smoke` 绿。

#### Step 3 落地记录（2026-09-30）

代码与单测已落地；上面「验证」（各平台手动同步一次）需要浏览器，**待人工**。判据三条都成立：`bodySnippet` 全仓只剩 `lib/http/response-body.ts` 一份定义；`lib/<platform>/` 零 `setTimeout` 等待，由新守卫锁住；`lib-import-smoke` 绿。

**落在哪**：

- **`lib/http/response-body.ts`**（新，纯 leaf）：`SNIPPET_CHARS = 300` + `textSnippet` / `bodySnippet` / `parseJsonBody(raw, what, suffix = '')`。
  - 解析收的是**已读出的字符串**，不收 `Response`：youtube 在判断状态码之前就读了 body（400/403 要从中取 reason），x / zhihu 解析之后还要拿 `rawBody` 拼别的错误。
  - 「300」从此只出现在这一个文件里。
- **`lib/http/retry.ts`**（新，纯 leaf）：`RetrySignal` + `retryAfter(delayMs, exhausted)` + `withRetries({ maxRetries, control? }, attempt)`。
  - 只 import `./backoff` 的 `sleep`，以及 `cooperative-checkpoint` leaf 的 type。
  - 循环逐条复刻两份旧循环：每次尝试前（含第一次）checkpoint；非 signal 原样返回，抛错原样穿透；`retries >= maxRetries` 才抛；一次调用一个计数器，跨重试原因共享；`delayMs` / `exhausted` 懒调用；用 `instanceof` 判别。
- **x**：`fetchPageWithBackoff` 的签名与 `{ json, res }` 不变，函数体就是一个 `withRetries`。
  - 私有 `bodySnippet` 删除；两处 `resetHeader ? new Date(...) : null` 收成私有 `resetAtOf`。
  - `fetchAllBookmarks` 里的 `while (true)` 是**分页**循环，不是重试循环，留着。
- **zhihu**：`fetchZhihuJson` 同上，**不传 `control`**。
  - 私有 `bodySnippet` 删除；429 / 5xx 共用一个私有 `transientBackoffMs`。
  - 三处 `JSON.stringify(json).slice(0, 300)` 改成 `textSnippet(...)`。
- **youtube**：`apiFetch` 只换响应读取（`parseJsonBody` + 三处 `textSnippet`），不加重试。
- **五处裸等待改 `sleep`**（行号为改前）：`github-api.ts:206`、`github-sync-service.ts:202`、`bili-sync-service.ts:135`、`bilibili-transcription-adapter.ts:29,36`。转录 adapter 只换等待，循环与 `SUBTITLE_RETRY_DELAYS` 不动。
- **`entrypoints/background.ts`**：X 的 filter 改成 `[...PLATFORM_DESCRIPTORS.x.hostPermissions]`，import 走 descriptor 文件，不走 barrel。
- **守卫** `tests/platform-sleep-guard.test.ts`（新）：扫 `PLATFORM_DIRS`，按 AST 找 `new Promise(...)` 参数子树里的 `setTimeout(...)`（含 `globalThis.` / `window.` / `self.` 前缀；trellis-check 又补了 `as` / `!` 包裹与 `['…']` 下标，见下方复核），失败逐条列 `file:line` 并写明修法。

**先红后绿**：

- **守卫**：在改 F 表五处之前跑，红的恰好是下面五条，与 PRD 的 F 表一致，没有别的文件，也没有别的行。改成 `sleep` 后转绿。红态原样：
  ```
  AssertionError: Hand-rolled setTimeout wait in a platform directory — wait with `sleep` from lib/http/backoff.ts, compute delays with `jitteredDelayMs` / `backoffDelayMs`, and retry transient errors with `withRetries` from lib/http/retry.ts:
  - lib/bilibili/bili-sync-service.ts:135
  - lib/bilibili/bilibili-transcription-adapter.ts:29
  - lib/bilibili/bilibili-transcription-adapter.ts:36
  - lib/github/github-api.ts:206
  - lib/github/github-sync-service.ts:202: expected [ …(5) ] to deeply equal []
  ```
- **探测器自检**（防规则空转；下面是实施时的清单，trellis-check 后命中 11 条、放过 5 条，见复核）：
  - 命中五条：`new Promise((r) => setTimeout(r, 1))`、`new Promise((resolve) => { setTimeout(() => resolve(), 5); })`，以及 `globalThis.` / `window.` / `self.` 三种前缀。
  - 放过四条：`setTimeout(send, 0)`、`const t = setTimeout(fn, 100)`、`sleep(100)`、`timer = globalThis.setTimeout(tick, 1000)`。
  - 另一例断言每个 `PLATFORM_DIRS` 目录都存在且有源文件，防扫描范围空转。
- **勘误**：§3 中-1 与本 Step 的文件清单都只记了三个文件四行，漏了第四处：`lib/github/github-sync-service.ts:202`，README 串行抓取的仓间等待。本 Step 的判据「`lib/<platform>/` 零 `setTimeout` 等待」要求它，所以一并改了；守卫的红态正好把它列了出来。两处原文已就地标注。
- **trellis-check 复核（2026-09-30）**：
  - 独立复现了先红：把 `github-api.ts`、`github-sync-service.ts`、`bili-sync-service.ts`、`bilibili-transcription-adapter.ts` 换回 HEAD 版再跑守卫，红的正是上面五条，恢复后转绿。守卫扩展（见下）后又复现一次，仍恰好是这五条。`lib/bilibili/inject/**` 与 `messaging.ts:97` 的定时回调两次都没被点名。
  - 行为零变化另核了一遍，没有发现差异：
    - 逐分支对照 `git show HEAD:` 的 x / zhihu 循环：分支顺序；429 / 5xx / code:88 共用一个计数；`maxRetries` 次重试即 `maxRetries + 1` 次尝试；5xx 的 body 只在耗尽时读；延迟按 1-based 重试序号在睡前算；X 每次尝试前 checkpoint；`fetchZhihuJson` 里不 checkpoint。
    - 把三个 api 文件里所有 `new <Error 类>(…)` 的字面模板抽出来，与 HEAD 逐条 diff。差异只有两类：三条非 JSON 模板搬进了 `parseJsonBody`，按 `what` / `suffix` 拼回来逐字节相同；`slice(0, 300)` 换成了 `textSnippet`。
    - 实施侧的 44 例差分对照没有重跑。
  - **守卫探针**：临时建 `lib/x/zz-sleep-probe.ts`，跑完删除。
    - 原规则命中三种：`new Promise<void>((r) => globalThis.setTimeout(r, n))`、`function (resolve) { setTimeout(resolve, 1) }`、`setTimeout?.(r, 1)`。
    - 原规则漏了四种：`(globalThis as any).setTimeout(…)`、`setTimeout!(…)`、`window['setTimeout'](…)`、`new globalThis.Promise(…)`。
  - **守卫补了这四种漏网**：
    - 匹配名字之前，先剥掉 `(…)` / `as` / `!` / `satisfies` / `<T>` 这类包裹；
    - 宿主上的读取也接受 `['…']` 字符串下标；
    - `Promise` 与 `setTimeout` 共用同一个 `namesGlobal` 判定。
    - 自检的命中表加了这四种，另加 `function` 表达式与 `?.` 调用两例（5 → 11 条）。放过表加了 `window['clearTimeout'](r)`（4 → 5 条），证明下标 key 是精确比较。
    - 改后探针命中七种，只剩别名那一种。
  - **仍然是已知缺口，不修**：
    - 别名不追踪，例如 `const st = setTimeout; new Promise((r) => st(r, 1))`。那要做数据流分析；spec §2 与 `lib/http/CLAUDE.md` 已写明。
    - `Promise.race` 的超时写法 `new Promise((_, rej) => setTimeout(rej, ms))` 也会被判违规。今天平台目录里没有这种写法，而本仓库的超时方案是 `fetchWithDeadline`，所以规则不改。
  - **`lib/http/retry.ts` 的 import 注释改了**：原文说走 barrel「会把 drizzle 拖进每个 importer」，这对 type-only import 不成立——它在构建时被擦除，`x-api.ts` 自己就从 barrel 引这个 type。现在写的是真实理由：`lib/http` 不点 barrel 的名，以后在这里加 value import 也拖不进 `collections-query`。
  - **本记录的两处勘误**（已就地改正）：
    - youtube 是三处 `textSnippet` 加一处 `parseJsonBody`，原写「四处」。
    - 聚焦测试原写「16 个文件 148 例」，与它自己列的清单对不上：那份清单是 14 个文件。按清单重跑是 14 个文件 133 例。
  - **`.trellis/spec/frontend/index.md:68` 的「four guard tests」改成「six」**。spec §2 点名的守卫测试文件现在是六个：completeness、import-smoke、fetch-deadline、sleep-guard、env-constants、cli-aliases。这个数在本 Step 之前就该是五，已经过期；新守卫让它错得更多，所以顺手改了这一个词。
  - **残留 grep**：
    - `bodySnippet` 在 `lib/`、`entrypoints/`、`packages/` 里只有 `response-body.ts:24` 一处定义。
    - `lib/x` 与 `lib/zhihu` 里的 `while (true)` 只剩 `x-api.ts:435`，是分页循环。
  - **manifest**：trellis-check 没有重建 HEAD 基线。diff 里 manifest 的三个输入（`wxt.config.ts`、`package.json`、descriptor）一行没动；重新 build 后 sha256 是 `053dd7bd…fde32ae5`，与下面记录的一致。

**错误消息逐字节核对**：

现有三份 api 测试只用正则匹配片段，所以「测试绿」证明不了消息没变。实施时做了一次性对照：

- **做法**：把 HEAD（`3411664`）版的 `x-api.ts` / `zhihu-api.ts` / `youtube-api.ts` 拷到平台目录之外的临时目录，免得撞上 env 守卫。新旧实现吃同一组响应，逐项比较：
  - 抛出的类名、`name`、`message`、`resetAt`、`reason`；
  - 返回值、fetch 次数、checkpoint 次数；
  - 每一个 `setTimeout` 的延迟（`Math.random` 固定为 0.5，时钟固定）。
- **结果**：44 例全等，跑完即删。
- **矩阵**：
  - x（`fetchPageWithBackoff`，带 `control`）：401、403、429 耗尽（reset 头在未来 / 在过去 / 缺失）、503 耗尽、两次 500 后成功、429→502→code:88→成功（跨原因共享计数）、404、200 非 JSON、200 GraphQL errors、code:88 耗尽（有 / 无 reset 头）、200 形状错、200 成功。
  - zhihu（经 `fetchSelfUrlToken` 走 `fetchZhihuJson`）：401、403、429 耗尽、503 耗尽、429→500→成功、404、200 非 JSON、error body 四种（code 100、code 101 无 message、其他 code、只有 message）、me 缺 `url_token`、成功。另经 `fetchCollections` / `fetchCollectionItems` 核对两个形状错误，以及两页的 checkpoint 次数。
  - youtube（经 `fetchPlaylists`）：400 keyInvalid、400「API key not valid」文本、403 quota、403 其他、400 其他、429、404、500、200 非 JSON、200 形状错、成功；另加 `resolveChannel` 缺 `items`。
- **对照测试自身的证伪**：临时把 `SNIPPET_CHARS` 改成 299，19 例红；再临时让 zhihu 传 `control`、同时把上限判断改成 `>`，8 例红。改回后全绿。

**默认决定**（PRD 已定，或实施时照 PRD 取的，用户未逐条过目）：

- **D-a `RetrySignal` 是 class，按 `instanceof` 判别**，不看结构 key：成功值是平台任意形状。`retry.test.ts` 锁住了「长得像 signal 的成功值原样返回」。构造器保持公开，`retryAfter` 只是读起来顺的工厂；把构造器私有化就得把工厂改成静态方法，收益为零。
- **D-b `withRetries` 的类型参数靠推断**。两个调用点都推对了：x 是 `{ json, res }`；zhihu 是 `unknown`，因为 `unknown | RetrySignal` 折叠成 `unknown`。运行时仍按 `instanceof` 分支，而 `JSON.parse` 产不出 `RetrySignal`。`pnpm compile` 验过，没写显式类型参数。
- **D-c x 收一个私有 `resetAtOf`**（PRD 列为可选）：两处 `resetHeader ? new Date(...) : null` 逐字相同。
- **D-d zhihu 的两个退避 lambda 收成私有 `transientBackoffMs`**，与既有的 `jitteredDelay` 并列。x 不收：它的 5xx 只有一处。
- **D-e 守卫报 `setTimeout` 调用所在的行**，不报 `new Promise` 所在的行。今天五处都是单行，两者相同；多行写法下前者更准。嵌套的 `new Promise` 不重复计数：「在不在 Promise 参数子树里」只是一个往下传的布尔。
- **D-f 守卫不设 allowlist**：今天没有合法例外，出现了再加。

**与 PRD 的偏离**：

1. **spec §4.1 两个指向 `lib/x/x-api.ts` 的行号一并改了**：`:493` → `:495`，`:205` → `:211`。本 Step 让它们移了位，PRD 的 Docs 一节没点到，不改就指错行。
2. **根 `CLAUDE.md` 的 platform-onboarding 条目**原写「五个自动守卫」，随 spec §2 改成六个。PRD 只点了 spec 里的「Five more guards」。
3. **zhihu 也改了注释**：文件头加一句「机制在 `lib/http/`，数值与 403 不重试留本文件」，`fetchZhihuJson` 的注释写明为什么不传 `control`。PRD 只要求同步 x 的注释。
4. **守卫多了一例「扫描范围非空」**。PRD 只列了探测器自检。
5. **`lib/collections/CLAUDE.md` 的 descriptor 条目补了一句**：`hostPermissions` 现在有两个消费方（`wxt.config.ts` 的 manifest 与 background 的 X filter），改 x 那一格会同时改两处。PRD 的 Docs 一节没列这个文件。

**行为变化与验证备注**：

- **行为零变化**：PRD Tests §4 的六个现有测试文件一行未改，全部绿（`git status` 里没有它们）。错误消息的逐字节核对见上。
- **判据之外的残留检查**：
  - `lib/x`、`lib/zhihu` 零重试用 `while (true)`；x 剩下的一个是 `fetchAllBookmarks` 的分页循环。
  - `slice(0, 300)` 在 x / zhihu / youtube 零残留。zhihu 的 `slice(0, 200)` / `slice(0, 80)` 是摘要与标题截断，不是错误片段，没动。
  - github / youtube / bilibili 仍然没有瞬时错误重试（Out of scope）。
- **X filter**：descriptor 里 x 的 `hostPermissions` 今天就是 `['*://x.com/*']`，所以 filter 的值不变。以后 x 在 descriptor 里加 host，捕获范围会随之扩大。这是安全的：`captureXTokens` 先按 URL 含 `x.com` / `twitter.com` 过滤，且 authorization / cookie / x-csrf-token 三者齐备才写。
- **manifest**：`pnpm build` 前后的 `.output/chrome-mv3/manifest.json` **逐字节相同**，sha256 两次都是 `053dd7bd…fde32ae5`。基线是在改动前从干净 HEAD（`3411664`）构建的。
- **SW 体积**：bundle-contract 行从 `13 modules / 947185 bytes` 变成 `13 modules / 947339 bytes`（+154）。descriptor 本来就经 `lib/chat/tools.ts` 在 SW 图里，模块数不变。
- **测试**：
  - 聚焦的 14 个测试文件共 133 例绿：PRD 列的 1–4，加 `http-fetch-deadline-guard`、`lib-import-smoke`、`platform-env-constants-guard`，另加 `agent-bridge-background-bundle-contract` 与 `platform-completeness-contract`；
  - `pnpm compile` 绿；
  - `pnpm test` 全量绿：主仓库 207 个文件 1638 例（Step 2 后是 204 / 1619，新增三个测试文件共 19 例），`packages/favbase` 15 个文件 263 例；
  - `pnpm build` 绿。
  - trellis-check 扩展守卫后重跑（守卫的扩展都在同一个 `it` 里，例数不变）：
    - 聚焦的 14 个文件 133 例绿；
    - `pnpm compile` 绿；
    - `pnpm test` 的计数与上面相同（主仓库 207 / 1638，`packages/favbase` 15 / 263）；
    - `pnpm build` 的 bundle-contract 行是 `13 modules / 947339 bytes`。

### Step 4 错误模型（中-2，并入 `COOLDOWN_MS` 归位）

- **目标**：同步错误一种形状、一个分类器、一个消息函数；B站 412 归入限流；`resetAt` 能禁用按钮。
- **依赖**：无（在 Step 6 之前做，Step 6 的共享状态组件直接用它）。
- **文件**：
  - 新 leaf `lib/collections/sync-errors.ts`：零 import，**不进 `lib/collections/index.ts` barrel**，平台直接 import 文件。定义 Auth 基类（`reason: 'missing' | 'rejected'`）与 RateLimit 基类（`resetAt: Date | null`）。
  - 五个平台错误类改为继承这两个基类。
  - `lib/bilibili/bilibili-api.ts`：412 → `BiliRateLimitError`。
  - app 侧：一个 `classifyCollectionSyncError` + 一个 `syncErrorMessage`（平台只传 i18n 键——限流文案带平台名，各平台键保留）。删除四份分类器、四份 switch，`lib/x/x-messages.ts` 随之删除。
  - `resetAt` 接 scaffold 的 `syncDisabled`。
  - X：`reason` 区分「未登录」与「登录失效」的文案；`COOLDOWN_MS` 迁到 `lib/x/` 并经 `envNumber('VITE_X_COOLDOWN_MS', …)`，同步 `.env.example` 与 env 守卫。
- **测试**：分类器单测覆盖六平台错误类；B站 412 → 限流；`instanceof GithubAuthError` 等既有断言不改就绿。
- **验证**：GitHub 用无效 token、X 登出、B站模拟 412（mock），三种文案正确；GitHub 限流时按钮禁用到重置时间。
- **回滚**：revert。
- **判据**：`classifySyncError` / `syncErrorMessage` 全仓各一份；`lib-import-smoke` 覆盖新 leaf。

#### Step 4 落地记录（2026-09-30）

代码与单测已落地；上面「验证」四项（GitHub 无效 token、X 登出、B站 412、GitHub 限流锁按钮）需要浏览器，**待人工**。判据成立：`classifyCollectionSyncError` 与 `syncErrorMessage` 全仓各一份定义（`entrypoints/app/hooks/collection-sync-error.ts:23`、`collection-sync-error-message.ts:29`）；`lib-import-smoke` 覆盖新 leaf。

**落在哪**：

- **`lib/collections/sync-errors.ts`**（新，零 import，不进 `lib/collections/index.ts` barrel）：`AuthFailReason = 'missing' | 'rejected'`，`abstract class PlatformAuthError(message, reason)`，`abstract class PlatformRateLimitError(message, resetAt: Date | null)`。基类不设 `name`，子类各自显式 `this.name`。`reason` 的判定规则写在 doc comment 里：`'rejected'` 只在请求前已确认持有凭据、平台仍拒绝时使用，其余一律 `'missing'`。
- **六平台十个类全部继承**（改前行号）：
  - bilibili：`BiliAuthError(message, reason)`；`checkAuth` 本地无 cookie → `'missing'`（`bili-sync-service.ts:67`），两处 `-101` → `'rejected'`（`bilibili-api.ts:123,152`）。
  - bilibili：新增 `BiliRateLimitError(message)`，`fetchFavFolders` / `fetchFavVideos` 在 `if (!res.ok)` 之前把 HTTP 412 映射成它，消息保留 `412` 字样。`bili-sync-service.ts:29` 的 re-export 补上它。
  - github：`GithubAuthError(…, 'rejected')`；`GithubRateLimitError` 签名不变。
  - zhihu：两处 `ZhihuAuthError(…, 'missing')`；`ZhihuRateLimitError(message)` 内部 `super(message, null)`。
  - youtube：`YoutubeAuthError(…, 'rejected')`；`YoutubeRateLimitError(message, resetAt = null)` 签名不变。
  - x：`XAuthError` 两处 `'rejected'` 不变；`XAuthFailReason` 删除，`'no-token'` 改名 `'missing'`（`x-sync-adapter.ts:43`）。注释同步改了 `x-api.ts`、`x-auth.ts:21`、`x-sync-service.ts:138`、`entrypoints/background.ts:92`。
  - 子类删掉自己的 `reason` / `resetAt` 字段声明，由基类持有。
- **app 侧分类与文案**：
  - `entrypoints/app/hooks/collection-sync-error.ts`（新，零 i18n）：`CollectionSyncError`（三个变体都带 `message`）、`classifyCollectionSyncError`、`rateLimitRemainingMs`。
  - `entrypoints/app/hooks/collection-sync-error-message.ts`（新）：`SyncErrorCopy` + `syncErrorMessage`。它与分类器分成两个文件，原因见偏离 1。
- **`useCollectionLibrary`**：删掉 `classifyError` 注入与 `TError` 泛型（4 → 3 个类型参数），`syncError` 由 hook 内部分类。
- **五个平台 hook**：删掉 `classifyError:` 行和第 4 个泛型实参，`syncError` 改为 `CollectionSyncError | null`。以下全部删除：`GithubSyncError` / `XSyncError` / `ZhihuSyncError` / `YoutubeSyncError`、github 私有的 `classifySyncError`、`classifyZhihuSyncError`、`classifyYoutubeSyncError`、bookmarks 的 `classifySyncError`、`lib/x/x-messages.ts`。
- **五个 view**：github / x / zhihu / youtube 各有一个模块级 `SYNC_ERROR_COPY`，四份 switch 删除，键映射保持改前文案。bookmarks 改为 `bm.syncError?.message`。
- **X 的两种 auth**：
  - `NotLoggedInState` 收 `reason`，`rejected` 时用新键 `x.sessionRejectedTitle` / `x.sessionRejectedDesc`。
  - 横幅由 `authRejected` 覆盖。
- **B站**：
  - `use-bili-fav-folders.ts` / `use-bili-fav-videos.ts` 的错误都经分类器：`auth` → `not_logged_in`，其余存为 `CollectionSyncError`。
  - 删掉三个英文兜底字面量：`'Sync failed'` / `'Failed to check login'` / `'Failed to fetch videos'`。
  - `bilibili-view.tsx` 有模块级 `SYNC_ERROR_COPY`（新键 `collections.rateLimited`）。三处原先把字符串直接交给 scaffold（夹内页的 `queryError` 与横幅，fallback 页的横幅），现在都先翻译再交。
- **按钮锁**：
  - `entrypoints/app/hooks/use-countdown.ts`（新）：`useCountdown` + 从 `sections/x/cooldown.ts` 搬来的 `formatCountdown`。
  - X 冷却改用它：`use-x-bookmarks.ts` 里内联的 `now` state 与 interval 删除。
  - github / x view 各加一个 `useCountdown((now) => rateLimitRemainingMs(syncError, now))`，结果接 scaffold 的 `syncDisabled` / `syncDisabledLabel`。X 取冷却与限流锁中较晚结束的那个。
  - label 用新键 `pipeline.fetchAvailableIn`，`x.cooldown` 删除。
- **`COOLDOWN_MS`**：
  - 新 leaf `lib/x/cooldown.ts` 定义 `envNumber('VITE_X_COOLDOWN_MS', 300_000)`。
  - app 侧 `sections/x/cooldown.ts` re-export 它，所以 `cooldown.test.ts` 的 `COOLDOWN_MS` / `remainingCooldown` 用例一行未改。
  - `use-x-bookmarks.ts` 原有的 `export { COOLDOWN_MS }` 没有消费者，删除。
  - `.env.example` 与 `.env.local` 的 x 块、`EXPECTED_ENV_CONSTANTS` 三方同步。§3 低-3 第一条随之关闭。
- **守卫**：
  - `tests/platform-completeness-contract.test.ts` 新增两个独立 `it`：继承检查，以及它的探测器自检。
  - `tests/lib-import-smoke.test.ts` 的 `PURE_ENTRIES` 加上 `'@/lib/collections/sync-errors'`，文件头补一句说明。

**先红后绿**：

- **继承守卫**：在改任何错误类之前、只写好新 `it` 时跑，红的恰好是下面 9 条（5 个 Auth + 4 个 RateLimit），与 PRD 预期一致。`BiliRateLimitError` 是新写的，不在红态里。自检同一次跑是绿的。改完 B 节后转绿。红态原样：
  ```
  AssertionError: Platform error class not derived from lib/collections/sync-errors.ts — make every `*AuthError` extend `PlatformAuthError` and every `*RateLimitError` extend `PlatformRateLimitError` (the `reason` rule is in that file's doc comment):
  - lib/bilibili/bilibili-api.ts:45: BiliAuthError extends Error
  - lib/github/github-api.ts:42: GithubAuthError extends Error
  - lib/github/github-api.ts:49: GithubRateLimitError extends Error
  - lib/x/x-api.ts:128: XAuthError extends Error
  - lib/x/x-api.ts:138: XRateLimitError extends Error
  - lib/zhihu/zhihu-api.ts:74: ZhihuAuthError extends Error
  - lib/zhihu/zhihu-api.ts:85: ZhihuRateLimitError extends Error
  - lib/youtube/youtube-api.ts:52: YoutubeAuthError extends Error
  - lib/youtube/youtube-api.ts:59: YoutubeRateLimitError extends Error: expected [ …(9) ] to deeply equal []
  ```
- **探测器自检**（下面是实施时的清单；trellis-check 后命中 8 条、放过 5 条，见下方复核）：
  - 命中三条：`class FooAuthError extends Error {}`、`class FooRateLimitError extends Error {}`、`class FooAuthError {}`。
  - 放过三条：`class FooAuthError extends PlatformAuthError {}`、`class FooRateLimitError extends PlatformRateLimitError {}`、`class HttpDeadlineError extends Error {}`。
- **`tsc` 生成的清单**：Auth 构造器的 `reason` 必填、无默认值，所以改完类后 `tsc --noEmit` 只剩两处报错，恰好是 PRD Tests §6 预告的 `collection-platform-auto-sync.test.ts:131` 与 `use-bili-fav-folders.test.tsx:117`（`Expected 2 arguments, but got 1`）。十个生产抛出点都已按 B 表写了 `reason`。
- **陈旧 `now` 回归例**：临时把 `useCountdown` 换回旧 X hook 的写法（`useState(() => Date.now())`，interval 里 `setNow`），只红新回归例：`expected 605000 to be 5000`。恢复后 6 例全绿。
- **trellis-check 复核（2026-09-30）**：
  - 独立复现了先红：把五个 `*-api.ts` 换回 HEAD 版再跑继承用例，红的正是上面 9 条，行号逐条相同；恢复后用 `cmp` 确认与改动版逐字节一致。守卫扩展（见下）后又复现一次，仍恰好是这 9 条。
  - 十个抛出点的 `reason` 逐一对照 PRD B 表，全部一致。五个 Auth 构造器都是 `(message, reason)`、无默认值；十个子类都有显式 `this.name`；`sync-errors.ts` 零 import，`lib/collections/index.ts` 不导出它。B站 412 只在 `fetchFavFolders` / `fetchFavVideos` 两处、都在 `!res.ok` 之前判定。
  - **守卫探针**：临时建 `lib/x/zz-error-probe.ts`，跑完删除。
    - 原规则命中：`extends (Error)`、`extends globalThis.Error`、`export default class …AuthError extends Error`、`extends (Error as ErrorConstructor)`。
    - 原规则漏了三种，全是 class 表达式：`export const FooAuthError = class extends Error {}`、`const FooRateLimitError = class FooRateLimitError extends Error {}`、`FooAuthError = class extends Error {}`。原实现只认 `ClassDeclaration`。
  - **守卫补了 class 表达式**：新 helper `errorClassNames` 取类自己的名字，再加上它被绑定到的名字（`const X = class …`、`X = class …`、`{ X: class … }`，穿过括号与类型断言），任一名字命中后缀就检查。
    - 自检的命中表从 3 条扩到 8 条：加 `export default`、`globalThis.Error`，以及三种 class 表达式。
    - 放过表从 3 条扩到 5 条：加 `const FooAuthError = class extends PlatformAuthError {}`，以及名字不匹配的 class 表达式。
    - 改后探针原先漏的三种全部命中，`class extends PlatformAuthError` 的表达式照样放过。spec §2 的描述同步改了。
  - **刻意从严，不算缺口**：别名（`const Base = PlatformAuthError; … extends Base`）与包过的基类（`extends (PlatformAuthError as …)`）都判违规。失败信息已经写明要直接写基类名。
  - **仍然是已知缺口，不修**：
    - 基类按标识符名认，不查 import 来源。在平台目录里本地声明 `class PlatformAuthError extends Error`，它自己就会被后缀规则抓到；剩下的洞只有「从别的模块 import 一个同名类」。
    - 规则按类名后缀认：`BiliRiskControlError extends Error` 这种名字不在检查范围。这是设计如此，spec 只约定 `*AuthError` / `*RateLimitError` 两个名字。
    - 没有任何名字的匿名类（`export default class extends Error {}`）不检查。
  - **偏离 1（拆文件）复核**：
    - 复现了 i18n 的加载副作用：临时 vitest 文件只 `import('@/lib/i18n')`，报 9 个 unhandled rejection（`getStorageArea` 读 `undefined.runtime`），文件判失败，跑完删除。
    - 三份测试确实都没 mock `@/lib/i18n` 或 `@/lib/storage`。
    - 判断：拆文件是对的修法，不是绕路。分类器在泛型层，本来就用不到 i18n；另一条路是给三份测试补 mock，而那是 PRD 没许可改的文件。
    - 原文「放在一个文件就会全红」措辞偏重：红的是 vitest 对 unhandled error 的判定，不是用例断言。结论不变。
  - **偏离 2（渲染期读时钟）复核**：
    - StrictMode 双渲染两次读到的时钟相同；effect 挂载、卸载、再挂载只是建一个 interval、清掉、再建一个，稳态只有一个。
    - interval 只在 `active` 由假变真时建、由真变假时清。到 0 的那次 tick 渲染把 `active` 置假，cleanup 随即清掉；`use-countdown.test.ts` 用 `getTimerCount()` 锁住了这一点。
    - 解锁比 reset 晚不到 1 s（tick 粒度），与旧 X hook 相同。
    - X 页冷却与限流锁同时生效时是两个 interval 实例、一个实现；view 取两者的 `Math.max`。
    - `remainingCooldown` 的函数体与它的用例都没动；`cooldown.test.ts` 只少了 `formatCountdown` 的 describe 与对应 import。
  - **偏离 3 复核**：`entrypoints/**` 里另外两个 `setInterval` 都不是倒计时：`bilibili-video.content/components/SubtitleView.tsx:93` 是 250 ms 的播放头轮询，`welcome/hooks/use-typewriter.ts:33` 是打字动画。所以「另有三个既有倒计时」成立。
  - **偏离 4 复核**：接受。它只进 review 表，没有冒充自动守卫，与 §7.2 的写法一致。
  - **本记录的勘误**（已就地改正）：`use-collection-library.test.tsx` 的两处泛型实参在 HEAD 是 `:21`、`:53`，原写 `:20`、`:54`。其余 `file:line` 逐条回查无误：`bili-sync-service.ts:67`、`bilibili-api.ts:123,152`、`x-sync-adapter.ts:43`、`x-auth.ts:21`、`x-sync-service.ts:138`、`background.ts:92`、`collection-platform-auto-sync.test.ts:131`、`use-bili-fav-folders.test.tsx:117`、`x-sync-adapter.test.ts:55,61`、`use-countdown.ts:28`、`zhihu-sync-adapter.ts:52`、`collection-sync-error.ts:23`、`collection-sync-error-message.ts:29`。
  - **残留 grep**：
    - `GithubSyncError` / `XSyncError` / `ZhihuSyncError` / `YoutubeSyncError` / `classifyXSyncError` / `XAuthFailReason` / `x-messages` / `'no-token'` / `x.cooldown` 在代码里零引用，只剩 docs、本任务 PRD 与归档。
    - `entrypoints/app/**` 非测试代码里按平台类 `instanceof` 的只剩上面说的三处刻意保留。
    - `COOLDOWN_MS` 只在 `lib/x/cooldown.ts` 定义；`.env.local` 的 x 块有 `# VITE_X_COOLDOWN_MS=`。
    - PRD Tests §7 列的五个文件，以及 bilibili / zhihu 两个 adapter 测试与 `bili-sync-service.test.ts`，都不在 diff 里。`x-sync-adapter.test.ts` 只改了 §6 许可的两行，mock 类本身没动。
  - **重跑**：
    - 聚焦的 19 个测试文件共 186 例绿；守卫扩展后 completeness contract 5 例绿；
    - `pnpm compile` 绿；
    - `pnpm test` 在默认并行度下两次都挂了几个文件，失败集合互不相同：一次是 5 个（PGlite `beforeAll` 10 s 超时为主），一次是 3 个（含 `lib-import-smoke` 的 5 s 超时）。两组分别单跑全绿。这是根 `CLAUDE.md` 记下的已知抖动，本机当时负载偏高；
    - `VITEST_MAX_WORKERS=4 pnpm test` 全量绿：主仓库 210 个文件 1689 例，`packages/favbase` 15 个文件 263 例；
    - `pnpm build` 的 bundle-contract 行是 `14 modules / 947838 bytes`；manifest 的 sha256 是 `053dd7bd…fde32ae5`，与改动前的 HEAD 基线相同。

**改了哪些现有测试**（都只因签名或形状变化）：

- `entrypoints/app/sections/x/x-sync-adapter.test.ts`：`:61` 的 `reason: 'no-token'` → `'missing'`；`:55` 的用例标题同步改名（见偏离 3）。
- `entrypoints/app/collection-platform-auto-sync.test.ts:131`：`new ZhihuAuthError('out')` 补第二参 `'missing'`。mock 工厂里的类没动。
- `entrypoints/app/sections/bilibili/use-bili-fav-folders.test.tsx`：
  - mock 工厂改成 async，在工厂里 `await import('@/lib/collections/sync-errors')`，mock 的 `BiliAuthError` 继承 `PlatformAuthError`（hook 改为按基类分类）。
  - `:117` 补 `'missing'`。
  - 这个测试不断言 `error` 字符串，没有别的改动。
- `entrypoints/app/hooks/use-collection-library.test.tsx`：`:33`、`:58` 删 `classifyError`；另外 `:21`、`:53` 的第 4 个泛型实参也得删（见偏离 2）。
- `entrypoints/app/sections/x/cooldown.test.ts`：`formatCountdown` 的 describe 与 import 搬到 `use-countdown.test.ts`，其余一行未改。
- PRD 点名要扩的守卫与测试：`tests/platform-completeness-contract.test.ts`、`tests/lib-import-smoke.test.ts`、`tests/platform-env-constants-guard.test.ts`（一行表项）、`lib/bilibili/bilibili-api.test.ts`（412 用例）。
- **一行未改就绿**：
  - `lib/x/x-api.test.ts`、`lib/zhihu/zhihu-api.test.ts`、`lib/youtube/youtube-api.test.ts`、`lib/github/github-api.test.ts`（`toBeInstanceOf(XAuthError)` 等照绿）；
  - `collection-page-scaffold.test.tsx`；
  - 另外五个 `*-sync-adapter.test.ts`、`use-bookmarks.test.tsx`、`bili-sync-service.test.ts`、`sections/configuration-heading.test.tsx`。

**默认决定**（PRD 已定，用户未逐条过目）：

- **D-a 类名** 用 `PlatformAuthError` / `PlatformRateLimitError`，不叫 Sync*：错误也从非同步路径抛出，例如 B站浏览和设置卡的 token 测试。文件名按本文用 `sync-errors.ts`。
- **D-b 基类 `abstract`**，子类各自显式 `name`。
- **D-c `reason` 判定规则**见 PRD B 表，知乎恒 `missing`。X 的 `'no-token'` 改名 `'missing'`，一处测试断言随之改。
- **D-d Auth 构造器的 `reason` 必填、无默认值**：漏写编译不过，比给默认值安全。
- **D-e `useCollectionLibrary` 删掉 `classifyError` 注入与 `TError`**。
- **D-f 每个 `CollectionSyncError` 变体都带 `message`**：bookmarks 零新键，行为逐字不变。
- **D-g `SyncErrorCopy` 的 `authRejected` / `rateLimitedUntil` 可选**：只有能区分两种 auth、能拿到 reset 的平台才给。缺省回落到基础键，表示平台不认识这个维度，不是隐藏特例。
- **D-h B站两个 hook 都走分类器**：浏览路径的 412 也显示本地化文案，D4 的风险面正是浏览路径。
- **D-i 倒计时 hook 共享**：X 冷却迁入，`pipeline.fetchAvailableIn` 取代 `x.cooldown`。锁只在 github / x 接，只有它们带 `resetAt`。
- **D-j `COOLDOWN_MS` 放新 leaf `lib/x/cooldown.ts`**，app 侧 `cooldown.ts` re-export，`cooldown.test.ts` 因此不用改。
- **D-k 继承守卫并进 completeness contract 的独立 `it`**，不新建文件，spec §2 的守卫文件计数不变。
- **倒计时的实现选择**（PRD 让落地记录写明）：选渲染期读 `Date.now()`，不把 `now` 存进 state，interval 只负责 `setTick` 触发重渲染。理由：
  - 存 state 的 `now` 在没有倒计时时不 tick，会一直停在挂载时刻。挂载 10 分钟后才到的限流错误，首帧就会多算 10 分钟。
  - 另一种做法是激活时在 layout effect 里重置 `now`，但那样首帧仍按旧值渲染一次，靠第二次渲染纠正，会闪一下。
  - 渲染期读时钟是非纯的，但只影响显示的秒数，不影响任何状态转移。
  - effect 依赖只有 `active`：`remainingAt` 每次渲染都是新闭包，放进依赖会每帧重建 interval。

**与 PRD 的偏离**：

1. **`syncErrorMessage` 不和分类器放在同一个文件**，拆到 `entrypoints/app/hooks/collection-sync-error-message.ts`，函数签名与 PRD 逐字相同。
   - 原因：`@/lib/i18n` 在模块加载时就调 `localeStorage.getValue()` / `.watch()`。
   - 实测：临时写一个只 `import('@/lib/i18n')` 的 vitest 文件，报 9 个 unhandled rejection，`@wxt-dev/storage` 的 `getStorageArea` 读 `undefined.runtime`，跑完删除。
   - 分类器被 `useCollectionLibrary` 与两个 B站 hook import，而 `use-collection-library.test.tsx`、`use-bookmarks.test.tsx`、`use-bili-fav-folders.test.tsx` 都没 mock i18n。这三份测试不在 PRD 允许修改的范围里，放在一个文件就会全红。
   - 结果：分类器那个文件零 i18n，只有 view import 带 i18n 的那一半。新测试 `collection-sync-error.test.ts` 自己 mock `@/lib/i18n`。
2. **`use-collection-library.test.tsx` 多改了两行**：PRD 只点了 `:33,58`，但 `:21` 的 `UseCollectionLibraryReturn<string, never, void, string>` 与 `:53` 的 `useCollectionLibrary<string, never, void, string>` 也带着第 4 个泛型，理由同样是 E 的签名变化。
3. **`x-sync-adapter.test.ts:55` 的用例标题**从「throws the no-token auth error…」改成「throws the missing-session auth error…」，与 `:61` 的改名同一个理由。
4. **`use-countdown.test.ts` 不写 JSX**，用 `createElement`，以保留 PRD 定的 `.ts` 文件名。
5. **「全仓只有一个 1 s 倒计时 interval 实现」只对 app.html 成立**：`entrypoints/app/**` 非测试代码里 `setInterval` 只剩 `use-countdown.ts:28`。
   - 全仓还有三个既有倒计时：Content Script 的 `lib/hooks/useRetryCountdown.ts`（转录限流重试），以及 `lib/auto-transcribe/pipeline.ts`、`lib/bilibili/transcription-coordinator.ts` 两个非 React 类里的 `countdownTimer`。
   - 它们跑在另一个 runtime，或在 React 之外，不能 import app hook，也不在本 Step 的范围里，没动。
6. **spec §11 多加了一行**「per-platform 分类器或 view 里的 switch → review」。PRD 只要求「直接 `extends Error` → completeness contract」那一行；多出的这行把 §7.2 的新写法写成禁项。
7. **注释同步多了一处 `entrypoints/background.ts:92`**（`"no-token" sync errors` → `"missing"-session sync errors`），属 PRD B 的「等注释」。

**行为变化与验证备注**：

- **B站 412**：改前同步横幅是「同步失败: Bilibili API HTTP 412」，浏览错误态显示 `Bilibili API HTTP 412`。现在两处都是「触发 B 站限流，请稍后重试」。其余非 2xx 仍显示原始消息。非 `Error` 的抛出值现在显示 `String(err)`，改前是三个英文兜底字面量之一。
- **X `rejected`**：横幅与空库 StateBox 都改用「X 登录已失效」这套文案。`missing` 不变。
- **GitHub / X 带 reset 的限流**：标题栏按钮禁用并显示倒计时，到点自动解锁。
  - 锁只活在内存 job store 里：刷新页面即解锁。这是接受的行为，Platform Sync Record 刻意不存错误（§5.1）。
  - 锁只作用于标题栏按钮。空库错误态、X 未登录态 StateBox 里的「立即获取」不受锁。
  - 知识库暂停时，scaffold 照旧 `gatePaused || syncDisabled` 并丢掉 label。
- **X 冷却**：label 键从 `x.cooldown` 换成 `pipeline.fetchAvailableIn`，文案逐字相同。
  - 顺带记一个旧实现的巧合：旧 hook 的 `now` 从挂载起就不 tick。长时间挂着的页面同步成功后，`now < lastSyncedAt` 会落进 clock-skew 分支、返回满窗口，所以首帧碰巧显示 5:00。限流的 deadline 没有这个巧合可依赖，这是新 hook 在渲染期读时钟的直接原因。
- **zhihu / youtube / bookmarks**：用户可见文案不变。
- **i18n**：新增 `pipeline.fetchAvailableIn`、`collections.rateLimited`、`x.sessionRejectedTitle`、`x.sessionRejectedDesc`（zh / en 各一），删除 `x.cooldown`。
- **仍按平台类 `instanceof` 的三处**（刻意保留）：`zhihu-sync-adapter.ts:52` 的 `isSilentError`（触发方策略），`github-connection-card.tsx` 与 `youtube-connection-card.tsx` 的 token 测试。
- **manifest**：改动前从干净 HEAD（`63eac7e`）构建，`.output/chrome-mv3/manifest.json` 的 sha256 是 `053dd7bd…fde32ae5`；改动后重建相同，**逐字节不变**。
- **SW 体积**：bundle-contract 行从 `13 modules / 947339 bytes` 变成 `14 modules / 947838 bytes`（+1 模块、+499 字节）。多出的模块是经 `bilibili-api.ts` 进 SW 图的 `sync-errors.ts`，本身零 import。
- **测试**：
  - 聚焦的 27 个测试文件共 249 例绿；
  - `pnpm compile` 绿；
  - `pnpm test` 全量绿：主仓库 210 个文件 1689 例（Step 3 后是 207 / 1638，新增三个测试文件，加上 412 用例与守卫用例），`packages/favbase` 15 个文件 263 例；
  - `pnpm build` 绿。
- **`.env.local`** 是 gitignored 文件，本机已按空值注释行格式补上 `# VITE_X_COOLDOWN_MS=`，env 守卫的 `.env.local` 半边在本机跑过、是绿的。

**[UNKNOWN]**：B站在 HTTP 200 的 JSON 里是否也用风控码（`-352` / `-412`）表示拦截，没有观测记录。本 Step 只映射 HTTP 412。JSON 层的码仍落到 `Bilibili API error <code>: <message>` 这个普通 `Error`，显示为原始消息。观察到再议，与附录 A 的 D4 浏览路径 412 同属一类待观测项。

### Step 5 正文来源契约（中-6）

- **目标**：延迟正文有一份可照抄的契约；两条现有管线共享已经重复的零件。
- **依赖**：D5；Step 1（收尾 funnel 定型后，逐条派发路径的边界才清楚）。
- **文件**：
  - `lib/ingest/ingest.ts`：私有 `settleContent`（`:395-409`）导出为 `settleItemContent`；`saveBookmarkContent` 改用它。
  - `lib/embedding/chunker`：加一个具名的 Markdown 分块 preset，替换四处 lambda。
  - 六个文件里的硬编码 job 命名空间改用 `jobPlatformForCollection`（中-6 所列）。
  - 契约测试：`sections/**` 禁止 `startJob('<字面量>'` / `useJob('<字面量>'`，扩展现有的「jobPlatform 手写」守卫。
  - `platform-onboarding.md` 新增「延迟正文」一节：`contentState:'pending'` → worker → `settleItemContent` → 逐条 `enqueueCollectionProcessingItem`，以 bookmarks 为模板、B站为流式变体。
- **不做**：面板合并、job kind 改名。
- **测试**：bookmarks 提取测试不改就绿；守卫对今天的六个文件**先红**。
- **验证**：书签提取、B站手动转录各跑一条，pipeline strip 与 job 徽标正常。
- **回滚**：revert。
- **判据**：`sections/**` 零字面 job 命名空间；`persistItemContent` + 手写 `contentState` 更新的组合全仓只在 `settleItemContent` 里出现。

#### Step 5 落地记录（2026-10-01）

代码与单测已落地；上面「验证」（书签提取、B站手动转录各跑一条，看 pipeline strip 与 job 徽标）需要浏览器，**待人工**。判据两条都成立：

- `entrypoints/app/**`（比原写的 `sections/**` 宽）零手写 job 命名空间，由新守卫锁住；
- `persistItemContent` 全仓只剩 `lib/ingest/ingest.ts` 里的私有定义与 `settleItemContent` 这一个调用点；`contentState: written ? 'chunked' : 'no_content'` 全仓只剩 `settleItemContent` 一处。

**落在哪**：

- **job 命名空间改派生**：一律 `import { jobPlatformForCollection } from '../../hooks/collection-job-platform'`（`sections/` → `hooks/` 是允许方向）。
  - 平台 id 既当条目平台、又当 job 命名空间用的四个文件，保留 `const PLATFORM = '<id>'`（面包屑、pipeline、scaffold、`getPlatformLastSyncedAt`、`itemPlatform` 继续用它），新增模块级 `const JOB_PLATFORM = jobPlatformForCollection(PLATFORM)`：`bilibili-view.tsx`、`use-bili-fav-folders.ts`、`bilibili-processing-adapter.ts`、`use-bookmark-extraction.ts`（后者原来没有 `PLATFORM`，新建）。
  - 只当命名空间用的两个文件只有 `JOB_PLATFORM = jobPlatformForCollection('bilibili')`：`auto-transcribe-runtime.ts`（原 `PLATFORM` 只有 `:44` 一处使用，删除）、`use-video-transcribe.ts`。
  - 五个平铺 hook：`const LOG_TAG = '<namespace>'` → `const JOB_PLATFORM = jobPlatformForCollection('<平台 id>')`，`logTag: JOB_PLATFORM`。X hook 的 `console.error` 前缀跟着改名，输出仍是 `[x-bookmarks]`。**键名 `logTag` 不改**（Step 7 的改名层）。
  - 注释：`hooks/use-collection-library.ts` 的 `logTag` 注释改成「Background-job namespace — pass `jobPlatformForCollection(platform)`; also the console.error prefix」，`hooks/background-jobs-store.ts` 的 `platform` 字段注释改指 descriptor 的 `jobPlatform`。
- **`lib/ingest/ingest.ts`**：
  - 第 5 阶段的私有闭包 `settleContent` 提成导出的 `settleItemContent(db, itemId, text, chunkText) → Promise<boolean>`。它写正文与 chunk 行，写成则 `'chunked'`，否则 `'no_content'`，返回是否写成。
  - 原闭包里的 `text.trim() ? … : false` 预判删掉：`persistItemContent` 对空白文本本来就返回 `false` 且不碰数据库，两者等价。
  - ingest 的闭包缩成「调 `settleItemContent`，写成则 push 进 `contentPersisted`」。5b 仍读它的返回值算 `healedItemIds`。
  - `persistItemContent` 去掉 `export`。doc comment 改成「Only `settleItemContent` calls it」，文件头 GHOSTS 第 1 条改指 `settleItemContent`。
  - `persistExistingItemContent` 不动（B站转录：按平台身份寻址、带时间戳的 prepared chunks、要写 `subtitle_source`、先 `has_content` 后 `chunked`）。
- **`lib/embedding/char-split.ts`**：新增导出 `paragraphSplit(text)` = `charSplit(text, { preferParagraph: true })`，barrel `lib/embedding/index.ts` 在 `charSplit` 旁多 re-export 它。github / zhihu / youtube 三个 sync-service 的 `chunk:` 改成 `chunk: paragraphSplit`，import 换成只 import `paragraphSplit`（leaf）。x 的 `preferParagraph: false` 不动。
- **`saveBookmarkContent`**：签名不变，函数体一行 `return settleItemContent(db, itemId, markdown, paragraphSplit)`；`persistItemContent` 与 `charSplit` 的 import 删除，`items` / `eq` 仍被 `markItemNoContent` 用着。
- **守卫** `tests/platform-completeness-contract.test.ts` 新增两个独立 `it`：探测器自检「detects hand-written job namespaces」与真实扫描「derives every job namespace from the descriptor」。
  - 纯函数 `jobNamespaceOffenders(source, fileName)` 自己 `ts.createSourceFile`。它检查两类位置（下面是实施时的形状；trellis-check 又补了 `deps['startJob']` 下标调用、计算字面量键与 `!` 包裹，见复核）：job-store 调用（callee 是裸名或属性访问末段，属于 `startJob` / `useJob` / `getJob` / `pauseJob` / `resumeJob` / `trackJobRun`）的第一参；名为 `jobPlatform` / `logTag` 的 `PropertyAssignment` 与 `ShorthandPropertyAssignment`。
  - 「手写」的判定：`unwrap` 后是字符串 / 无替换模板 / 模板表达式，或是标识符，且其同模块 `VariableDeclaration` 的初始值递归满足本判定（最多 5 跳）。调用、属性访问、参数、import 都放过。
  - 同模块常量的查找另写了一个收 `ts.SourceFile` 的 `moduleVariableInitializer`；原 `variableInitializer` 签名没动。
  - 扫描范围是 `appModules()`，与 funnel 守卫同一个 helper。

**先红后绿**：

- **守卫**：在改任何生产代码之前、只写好两个 `it` 时跑。真实扫描红的恰好是 PRD 表里 **11 个文件 21 处**，行号逐条相同，没有 `sections/**` 之外的文件；自检同一次跑是绿的（`1 failed | 6 passed`）。改完 B 节后转绿。红态原样：
  ```
  AssertionError: Job namespace written by hand — derive it with `jobPlatformForCollection(platform)` (docs/32 Step 5). `jobPlatform` differs from the platform id for github / x / zhihu / youtube, so a copied literal silently splits a platform's jobs across two namespaces:
  - entrypoints/app/sections/bilibili/auto-transcribe-runtime.ts:44: startJob(PLATFORM = 'bilibili')
  - entrypoints/app/sections/bilibili/bilibili-processing-adapter.ts:9: jobPlatform: PLATFORM = 'bilibili'
  - entrypoints/app/sections/bilibili/bilibili-view.tsx:196: useJob(PLATFORM = 'bilibili')
  - entrypoints/app/sections/bilibili/bilibili-view.tsx:197: useJob(PLATFORM = 'bilibili')
  - entrypoints/app/sections/bilibili/bilibili-view.tsx:198: useJob(PLATFORM = 'bilibili')
  - entrypoints/app/sections/bilibili/bilibili-view.tsx:345: useJob(PLATFORM = 'bilibili')
  - entrypoints/app/sections/bilibili/bilibili-view.tsx:346: useJob(PLATFORM = 'bilibili')
  - entrypoints/app/sections/bilibili/bilibili-view.tsx:347: useJob(PLATFORM = 'bilibili')
  - entrypoints/app/sections/bilibili/use-bili-fav-folders.ts:42: useJob(PLATFORM = 'bilibili')
  - entrypoints/app/sections/bilibili/use-bili-fav-folders.ts:64: startJob(PLATFORM = 'bilibili')
  - entrypoints/app/sections/bilibili/use-video-transcribe.ts:20: startJob('bilibili')
  - entrypoints/app/sections/bookmarks/use-bookmark-extraction.ts:58: startJob('bookmarks')
  - entrypoints/app/sections/bookmarks/use-bookmark-extraction.ts:66: jobPlatform: 'bookmarks'
  - entrypoints/app/sections/bookmarks/use-bookmark-extraction.ts:77: useJob('bookmarks')
  - entrypoints/app/sections/bookmarks/use-bookmark-extraction.ts:78: useJob('bookmarks')
  - entrypoints/app/sections/bookmarks/use-bookmark-extraction.ts:79: useJob('bookmarks')
  - entrypoints/app/sections/bookmarks/use-bookmarks.ts:77: logTag: LOG_TAG = 'bookmarks'
  - entrypoints/app/sections/github-stars/use-github-stars.ts:88: logTag: LOG_TAG = 'github-stars'
  - entrypoints/app/sections/x/use-x-bookmarks.ts:90: logTag: LOG_TAG = 'x-bookmarks'
  - entrypoints/app/sections/youtube/use-youtube-playlists.ts:89: logTag: LOG_TAG = 'youtube-playlists'
  - entrypoints/app/sections/zhihu/use-zhihu-favorites.ts:78: logTag: LOG_TAG = 'zhihu-favorites': expected [ …(21) ] to deeply equal []
  ```
  `hooks/` 一条都没红：`use-collection-library.ts` 的 `logTag` 是从 `config` 解构出来的（`ObjectBindingPattern`，不是标识符命名的 `VariableDeclaration`）；`collection-processing-jobs.ts` 里的 `jobPlatform` 都是参数；`library-gate.ts` 的 `const jobPlatform = jobPlatformForCollection(platform)` 初始值是调用。三者按规则放过。
- **探测器自检**（下面是实施时的清单；trellis-check 后命中 14 条、放过 7 条，见下方复核）：命中表 10 条各恰好 1 条：直接字面量、无替换模板、同模块常量、两跳常量链、`deps.startJob`、`jobPlatform` 字面量 / 常量 / shorthand、`logTag` 常量、模板表达式。放过表 6 条零条：派生常量、属性访问、参数、import、`itemPlatform`、`useCollectionBreadcrumbs`。
- **证伪**：把 `bilibili-view.tsx:200` 的 `useJob(JOB_PLATFORM, 'tag')` 临时换回 `PLATFORM`，真实扫描恰好红一条：`- entrypoints/app/sections/bilibili/bilibili-view.tsx:200: useJob(PLATFORM = 'bilibili')`（`1 failed | 6 passed`）。恢复后 `7 passed`，`git diff` 与证伪前相同。
- **只按字面量判定会漏多少**：上表里调用点直接写字面量的只有 `use-video-transcribe.ts` 与 `use-bookmark-extraction.ts` 两个文件 6 处。其余 15 处经模块常量传入，所以规则必须解析同模块常量（§3 中-6 勘误①）。
- **新增的 ingest / char-split 用例**：没做先红。`settleItemContent` 与 `paragraphSplit` 在 HEAD 不存在，旧代码上这几例是 import 失败，不是断言红，证明不了什么。它们锁的是新 API 的语义：
  - `settleItemContent` 有文本 → `true` + `'chunked'` + chunk 行 = chunker 输出；
  - 空白文本 → `false` + `'no_content'` + `item_contents` 无行；
  - 覆盖转录正文时 `subtitle_source` 清成 NULL，且状态是 `'chunked'`；
  - `paragraphSplit` 与 `charSplit(…, { preferParagraph: true })` 深相等，且与 `preferParagraph: false` **不**相等——所以用的那段文本确实能区分两种模式。
- **trellis-check 复核（2026-10-01）**：
  - **独立复现了先红**：把 11 个生产文件换回 HEAD 版（`git show HEAD:<path>`），只跑命名空间两例：自检绿，真实扫描恰好红上面 21 条，11 个文件、行号逐条相同；恢复后 `cmp` 确认 11 个文件与改动版逐字节一致。守卫补完下面三处后又复现一次，仍恰好这 21 条、行号相同，恢复后再次 `cmp` 11/11。
  - **独立复现了证伪**：`bilibili-view.tsx:200` 换回 `PLATFORM`，整份契约测试 `1 failed | 6 passed`，唯一一条正是 `bilibili-view.tsx:200: useJob(PLATFORM = 'bilibili')`；恢复后 `cmp` 一致。
  - **守卫探针**（临时在契约测试里加一例打印探测器结果，跑完删掉，删后 `cmp` 与探针前一致）：
    - 任务点名的 9 种写法，原规则命中 7 种：`` startJob(`b` as const, …) ``、`const P = 'b' as const`、`const P = ('b')`、`let P = 'b'`、`{ ...{ jobPlatform: 'b' } }`（内层对象照样被遍历）、`useJob<Foo>('b', …)`、`` startJob(`${'b'}`, …) ``。
    - 漏了 2 种：`startJob(P!, …)`（非空断言不在 `unwrap` 里）、`{ ['jobPlatform']: 'b' }`（计算键，`propertyName` 只认标识符与字符串键；`` [`jobPlatform`] `` 同样漏）。
    - 另试的写法里，`startJob?.('b')`、`{ 'jobPlatform': 'b' }`、`useJob(ns satisfies string)` 命中；`deps['startJob']('b')` 漏（callee 只认标识符与属性访问）。
  - **守卫补了三处**：
    - `handWrittenNamespace` 剥掉 `unwrap` 后再循环剥 `!`（只在本探测器里做，共享的 `unwrap` 不动——它还服务前面的注册表解析）；
    - 新 helper `namespacePropertyKey`：计算键的表达式是字符串 / 无替换模板时按该名字算；
    - 新 helper `calleeName`：在裸名、属性访问之外再认 `deps['startJob']` 这种字面量下标。
    - 自检命中表从 10 条扩到 14 条（`P!`、`deps['startJob']`、`['jobPlatform']`、`` [`logTag`] ``），放过表从 6 条扩到 7 条（`({ [key]: 'p' })`：计算键不是字面量就不算）。改后整份契约测试 7 例绿，真实扫描仍是零条。探测器 doc comment 同步写了新覆盖面与「Not seen」清单；spec §2 的描述粒度够，不用改；根 `CLAUDE.md` 的守卫描述同步补了这三处与下面的缺口。
  - **仍然是已知缺口，不修**（今天树里都没有这种写法；补任何一种都要改「手写」的定义或追 import）：
    - 条件与拼接：`startJob(c ? 'a' : 'b', …)`、`startJob('b' + x, …)`；
    - job-store 函数的别名 import（`import { startJob as sj }`）、getter（`get jobPlatform() { return 'b'; }`）、赋值（`o.jobPlatform = 'b'`）、解构出来的常量（`const { P } = { P: 'b' }`）、经常量的计算键（`const k = 'jobPlatform'; ({ [k]: 'b' })`）；
    - callee 是封闭清单：`isLibraryPaused(jobPlatform)`、`collectionPlatformForJob`、`backgroundJobPlatformLabel` 也收命名空间，不在 `JOB_STORE_CALLS` 里（今天没有字面量调用点，`isLibraryPaused` 只被当 reader 传给 `setJobGate`）；
    - D-b 记下的两条（跨模块字面量常量不追、同名参数被当成模块常量误报）实测成立。
  - **语义复核**：
    - `settleItemContent` 与旧 ingest 闭包等价：被删的 `text.trim() ? … : false` 与 `persistItemContent` 开头的 `trim` + `return false` 同义，空白文本两边都不碰 `item_contents`、都只写一条 `'no_content'`；与旧 `saveBookmarkContent` 逐语句相同（同一个 `update … set { contentState, updatedAt }`）。phase 5 的 5a / 5b、`contentPersisted`、`healedItemIds` 那几段除闭包体外一行没动。
    - `persistItemContent` 无 `export`；`lib` / `entrypoints` / `tests` / `packages` / `scripts` / `spikes` 里（含测试）只剩 `ingest.ts` 的定义与 `settleItemContent` 里的调用。`item_contents` 的 insert 全仓只在 `lib/ingest/ingest.ts`。
    - 六个派生值逐个对照 `platform-descriptor.ts` 的 `jobPlatform`，与 HEAD 字面量相同；`PLATFORM` 仍只用于条目平台的位置；`auto-transcribe-runtime.ts` 删掉的 `PLATFORM` 没有别的引用；代码里 `LOG_TAG` 零残留。
    - `paragraphSplit` 恰好四处，x 的 lambda 没动，四个 lib 文件都 leaf import，无闲置 `charSplit` import。
    - 测试 diff 只有三个文件：`char-split.test.ts` 15 增 1 删（删的那行是 import 行加了 `paragraphSplit`，原有用例没动）、`ingest.test.ts` 40 增 3 删（import、标题、调用）、契约测试。
  - **修了一处测试标题**：新增例原名「settleItemContent writes chunk rows before claiming chunked」，但它只断言终态，证明不了先后顺序，改成「settleItemContent writes the chunker output and settles at chunked」。断言没动。
  - **spec §4.4 补了四处**（新平台照抄时会漏的契约，不读源码看不出来）：
    - 模板第一条补：funnel 闭包返回 `newItemIds: []`——pending 条目还没有正文，由 worker 逐条派发；funnel 的 backlog-only embed lane 仍会捡起中断留下的 `'chunked'`（`platform-sync.ts` 的 `PlatformSyncOutcome.newItemIds` 注释、`collection-processing-jobs.ts` 的「empty → 不派 tag」）；
    - `settleItemContent` 不发领域事件，worker 对每条落定的条目发 `item-content-updated`（`bookmark-content-service.ts:142`、`transcribe-utils.ts:78`），否则 coverage 与卡片不刷新；B站变体同样「写成 → 事件 → 逐条派发」；
    - B站代码清单补 `lib/bilibili/transcribe-utils.ts`（persist → 事件 → `startProcessing` 的顺序住在那里）；
    - 「Which writer」末句原写模块私有让那种组合「cannot be written outside `lib/ingest`」，说过头了（谁都能直接对 `item_contents` 写 drizzle），改成「outside `lib/ingest` there is no exported piece to build that pairing from」。
  - **本记录与 §3 的勘误**（已就地改正）：§3 中-6 勘误②引用的 `use-collection-library.ts:145,156,157,271` 是 HEAD 行号；Step 5 在 `:45` 的注释多了三行，现在是 `:148,159,160,274`。其余 `file:line` 逐条回查无误：`auto-transcribe-runtime.test.ts:153`、`use-bookmark-extraction.test.ts:87-88`、`bilibili-processing-adapter.test.ts:19-20`、`transcription-coordinator.ts:79`、`github-sync-service.ts:18`、`bookmarks-sync-service.ts:21`、`bilibili-view.tsx:200`；`bili-sync-service.test.ts` 对 `@/lib/ingest/ingest` 的 mock 确实只导出 `persistExistingItemContent`。
  - **重跑**（在上面这些改动之后）：
    - 聚焦（PRD 命令）36 个文件 291 例绿；
    - `pnpm compile` 绿；
    - `pnpm test` 一次全绿：主仓库 210 个文件 1694 例，`packages/favbase` 15 个文件 263 例，没遇到超时（自检扩展都在同一个 `it` 里，例数不变）；
    - `pnpm build` 的 bundle-contract 行是 `14 modules / 947838 bytes`；manifest 的 sha256 是 `053dd7bd…fde32ae5`，与 Step 4 相同。
    - 运行时验证（书签提取、B站手动转录各跑一条）仍**待人工**。

**默认决定**（PRD 已定，用户未逐条过目）：

- **D-a 守卫范围 `entrypoints/app/**`**，比 Step 5 原文的 `sections/**` 宽；`hooks/` 今天全是派生，扩大范围零成本，以后也不会漏。
- **D-b 守卫解析同模块常量**（最多 5 跳），不追 import。按名字在整个模块里找 `VariableDeclaration`，不按作用域。已知缺口：
  - 从别的模块 import 进来的字面量常量（例如 `export const NS = 'p'` 再 import）不追，今天没有这种写法；
  - 同名的参数与模块常量并存时会误报（参数会被当成那个常量），今天也没有。
- **D-c 守卫同时查 `logTag:`**（用户决定提前 `LOG_TAG`，§3 中-6 勘误②）；`logTag` 键名不改。
- **D-d 不改 `enqueueCollectionProcessingItem` / `startCollectionProcessingJobs` 的签名**（不让它们内部派生 `jobPlatform`）。**未做**，理由：`collection-processing-jobs.test.ts` 有 8 处用任意命名空间调用它们，改签名属 D5 之外的 churn；调用方传的值已由守卫锁住，派生在调用方做和在函数里做，结果一样。
- **D-e `persistItemContent` 去 `export`**，靠模块边界兑现判据，不另加守卫。
- **D-f preset 名 `paragraphSplit`**：按行为（段落优先）命名，因为 YouTube description 不是 Markdown；写成 `function` 声明（PRD 允许 `const` 箭头或等价的 `function`）。
- **D-g `saveBookmarkContent` 保留为薄包装**：`bookmark-content-service.ts` 调它，绑定 preset 与默认 db 是它存在的理由。
- **D-h spec 新节放 §4.4**，原 §4.4 Tests 顺延 §4.5：全仓 grep `§4.4` / `§4.5` 零交叉引用，插入不打断任何现有引用。
- **守卫报告的行**：调用报**第一参**所在的行，属性报属性节点所在的行。今天每处都与调用 / 属性起始同一行；多行调用下前者更准（同 Step 3 D-e）。

**与 PRD 的偏离**：

1. **spec 多改了两处 PRD G 节没点名的地方**：
   - §4.2 的「Chunking: `charSplit` …」一行改成先推荐 `paragraphSplit`（`chunk: paragraphSplit`），句末切的推文仍用 `charSplit`。不改的话，接新平台的人照 §4.2 会再写出第五份同形 lambda。
   - §4.3 的 `'pending'` 条加了「(§4.4)」交叉引用。PRD 只在「挂到 §10 之后」那个备选方案里要求它；放 §4.4 时它同样有用。
2. **spec §2 原文「a hand-written `jobPlatform`」补成「… in the auto-sync registry」**，与新加的命名空间守卫区分开。PRD 说「若只指 auto-sync registry，保留那半句」——它确实只指那一项，保留并写明。
3. **`paragraphSplit` 用例多一条 `not.toEqual(charSplit(…, { preferParagraph: false }))`**：PRD 只要求与 `preferParagraph: true` 深相等。只断言相等的话，一段两种模式切法相同的文本也能过；加上这条，证明这段文本确实能区分两种模式。
4. **两个 sync-service 的头注释顺手改了**：`github-sync-service.ts:18` 与 `bookmarks-sync-service.ts:21` 原写「`charSplit` chunks」，改成 `paragraphSplit`。只动注释。
5. **`entrypoints/app/hooks/CLAUDE.md` 的 `collection-job-platform.ts` 条目也补了一句**：消费方从「`library-gate` 与 provider 恢复门面」扩到 funnel 与 `sections/**` 的全部命名空间。PRD G.5 只点了 `useCollectionLibrary` 的 `logTag`。
6. **四个平铺平台 section 的 `CLAUDE.md` 没改**：PRD G.5 的条件是「如有提到 `LOG_TAG` 的地方」，逐个 grep 都没有。x / zhihu 文中的 `x-bookmarks:embed|tag`、`zhihu-favorites:embed|tag` 是运行时键的描述，值没变。约定统一写进了 `hooks/CLAUDE.md` 消费方那一行。
7. **`lib/bilibili/transcription-coordinator.ts:79` 注释里的 `startJob('bilibili', 'transcribe', …)` 字样没改**：lib 层描述 app 接线的注释，不在守卫范围，PRD 写「不改也行」。
8. **多改了四个平台 lib 目录的 `CLAUDE.md`**：`lib/github`、`lib/zhihu`、`lib/youtube` 三处原写「`charSplit(text, { preferParagraph: true })` 切块」，改成 `paragraphSplit`（并注明它等于前者）；`lib/bookmarks/CLAUDE.md` 的 items 行映射条原写「`charSplit` 切块；`persistItemContent` 返回值 …」——后者已是模块私有、书签不再碰它——改成「`paragraphSplit` 切块，经 `settleItemContent`」。PRD G.5 只点了 `lib/bookmarks/CLAUDE.md`（且只指 `saveBookmarkContent` 条），另外三个不在清单里，但不改就是写着已经不成立的调用形状。`lib/x/CLAUDE.md` 不动（`preferParagraph: false` 没变）。

**行为变化与验证备注**：

- **运行时行为零变化**：六个平台的 `jobPlatform` 都没变，派生值与原字面量逐个相同（bilibili `'bilibili'`、bookmarks `'bookmarks'`、github `'github-stars'`、x `'x-bookmarks'`、zhihu `'zhihu-favorites'`、youtube `'youtube-playlists'`，`platform-descriptor.ts` 已回查），所以 job 键、闸门、徽标、indicator 文案都不变。
- **ingest phase 5 与书签提取**：写入顺序与状态转移逐字相同；只是两份实现变成一份。`'chunked'` 仍只在 chunk 行落库之后写。
- **manifest**：本 Step 不动 descriptor。`pnpm build` 后 `.output/chrome-mv3/manifest.json` 的 sha256 是 `053dd7bd…fde32ae5`，与 Step 4 记录的基线相同。
- **SW 体积**：bundle-contract 行是 `14 modules / 947838 bytes`，模块数与字节数都与 Step 4 后相同。所以本 Step 的改动没有进入 SW 的产物；`char-split.ts` / `ingest.ts` 是否在 SW 的模块图里、只是新导出被 tree-shake 掉，没有单独核对。
- **测试**：
  - 聚焦（PRD 命令：contract + `lib/ingest` + `char-split` + `lib/bookmarks` + `sections/bookmarks` + `sections/bilibili` + `hooks/`）36 个文件 291 例绿；
  - `pnpm compile` 绿；
  - `pnpm test` 全量绿：主仓库 210 个文件 1694 例（Step 4 后 210 / 1689，+5：两个守卫 `it`、两例 `settleItemContent`、一例 `paragraphSplit`），`packages/favbase` 15 个文件 263 例；在 config 的 `maxWorkers: 8` 下一次跑过，没遇到 PGlite / import-smoke 超时；
  - `pnpm build` 绿。

**改了哪些现有测试**：

- `lib/ingest/ingest.test.ts`：PRD 唯一许可的一处。`:11` 的 import 把 `persistItemContent` 换成 `settleItemContent`。原「persistItemContent clears a subtitle source…」改调 `settleItemContent`，标题改成「settleItemContent clears a subtitle source…」，多断言该行 `content_state = 'chunked'`。另新增两例：有文本 / 空白文本。
- `lib/embedding/char-split.test.ts`：只新增（import 加 `paragraphSplit`，末尾新 `describe('paragraphSplit')` 一例），原有用例一行未改。
- `tests/platform-completeness-contract.test.ts`：只新增两个 `it` 与它们的 helper。
- **一行未改就绿**：
  - `lib/bookmarks/bookmark-content-service.test.ts`（真 PGlite 跑 `extractPendingBookmarks` → `saveBookmarkContent` → `settleItemContent`）；
  - `entrypoints/app/sections/bookmarks/use-bookmark-extraction.test.ts`（`:87-88` 断言 `jobPlatform: 'bookmarks'`，派生值相同）；
  - `entrypoints/app/sections/bilibili/bilibili-processing-adapter.test.ts`（`:19-20` 同理）；
  - `auto-transcribe-runtime.test.ts`（`:153` 用字面量 `'bilibili'` 抢占 transcribe 键，派生值相同所以照样排队）、`use-bookmarks.test.tsx`、`use-bili-fav-folders.test.tsx`、`use-collection-library.test.tsx`、各 `*-sync-service.test.ts`、`lib/bilibili/bili-sync-service.test.ts`（它的 `@/lib/ingest/ingest` 部分 mock 只导出 `persistExistingItemContent`，本 Step 没碰那条路径）。

### Step 6 平台页外壳（中-5 除 hook 改名层外的部分）

- **目标**：平铺平台 view 只写平台特有部分。
- **依赖**：Step 4。
- **文件**：
  - `components/collection/collection-page-scaffold.tsx`：`syncLabel` / `syncingLabel` / `loadFailed` / `retry` 给默认值，7 处调用点删掉这四行。
  - `components/collection/`：共享 `EmptyLibraryState` / `NotLoggedInState` / `NeedsConfigState`，平台只传 icon、i18n 键和打开站点的 URL。
  - 五个 view 删本地副本。
  - i18n：新增 `collection.lastSynced` / `syncFailed` / `showMore` / `showLess` / `all` 五个共享键（zh / en 各一份），删 30 个平台副本；勘误 docs/16:11 的 LOW-7 记录。
  - `hooks/use-collection-library.ts` 导出 `SEARCH_DEBOUNCE_MS`，B站 view 与 `use-collections.ts` 复用它。
  - ~~`LOG_TAG` 改由 `jobPlatformForCollection` 派生。~~ **已提前到 Step 5**（2026-10-01，用户决定）：五个 `LOG_TAG` 就是 `useCollectionLibrary` 的 job 命名空间，Step 5 的「零字面 job 命名空间」判据不提前它就不成立（§3 中-6 勘误②）。
  - ~~B站 caption 时间改用 `formatDateTime`。~~ **已提前到 Step 1**（2026-09-30，D-g）：Step 1 让 `lastSyncedAt` 活过刷新，只显示时刻会把上周的同步显示成「10:32」。
- **测试**：`collection-page-scaffold.test.tsx` 加默认文案断言；`tests/i18n-no-hardcoded.test.ts` 照跑；locale parity 测试照跑。
- **验证**：六平台页 × 亮 / 暗 × 中 / 英截图，空库、未登录、未配置三种状态逐一过一遍。
- **回滚**：revert。
- **判据**：`EmptyLibraryState` / `NotLoggedInState` 全仓各一份；`*.lastSynced` 平台键零残留。

#### Step 6 落地记录（2026-10-01）

代码与单测已落地；上面「验证」（六平台页 × 亮 / 暗 × 中 / 英截图，空库、未登录、未配置三种状态）需要浏览器，**待人工**。判据都成立：

- `EmptyLibraryState` / `NotLoggedInState` / `NeedsConfigState` 全仓各一个定义，都在 `entrypoints/app/components/collection-states/collection-states.tsx`；
- `NoTokenState` / `NotConnectedState` / `AuthFailedState` / `OpenZhihuButton` / `OpenBookmarksButton` 在 `entrypoints/`（代码与 `CLAUDE.md`）零残留；
- 两个 locale 里 `.lastSynced` / `.syncFailed` / `showMore` / `showLess` / `.goToSettings` 只剩 `common.*` 那一个（`snackbar.syncFailed` 文案不同，不在范围），`allLanguages` / `allAuthors` / `zhihu.allCollections` / `allPlaylists` / `allPlatforms` / `allFolders` 零残留；
- `CollectionPageCopy` 不含那五个字段，七个调用点都不传；
- `SEARCH_DEBOUNCE_MS = 300` 全仓一个定义（`SubtitleView.tsx` 的 100 除外）；
- `entrypoints/app/components/collection/**` 非测试文件零 `t(` / `useTranslation` / `@/lib/i18n` import（剥掉注释行后 grep 为空；剩下的命中全是「Zero `t()`」这类注释）。

**铁律冲突与解法（用户 2026-10-01 决定）**：本 Step 原文要「scaffold 给四个文案默认值」「共享状态组件只收 i18n 键」，两件都要调 `t()`，而 `components/collection/**` 有零 `t()` 铁律（spec `platform-onboarding.md` §11、`components/collection/CLAUDE.md`）。解法是新建智能兄弟目录 `entrypoints/app/components/collection-states/`，自带 `useTranslation()`；scaffold 只在它已有的具名例外名单（原来只有 `library-gate`）里多 import 一个叶文件。`components/collection/` 的文件自身仍零 `t()`。

**落在哪**：

- **`components/collection-states/`（新）**：
  - `collection-states.tsx`：三个导出状态 `EmptyLibraryState({ icon, title, description, syncing, onSync, site? })`、`NotLoggedInState({ …, site })`、`NeedsConfigState({ …, settings, sync? })`，加私有 `GuideState` / `OpenSiteButton` / `GoToSettingsButton`。
    - 平台只传 `IconifyName`、`LocaleKeys`、`SiteAction`（`{ href, label: LocaleKeys, icon: IconifyName }`）或 `SettingsLeaf`，`tsc` 校验三者。
    - 动作区规则由组件推出、不做 prop：前导动作（打开站点 / 前往设置）与获取都有 → 居中可换行 `Box`（`gap: 1`）里前导在前、`SyncNowButton` **outlined** 在后；只有获取 → 单个 **contained**；只有前导 → 单个前导。这是 `sync-now-button.tsx` 原来写在文档里的约定。
    - `OpenSiteButton` 与迁移前 x / zhihu 两份逐属性相同（`component={Link}`、`target="_blank"`、`rel="noopener"`、contained、18px 图标）。`GoToSettingsButton` 保持 `onClick` + `navigate(settingsPath(leaf))`，不改成链接。
  - `use-collection-chrome-copy.ts`：`useCollectionChromeCopy()` → `{ syncLabel, syncingLabel, loadFailed, retry, syncFailed(error) }`，只依赖 `useTranslation`。
  - `index.ts`（barrel）、`CLAUDE.md`、`collection-states.test.tsx`。
- **scaffold**：
  - `CollectionPageCopy` 删 `syncLabel` / `syncingLabel` / `loadFailed` / `retry` / `syncFailedBanner`，剩 `title` / `breadcrumbs?` / `caption?` / `searchPlaceholder` / `noMatches` / `syncErrorText`。
  - 顶部 `const chrome = useCollectionChromeCopy()`（直接 import 叶文件 `../collection-states/use-collection-chrome-copy`）。标题栏两个 label、两处 `ErrorState` 的 `title` / `retryLabel` 改读 `chrome`；横幅改成 `chrome.syncFailed(copy.syncErrorText)`，渲染条件仍是 `hasSyncError && libraryCount > 0`。文件头与 `CollectionPageCopy` 的注释改写成「平台文案 vs 外壳文案」。
- **四个平铺 view**：
  - github：配置门 → `NeedsConfigState`（`mdi:github`、`githubStars.noTokenTitle/Desc`、`settings="connections/github"`）；库空 → `EmptyLibraryState`（`mdi:star`）。
  - youtube：配置门与 `authFailedState` 都是 `NeedsConfigState`（`settings="connections/youtube"`，后者带 `sync`）；库空 → `EmptyLibraryState`。
  - x：模块级 `X_BOOKMARKS_SITE`（`as const satisfies SiteAction`，原注释保留）同时传给 `EmptyLibraryState` 与 `NotLoggedInState`；未登录态的两套键由 view 按 `authReason` 选（`sessionRejected ? 'x.sessionRejectedTitle' : 'x.notLoggedInTitle'` 等）。
  - zhihu：模块级 `ZHIHU_SITE` 只给 `NotLoggedInState`；`EmptyLibraryState` 不传 `site`（单个 contained 获取，与改前相同）。
  - 删除的本地件：github `NoTokenState` / `EmptyLibraryState`，youtube `NotConnectedState` / `AuthFailedState` / `EmptyLibraryState`，x 与 zhihu 各自的 `NotLoggedInState` / `EmptyLibraryState` 与 `OpenBookmarksButton` / `OpenZhihuButton`——九个状态、两个按钮。github / youtube 的 `useNavigate` 与 `settings-nav` import 随之消失。
- **七个 `copy={{…}}`**（四个平铺 view + bookmarks + B站两处）删掉那五行；bookmarks「无错误时传 `''`」的横幅三元式随之消失。
- **六处 caption 的「上次同步」**改用 `common.lastSynced`。
- **i18n**：zh-CN 与 en 各新增 `common.lastSynced` / `syncFailed` / `showMore` / `showLess` / `all` / `goToSettings`（放在 `common.retry` / `loadFailed` 旁），各删 36 个副本。
  - 开工前用脚本逐字节核对过：表 D 的 35 个旧键在两个 locale 里的值都与新值相同，另一个是 `bookmarks.allFolders`（`全部 ({{count}})` / `All ({{count}})`）。
  - `bookmarks/folder-chips.tsx` 改成与其余四个 chips 同一拼法 `` `${t('common.all')} (${totalCount})` ``，渲染逐字不变。
  - 调用点：六个 chips 文件、`sections/collections/collections-view.tsx`、`components/tags/tag-filter-chips.tsx`。删键后 `tsc` 一次全绿，没有遗漏的调用点。
- **`SEARCH_DEBOUNCE_MS`**：`hooks/use-collection-library.ts` 改为 `export const`；`sections/bilibili/bilibili-view.tsx` 与 `sections/collections/use-collections.ts` 删本地定义、改 import。`SubtitleView.tsx` 的 100 不动。
- **view 行数**（HEAD → 现在）：github 236 → 196、x 234 → 176、zhihu 196 → 149、youtube 227 → 160、bookmarks 146 → 139、bilibili 503 → 493。新目录 `collection-states.tsx` 185 行、hook 34 行。

**先红后绿**：

- **scaffold**：先建好叶文件 `use-collection-chrome-copy.ts`（新代码，不是 scaffold 改动，好让 `vi.mock` 的目标能解析），再改 `collection-page-scaffold.test.tsx`。
  - 测试改动：`vi.mock` 该 hook 返回哨兵串；`./error-state` 的 mock 改为记录 props（保留 `data-section="content"`，否则顺序用例跟着红）；`baseProps.copy` 删五个字段；新增四例。横幅那例包一层 `ThemeProvider`——横幅的 `sx` 读 `theme.vars`，没有 CSS-vars provider 会直接 TypeError，而不是断言失败。
  - 对**未改动**的 scaffold 跑，红的恰好是四个新例，原有 7 例绿。红态原样（只删掉了 `stderr | … act(...)` 环境告警行与 `RUN` 横幅——这个文件原来就没设 `IS_REACT_ACT_ENVIRONMENT`；收尾前把 scaffold 临时换回 HEAD 版重跑了一次，结果相同，下面是那一次的输出，换回后 `cmp` 与改动版一致）：
    ```
     ❯ entrypoints/app/components/collection/collection-page-scaffold.test.tsx (11 tests | 4 failed) 66ms
         × labels the title-bar fetch button from its own chrome copy 6ms
         × titles the query-error phase from its own chrome copy and retries the query 2ms
         × titles the sync-error phase from its own chrome copy and retries the sync 2ms
         × composes the sync-failed banner itself, and only above a populated library 26ms

    ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

     FAIL  entrypoints/app/components/collection/collection-page-scaffold.test.tsx > CollectionPageScaffold section contract > labels the title-bar fetch button from its own chrome copy
    AssertionError: expected { title: 'Title', …(9) } to match object { syncLabel: 'chrome:fetch', …(1) }
    (8 matching properties omitted from actual)

    - Expected
    + Received

      {
    -   "syncLabel": "chrome:fetch",
    -   "syncingLabel": "chrome:fetching",
    +   "syncLabel": undefined,
    +   "syncingLabel": undefined,
      }

     ❯ entrypoints/app/components/collection/collection-page-scaffold.test.tsx:274:32
        272|     act(() => root.render(<CollectionPageScaffold {...baseProps} />));
        273|
        274|     expect(titleBarProps.last).toMatchObject({
           |                                ^
        275|       syncLabel: 'chrome:fetch',
        276|       syncingLabel: 'chrome:fetching',

    ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

     FAIL  entrypoints/app/components/collection/collection-page-scaffold.test.tsx > CollectionPageScaffold section contract > titles the query-error phase from its own chrome copy and retries the query
    AssertionError: expected { title: undefined, …(3) } to match object { title: 'chrome:load-failed', …(3) }

    - Expected
    + Received

      {
        "message": "Boom",
        "onRetry": [Function Mock],
    -   "retryLabel": "chrome:retry",
    -   "title": "chrome:load-failed",
    +   "retryLabel": undefined,
    +   "title": undefined,
      }

     ❯ entrypoints/app/components/collection/collection-page-scaffold.test.tsx:285:34
        283|     });
        284|
        285|     expect(errorStateProps.last).toMatchObject({
           |                                  ^
        286|       title: 'chrome:load-failed',
        287|       message: 'Boom',

    ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

     FAIL  entrypoints/app/components/collection/collection-page-scaffold.test.tsx > CollectionPageScaffold section contract > titles the sync-error phase from its own chrome copy and retries the sync
    AssertionError: expected { title: undefined, …(3) } to match object { title: 'chrome:load-failed', …(3) }

    - Expected
    + Received

      {
        "message": "Sync failed",
        "onRetry": [Function Mock],
    -   "retryLabel": "chrome:retry",
    -   "title": "chrome:load-failed",
    +   "retryLabel": undefined,
    +   "title": undefined,
      }

     ❯ entrypoints/app/components/collection/collection-page-scaffold.test.tsx:300:34
        298|     });
        299|
        300|     expect(errorStateProps.last).toMatchObject({
           |                                  ^
        301|       title: 'chrome:load-failed',
        302|       message: 'Sync failed',

    ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

     FAIL  entrypoints/app/components/collection/collection-page-scaffold.test.tsx > CollectionPageScaffold section contract > composes the sync-failed banner itself, and only above a populated library
    AssertionError: expected '' to contain 'chrome:failed:Quota hit'

    - Expected
    + Received

    - chrome:failed:Quota hit

     ❯ entrypoints/app/components/collection/collection-page-scaffold.test.tsx:319:35
        317|       );
        318|     });
        319|     expect(container.textContent).toContain('chrome:failed:Quota hit');
           |                                   ^
        320|
        321|     // An empty library shows the sync-error phase instead — no banner.

    ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯

     Test Files  1 failed (1)
          Tests  4 failed | 7 passed (11)
       Start at  03:21:03
       Duration  2.49s (transform 455ms, setup 17ms, import 1.57s, tests 66ms, environment 612ms)
    ```
  - 改完 scaffold 后 11 例全绿。
  - 横幅那例的后半段（`libraryCount === 0` 时没有横幅）在旧代码上也成立，是守卫而不是红；红态里它没有跑到，因为同一例的前半段先失败了。
- **`collection-states.test.tsx`（8 例）证伪**：临时把变体规则翻成 `lead ? 'contained' : 'outlined'`，红 4 例（单获取 contained、x 两态的 outlined 获取、带 `sync` 的 `NeedsConfigState`），`4 failed | 4 passed`；恢复后 `cmp` 与改动版一致，8 例全绿。变体按 `buttonClasses.contained` / `buttonClasses.outlined` 判定，不手打 `MuiButton-*` 类名（`entrypoints/app/CLAUDE.md` 的 v9 约定）。

**默认决定**（PRD 已定，用户未逐条过目）：

- **D-a 删字段，不给默认值**：七个调用点传的外壳文案逐字相同，没有调用方会覆盖；可选 + 无人覆盖 = 死代码。`syncFailedBanner` 一并删：键共享之后七处拼法相同，由 scaffold 拼。这是对本 Step 原文「给默认值」措辞的偏离。
- **D-b 命名空间用 `common.*`，不用原文的 `collection.*`**：`collection.` 与 B站历史命名空间 `collections.` 只差一个字母，而 `collections.lastSynced` 本身就是要删的键；docs/15 LOW-7 当年指定的就是 `common.*`。
- **D-c 刻意留在本地的状态**：bookmarks `EmptyState`（没有按钮，是另一个状态）、B站 `NotLoggedIn`（动作是重试）、`EmptyFolderState`（无图标无按钮）、`SelectFolderState`（240 高）。
- **D-d `tags.*` / `allCollections.*` 的同文键一并收**，代价是 `collections-view.test.tsx` 的键名映射。
- **D-e「本次新增」不在本 Step**：它是新功能不是去重，`sections/x/CLAUDE.md` 那句已改成「未排期，适合与 Step 7 一起做」。
- **D-f 状态组件收 `LocaleKeys` 而不是字符串**；x 的两种 auth 由 view 选键，组件不认识 `reason`。
- **D-g 不新增守卫**：「locale 里没有同文副本」写不成不误报的规则；`tsc` 已保证删掉的键零残留调用。
- **D-h scaffold 直接 import 叶文件**，测试 mock 叶路径。
- **D-i 状态组件 `icon` 收 `IconifyName`**，统一画 48px `text.secondary`；站点按钮图标 18px。
- **D-j 不动 `sync-now-button.tsx` / `state-box.tsx` / `error-state.tsx` 的接口**。

**与 PRD 的偏离**：

1. **`collection-states.tsx` 从叶文件 import `StateBox` / `SyncNowButton`**（`../collection/state-box`、`../collection/sync-now-button`），没有走 PRD 写的 `../collection` barrel。barrel 带着 scaffold，scaffold 又 import 本目录的 hook 和 `library-gate`（加载期读 `libraryGateStorage`）；两个哑组件用不着这些。走 barrel 不成环（scaffold 引的是叶 hook），但新测试就得 mock `@/lib/storage` 才能加载，而 `GuideState` 只渲染两个哑组件。
2. **`collection-states.test.tsx` 的 `t` mock 把参数拼在键后面**（`common.syncFailed|error=Quota hit`），不是 PRD 写的 `{{x}}` 插值。键原样返回，键里没有 `{{error}}` 占位符，插值什么也证明不了；拼在后面才看得出参数确实传进去了。
3. **`collection-states` barrel 多导出四个类型**：三个 props 类型和 `CollectionChromeCopy`。PRD 只列了组件、`SiteAction` 与 hook。
4. **PRD G 清单之外多改了三处文档**，都是本 Step 让它们过期的：
   - `entrypoints/app/sections/CLAUDE.md` 原写「`settingsPath` 是本目录唯一一处 section → sibling section 的 import」——github / youtube 改用 `NeedsConfigState` 后 `sections/` 里已没有这个 import；
   - `entrypoints/app/hooks/CLAUDE.md` 的 `collection-phase.ts` 条目点名了 `NoTokenState`，判据要求 `entrypoints/` 零残留；
   - 顺手更正 `github-stars/CLAUDE.md`、`bookmarks/CLAUDE.md` 与 `components/collection/CLAUDE.md` 消费方清单里把 chips 写成「`ChipRowShell` + `FilterChip`」的描述——代码早已是 `CollapsibleChipRow`，这几行本 Step 本来就要改。
5. **`i18n-conventions.md` 改了**：PRD 的条件是「若有平台前缀键的约定处」。§2 Key naming conventions 表就是键前缀的约定处，所以加了一行 `common.*` 与一段「一句话跨平台一个键」（列出六个新键、计数在调用点拼、为什么没有守卫）。不写的话，下一个平台照 §2 还会造出 `<p>.lastSynced`。
6. **被删的本地 JSDoc 里有两句信息搬了家**：x 的 `'missing'` / `'rejected'` 解释挪到 view 里 `authReason` 的计算处；zhihu、youtube 未登录 / 被拒态的说明挪成 `authFailedState` 上方的注释。

**行为变化与验证备注**：

- **渲染逐字不变**（逐态对照过改前 JSX）：
  - 动作区 `Box` 的 `sx`、按钮先后与变体：github 库空 contained、zhihu 库空 contained、youtube 库空 contained；x 两态与 zhihu 未登录是打开站点 contained + 获取 outlined；youtube 被拒是前往设置 contained + 获取 outlined；github / youtube 未配置是单个 contained 前往设置。
  - `rel="noopener"`、18px / 48px 图标与 `text.secondary`。
  - 文案值：`common.goToSettings` 与原两个键同值；所有「全部 (N)」与展开 / 收起同值；横幅与上次同步同值。
  - React 树多了一层 `GuideState` 包装，DOM 不变。
- **i18n**：`LocaleKeys` 净减 30 个（36 删、6 增）。新键全部双语，`en.ts` 的 `Record<LocaleKeys, string>` 保证 parity。
- **模块图**：`sections/collections/use-collections.ts` 现在 import `hooks/use-collection-library.ts`（只为常量），后者把 `background-jobs-store` / `collection-sync-error` 带进来；两者都只有模块级数据结构、无加载副作用，`use-collections.test.tsx` 一行未改就绿。
- **manifest**：本 Step 不动 descriptor。`pnpm build` 后 `.output/chrome-mv3/manifest.json` 的 sha256 是 `053dd7bd…fde32ae5`，与 Step 4 / 5 相同。
- **SW 体积**：bundle-contract 行是 `14 modules / 947838 bytes`，与 Step 5 后相同。
- **测试**：
  - 聚焦（PRD 命令：`components/collection` + `components/collection-states` + `components/tags` + `sections` + `hooks` + `lib/i18n` + contract + i18n-no-hardcoded + ui-vendor-boundaries）64 个文件 441 例绿；
  - `pnpm compile` 绿；
  - `pnpm test` 全量绿：主仓库 211 个文件 1706 例（Step 5 后 210 / 1694，+1 文件、+12 例：scaffold 4 例、collection-states 8 例），`packages/favbase` 15 个文件 263 例；在 config 的 `maxWorkers: 8` 下一次跑过；
  - `pnpm build` 绿。
- **运行时验证待人工**：六平台页 × 亮 / 暗 × 中 / 英，空库、未登录（x 两种 reason、zhihu）、未配置（github、youtube）、youtube 密钥被拒各过一遍；同步失败横幅在有库时出现。

**改了哪些现有测试**：

- `entrypoints/app/components/collection/collection-page-scaffold.test.tsx`：PRD F.1 许可的先红改动（见上）。
- `entrypoints/app/sections/configuration-heading.test.tsx`：只改键名映射——`githubStars.goToSettings` / `youtube.goToSettings` 两行合成一行 `'common.goToSettings': 'Open settings'`。其余一行未改，三组用例照绿（单 h1、按钮落到 `/settings/connections/<platform>`、面包屑）。
- `entrypoints/app/sections/collections/collections-view.test.tsx`：只改键名映射——`allCollections.allPlatforms` / `showMorePlatforms` / `showLessPlatforms` 换成 `common.all` / `showMore` / `showLess`，值不变；`tags.showMore` / `showLess` 两行与之重复，删掉。没有断言依赖这些文案。
- **一行未改就绿**：`use-collection-library.test.tsx`、`use-bookmarks.test.tsx`、`use-bili-fav-folders.test.tsx`、`use-collections.test.tsx`、`tests/platform-completeness-contract.test.ts`（含面包屑与 job 命名空间两个守卫）、`tests/i18n-no-hardcoded.test.ts`、`tests/ui-vendor-boundaries.test.ts`、`lib/i18n/index.test.ts`。

**trellis-check 复核（2026-10-02）**：

- **独立复现了 scaffold 先红**：把 `collection-page-scaffold.tsx` 换回 HEAD 版（`git show HEAD:<path>`），只跑 `collection-page-scaffold.test.tsx`：`4 failed | 7 passed (11)`，红的恰好是四个新例，原有 7 例绿；恢复后 `cmp` 与改动版逐字节一致。
- **独立复现了变体证伪**：把 `collection-states.tsx` 的 `variant={lead ? 'outlined' : 'contained'}` 翻成 `lead ? 'contained' : 'outlined'`，`4 failed | 4 passed (8)`，红的正是记录里那四例；恢复后 `cmp` 一致。
- **渲染等价逐态对照**（HEAD 的本地组件 vs 共享组件，九个状态）：github 无 token / 库空、youtube 未配置 / 被拒 / 库空、x 库空 / 未登录（`missing` 与 `rejected` 两套键）、zhihu 库空 / 未登录。逐项核对图标名、48px、`text.secondary`，标题 / 描述键，动作区 `Box` 的 `sx`（`display: flex`、`justifyContent: center`、`gap: 1`、`flexWrap: wrap`），按钮先后，变体（无前导才 contained——HEAD 的 x / zhihu / youtube 双按钮态都是 `SyncNowButton` 默认的 outlined），`component={Link}` + `target="_blank"` + `rel="noopener"`，站点按钮 18px 图标，`navigate(settingsPath('connections/<platform>'))`。没有差异。scaffold 外壳文案：七个调用点 HEAD 传的 `syncLabel` / `syncingLabel` / `loadFailed` / `retry` 都是 `pipeline.fetchNow` / `pipeline.fetching` / `common.loadFailed` / `common.retry`，横幅是 `t('<p>.syncFailed', { error: syncErrorText })`；bookmarks 的 `syncErrorText` 仍是原始 `message`，「无错误传 `''`」分支被 `hasSyncError && libraryCount > 0` 条件覆盖、从不渲染；B站 fallback 页 `libraryCount={0}`，横幅本来就不出现。等价。
- **i18n**：用脚本把两个 locale 的 HEAD 版与现版逐键比较：被删的 35 个键在 zh-CN / en 里都与对应 `common.*` 新值逐字节相同，`bookmarks.allFolders` 两种语言都没有 `.one` 变体（所以旧的 `{ count }` 调用走 base key、`String(count)` 插值），与代码拼的 `` `${t('common.all')} (${totalCount})` `` 渲染相同；每个 locale 恰好删 36、增 6；`allCollections.*` 只删了那三个，`allCollections.allTags` / `.count` / `.count.one` 等未动；残留调用点 grep 为零（`snackbar.syncFailed` 不在范围）。
- **铁律**：`components/collection/**` 非测试文件剥掉注释行后零 `t(` / `useTranslation` / `@/lib/i18n`；scaffold import 的是叶文件 `../collection-states/use-collection-chrome-copy`。偏离 1 的理由成立：`../collection` barrel → scaffold → `../library-gate` → `hooks/library-gate.ts` 在加载期调 `libraryGateStorage.getValue()` / `.watch()`（另经 `../tags` 带进 `@/lib/database` / `@/lib/tagging`）；`collection-states/CLAUDE.md` 的「导入方向」一节写明了。
- **测试**：既有测试里只有 `configuration-heading.test.tsx` 与 `collections-view.test.tsx` 改了，且只改键名映射行；`collections-view.test.tsx` 的 `'common.all': 'All platforms'` 保留了测试映射值，没有断言依赖它。`collection-states.test.tsx` 确实断言了变体（`buttonClasses`）、`href` / `target` / `rel`、点击后的 location、`syncing` 时禁用。

**本轮修掉的**：

1. **「两个具名例外 / and nowhere else」不成立**：scaffold 自 docs/16 MEDIUM-3 起就 import `../tags` 的 `useCollectionTags` / `TagFilterChips` / `TaggedItemGrid` / `TagEditPopover`，而 `tag-filter-chips.tsx` / `tag-edit-popover.tsx` / `tagged-item-grid.tsx` / `tag-row.tsx` 都调 `useTranslation()`——它是第三个智能模块，只是从未被列入。上面「铁律冲突与解法」说的「原来只有 `library-gate`」对**名单**是准的，但名单本身早就不全。改了三处：`components/collection/CLAUDE.md` 边界例外改成三个具名模块（`tags` 排第一，并写明它的形状不同——自己渲染带译文的 chip / 网格 / popover，不往本目录交字符串）；spec `platform-onboarding.md` §11 的 `t()` 行把 `components/tags/` 加进「and nowhere else」之前的清单；§8 表 6–8 行同步。`components/tags/CLAUDE.md` 的 i18n 条补了 `common.showMore` / `showLess` 与「scaffold 具名导入的三个智能模块之一」。
2. **根 `CLAUDE.md` 的「manifest 与 SW bundle 逐字节不变」说过头**：bundle 只比了 bundle-contract 行的模块数与字节数，改成如实写法；manifest 的 sha256 本轮重算过，确实相同。
3. **`collection-states.test.tsx` 的 mock 注释写错**：原写「with `{{x}}` interpolated」，实际是把参数拼成 `key|name=value`。注释改成实际行为和理由（证的是键与参数名）。
4. **`syncFailed` 的测试缺一半**：mock 只能证明 hook 传了 `common.syncFailed` 和参数名 `error`，没有任何测试证明真实 zh / en 字符串带 `{{error}}`——占位符改名后每个收藏页都会把它原样显示出来。在同一文件末尾加了 `it.each` 三例：`common.syncFailed` / `common.lastSynced` / `common.showMore` 在 zh-CN 与 en 里分别含 `{{error}}` / `{{time}}` / `{{n}}`（直接 import 两个纯数据 locale 文件；`en.ts` 只 `import type` 自 `./zh-CN`，不碰 `@/lib/i18n` 的加载期 storage 读取，先例 `tests/agent-bridge-cli-aliases.test.ts`）。证伪：临时把 en 的 `{{error}}` 改成 `{{err}}`，恰好红 `common.syncFailed carries {{error}}` 一例（`1 failed | 10 passed`），恢复后 `cmp` 一致。`collection-states/CLAUDE.md` 的测试条同步。
5. **`i18n-conventions.md` 的「36 platform copies deleted」不准**：36 里有 5 个在 `tags.*` / `allCollections.*` 下，不是平台副本；改成「36 per locale: 31 under platform prefixes, 5 under `tags.*` / `allCollections.*`」。同表的 `common.*` 行补一句 `retry` / `loadFailed` 也服务 Dashboard 的错误态（`overview-view.tsx`），否则「every collection page」描述不了它的全部用途。偏离 5 本身（在 §2 表加 `common.*` 行与规则段）准确，与文件其余部分一致。

**核对过、无需改的**：落地记录里的 `file:line` 与数字逐条对过当前树——view 行数（236 → 196 等六个）、`collection-states.tsx` 185 行与 hook 34 行、红态里的 `collection-page-scaffold.test.tsx:274` / `:285` / `:300` / `:319`、§3 中-5 勘误的 28 = 6+6+6+6+4 与 36 = 28 + `tags.*` 2 + `allCollections.*` 3 + `bookmarks.allFolders` 1 + `*.goToSettings` 2、docs/16:11 勘误、附录 B 条、根 `CLAUDE.md` 索引新行、六个 section `CLAUDE.md`（`sections/x/CLAUDE.md` 的「本次新增」已改成「未排期」，不再归 Step 6）、`sections/CLAUDE.md`（`settings-nav` 在 `settings/` 之外的非测试引用确实只有 `configuration-blocker` 与 `collection-states`）、`hooks/CLAUDE.md`、spec §7.2 / §7.3。一处措辞偏窄但不错：「模块图」条说 `use-collection-library.ts` 带进 `background-jobs-store` / `collection-sync-error`，它还带进 `@/lib/database`（`initDbProxy`）——`use-collections.ts` 自己就 import 它、`bilibili-view.tsx` 经 `use-bili-fav-folders.ts` 也早已在图里，所以两个消费方的模块图都没多出东西。

**仍然是已知缺口，不修**：

- scaffold「只 import 叶文件、不经 `collection-states` barrel」没有机械守卫：scaffold 测试 mock 的是叶路径，而 barrel 是 re-export，改成经 barrel 导入时 mock 照样生效、测试照绿。今天只靠 `components/collection/CLAUDE.md` 与 scaffold 文件头注释。
- `components/collection/**` 零 `t()` 仍只是设计约定（spec §11 写的就是 design contract），本 Step 没有升级成守卫。
- 「locale 里没有同文副本」没有守卫（D-g）。
- `SEARCH_DEBOUNCE_MS` 住在 `use-collection-library.ts` 这个 hook 模块里（PRD E 指定），聚合页与 B站 view 为一个常量 import 了整个 hook 模块；今天不多拖依赖（见上），以后那个模块变重时应挪到叶文件。
- 运行时验证（六平台页 × 亮 / 暗 × 中 / 英，各状态）仍**待人工**。

**重跑**（全量在代码与测试文件改动——即修复 3、4——之后跑；其后只改了 `.md`（修复 1、2、5 与本记录），grep 确认没有测试按路径读 `CLAUDE.md` / `.trellis/spec` / `docs/`，读仓库文件的守卫 `agent-bridge-cli-aliases` / `platform-completeness-contract` / `ui-vendor-boundaries` / `i18n-no-hardcoded` 连同 `collection-states` 另行重跑，5 个文件 60 例绿）：

- 聚焦（PRD 命令）64 个文件 444 例绿（+3 是新加的占位符例）；
- `pnpm compile` 绿；
- `pnpm test` 全量绿：主仓库 211 个文件 1709 例，`packages/favbase` 15 个文件 263 例，一次跑过；
- `pnpm build` 的 bundle-contract 行是 `14 modules / 947838 bytes`；`.output/chrome-mv3/manifest.json` 的 sha256 是 `053dd7bdf0da2ba2fa5ae8c67453ecc286b56394f5704585b38c3e34fde32ae5`，与 Step 4 / 5 相同。

### Step 7 数据 hook 改名层（D3；若 D3 选保留则跳过）

- **目标**：五个平台 hook 只留平台特有部分，兑现 docs/15:55 的约 40 行目标。
- **依赖**：Step 6。
- **改法**：
  - view 直接消费 `useCollectionLibrary` 的 `items` / `filter` / `facets`；
  - `queryFn` 的 filter / search / page 规整抽成共享 helper；
  - 凭据门（github token、youtube 配置）用一个共享 wrapper；
  - X 冷却、bookmarks 的路由受控筛选与挂载同步，留在各自 hook。
  - （**补记 2026-10-02**）`useCollectionLibrary` 的 config 键 `logTag` 改名 `jobPlatform`：Step 5 落地记录与 `hooks/CLAUDE.md` 都把这个键名明确留给本 Step 的改名层，本节原文没列。
- **测试**：`use-bookmarks.test.tsx` 与各 view 测试随改名更新；`use-collection-library.test.tsx` 不动。（**勘误 2026-10-02**：仓库里没有 `*-view.test.tsx`（docs/25 Step 8 已查明），本 Step 唯一触及的 view 级测试是 `sections/configuration-heading.test.tsx`；`use-bookmarks.test.tsx` 实际一行未改。`use-collection-library.test.tsx` 改了三行——只是 config 键 `logTag` → `jobPlatform` 及同名局部变量，零断言改动；「不动」写在 Step 5 把键名延到本 Step 之前。）
- **判据**：五个平台 hook 各 ≤ 60 行（估算门槛）。

#### Step 7 落地记录（2026-10-02）

代码与单测已落地；运行时验证（五个平铺平台页照常加载、筛选、搜索、翻页、获取，github / youtube 未配置时显示连接引导）需要浏览器，**待人工**。判据都成立：

- 五个平台 hook 各 ≤ 60 行（`wc -l`）：github 35、x 60、zhihu 34、youtube 37、bookmarks 59（Step 7 之前依次是 131 / 149 / 110 / 132 / 110）；
- `entrypoints/` 非测试代码零 `logTag`（grep）；`useCollectionLibrary` 的 config 键是 `jobPlatform`（`hooks/use-collection-library.ts:51`）；
- `entrypoints/` 零 `hasToken` / `hasConfig` / `UseGithubStarsReturn` / `UseXBookmarksReturn` / `UseZhihuFavoritesReturn` / `UseYoutubePlaylistsReturn`；
- github / youtube 的「是否已配置」各只有一个定义：`githubCredentials`（`sections/github-stars/github-sync-adapter.ts:85`）与 `youtubeCredentials`（`sections/youtube/youtube-sync-adapter.ts:41`）。run 门（`:44` / `:27`）、`probeReady`（`:91` / `:48`）、页面门（两个 hook 传给 `useCredentialGatedLibrary`）三处都调它。`entrypoints/` 与 `lib/` 非测试代码里，读 `githubToken` / `youtubeApiKey` / `youtubeChannel` 的只剩这两个解析函数，以及 `lib/hooks/useSettings.ts` 的设置卡草稿派生与保存；
- 新 wrapper 测试与契约测试都做了证伪，红态见下；
- `use-collection-library.test.tsx` 只改了 config 键（及同名局部变量），两个 adapter 测试的现有用例零改动；
- `pnpm compile` / `pnpm test` / `pnpm build` 全绿，manifest sha256 不变。

**落在哪**：

- **`hooks/use-collection-library.ts`**：
  - `UseCollectionLibraryConfig.logTag` 改名 `jobPlatform`：类型、解构、`useJob` / `startJob` 的第一参、两处 `console.error` 前缀、三个 effect / callback 的依赖数组，以及注释。
  - 函数 doc comment 的「Platform adapters rename the generic fields back to their domain vocabulary」改写成「平台 hook 只注入稳定函数、叠加自己的触发策略和平台特有状态；view 直接消费通用字段」。
  - `UseCollectionLibraryReturn` 的字段不改名、不增减。
- **`hooks/facet-query.ts`**（新，15 行，泛型层纯函数，只 `import type` 自 `./use-collection-library`）：
  - `facetQuery(query, facetKey)` 返回 `({ filter, search, page, pageSize }) => query({ [facetKey]: filter ?? undefined, search: search || undefined, page, pageSize } as TQuery)`。
  - 函数体两行，唯一的断言是 `as TQuery`，五个调用点零断言。
  - PRD A.2 的接受条件全部满足，所以保留 helper（实证见下）。
- **`hooks/use-credential-gated-library.ts`**（新，43 行，**平台感知层**：经 `useSettings` 读 storage）：
  - `useCredentialGatedLibrary(credentials, config)` 渲染期算 `configured = credentials(settings) !== null`，`sync` 是 `useCallback`：未配置时 `return`，否则 `await lib.sync()`，依赖 `[configured, syncInner]`。
  - 返回 `{ ...lib, sync, configured, settingsLoading }`。
  - 与两个平台改前的门逐行等价（github：`if (!token) return`，依赖 `[token, syncInner]`；youtube：`if (!hasConfig) return`，依赖 `[hasConfig, syncInner]`）。
- **两个 adapter**：
  - github 导出 `githubCredentials(settings): string | null`（`settings.githubToken || null`）。
  - youtube 导出 `youtubeCredentials(settings): YoutubeSyncConfig | null`（`apiKey` 与 `channel` 都非空才返回 `{ apiKey, channel }`）。
  - run 门直接用返回值（`if (token === null) return;` / `if (config === null) return;`，无 `!`），`probeReady` 改为 `<p>Credentials(...) !== null`。youtube 的 `config` 对象原先在 `onProgress` 之后构造，现在由解析函数在门里给出，无可观测差别。
- **五个平台 hook**：
  - 全部 `logTag: JOB_PLATFORM` → `jobPlatform: JOB_PLATFORM`；`queryFn` 改成模块级 `facetQuery(get…, '<facetKey>')`。
  - 删五个 `Use*Return` 接口，以及 github / x / zhihu 的进度类型 re-export（改前 grep 确认零消费者：五个 hook 文件只被各自 view 和两个测试 import，view 只 import `use*` 函数）。
  - 返回形状：
    - zhihu：`return useCollectionLibrary({...})`；
    - github / youtube：`return useCredentialGatedLibrary(<p>Credentials, {...})`；
    - x：`{ ...lib, lastInserted, cooldownRemainingMs }`，`lastInserted` effect 与冷却逻辑（含注释）逐字保留；
    - bookmarks：挂载 `useEffect(() => void sync())` 保留，`return lib`，返回类型 `UseBookmarksReturn = Omit<UseCollectionLibraryReturn<BookmarkItem, BookmarkFolderRef, BookmarksSyncProgress>, 'filter' | 'setFilter'>`（导出，`use-bookmarks.test.tsx:43` 在用）。
  - 原写在 `Use*Return` 接口里的平台说明（youtube「手动按钮，绝不 auto-on-mount：配额端点、位置序无增量游标」、zhihu「限流远程端点」、x「D5」与 `lastInserted` / `cooldownRemainingMs` 的含义）挪进函数 doc comment。
- **五个 view**：只改字段名——`.repos` / `.favorites` / `.videos` / `.bookmarks` → `.items`，`.language` / `.collectionId` / `.playlistId` / `.author` → `.filter`，`.setLanguage` / … → `.setFilter`，`.languages` / `.collections` / `.playlists` / `.authors` / `.folders` → `.facets`，`.hasToken` / `.hasConfig` → `.configured`。github / youtube 的配置门与 `pipeline` 条件因此同形（`!x.settingsLoading && !x.configured`）。chips 组件自己的 prop 名不改（Step 8）。view 行数与 Step 6 后相同（github 196、x 176、zhihu 149、youtube 160、bookmarks 139）。
- **契约测试**（`tests/platform-completeness-contract.test.ts`）：
  - `JOB_NAMESPACE_PROPERTIES` 只剩 `'jobPlatform'`（`:812`）。
  - 自检命中表删 `"const LOG_TAG = 'p'; ({ logTag: LOG_TAG });"`（已被 `"const P = 'p'; ({ jobPlatform: P });"` 覆盖）；`` "({ [`logTag`]: 'p' });" `` 改成 `` "({ [`jobPlatform`]: 'p' });" ``，保住模板字面量计算键这一格。
  - 自检注释与探测器 doc comment 去掉 `logTag`。

**先红后绿与实证**：

- **`facetQuery` 接受条件**：先写好 helper，再建临时探针文件 `entrypoints/app/hooks/zz-facet-probe.ts`，跑 `tsc --noEmit -p tsconfig.json`，跑完删除（`git status` 确认无残留）。
  - 探针内容：五个真实调用（`getStarredRepos` / `'language'`、x `getBookmarks` / `'author'`、`getFavorites` / `'collectionId'`、`getPlaylistVideos` / `'playlistId'`、bookmarks `getBookmarks` / `'folderId'`）；一条把结果赋给 `(p: CollectionQueryParams) => Promise<CollectionPage<GithubRepoItem>>` 的类型断言，证 `TItem` 推得出；三条错误用法。
  - 输出恰好是三条错误用法，五个真实调用与类型断言都通过：
    ```
    entrypoints/app/hooks/zz-facet-probe.ts(17,49): error TS2345: Argument of type '"lang"' is not assignable to parameter of type '"language"'.
    entrypoints/app/hooks/zz-facet-probe.ts(18,49): error TS2345: Argument of type '"search"' is not assignable to parameter of type '"language"'.
    entrypoints/app/hooks/zz-facet-probe.ts(19,47): error TS2345: Argument of type '"language"' is not assignable to parameter of type '"author"'.
    ```
  - 另用第二个临时探针证明 `as TQuery` 删不掉（同样跑完删除）：去掉断言后 `tsc` 报
    ```
    error TS2345: Argument of type '{ [facetKey]: string | undefined; search: string | undefined; page: number; pageSize: number; }' is not assignable to parameter of type 'TQuery'.
      '{ [facetKey]: string | undefined; search: string | undefined; page: number; pageSize: number; }' is assignable to the constraint of type 'TQuery', but 'TQuery' could be instantiated with a different subtype of constraint '{ search?: string | undefined; page: number; pageSize: number; }'.
    ```
- **wrapper 证伪**：临时删掉 `use-credential-gated-library.ts:38` 的 `if (!configured) return;`，只跑 `use-credential-gated-library.test.tsx`，红的恰好是未配置那一例（`1 failed | 3 passed`），已配置、`settingsLoading` 透传、settings 切换三例照绿；恢复后 `cmp` 与保留版一致，4 例全绿。红态原样（只删了开头的 `RUN` 横幅与结尾的 `Start at` / `Duration` 两行；收尾前未过滤重跑一次，输出里零 `stderr` / `act(` 行——这个文件设了 `IS_REACT_ACT_ENVIRONMENT`；恢复后再次 `cmp` 一致）：
  ```
   ❯ entrypoints/app/hooks/use-credential-gated-library.test.tsx (4 tests | 1 failed) 120ms
       × unconfigured: sync() is a silent no-op — no job, no syncing flip 33ms

  ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

   FAIL  entrypoints/app/hooks/use-credential-gated-library.test.tsx > useCredentialGatedLibrary > unconfigured: sync() is a silent no-op — no job, no syncing flip
  AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times

  Received:

    1st vi.fn() call:

      Array [
        [Function anonymous],
        Object {
          "checkpoint": [Function checkpoint],
        },
      ]


  Number of calls: 1

   ❯ entrypoints/app/hooks/use-credential-gated-library.test.tsx:102:24
      100|     await flush();
      101|
      102|     expect(syncFn).not.toHaveBeenCalled();
         |                        ^
      103|     expect(latest.syncing).toBe(false);
      104|     expect(latest.syncJob).toBeNull();

  ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


   Test Files  1 failed (1)
        Tests  1 failed | 3 passed (4)
  ```
- **契约测试证伪**：临时把 `sections/zhihu/use-zhihu-favorites.ts:32` 的 `jobPlatform: JOB_PLATFORM` 改成 `jobPlatform: 'zhihu-favorites'`，红的恰好是「derives every job namespace from the descriptor」一例（`1 failed | 6 passed`），只列这一行；恢复后 `cmp` 一致，7 例全绿。红态（只保留断言与计数行）：
  ```
   FAIL  tests/platform-completeness-contract.test.ts > platform completeness contract > derives every job namespace from the descriptor
  AssertionError: Job namespace written by hand — derive it with `jobPlatformForCollection(platform)` (docs/32 Step 5). `jobPlatform` differs from the platform id for github / x / zhihu / youtube, so a copied literal silently splits a platform's jobs across two namespaces:
  - entrypoints/app/sections/zhihu/use-zhihu-favorites.ts:32: jobPlatform: 'zhihu-favorites': expected [ Array(1) ] to deeply equal []
   Test Files  1 failed (1)
        Tests  1 failed | 6 passed (7)
  ```
- **自检表改动后照绿**：删掉 `LOG_TAG` 行、`` [`logTag`] `` 改成 `` [`jobPlatform`] `` 之后，自检一例绿（命中表 13 条各恰好 1 条，放过表 7 条零条），真实扫描零条。

**默认决定**（PRD 已定，照做）：

- **D-a 返回形状是 spread**，不嵌套 `{ library: lib }`。
- **D-b 删 `Use*Return` 接口**，只留 `UseBookmarksReturn`（测试在用），且由 `Omit` 派生，不手写字段表。
- **D-c `configured` 一个字段名**服务 github / youtube（原 `hasToken` / `hasConfig`）。
- **D-d 凭据解析函数返回凭据或 `null`**，不返回 boolean：run 门要用它的值，boolean 版会逼出 `!` 断言。
- **D-e wrapper 是独立 hook**，不往 `useCollectionLibrary` 加 `canSync` 之类开关（spec §7.2 的既有决定：门不进泛型层）。
- **D-f 不新增「hook 不得改名」守卫**：判据是行数，`tsc` 已保证 view 与 hook 字段一致。
- **D-g 契约测试去掉 `logTag`**。
- **实施时补的两个默认**（PRD 未写，按最少代码取）：
  - 五个 hook 都不写显式类型实参与返回类型注解（bookmarks 除外）。`TItem` / `TFacet` / `TProgress` 由注入的函数推出，`pnpm compile` 验过；原来的显式实参只是为了配手写的 `Use*Return`。
  - `facet-query.test.ts` 断言的是「值为 `undefined`」，不是「键不存在」。helper 与改前手写的 `queryFn` 一样写 `language: filter ?? undefined`，键在、值是 `undefined`，lib 查询把它当作没传。

**与 PRD 的偏离**：

1. **wrapper 先写、测试后写**。PRD 判据写「新 wrapper 测试先写、证伪红过」。实际顺序是先写 `use-credential-gated-library.ts`，再写测试，再删掉 no-op 分支证伪。红态证据来自证伪，不来自「对不存在的 wrapper 跑测试」。后者只会是 import 失败，不是断言红，Step 5 落地记录对同类情况有同样的说明。
2. **五个 hook 的 `JOB_PLATFORM` JSDoc 压成两行**（`/** … */`，与 `use-collection-library.ts` 里 `SEARCH_DEBOUNCE_MS` 的写法相同）。PRD 只要求把其中的 `logTag` 改成 `jobPlatform`。x 不压就是 62 行；为了五个文件一致，统一压缩。x 的 `syncFn` 注释从 4 行压到 3 行，删了「all live there」，其余措辞不变；`lastInserted` effect 与冷却两段逐字保留。
3. **两个 adapter 测试改了 import 行**（github 那行加 `githubCredentials`，youtube 那行加 `youtubeCredentials`，两份都多一行 `import type { UserSettings }`）。PRD 允许追加用例；要追加就得 import 解析函数。现有 `it` 一行未动。
4. **spec 多改了 §12 末段**：「anchor 5's `probeReady`」改成「anchor 5's `<p>Credentials` resolver (what `probeReady` reads)」。PRD G 没点 §12；不改的话它指向的东西和 §8 第 5 条对不上。
5. **根 `CLAUDE.md` 的 `entrypoints/app/hooks/CLAUDE.md` 索引行**补了 `useCredentialGatedLibrary` 与 `facetQuery`。PRD 的条件是「若提到改名」：这一行没提改名，但新增的两个 hook 模块不写进去就查不到。
6. **`sections/github-stars/CLAUDE.md` 与 `sections/youtube/CLAUDE.md` 的 adapter 行也改了**，写明 `<p>Credentials` 住在 adapter、三处共用。PRD G 只点了这两份文件的 hook 行。

**行为变化与验证备注**：

- **运行时行为零变化**：
  - view 只改字段名，渲染逐字不变。
  - `configured` 与原 `hasToken` / `hasConfig` 同值：github 是 `(githubToken || null) !== null` ≡ `Boolean(githubToken)`；youtube 是两者都非空 ≡ 原 `Boolean(apiKey && channel)`（原来经 `?? ''`）。
  - `probeReady` 与 run 门的判定也同值。
  - `facetQuery` 发给 lib 查询的对象与改前手写的 `queryFn` 逐键相同，键序也相同：facet 键、`search`、`page`、`pageSize`。
- **bookmarks 返回值的类型面变宽**：`Omit<…, 'filter' | 'setFilter'>` 让 view 在类型上看得到 `syncProgress` / `embedJob` / `tagJob`，原手写接口没列这三个。今天没有消费者；运行时本来就有。`filter` / `setFilter` 运行时也在对象上（`return lib`），只是类型不暴露，与 PRD「保留刻意不暴露」的意图一致。
- **「本次新增 N」扩到其余五平台没做**（PRD Out of Scope）：`sections/x/CLAUDE.md` 那句改成只写「未排期」，理由一并写明。
- **manifest**：本 Step 不动 descriptor。`pnpm build` 后 `.output/chrome-mv3/manifest.json` 的 sha256 是 `053dd7bdf0da2ba2fa5ae8c67453ecc286b56394f5704585b38c3e34fde32ae5`，与 Step 4 / 5 / 6 相同。
- **SW 体积**：bundle-contract 行是 `14 modules / 947838 bytes`，与 Step 6 后相同（只比了计数）。
- **测试**：
  - 聚焦（PRD H.1 命令：`entrypoints/app/hooks` + `entrypoints/app/sections` + contract + i18n-no-hardcoded + ui-vendor-boundaries + lib-import-smoke）57 个文件 391 例绿；
  - `pnpm compile` 绿；
  - `pnpm test` 全量绿：主仓库 213 个文件 1720 例（Step 6 后 211 / 1709，+2 文件、+11 例：`use-credential-gated-library.test.tsx` 4 例、`facet-query.test.ts` 3 例、两个 adapter 测试各追加 2 例），`packages/favbase` 15 个文件 263 例；在 config 的 `maxWorkers: 8` 下一次跑过；
  - `pnpm build` 绿。

**改了哪些现有测试**：

- `entrypoints/app/hooks/use-collection-library.test.tsx`：只改 config 键——`let logTag` → `let jobPlatform`、`logTag,` → `jobPlatform,`、`logTag = …` → `jobPlatform = …`，三行，零断言改动（偏离见上方 Step 7 正文勘误）。
- `entrypoints/app/sections/configuration-heading.test.tsx`：两个 mock 的 `hasToken: false` / `hasConfig: false` → `configured: false`，其余一行未改。
- `tests/platform-completeness-contract.test.ts`：见「落在哪」。
- `entrypoints/app/sections/github-stars/github-sync-adapter.test.ts`、`entrypoints/app/sections/youtube/youtube-sync-adapter.test.ts`：只追加解析函数的 `describe`（空串 / 缺一项 → `null`），外加 import 行（偏离 3）；现有用例零改动，照绿（含 github `mockResolvedValue({})` 与 youtube 只给 `youtubeApiKey` 的两个静默 no-op 例）。
- **新增**：`entrypoints/app/hooks/use-credential-gated-library.test.tsx`（4 例：未配置不启动 job、已配置跑一次、`settingsLoading` 透传、settings 切换后 `configured` 跟着变；整模块 mock `@/lib/hooks/useSettings`，因为真模块加载期读 `@/lib/storage`；每例用不同的 job 命名空间，因为 job store 是模块单例）、`entrypoints/app/hooks/facet-query.test.ts`（3 例）。
- **一行未改就绿**：`use-bookmarks.test.tsx`（四例，含 route→folder 映射与换 folder 回页 1）、`collection-page-scaffold.test.tsx`、`collection-states.test.tsx`、`collection-platform-auto-sync.test.ts`（`toBe` 身份锁定）、`use-daily-auto-sync.test.tsx`，以及其余全部。

**trellis-check 复核（2026-10-02）**：

- **行为等价逐项对照**（`git show HEAD:` 的五个 hook 与五个 view）：
  - view 读的每个字段都映射到同一个值。旧 hook 里 `repos` / `favorites` / `videos` / `bookmarks`、`language` / `collectionId` / `playlistId` / `author`、`setLanguage` / …、`languages` / `collections` / `playlists` / `authors` / `folders` 本来就是 `lib.items` / `lib.filter` / `lib.setFilter` / `lib.facets` 的别名；其余字段（`syncError`、`syncJob`、`sync`、`embedJob` …）原样透传。`tsc` 保证 view 没有漏改的读取。
  - 凭据判定：`githubCredentials` 与旧三处（run 门 `if (!token) return`、`probeReady` 的 `Boolean(githubToken)`、hook 的 `Boolean(token)`）在 `undefined` / `''` / 非空串上同真值；`youtubeCredentials` 与旧三处（`!apiKey || !channel`、`Boolean(apiKey && channel)`、hook 里经 `?? ''` 的同式）在缺一项 / 空串 / 都有上同真值。run 门、`probeReady`、页面门都调同一个解析函数（`github-sync-adapter.ts:44,91`、`youtube-sync-adapter.ts:27,48`、两个 hook 传给 `useCredentialGatedLibrary` 的第一参）。`DEFAULT_SETTINGS` 不含这三个键，所以 settings 加载窗口里 `configured` 为假、`sync()` 静默，与改前相同。
  - **唯一不逐字等价的是 `sync` 的引用身份**：旧 github 门的 `useCallback` 依赖 `[token, syncInner]`，token 在两个非空值之间切换会换一个新函数；现在依赖 `[configured, syncInner]`，不换。没有地方按它的身份做事：两个 view 只把它当 `onSync` 传给 scaffold 与 `collection-states`，`components/collection/` 与 `components/collection-states/` 的非测试文件零 `useEffect` / `useMemo` / `useCallback` / `memo(`；run 门每次调用都重读 storage。youtube 的旧依赖本来就是布尔 `[hasConfig, syncInner]`，完全等价。上面「与两个平台改前的门逐行等价」对 github 说得略宽，以此为准。
  - x：`lastInserted` effect、冷却锚点与 `useCountdown` 逐字未变（只压了 `syncFn` 注释，偏离 2）；`{ ...lib, lastInserted, cooldownRemainingMs }` 与旧的逐字段返回同值。bookmarks：挂载 `useEffect(() => void sync())` 保留；`UseBookmarksReturn` 由 `Omit` 派生，类型上不含 `filter` / `setFilter`。
  - `facetQuery` 发给 lib 查询的对象与旧手写 `queryFn` 同键、同值、同序（facet 键 `filter ?? undefined`、`search || undefined`、`page`、`pageSize`）。
- **`facetQuery` 接受条件**：函数体两行、一个 `as TQuery`、五个调用点零断言。独立重跑 tsc 探针（`entrypoints/app/hooks/zz-check-facet-probe.ts`，跑完删除）：五个真实调用通过，四条错误用法恰好四个 TS2345——`'lang'`、`'search'`、`'page'`（都是「not assignable to parameter of type '"language"'」）与 x 查询上的 `'language'`（「… '"author"'」）。比上面的记录多验了 `'page'` 一条；记录原有的三条输出不改。
- **独立复现了两次证伪**：
  - 删掉 `use-credential-gated-library.ts:38` 的 `if (!configured) return;`：`1 failed | 3 passed (4)`，红的只有未配置那一例（`expected "vi.fn()" to not be called at all, but actually been called 1 times`）。
  - `use-zhihu-favorites.ts:32` 改成 `jobPlatform: 'zhihu-favorites'`：契约测试 `1 failed | 6 passed (7)`，只列 `entrypoints/app/sections/zhihu/use-zhihu-favorites.ts:32: jobPlatform: 'zhihu-favorites'` 一行。
  - 两次都从改前的副本拷回。对拷回的文件跑 `cmp` 只是自证，不算证据；证据是拷回后 zhihu 文件的 `git diff --stat` 仍是证伪前的 15 增 91 删，两份测试随后各 4/4、7/7 绿，`git status` 无残留副本。
- **测试 diff**：`use-collection-library.test.tsx` 只有三行（config 键与同名局部变量），零断言改动；两个 adapter 测试只有 import 行与追加的 `describe`，原有 `it` 未动；`configuration-heading.test.tsx` 只有两个 mock 字段。契约测试的 `JOB_NAMESPACE_PROPERTIES` 是 `new Set(['jobPlatform'])`（`:812`）；自检命中表 13 条，仍含「常量经属性」`const P = 'p'; ({ jobPlatform: P })` 与模板计算键 `` ({ [`jobPlatform`]: 'p' }) ``，放过表 7 条；真实扫描零条。
- **残留 grep**：`entrypoints/`、`lib/`、`tests/`、`packages/` 的 `.ts` / `.tsx` 里 `logTag` / `LOG_TAG` / `hasToken` / `hasConfig` / 四个 `Use*Return` 为零。读 `githubToken` / `youtubeApiKey` / `youtubeChannel` 的非测试代码只剩两个解析函数与 `lib/hooks/useSettings.ts`（另有 `settings-schema.ts` 的声明）。view 行数与 HEAD 相同（196 / 176 / 149 / 160 / 139）。

**本轮修掉的**：

1. **五个 hook 的 `JOB_PLATFORM` JSDoc 改名后成了同义反复**：「… derived from the domain Platform Descriptor's `jobPlatform` — also this hook's `useCollectionLibrary` `jobPlatform`」。改成「Background-job namespace — the domain Platform Descriptor's `jobPlatform`, which keys this page's sync / embed / tag jobs in `useCollectionLibrary`.」。仍是两行，所以五个 hook 的行数（35 / 60 / 34 / 37 / 59）与 `jobPlatform: JOB_PLATFORM` 的行号（zhihu 仍是 `:32`）都不变，上文与各 `CLAUDE.md` 引用的数字照旧成立。
2. **`lib/youtube/youtube-sync-service.ts:217-218` 与 `lib/zhihu/zhihu-sync-service.ts:144-145` 的行内注释**仍写「Auto-tag / auto-embed are fired by the caller (use-youtube-playlists hook) via `startJob`」。这是 Step 1 漏掉的旧文（两个文件的模块 docstring 早已改对），而它点名的正是本 Step 刚掏空的 hook。改成指向 adapter 在外层跑的 Platform Sync funnel，2 行换 2 行。这两个文件不在 PRD 的文件清单里，只动了注释。

**核对过、无需改的**：落地记录里的 `file:line`（`use-collection-library.ts:51`、`github-sync-adapter.ts:44/85/91`、`youtube-sync-adapter.ts:27/41/48`、`use-credential-gated-library.ts:38`、`use-zhihu-favorites.ts:32`、契约测试 `:812`、`use-bookmarks.test.tsx:43`）；行数（hook 35 / 60 / 34 / 37 / 59、wrapper 43、facet-query 15）；自检 13 / 7 条；六处偏离（偏离 1 如实写明测试在 wrapper 之后写）。spec §2 `:38`、§7.2、§8 第 5 条、§11（job 命名空间行现为 `:527`）、§12；`hooks/CLAUDE.md` 的分档（`facet-query` 在泛型层，`use-credential-gated-library` 在平台感知层）；五个 `sections/*/CLAUDE.md`；`components/collection/CLAUDE.md:10`；根 `CLAUDE.md` 的 docs/32 条与契约测试条。

**仍然是已知缺口，不修**：

- `<p>Credentials` 读错 key 仍无守卫（spec §8 第 5 条 unchecked）。三处读同一个函数，只保证它们不互相分叉。
- 「平台 hook 不得改名」无守卫（D-f），靠行数判据与 review。
- manifest 基线没有从 HEAD 重建，只比对了与 Step 4 / 5 / 6 记录相同的 sha256；bundle 只比了 bundle-contract 行的计数。
- 运行时验证仍**待人工**。

**重跑**（在上面两处注释改动之后；其后只改了 `.md`）：

- 聚焦（PRD H.1 命令）57 个文件 391 例绿；
- `pnpm compile` 绿；
- `pnpm test` 全量绿：主仓库 213 个文件 1720 例，`packages/favbase` 15 个文件 263 例，一次跑过；
- `pnpm build` 的 bundle-contract 行是 `14 modules / 947838 bytes`；`.output/chrome-mv3/manifest.json` 的 sha256 是 `053dd7bdf0da2ba2fa5ae8c67453ecc286b56394f5704585b38c3e34fde32ae5`。

### Step 8 tagged card 外壳 + facet chips（低-2）

- **改法**：
  - 一个 `taggedCard(Card, mapItem)` 工厂，六个 `tagged-*-card.tsx` 缩成一行导出。**`CARD_ADAPTERS` 的形状不动**（docs/26 §0.2 第 1 条）。
  - x / zhihu / youtube 三个 chips 合成一个 source facet chips；github 的语言色点、B站、书签的 chips 保留。
- **判据**：`platform-completeness-contract` 的 `CARD_ADAPTERS` 对账照绿。

### Step 9 查询片段（低-1）

- **改法**：
  - `lib/database/collection-queries.ts` 新增 source 成员条件、每 source 计数、搜索条件、已知 id 集合四个片段 builder，五平台与 `ingest.ts:310-314` 替换；
  - 删除五个 `getLastSyncedAt` 包装（Step 1 之后已冗余）。
- **判据**：各平台查询测试不改就绿，生成的 SQL 与改前相同。

---

## 7. 收益估算（估算，误差 ±30%）

以知乎为「平铺平台」样本，统计**新平台在 app 侧必须手写的行数**：

| 文件 | 今天 | 全部 Step 后 | 主要来源 |
|---|---|---|---|
| sync adapter | 58 | ~30 | Step 1 收尾 funnel |
| 数据 hook | 129 | ~40（D3=删）/ ~110（D3=留）；**实测 34**（Step 7 落地 2026-10-02；Step 7 之前是 110） | Step 7 |
| view | 194 | ~110 | Step 4 / 6 |
| card | 94 | 94 | 平台特有，不动 |
| tagged card | 31 | ~3 | Step 8 |
| chips | 44 | 0 | Step 8 |
| skeleton | 6 | 6 | 有意保留 |
| **合计** | **556** | **~283（-49%）** | |

lib 侧：平台 API 文件的重试 / 响应读取约减 30–40 行（Step 3），sync-service 的查询片段约减 30–40 行（Step 9）；每平台 i18n 键约 22 → 16。

四个轴（获取、风控、凭据、正文来源）的代码量**不会减少**——它们本来就该由平台手写。

---

## 8. 对平台接入契约的增量

| Step | `.trellis/spec/frontend/platform-onboarding.md` | `tests/platform-completeness-contract.test.ts` 等守卫 |
|---|---|---|
| 1 | §10 强制清单加「同步收尾 funnel」；adapter 不再手写 `startCollectionProcessingJobs`（已落地 2026-09-30：§4.3、§7.2、§10、§11 与 §2 守卫描述） | `entrypoints/app/**` 非测试模块里，`startCollectionProcessingJobs` 标识符只许出现在定义处与 funnel（AST 扫描，独立用例，失败列 `file:line`） |
| 2 | §6.1 domain descriptor 六字段 → 七字段（新增简介字段；`dimensions` 内加 meta 维度格）（已落地 2026-09-30：§6 字段数、§6.1 表 `descriptionField` 行与 `dimensions` 行、§2 守卫描述、§11 禁项行） | 共享模块禁平台字面量 / 字面 meta key 从一个文件扩成清单（独立用例，AST 扫描，失败列 `file:line`）；`dimensions.meta.kind` 必须在 `ranked` 里 |
| 3 | 风控一节说明「机制在 `lib/http/`，数值与语义在平台」（已落地 2026-09-30：§4.1 Pagination 条、§2 守卫表（Five → Six）、§11 禁项行） | `lib/<platform>/` 禁 `setTimeout` 等待（`tests/platform-sleep-guard.test.ts`，AST 扫描 `new Promise` 参数里的 `setTimeout`，失败列 `file:line`） |
| 4 | 错误类必须继承 `sync-errors.ts` 基类（已落地 2026-09-30：§4.1 错误类条、§7.2 `use-<platform>.ts` 与 `<platform>-view.tsx` 两行、§2 completeness contract 描述、§11 禁项行） | 平台错误类继承断言（completeness contract 的独立用例 + 探测器自检，AST 扫描，失败列 `file:line`）；`lib-import-smoke` 纳入新 leaf |
| 5 | 新增「延迟正文」一节（已落地 2026-10-01：§4.4「Deferred content」，原 §4.4 Tests 顺延 §4.5；另改 §2 completeness contract 描述、§4.2 Chunking 行、§4.3 `'pending'` 条的交叉引用、§7.2 `use-<platform>.ts` 行、§11 禁项行） | `entrypoints/app/**`（比原写的 `sections/**` 宽）禁手写 job 命名空间：job-store 调用（`startJob` / `useJob` / `getJob` / `pauseJob` / `resumeJob` / `trackJobRun`）的第一参与 `jobPlatform` / `logTag` 属性，不得是字面量或同模块里绑到字面量的常量（AST 扫描，独立用例 + 探测器自检，失败列 `file:line`） |
| 6–8 | §7 页面清单删去状态组件与 tagged 外壳两项（Step 6 已落地 2026-10-01：§7.2 view 行改为「状态组件从 `components/collection-states/` 取、`copy` 只传平台文案」，§7.3 加 scaffold 自持外壳文案一段，§11「`components/collection/**` 内 `t()`」行补具名例外（实施时补了 `library-gate` 与 chrome-copy 叶文件两个，2026-10-02 trellis-check 补上一直在用却未具名的 `components/tags/`，共三个）；tagged 外壳待 Step 8。另 `i18n-conventions.md` §2 加 `common.*` 一行） | `CARD_ADAPTERS` 对账不变；Step 6 不新增守卫（D-g） |
| 7 | §7.2 `use-<platform>.ts` 行改写：不改名、无手写返回接口、view 直接读通用字段，`jobPlatform = jobPlatformForCollection(<platform>)`，单 facet 查询用 `facetQuery`，`'credentials'` 平台用 `useCredentialGatedLibrary(<p>Credentials, config)`；§7.2 `<platform>-sync-adapter.ts` 行加 `<p>Credentials(settings)`；§8 第 5 条改成「导出解析函数，run 门 / `probeReady` / 页面门三处读同一个，仍 unchecked」；§12 末段同步；§2 completeness contract 描述与 §11 job 命名空间行只剩 `jobPlatform`（已落地 2026-10-02） | job 命名空间守卫的 `JOB_NAMESPACE_PROPERTIES` 去掉 `'logTag'`（改名后 `entrypoints/app/**` 不再有这个键，`tsc` 也拒绝它）；自检表删 `LOG_TAG` 行、`` [`logTag`] `` 行改 `` [`jobPlatform`] ``；不新增守卫（D-f） |
| 9 | 查询片段 builder 列入「shared read helpers」 | — |

每个 Step 落地时同 commit 更新上表对应的 spec 与目录 `CLAUDE.md`。

---

## 附录 A [UNKNOWN]

- `fetchFavVideos` 直接返回 `json.data`，不做形状校验（`lib/bilibili/bilibili-api.ts:159`）；调用方读 `data.medias` / `data.info`。`data: null` 时是 TypeError 而非分类错误。`checkAuth` 登录门是否总能挡住这种情况，未确认。
- B站浏览路径（D4）是否触发过 412，无观测记录。
- docs/17 HIGH-2 / HIGH-3 的现状本次未核查。
- 导出没有恢复 / 导入路径，是否在规划中未知。

## 附录 B 勘误与旁注

- **docs/16:11**：记 docs/15 LOW-7「已修复」，实际只迁了 `retry` / `loadFailed`；**已于 Step 6 勘误**（2026-10-01，原句不改，句末补勘误括注）。
- **§2 漏记一条既有决定**（2026-09-29 定 D1 时发现）：07-26 daily auto-sync 任务定过「复用 `sources.lastFetchedAt`，不建新表、不加新 storage 记录」（`.trellis/tasks/archive/2026-07/07-26-daily-first-open-auto-sync-all-platforms/prd.md:11`）。它不属于「不得重提」，因为 D1 明确推翻了它（§5.1）；记在这里，是为了不让后人以为本文不知道它。
- **docs/15:55**：「各平台 hook 退化为 ~40 行」未兑现，现为 115–163 行（D3）。**已于 Step 7 兑现**（2026-10-02，`wc -l`）：github 35、x 60、zhihu 34、youtube 37、bookmarks 59（Step 7 之前依次是 131 / 149 / 110 / 132 / 110）。x 与 bookmarks 超过 40 行的部分是平台自己的状态（X 的「本次新增」与冷却、书签的路由受控筛选与挂载同步），不是改名。
- **命名冲突**：`SyncBookmarksResult`、`getBookmarks`、`BookmarksQuery` 在 `lib/x` 与 `lib/bookmarks` 同名导出，今天没有文件同时 import 两者。**Step 1 未改名**（2026-09-30，D-h）：六个 lib 结果类型各自只追加了缺的字段（github `inserted`、bookmarks `inserted`、bilibili runner `insertedCount`），没有被统一成一个类型；统一只发生在 app 侧 adapter 返回给 funnel 的 `PlatformSyncOutcome`。lib 层两个同名类型不在同一文件相遇，改名收益为零。等哪天真有文件同时 import 两者，再改。
- **悬空 ADR 引用**：`lib/ingest/ingest.ts:11` 曾写「ADR in .trellis/spec/frontend/database-bridge.md」，该文件不存在，也**从未进过 git**（`git log --all -- '*database-bridge*'` 为空；工作日志记它曾加过一节「Insert-Only Policy」，但从未提交，内容已丢失）。insert-only 规则实际只记录在 `lib/ingest/CLAUDE.md:16` 与 `platform-onboarding.md:117`。**Step 1 起全部改指 `lib/ingest/CLAUDE.md`**（2026-09-30）：`ingest.ts` 与这两处文档先改；同一条悬空引用还留在五个 sync-service 头注释（github / x / zhihu / youtube / bookmarks）、六个测试文件头注释（上面五个平台的 service 测试加 `lib/bilibili/videos-sync.test.ts`）与四个 `lib/<platform>/CLAUDE.md`（bilibili / bookmarks / github / x）里，**用户同日追加范围**，由 trellis-check 一并改掉；docs/ 与归档任务之外该路径零残留。
- **「synced」含义不一**：x 报拉取数（`x-sync-service.ts:224`），github / bilibili 报 link 数（`github-sync-service.ts:293`、`videos-sync.ts:66`）。**已于 Step 1 在 adapter 层消除**（2026-09-30）：进 Platform Sync Record 的只有 `fetched` / `inserted` 两个口径明确的数（口径见 D-d）；lib 各自的 `synced` 字段原样保留，也不入记录。
