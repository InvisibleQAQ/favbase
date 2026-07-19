# 16. 六平台架构深化审计（2026-07-18）

## 背景与范围

Favbase 现有 6 个收藏平台：Bilibili、GitHub Stars、浏览器书签、X 书签、知乎收藏、YouTube 公开播放列表。数据库结构统一（单 items 表 + `platform` 判别列 + `platformMeta` JSONB）。

前三次审计的已修项**不在本报告重复**：

- `docs/13`（2026-06-29）：lib 层平台耦合 8 条——全部修复。
- `docs/14`（2026-07-13）：UI 层标签圈禁 + section 脚手架——已修复。
- `docs/15`（2026-07-17）：HIGH-1（`useCollectionLibrary` 泛型 hook）、HIGH-2（`resolveCollectionPhase` + 四件套组件提升）、MEDIUM-3 步骤 1+2（`sql-utils` + `collection-queries`）、MEDIUM-4（`CollapsibleChipRow`）、LOW-7（`common.*` i18n）——已修复，本次复查全部兑现。

**本次审计的触发点**：docs/15 修复之后接入了 YouTube——**这是共享层全部就位后接入的第一个平台**，是「新平台边际成本」的最真实测量，也是 docs/15 两个「暂缓评估」条款（ingest 事务骨架、字符软切 chunker）设定的触发条件的直接检验。

结论先说：**两个暂缓触发器都被 YouTube 引爆了**。docs/15 说「第 6 个平台真出现时再决策」ingest 骨架——第 6 个平台出现了，照抄了第 5 份；docs/15 说「第 3 个字符软切 chunker 出现时再提取」——第 3 份出现了，与知乎版除函数名外逐字符相同。暂缓条款不是废纸，条件满足就该兑现。

所有 HIGH/MEDIUM 级证据均经逐行人工复核（非仅静态扫描）。

## 总评

**品味评分：凑合偏好。**

好的一面必须先记账：docs/15 的投资全部兑现了。YouTube 对共享层的复用**零遗漏**——`sql-utils`（`youtube-sync-service.ts:31`）、`pagedItemsQuery`/`getPlatformLastSyncedAt`（:33-36）、`useCollectionLibrary` 薄 adapter（`use-youtube-playlists.ts:101-113`，148 行 vs 旧模式 ~230 行）、`CollapsibleChipRow`（`playlist-chips.tsx` 39 行 vs 旧模式 ~90 行）、`resolveCollectionPhase` + 全套哑组件 + `useCollectionTags`、`common.*` i18n。危险复制（状态机竞态、分支顺序、SQL 骨架、`escapeLike` 安全函数）已经消灭，这是真实进步。

烂的一面用数字说话。**第 6 个平台的 UI 边际成本实测 ~720 行 section 代码**（view 332 + hook 148 + 卡片/骨架/chips/tagged-adapter ~240），docs/15 预测的是 ~150 行。差距在哪：view 层收敛只做了一半——分支**顺序**进了纯函数，但 phase→节点映射的通用接线（~150 行）每个 view 原样照抄；lib 层 ingest 事务骨架（~150 行）照抄第 5 份；chunker（~50 行）照抄第 3 份；platformMeta 防御式收窄（~25 行）每平台写两份。加起来 **~380 行本可为零的复制**，这就是本报告的问题清单。

---

## 问题清单（严重度降序）

### HIGH-1：ingest 事务骨架第 5 份拷贝（docs/15 MEDIUM-3 步骤 3 的触发条件已满足）

**证据**（逐行对照）：

- `syncPlaylistsToDb`（`lib/youtube/youtube-sync-service.ts:230-396`，~165 行）↔ `syncFavoritesToDb`（`lib/zhihu/zhihu-sync-service.ts:150-318`，~168 行）：五阶段结构完全同构——
  1. sources upsert（title + lastFetchedAt 刷新，ADR 允许的唯一例外）；
  2. authors 按 id 去重 → insert-only → re-select 建 `authorIdMap`；
  3. items：先查 `preExisting` 集 → values 映射（authorId 缺失过滤 + `platformMeta satisfies` + `contentState` 三态）→ `chunk(500)` 分批 `onConflictDoNothing`；
  4. links：re-select `itemIdMap` → `seenLinks` 去重 → 分批 insert；
  5. 收集 `inserted[]` → **事务外**逐条写 content+chunks（`replaceItemChunks` 自开事务，嵌套死锁注释两处逐字相同）。
- `syncBookmarksToDb`（`lib/x/x-sync-service.ts:167`）及 github/bookmarks 同构（docs/15 已复核相似度 80-90%，本次抽查未变）。
- youtube 文件头注释自我招认：「Structure mirrors the zhihu flow」（`youtube-sync-service.ts:224-225`）。

