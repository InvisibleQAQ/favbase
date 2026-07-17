# 15. 五平台内聚-耦合审计（2026-07-17）

## 背景与范围

Favbase 现有 5 个收藏平台：Bilibili、GitHub Stars、浏览器书签、X 书签、知乎收藏。数据库结构统一（单 items 表 + `platform` 判别列 + `platformMeta` JSONB）。

前两次审计的已修项**不在本报告重复**：

- `docs/13`（2026-06-29）：lib 层平台耦合 8 条（转录管线/缓存/消息分发/auto-transcribe）——全部修复，本次复查仍然干净。
- `docs/14`（2026-07-13）：UI 层 HIGH-1 标签圈禁、HIGH-2 section 脚手架、MEDIUM-3 命名——已修复。

**本次审计的触发点**：docs/14 之后新接入了 X（第 4 平台）和知乎（第 5 平台）。这两个平台是**在共享层已存在的前提下**接入的，因此它们照抄了什么、没复用什么，是"新平台边际成本"的最真实测量。结论：哑组件层（`components/collection/`）和标签层（`components/tags/`）被正确复用了，但**编排层（hook 状态机、view 分支链、sync-service 查询骨架）每个平台仍在整块复制**。

所有 HIGH/MEDIUM 级证据均经逐行人工复核（非仅静态扫描）。

## 总评

**品味评分：凑合。**

数据结构是对的——单表 + platform 列 + JSONB 让 DB/RPC/迁移/导出对新平台完全透明，这是本项目最值钱的决策。横切基础设施（tagging/events/embedding-indexing/export）零平台字面量。烂的地方全在"每平台一份"的编排代码：**新接一个平台要照抄约 600-800 行结构完全相同的代码**（hook ~230 行 + view ~300 行 + sync-service 查询/工具 ~150 行），其中 X→知乎的照抄已经证明了这个成本是真实的、每次都会发生的。复制不是理论风险——`escapeLike` 这种安全相关函数已经存在 4 份逐字拷贝，哪天修 bug 漏一处就是 SQL LIKE 注入面。

---

## 问题清单（严重度降序）

### HIGH-1：数据 hook 状态机 ×3 整块复制（~700 行）

**证据**：

- `entrypoints/app/sections/github-stars/use-github-stars.ts`（~248 行）
- `entrypoints/app/sections/x/use-x-bookmarks.ts`（227 行）
- `entrypoints/app/sections/zhihu/use-zhihu-favorites.ts`（242 行）

三个 hook 结构逐段镜像，各自的 CLAUDE.md 甚至自我招认（"镜像 use-github-stars 模式"、"镜像 use-x-bookmarks"）。逐字相同的段落：

- 搜索防抖块（300ms + `searchRef` 值比对 + 重置 page=1）：`use-x-bookmarks.ts:95-105` ↔ `use-zhihu-favorites.ts:111-121`，**逐字符相同**。
- 分页查询 effect（`cancelled` 竞态保护 + `initDbProxy()` + setLoading/setQueryError）：`use-x-bookmarks.ts:116-144` ↔ `use-zhihu-favorites.ts:132-160`，仅查询函数名和 filter 键不同。
- `refreshMeta`（Promise.all 三连 + `mountedRef` 守卫）：`use-x-bookmarks.ts:147-159` ↔ `use-zhihu-favorites.ts:163-175`。
- `sync` 编排（syncing 互斥 + 进度回调 + refreshMeta + queryVersion 递增 + finally 清理）：`use-x-bookmarks.ts:173-202` ↔ `use-zhihu-favorites.ts:189-217`。
- `mountedRef` 声明块、`goToPage`/`retryQuery`、返回对象形状：全部相同。

**为什么是问题**：这是平台无关的状态机，真正的平台注入点只有 5 个——查询函数、meta 函数组、同步函数、filter 键名、错误分类器。现在每个新平台复制 ~230 行；防抖竞态、staleness 守卫这类修复要同步 3 处（未来 N 处）。第 6 个平台接入时这里必然产生第 4 份拷贝。

**建议**：提取泛型 hook `useCollectionLibrary<TItem, TFilter, TProgress, TError>`（放 `entrypoints/app/components/collection/` 或 `entrypoints/app/hooks/`），配置注入：

```ts
useCollectionLibrary({
  queryFn,        // (filter, search, page, pageSize) => { rows, total }
  metaFn,         // () => { counts, lastSyncedAt, libraryCount }
  syncFn,         // (onProgress) => Promise<void>  — auth 解析留在各平台闭包内
  classifyError,  // (err) => TError
})
```

