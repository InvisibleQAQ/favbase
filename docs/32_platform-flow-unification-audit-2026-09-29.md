# 32 跨平台流程统一度审计与分步整改（2026-09-29）

> 状态：**审计完成；D1、D2 已决（2026-09-29，§5.1、§5.2）；Step 1 已落地 2026-09-30（代码 + 单测；运行时验证待人工，见 §6 Step 1 落地记录）；D6 已决（用户 2026-09-30，按推荐）；Step 2 已落地 2026-09-30（代码 + 单测；运行时验证待人工，见 §6 Step 2 落地记录）；Step 3 已落地 2026-09-30（代码 + 单测；运行时验证待人工，见 §6 Step 3 落地记录）；Step 4–9 均未实施**。执行任一 Step 前先读 §2 否决清单与 §5 对应决策；一次对话只做一个 Step。
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
- 五个数据 hook（115–163 行）60–70% 是把 `useCollectionLibrary` 的通用字段改名（`repos: lib.items`、`language: lib.filter`…，约 25 行 / 个）。docs/15 当年的目标是「各平台 hook 退化为 ~40 行薄 adapter」（`docs/15:55`），没有兑现。
- `LOG_TAG` 手写五份（`use-github-stars.ts:21` 等），与 adapter 里 `jobPlatformForCollection` 派生的值是两个事实源，今天恰好相同。
- `SEARCH_DEBOUNCE_MS = 300` 三份：`hooks/use-collection-library.ts:9`、`sections/bilibili/bilibili-view.tsx:33`、`sections/collections/use-collections.ts:20`。
- i18n 第一类同文键 30 个：`*.lastSynced`「上次同步 {{time}}」×6、`*.syncFailed`「同步失败: {{error}}」×6（`lib/i18n/locales/zh-CN.ts:501-605`，已 grep 验证）、`showMore*` ×6、`showLess*` ×6、`all*` ×4（`allCollections.*` 与 `tags.*` 另有两组同文的展开/收起）。docs/16:11 把 docs/15 LOW-7（`common.*` i18n）记为「已修复」，实际只迁了 `retry` / `loadFailed`，**此记录需勘误**。
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

- env 守卫只扫 `lib/<platform>/`（`tests/platform-env-guard-contract.ts:3`），漏掉 `sections/x/cooldown.ts:11` 的 `COOLDOWN_MS = 5 * 60 * 1000`。
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
| D3 | 数据 hook 的字段改名层 | **删除**：view 直接消费 `useCollectionLibrary` 的通用字段，平台 hook 只留真正平台特有的部分（凭据门、X 冷却）；兑现 docs/15:55 的「~40 行」目标 | 保留：零 churn，但每个新平台继续手写约 25 行改名 |
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

### Step 6 平台页外壳（中-5 除 hook 改名层外的部分）

- **目标**：平铺平台 view 只写平台特有部分。
- **依赖**：Step 4。
- **文件**：
  - `components/collection/collection-page-scaffold.tsx`：`syncLabel` / `syncingLabel` / `loadFailed` / `retry` 给默认值，7 处调用点删掉这四行。
  - `components/collection/`：共享 `EmptyLibraryState` / `NotLoggedInState` / `NeedsConfigState`，平台只传 icon、i18n 键和打开站点的 URL。
  - 五个 view 删本地副本。
  - i18n：新增 `collection.lastSynced` / `syncFailed` / `showMore` / `showLess` / `all` 五个共享键（zh / en 各一份），删 30 个平台副本；勘误 docs/16:11 的 LOW-7 记录。
  - `hooks/use-collection-library.ts` 导出 `SEARCH_DEBOUNCE_MS`，B站 view 与 `use-collections.ts` 复用它。
  - `LOG_TAG` 改由 `jobPlatformForCollection` 派生。
  - ~~B站 caption 时间改用 `formatDateTime`。~~ **已提前到 Step 1**（2026-09-30，D-g）：Step 1 让 `lastSyncedAt` 活过刷新，只显示时刻会把上周的同步显示成「10:32」。
- **测试**：`collection-page-scaffold.test.tsx` 加默认文案断言；`tests/i18n-no-hardcoded.test.ts` 照跑；locale parity 测试照跑。
- **验证**：六平台页 × 亮 / 暗 × 中 / 英截图，空库、未登录、未配置三种状态逐一过一遍。
- **回滚**：revert。
- **判据**：`EmptyLibraryState` / `NotLoggedInState` 全仓各一份；`*.lastSynced` 平台键零残留。

### Step 7 数据 hook 改名层（D3；若 D3 选保留则跳过）