**为什么升 HIGH**：docs/15 把这条压在 MEDIUM-3 步骤 3 并写明缓期条件——「收益要等第 6 个平台真出现时再兑现」。第 6 个平台出现了，第 5 份拷贝产生了。按 docs/15 自己的逻辑这条自动晋级。现状是 **~750 行 schema 知识分布在 5 个文件里**，每份只靠各自的守护测试兜底；「两段式事务防死锁」这类不变量靠注释复制传播——哪个平台哪天在事务内调了 `replaceItemChunks`，就是一个只在数据量大时才复现的死锁。

**建议**：提取共享 ingest 管线（`lib/database/ingest.ts` 或 `lib/ingest/`）：

```ts
ingestCollection(db, {
  platform,
  sources,   // { platformSourceId, title }[] — upsert 语义由管线持有
  authors,   // { platformAuthorId, name, avatarUrl }[]
  items,     // (归一化行, 含 platformMeta/contentState) + sourceKey 归属
  links,     // 或由 items×sources 派生
  contentOf, // (newItem) => { plainText, chunks } | null — 事务外持久化
})
```

管线持有：事务边界、`chunk(500)` 分批、id-map re-select、`preExisting` 差集、seenLinks 去重、两段式 content 写入。平台只提供归一化行。**迁移策略**：zhihu/youtube 先行（同构度最高），x/bookmarks/github 跟进；5 个平台的 in-memory PGlite 守护测试原样保留做等价验证——这是低风险重构的全部前提，测试已经在那里了。

附带收益：这个收敛点正是 MEDIUM-2（content-persisted seam）需要的挂载处，两条一起做。

### MEDIUM-2：content-persisted seam 仍缺失，打标欠账 +1（docs/15 MEDIUM-5 遗留）

**证据**：

- 事件注册表仍只有一个事件：`item-tagged`（`lib/events/domain-events.ts:8-10`）——「内容已持久化」这个上游事实依然没有控制点。
- AI 自动打标仍只有 bilibili 接线（`lib/bilibili/transcribe-utils.ts:36` 的 `void tagPlatformItem('bilibili', bvid)`）。
- x/zhihu/youtube 三个平台的内容都已落 `item_contents` + chunks（`content_state='chunked'`），但零打标触发——三个 section 的 CLAUDE.md 各写了一遍「触发点待后续任务」。docs/15 时欠账 2 处，现在 3 处，每接一个文本平台 +1。
- github 是另一类：**连内容持久化都没有**（`lib/github/github-sync-service.ts` 不写 `item_contents`），打标输入缺失——那是独立的产品决策（README 收录），不算本条欠账。

**建议**：随 HIGH-1 落地——共享 persist 步骤完成后直调 `tagPlatformItem(platform, id)`（docs/15 已论证「直调」比跨 context 事件转发简单且够用）。**约束必须直说**：X 有一条同步路径跑在 offscreen（浮层按钮 → `syncBookmarks`），offscreen 无 `chrome.storage`（`sql-utils.ts:3-4` 的设计前提），而 `tagPlatformItem` 要读 LLM 配置——所以 offscreen 路径要么经 background 转发触发，要么接受该路径不自动打标（欠账保留一处、显式记录）。app.html 路径（5 个平台全部 + X 的页内同步按钮）直调即可覆盖绝大多数场景。

### MEDIUM-3：view 编排脚手架 ~150 行 ×4 残留复制（docs/15 HIGH-2 只做了一半）

> **已修复（2026-07-19，任务 07-19-medium3-collection-page-scaffold）**：提取 `entrypoints/app/components/collection/collection-page-scaffold.tsx`（`CollectionPageScaffold<T>`），持有 tag 接线 + phase 阶梯 + 8-case 渲染 + 双 id 映射 + 主 grid popover/分页 + 页面骨架区；github/x/zhihu/youtube 四 view 退化为配置门 + 平台状态组件 + slot 装配（332/299/309/302 → 214/178/184/185 行）。重复的编排逻辑从 ×4 归一为 ×1。配置门早退 + 平台状态组件留在 view（平台专属）。tsc + 358 测试全绿；scaffold 零 t()/零平台字面量/零平台 lib import。

**证据**：