各平台 hook 退化为 ~40 行薄 adapter。注意 X 的 auth 解析（`getXAuth()` 在 app.html context 读 session storage）必须留在 X 自己的 `syncFn` 闭包里，泛型层零 storage 访问——这与 `syncBookmarks` 的既有约定一致。bookmarks 平台的 auto-on-mount 同步和 bilibili 的双 hook 结构（folders+videos）不强行塞进该抽象——只收敛 github/x/zhihu 这类"单列表+chips+手动同步"形态，3 个消费方起步，够本。

### HIGH-2：view 内容分支链 ×3 照抄（~300 行 × 3）

**证据**：

- `github-stars-view.tsx`（~273 行）、`x-view.tsx`（~282 行）、`zhihu-view.tsx`（338 行）。
- 同一条 8 分支三元链，顺序完全一致（tagFilter → queryError → authFailed → syncError∧库空 → metaLoading → 库空 → loading → 无匹配 → grid）：`zhihu-view.tsx:280-334` ↔ x-view 同构。
- 每个 view 本地重复定义一套只差 i18n key/图标的组件：`SyncNowButton`（`zhihu-view.tsx:78-104`）、`ErrorState`（142-162）、`NoMatchesState`（165-174）、`SyncProgressBar`（181-197）——x-view 有几乎相同的四件套。
- 标签接线五件套（`useItemTags` + `useTagEditState` + `useUsedTags` + `useTagFilter` + `handleTagsChanged`）每个 view 抄一遍（`zhihu-view.tsx:209-220`），且携带一个微妙的必守不变量："`useItemTags` 顶层常驻，故 `onTagsChanged` 必须传 `handleTagsChanged` 否则清除筛选后标签过期"——这个坑在 3 个 view 的 CLAUDE.md 里各写了一遍。靠文档提醒人别踩同一个坑，就是抽象缺失的自白。

**与 docs/14 结论的冲突，必须直说**：docs/14 明确反对 `CollectionPageFrame` 大一统，理由是当时只有 3 个消费方、平台间分支有差异。**证据已经变了**：现在 5 个消费方，其中 2 个（X/知乎）是在共享哑组件存在的情况下仍然整块照抄的——说明哑组件抽得太浅，编排层复制已从"两次偶然"变成"模式定型"。当时的反对理由（差异化）实测很小：X 与知乎的差异只是空态按钮主次（contained/outlined）和进度 caption 文案。

**建议**（不是大一统 frame，分两步）：

1. **无脑步**：`SyncNowButton`/`ErrorState`/`NoMatchesState`/`SyncProgressBar` 提升到 `components/collection/`，文案经 props 传入（维持该目录"零平台字面量 + 零 t()"铁律）。机械替换，零行为变更。
2. **判断步**：8 分支链提取为共享组件 `CollectionContentSwitch`（或纯函数 `resolveContentPhase()` 返回 discriminated union，view 只做 phase → 平台组件的映射）。分支**顺序**是这条链的核心不变量——今天靠 3 个 view 各自维持一致，哪天某平台漏了 `authFailed` 短路就是静默 bug。把顺序收敛到一处，平台只提供每个 phase 的渲染物。标签五件套可一并收进 HIGH-1 的泛型 hook 或独立 `useCollectionTags(platform, itemIds)` 组合 hook，把 `handleTagsChanged` 不变量封死在抽象内部。

### MEDIUM-3：sync-service 工具函数与查询骨架 ×4 复制

**证据**（全部人工复核）：

- `chunk<T>()` **逐字符相同 ×4**：`github-sync-service.ts:353-356`、`bookmarks-sync-service.ts:311-314`、`x-sync-service.ts:403-406`、`zhihu-sync-service.ts:427-430`。
- `escapeLike()` **逐字符相同 ×4**：`github-sync-service.ts:360-362`、`bookmarks-sync-service.ts:318-320`、`x-sync-service.ts:410-412`、`zhihu-sync-service.ts:434-436`。这是 ILIKE 注入的防线，安全函数存在 4 份拷贝，修 bug 漏一处即留洞。
- 分页查询骨架 ~60 行 ×4：`getBookmarks`（`x-sync-service.ts:325-370`）↔ `getFavorites`（`zhihu-sync-service.ts:340-393`）——select 列清单、`publishedAt DESC NULLS LAST`、limit/offset、`count(*)::int` 并行查询、返回形状**全部相同**，差异仅 filter 条件（JSONB 精确匹配 vs EXISTS 子查询）和 search 列。github/bookmarks 同构。
- `persistTweetContent`（`x-sync-service.ts:305-315`）↔ `persistZhihuContent`（`zhihu-sync-service.ts:319-329`）：11 行仅 chunker 调用不同。
- `toBookmarkItem`（`x-sync-service.ts:414-440`）↔ `toFavoriteItem`（`zhihu-sync-service.ts:440-463`）：同一套 platformMeta 防御式收窄模式。
- `getLastSyncedAt` ×4（`x-sync-service.ts:390-397`、`zhihu-sync-service.ts:415-421` 等）。
- 主同步事务骨架（sources upsert → authors 去重 insert → items insert → item_sources insert，batch 500）×4，相似度 80-90%。