- **目标**：五个平台 hook 只留平台特有部分，兑现 docs/15:55 的约 40 行目标。
- **依赖**：Step 6。
- **改法**：
  - view 直接消费 `useCollectionLibrary` 的 `items` / `filter` / `facets`；
  - `queryFn` 的 filter / search / page 规整抽成共享 helper；
  - 凭据门（github token、youtube 配置）用一个共享 wrapper；
  - X 冷却、bookmarks 的路由受控筛选与挂载同步，留在各自 hook。
- **测试**：`use-bookmarks.test.tsx` 与各 view 测试随改名更新；`use-collection-library.test.tsx` 不动。
- **判据**：五个平台 hook 各 ≤ 60 行（估算门槛）。

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
| 数据 hook | 129 | ~40（D3=删）/ ~110（D3=留） | Step 7 |
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
| 4 | 错误类必须继承 `sync-errors.ts` 基类 | 平台错误类继承断言；`lib-import-smoke` 纳入新 leaf |
| 5 | 新增「延迟正文」一节 | `sections/**` 禁字面 job 命名空间 |
| 6–8 | §7 页面清单删去状态组件与 tagged 外壳两项 | `CARD_ADAPTERS` 对账不变 |
| 9 | 查询片段 builder 列入「shared read helpers」 | — |

每个 Step 落地时同 commit 更新上表对应的 spec 与目录 `CLAUDE.md`。

---

## 附录 A [UNKNOWN]

- `fetchFavVideos` 直接返回 `json.data`，不做形状校验（`lib/bilibili/bilibili-api.ts:159`）；调用方读 `data.medias` / `data.info`。`data: null` 时是 TypeError 而非分类错误。`checkAuth` 登录门是否总能挡住这种情况，未确认。
- B站浏览路径（D4）是否触发过 412，无观测记录。
- docs/17 HIGH-2 / HIGH-3 的现状本次未核查。
- 导出没有恢复 / 导入路径，是否在规划中未知。

## 附录 B 勘误与旁注

- **docs/16:11**：记 docs/15 LOW-7「已修复」，实际只迁了 `retry` / `loadFailed`；Step 6 落地时同 commit 勘误。
- **§2 漏记一条既有决定**（2026-09-29 定 D1 时发现）：07-26 daily auto-sync 任务定过「复用 `sources.lastFetchedAt`，不建新表、不加新 storage 记录」（`.trellis/tasks/archive/2026-07/07-26-daily-first-open-auto-sync-all-platforms/prd.md:11`）。它不属于「不得重提」，因为 D1 明确推翻了它（§5.1）；记在这里，是为了不让后人以为本文不知道它。
- **docs/15:55**：「各平台 hook 退化为 ~40 行」未兑现，现为 115–163 行（D3）。
- **命名冲突**：`SyncBookmarksResult`、`getBookmarks`、`BookmarksQuery` 在 `lib/x` 与 `lib/bookmarks` 同名导出，今天没有文件同时 import 两者。**Step 1 未改名**（2026-09-30，D-h）：六个 lib 结果类型各自只追加了缺的字段（github `inserted`、bookmarks `inserted`、bilibili runner `insertedCount`），没有被统一成一个类型；统一只发生在 app 侧 adapter 返回给 funnel 的 `PlatformSyncOutcome`。lib 层两个同名类型不在同一文件相遇，改名收益为零。等哪天真有文件同时 import 两者，再改。
- **悬空 ADR 引用**：`lib/ingest/ingest.ts:11` 曾写「ADR in .trellis/spec/frontend/database-bridge.md」，该文件不存在，也**从未进过 git**（`git log --all -- '*database-bridge*'` 为空；工作日志记它曾加过一节「Insert-Only Policy」，但从未提交，内容已丢失）。insert-only 规则实际只记录在 `lib/ingest/CLAUDE.md:16` 与 `platform-onboarding.md:117`。**Step 1 起全部改指 `lib/ingest/CLAUDE.md`**（2026-09-30）：`ingest.ts` 与这两处文档先改；同一条悬空引用还留在五个 sync-service 头注释（github / x / zhihu / youtube / bookmarks）、六个测试文件头注释（上面五个平台的 service 测试加 `lib/bilibili/videos-sync.test.ts`）与四个 `lib/<platform>/CLAUDE.md`（bilibili / bookmarks / github / x）里，**用户同日追加范围**，由 trellis-check 一并改掉；docs/ 与归档任务之外该路径零残留。
- **「synced」含义不一**：x 报拉取数（`x-sync-service.ts:224`），github / bilibili 报 link 数（`github-sync-service.ts:293`、`videos-sync.ts:66`）。**已于 Step 1 在 adapter 层消除**（2026-09-30）：进 Platform Sync Record 的只有 `fetched` / `inserted` 两个口径明确的数（口径见 D-d）；lib 各自的 `synced` 字段原样保留，也不入记录。