- view 行数实测：`github-stars-view.tsx` 302、`x-view.tsx` 299、`zhihu-view.tsx` 309、`youtube-view.tsx` 332。对比 docs/15 修复前（273/282/338）——**收敛之后 view 没有变薄**。风险最高的东西（分支顺序）确实进了 `resolveCollectionPhase` 并被 `collection-phase.test.ts` 锁死，但行数复制原样保留。
- 逐字同构的段落（`x-view.tsx` ↔ `youtube-view.tsx` 对照，github/zhihu 同）：
  - captionParts 构建 + syncErrorText（x:145-153 ↔ yt:165-173）；
  - phase 旗标接线（x:155-165 ↔ yt:175-185，九个旗标名一致）；
  - switch 的 `tag-filtered`/`query-error`/`sync-error`/`skeleton`/`no-matches`/`grid` 六个 case（x:168-240 ↔ yt:187-268）——差异仅平台组件名；`grid` case 里的 `TagEditPopover` + `CardGridPagination` 接线逐字相同；
  - 页面骨架区（SectionTitleBar → SyncProgressBar → 错误横幅 → SearchField → chips → TagFilterChips → content，x:242-298 ↔ yt:270-331）。
- 真正的平台差异已被 4 个消费方实测枚举清楚：空态/授权态组件（文案+按钮组合）、卡片、骨架、chips 数据、进度 caption、错误映射函数——**全部可 slot 化**。

**与 docs/14 结论的关系**：docs/14 反对 `CollectionPageFrame` 的理由是「分支有差异、消费方少」。分支差异已被 phase 函数消解（顺序契约独立成纯函数 + 测试），消费方从 3 涨到 4 且逐字同构。证据变了，结论该跟着变——这正是 docs/15 HIGH-2 建议里「共享组件 `CollectionContentSwitch`」没做的另一半。

**建议**：提取 `CollectionPageScaffold`（`components/collection/`，维持零平台字面量 + 零 `t()` 铁律，文案经 props）：内部消费 `resolveCollectionPhase`，持有六个通用 case + TagEditPopover + pagination + 页面骨架区；平台注入 slots（`renderCard`/`skeleton`/`chips`/`emptyState`/`authFailedState`/`progressCaption`/文案组/错误映射）。各 view 退化为 ~100-120 行（平台空态组件 + 文案 + slot 装配）。风险中等：4 个 view 行为等价回归，建议在 HIGH-1 之后单独任务做。

### MEDIUM-4：字符软切 chunker 第 3 份拷贝（docs/15 LOW-6 触发条件已满足）

**证据**：

- `lib/zhihu/zhihu-chunker.ts:13-54` ↔ `lib/youtube/youtube-chunker.ts:14-54`：**除导出函数名与注释外逐字符相同**——`MAX_CHARS=1500`、`LOOKBACK=300`、`SENTENCE_END` 正则、`findCut`（段落空行 > 句末标点 > 硬切）、while 主循环 + 尾块。
- `lib/x/x-chunker.ts` 同族，唯一差异是无段落优先级。
- docs/15 LOW-6 原话：「**第 3 个字符软切 chunker 出现时再提取**，提取物大概是 `charSplit(text, { preferParagraph })`」——第 3 个出现了，且预测的提取物形状完全命中。

**建议**：`lib/embedding/char-split.ts`（与 `chunkSubtitleRows` 同目录——`ChunkInput` 契约的家）导出 `charSplit(text, { preferParagraph }): ChunkInput[]`；x 传 `false`，zhihu/youtube 传 `true`。三个平台 chunker 文件退化为一行 re-export 或直接删除（调用点改导入）。三份现有单测合并迁移。纯函数、零风险，10 分钟级。

### MEDIUM-5：platformMeta 防御式收窄每平台写两份（lib mapRow ↔ section tagged-card）

**证据**：

- `toVideoItem`（`lib/youtube/youtube-sync-service.ts:492-517`）↔ `toYoutubeVideoItem`（`entrypoints/app/sections/youtube/tagged-youtube-card.tsx:13-38`）：同一套 `typeof meta.x === 'string' ? ... : 默认值` 逐字段收窄，11 个字段两份维护。
- x/github/zhihu 同模式（`toBookmarkItem` ↔ `toXBookmarkItem`、`toGithubRepoItem` 镜像链，各 tagged-card 的 CLAUDE.md 自我招认「镜像 toXBookmarkItem」）。
- 矛盾点：sync-service 头注释自称 platformMeta 形状「single source of truth: this file」（`youtube-sync-service.ts:72`），但 section 里另有一份解析知识。meta 是 `unknown`/JSONB——**改形状时编译器不会告诉你 tagged-card 那份漏改了**，只有运行时标签视图字段悄悄变默认值。

**建议**：每平台从 sync-service 导出唯一的收窄函数 `narrowYoutubeMeta(meta: unknown)`（返回带默认值的完整 meta 结构），`mapRow` 与 tagged-card adapter 共用；envelope 字段差异（`id` 来源、`publishedAt` 置 null）留在各自调用点。~25 行 ×2 → ×1 每平台，机械替换，低风险。