**为什么只是 MEDIUM**："每平台 sync-service 是 DB schema 知识的唯一持有者"是既有 ADR（`.trellis/spec/frontend/database-bridge.md`），有单测兜底（4 个平台都有 in-memory PGlite 守护测试），且这层代码写完就稳定。但工具函数和查询骨架的复制没有任何 ADR 掩护，纯粹是抄。

**建议**（分层处理，风险递增）：

1. **零风险**：`chunk`/`escapeLike` 提到 `lib/database/sql-utils.ts`（或 `lib/shared/`），4 处替换导入。10 分钟。
2. **低风险**：提取 `pagedItemsQuery({ platform, extraConditions, searchColumns, mapRow })` 查询构造器 + `getPlatformLastSyncedAt(platform)`，各平台查询函数变成条件声明。
3. **暂缓评估**：主同步事务骨架抽成共享 ingest 管线（`ingestItems(db, { platform, sources, authors, items, links })`）。这会把 schema 知识从"每平台一份"集中为"一处持有 + 平台提供归一化行"，是更深的模块——但要动 4 个平台的事务代码和守护测试，收益要等第 6 个平台真出现时再兑现。先做 1、2，第 6 个平台接入时再决策 3。

### MEDIUM-4：折叠 chip 行 ×2 逐字复制（~90 行）

**证据**：`sections/x/author-chips.tsx`（89 行）↔ `sections/zhihu/collection-chips.tsx`（94 行）。逐行对照：`COLLAPSED_COUNT=12`、`overflow/collapsible/visible` 计算（x:34-36 ↔ zhihu:39-41）、`selectedHidden` 补渲逻辑（x:40-43 ↔ zhihu:45-48）、展开/收起 raw Chip（x:73-86 ↔ zhihu:78-91）——**全部相同**，差异仅：类型（AuthorCount/ZhihuCollectionCount）、icon、i18n key、label 函数。zhihu 的 CLAUDE.md 直接写着"折叠逻辑抄 author-chips"。

**建议**：提取 `CollapsibleChipRow<T>` 到 `components/collection/`（该目录本就是 chips 外壳的家，`ChipRowShell`/`FilterChip` 已在那里），props 注入 `items/getKey/getLabel/icon/title/showMoreLabel/showLessLabel`。维持零 t() 铁律（label 由调用方传）。两个消费方各减 ~70 行；下一个有无界 chip 行的平台（作者/收藏夹类）直接受益。机械重构，有现成消费方可回归验证。

### MEDIUM-5：内容持久化缺共享 seam，横切功能靠"记得手工接线"

**证据**：

- AI 自动打标只有 bilibili 接了（`lib/bilibili/transcribe-utils.ts` 里 fire-and-forget 调 `tagPlatformItem`）；X/知乎的内容已落 `item_contents` + chunks（`content_state='chunked'`），但**没有任何打标触发**——不是决策不做，而是"触发点待后续任务"（两个 section 的 CLAUDE.md 均如此标注）。
- `lib/tagging/tagging-service.ts` 本身完全平台无关（`tagPlatformItem(platform, id)`），问题不在服务层，在**接入方式**：每个平台的 persist 路径是私有函数（`persistTweetContent`/`persistZhihuContent`/bili `content-sync`），横切功能想挂上去只能逐平台改代码。
- `lib/events/` 已有事件总线，但只定义了 `item-tagged`（`lib/events/domain-events.ts:8-10`）——"内容已持久化"这个更上游的事实没有事件。

**为什么是问题**：这是"复制"的镜像问题——不是代码重复，而是**该共享的控制点不存在**。每新增一个横切需求（自动打标、inline embedding 策略变更、内容统计），都要去 N 个平台的 persist 函数里各插一刀。打标接入 bilibili 时是 1 处，现在欠账已经是 3 处（github/x/zhihu），每接一个平台欠账 +1。

**建议**：在 MEDIUM-3 的 persist 收敛之上（或独立做），发一个 `content-persisted { platform, platformItemId }` 领域事件（复用 `lib/events/`），tagging 从"被各平台调用"翻转为"订阅事件自治"。注意约束：事件消费者要考虑 context——同步可能跑在 app.html、offscreen（X 浮层路径）两种 context，事件总线目前是单 context（app.html）设计，跨 context 需经 background 转发或退化为"persist 收敛点内直接调 `tagPlatformItem`"。后者更简单，也够用。

### LOW-6：chunker 主循环 ×2 复制（~50 行）

**证据**：`lib/x/x-chunker.ts:14-48` ↔ `lib/zhihu/zhihu-chunker.ts:13-54`。`MAX_CHARS=1500`、`LOOKBACK=300`、`SENTENCE_END` 正则（逐字符相同）、while 主循环 + 尾块处理全部相同；唯一差异是知乎在句末标点前多一级段落（`\n\n`）优先切。

**为什么只是 LOW**：两个都是有单测的纯函数，写完不会再动；下一个平台的切分策略未必落在"字符软切"家族（视频字幕是行聚合、PDF 可能按页）。现在参数化 `findCut` 策略省不了几行，还引入一层间接。**第 3 个字符软切 chunker 出现时再提取**，提取物大概是 `charSplit(text, { preferParagraph })`。

### LOW-7：i18n 同义 key 每平台一份

**证据**：`x.syncNow`/`zhihu.syncNow`、`x.retry`/`zhihu.retry`、`x.showMoreAuthors`/`zhihu.showMoreCollections`、`x.loadFailed`/`zhihu.loadFailed` 等——locale 文件按平台前缀成组增长，其中相当一部分 zh/en 文案完全相同。

**建议**：随 HIGH-2 第 1 步顺手做：共享组件化后，真正通用的文案（retry/syncNow/loadFailed/noMatches）迁入 `common.*` 命名空间，平台前缀只留真正平台特有的（notLoggedInDesc/emptyDesc 之类）。单独做不值得，搭车做零成本。

### LOW-8（观察项，暂不动）：平台注册散点

新平台的散弹式修改面目前是 4 处：`entrypoints/app/main.tsx`（lazy import + 路由）、`layouts/nav-config.tsx`（叶子项）、`wxt.config.ts`（hostPermissions 数组 + spread）、`pages/`（lazy 页面）。每处 2-5 行、类型安全、漏了会立刻可见（页面打不开）。docs/14 已验证此成本可接受。**registry 驱动的平台配置表等 `/collections` 聚合页需求真出现时一并做**，现在做是过度设计。

---

## 健康面（勿动，也勿重复审计）

以下经本次复查确认干净，列出以防下次审计重复扫描：

- **数据库层**：单 items 表 + `platform` 列 + `platformMeta` JSONB（`lib/database/entities/items.ts`），chunks/tags/embedding 表平台无关；RPC 桥（`lib/database/bridges/`）只有 health/query/exec/close 四操作，零平台感知；迁移零平台样板。**新平台零 DB 改动**，这是全项目最好的决策。
- **横切基础设施**：`lib/tagging/`、`lib/events/`、`lib/embedding/`（`indexItemChunks` 吃平台无关 `ChunkInput[]`）、`lib/export/`（`EXPORT_TABLES = Object.values(schema)` 自动覆盖新平台）、`lib/storage/` 生产代码零平台字面量（唯一例外 `settings.ts:49` 的 `configSavedAt` Record key 含 'github'，无害）。
- **消息层**：`lib/background/` 转录分发是 `platformHandlers` 注册表（`transcription-handlers.ts:23-25`），非 if/switch。
- **共享 UI 层**：`components/collection/` 与 `components/tags/` 被 X/知乎正确复用（StateBox/SectionTitleBar/SearchField/CardGrid/TagRow/TaggedItemGrid 均无第二份实现）。
- **offscreen 的 X 专属 runner**（`lib/offscreen/x-sync.ts`，9 行）：X 是唯一需要 offscreen 委托同步的平台（CS 无法直连 PGlite + session storage 不可读），单例特殊情况不值得框架化。第 2 个需要 offscreen 委托的平台出现时再说。

## 建议执行顺序

| 序 | 项 | 工作量 | 风险 |
|---|---|---|---|
| 1 | MEDIUM-3 第 1 步（chunk/escapeLike 提取） | 极小 | 零 |
| 2 | MEDIUM-4（CollapsibleChipRow） | 小 | 低（2 消费方回归） |
| 3 | HIGH-2 第 1 步（四件套组件提升 + LOW-7 搭车） | 中 | 低 |
| 4 | HIGH-1（useCollectionLibrary 泛型 hook） | 中大 | 中（3 hook 行为等价验证） |
| 5 | HIGH-2 第 2 步（分支链收敛） | 中 | 中（依赖 4 的形状） |
| 6 | MEDIUM-3 第 2 步（查询构造器） | 中 | 低（守护测试兜底） |
| 7 | MEDIUM-5（content-persisted seam + 打标接线） | 中 | 中（含产品决策：哪些平台开自动打标） |

1-3 可以合成一个纯机械任务先做掉；4-5 是本审计的主菜，做完后**第 6 个平台的 UI 边际成本从 ~600 行降到 ~150 行**（卡片 + 文案 + 薄 adapter）；6-7 按需排期。