### LOW-6：persist-content 小助手第 3 份拷贝

**证据**：`persistTweetContent`（`x-sync-service.ts:307`）↔ `persistZhihuContent`（`zhihu-sync-service.ts:321`）↔ `persistDescriptionContent`（`youtube-sync-service.ts:404`）——11-15 行，仅 chunker 调用与空值语义微差。

**建议**：并入 HIGH-1 管线的 `contentOf` 步骤自然消失；若 HIGH-1 暂缓，先提 `persistPlainTextContent(db, itemId, text, chunkFn)` 到 `lib/database/` 或 `lib/embedding/`。搭车做零成本，单独做也就 15 分钟。

### LOW-7（观察项，暂不动）：平台注册散点从 4 处涨到 ~7 处

docs/15 时是 4 处（main.tsx 路由、nav-config、wxt.config hostPermissions、pages/）。YouTube 接入实测新增：`icon-sets.ts` 离线图标注册、settings 的 connection card + `settings-view.tsx` 挂载、locales 平台命名空间（zh/en 两文件）。每处仍是类型安全的小改动、漏了立刻可见，**维持 docs/15 结论：registry 驱动的平台配置表等真实消费方出现再做**。但注意——那个消费方已经有雏形了，见 LOW-8。

### LOW-8（观察项）：overview 仪表盘是硬编码假数据占位页

**证据**：`entrypoints/app/sections/overview/overview-view.tsx:20-148` 全部 mock——「Total Videos 128」「Recent Activity」假条目、硬编码英文（该文件在 i18n 守卫 `EXCLUDED_FILES` 豁免名单里，根 CLAUDE.md 有案）。六个平台的真实数据在仪表盘零呈现。

**为什么放 LOW**：这不是耦合问题，是未实现的功能。放进本报告的原因只有一个：**做真实 stats 的那天，就是 LOW-7 的 registry 兑现日**——per-platform 卡片（count 查询 + icon + label + 路由）应由平台配置表驱动，而不是 6 份硬编码 `StatWidget`。两条绑定决策，别分开做。

---

## 健康面（勿动，也勿重复审计）

以下经本次复查确认干净：

- **共享层复用（docs/15 投资兑现清单）**：YouTube 全链路零自建——`chunk`/`escapeLike` 导入自 `sql-utils`、`pagedItemsQuery`/`getPlatformLastSyncedAt` 导入自 `collection-queries`、hook 是 `useCollectionLibrary` 薄 adapter（配置门/auth 留 adapter 闭包，spec 铁律遵守）、chips 是 `CollapsibleChipRow` 薄 adapter、view 消费全套 `components/collection/` 哑组件 + `resolveCollectionPhase` + `useCollectionTags`、通用文案走 `common.*`。
- **`useCollectionTags`**：标签五件套 + `handleTagsChanged` 不变量已封死在 hook 内——docs/15 HIGH-2 点名的「靠 CLAUDE.md 提醒别踩坑」问题已消灭。
- **数据库层与横切基础设施**：YouTube 零新表、零迁移、零 RPC 改动、export 自动覆盖——继承 docs/15 健康清单，抽查无回归。
- **adapter 字段重命名映射**（`videos: lib.items` 等 ~25 行/平台）：既定取舍（保留领域词汇表），不是复制，勿动。
- **bookmarks / bilibili 不进共享抽象**：形态不同（auto-on-mount / 双 hook），docs/15 已圈定范围，维持。

## 建议执行顺序

| 序 | 项 | 工作量 | 风险 |
|---|---|---|---|
| 1 | MEDIUM-4（charSplit 提取，3 单测兜底） | 极小 | 零 |
| 2 | MEDIUM-5（narrowMeta 每平台单份） | 小 | 低（机械替换） |
| 3 | HIGH-1（ingestCollection 管线，zhihu/youtube 先行） | 中大 | 中（5 守护测试等价验证兜底） |
| 4 | MEDIUM-2（HIGH-1 收敛点直调 tagPlatformItem；offscreen 路径显式决策） | 小 | 低（含产品决策：哪些平台开自动打标） |
| 5 | ~~MEDIUM-3（CollectionPageScaffold，4 view 回归）~~ ✅ 已修复 2026-07-19 | 中 | 中 |
| 6 | LOW-6 随 3 消失；LOW-7/8 等 dashboard 真实化需求一并做 registry | — | — |

1-2 是纯机械任务可合并先做；3-4 是本审计的主菜——做完后新平台的 lib 层从「抄 165 行事务代码」变成「声明归一化行」，且自动打标不再逐平台欠账；5 做完后 view 层边际成本才真正落到 docs/15 预测的 ~150 行区间。
