# 多平台内聚性审计（2026-07-13）

> Goal: Favbase 已支持 Bilibili 收藏 + GitHub Stars，后续将接入知乎、抖音、YouTube 等平台。审计当前代码的高内聚/低耦合状况，识别平台数增长到 5+ 时会放大的架构摩擦，按严重程度由高到低排序。
>
> 与 `docs/13_multi-platform-extensibility-audit.md`（2026-06-29）的关系：该审计 11 条发现中 **C1–C6、H1、H2 共 8 条已全部修复**（详见文末状态表）。转录管线、缓存、消息分发、自动转录状态机已平台无关。本文接棒，聚焦**剩余问题 + GitHub Stars 接入后暴露的新问题**——摩擦已从 lib 层转移到 **app.html UI 层**。

术语（沿用 module/interface/seam 词汇）：**module** = 有接口和实现的任何单元；**seam** = 接口所在处、可在不改内部的情况下替换行为的位置；**adapter** = 在 seam 上满足接口的具体实现；**locality** = 变更/bug/知识集中在一处的收益。判定原则：**一个 adapter = 假想 seam，两个 adapter = 真实 seam**。

---

## HIGH-1. 标签子系统被圈禁在 Bilibili section 内

**Files**:
- `entrypoints/app/sections/collections/use-item-tags.ts:8`（`export const BILI_PLATFORM = 'bilibili'`）、`:34`、`:55`
- `entrypoints/app/sections/collections/tag-edit-popover.tsx:11,64,79`（直接消费 `BILI_PLATFORM`）
- `entrypoints/app/sections/collections/tagged-video-grid.tsx:22`（`toBiliFavVideo(item: TaggedItem): BiliFavVideo`）、`:142`
- `entrypoints/app/sections/collections/tag-filter-chips.tsx`

**Problem**: `lib/tagging/` 本身是干净的——`tagPlatformItem(platform, platformItemId)` 全程用判别符寻址，无平台分支。但**标签的全部 UI**（编辑 popover、筛选 chips、跨夹标签网格、数据 hooks）都长在 `sections/collections/`（Bilibili section）里，且：

1. `BILI_PLATFORM` 常量把 hooks/popover 的 platform 参数焊死为 `'bilibili'`；
2. `tagged-video-grid.tsx` 的 `toBiliFavVideo` 把平台无关的 `TaggedItem` 强转为 `BiliFavVideo` 以复用 `VideoCard`——这个网格**只能渲染 Bilibili 条目**。GitHub repo 一旦被打上标签（已规划的后续任务），会命中 `getItemsByTags` 查询结果，然后被强行塞进 B 站视频卡片形状，静默渲染出垃圾。

标签是知识库的**平台无关**概念（PRD 层面：所有平台的收藏都要能打标、按标签筛选），但它的 UI module 只有一个 adapter（Bilibili），且这个 adapter 的知识（platformMeta 形状、卡片渲染）泄漏进了本应通用的网格里。

**Solution**（作为「GitHub 打标」任务的第一步做，不要提前做）：
1. 把标签 UI（`use-item-tags`、`tag-edit-popover`、`tag-filter-chips`、tagged 网格骨架）提升出 `sections/collections/`，platform 从常量变为参数；
2. `TaggedVideoGrid` 的卡片渲染改为 per-platform 渲染 seam：`TaggedItem.platform` → 对应平台的卡片组件（registry 或 render-prop），删掉 `toBiliFavVideo` 强转；
3. 跨平台标签筛选视图（如果产品上要「一个标签横跨 B 站视频 + GitHub repo」）自然从 2 落地。

**Benefits**: locality——标签行为的变更集中在一个 module，不用每个平台复制一份 popover/hooks；leverage——平台 N 接入打标 = 提供一张卡片组件，零标签逻辑代码。测试面收窄到「(platform, itemId) → 标签操作」一个接口。目前 GitHub 尚未打标，seam 还是假想的——**所以此项与 GitHub 打标任务绑定执行**，届时两个 adapter 让 seam 变真实，避免为单消费者提前抽象。

---

## HIGH-2. 平台 section 展示层脚手架 O(n) 复制，且已出现分叉演化

**Files**:
- `entrypoints/app/sections/collections/collections-view.tsx`（386 行）vs `entrypoints/app/sections/github-stars/github-stars-view.tsx`（286 行）
- `video-grid-skeleton.tsx` vs `RepoGridSkeleton`（github-stars-view.tsx:139-149）

**Problem**: 两个平台 view 之间存在大块**结构等价的展示脚手架**复制：

| 脚手架 | collections | github-stars | 状态 |
|---|---|---|---|
| 虚线空态框（icon+标题+描述+按钮） | `NotLoggedIn`/`ErrorState`/`EmptyFolderState`（:38-121，各自重复 sx） | `StateBox` + 4 个状态组件（:45-137，已抽壳） | **已分叉**：github 版边框用 `varAlpha(grey['500Channel'], 0.24)`（暗色安全），collections 仍是静态 `grey[300]`——复制后改进未回流 |
| 标题栏（标题+计数 caption+spacer+同步按钮 CircularProgress/restart） | :202-231 | :207-235 | 逐行等价 |
| 搜索框（TextField + eva:search-fill adornment） | :369-383 | :248-263 | 逐行等价 |
| 卡片网格（xs12/sm6/md4/lg3）+ Pagination | :259-298 | :290-308 | 逐行等价 |
| 8 卡骨架屏 | `video-grid-skeleton.tsx` | `RepoGridSkeleton` | 等价 |
| chips 过滤行 | `folder-chips.tsx`（63 行） | `language-chips.tsx`（73 行，CLAUDE.md 自述「复用 folder-chips 模式」＝复制） | 视觉/交互等价 |

每接一个平台，这 ~200 行脚手架再复制一遍。5 个平台 = 5 份各自演化的拷贝。分叉已经发生：暗色模式修复只落在 github 一份。删除测试：删掉这些重复块，复杂度会在 N 个 section 里重现——它们确实在挣自己的位置，只是位置错了。

**Solution**: 抽**哑组件**，不抽框架。新建共享目录（如 `entrypoints/app/components/collection/`），提取：
1. `StateBox` 家族（github 版为基准，参数化 icon/标题/描述/action）——**这个 seam 已有两个 adapter，是真实 seam，立刻可做**；
2. 标题栏 + 同步按钮（title, caption, syncing, onSync）；
3. `SearchField`（受控/禁用两态）；
4. `CardGrid` + 分页（children + page/totalPages/onChange）；
5. 骨架屏（卡高参数化）。

**不要**做 `CollectionPageFrame` 大一统框架：两个 view 的内容分支顺序、chips 行显隐条件、进度条种类（AutoTranscribeBar vs SyncProgressBar）都不同，强行统一会造出接口和实现一样宽的浅 module。各平台 view 保留自己的编排，只消费哑组件。

**Benefits**: locality——暗色模式类修复只改一处；leverage——平台 N 的 view 从 ~300 行降到 ~100 行编排代码；哑组件可独立做渲染测试，平台 view 只剩接线逻辑。

---

## MEDIUM-3. Bilibili 独占 `/collections` 通用命名空间（路由 + 目录名）

**Files**:
- `entrypoints/app/main.tsx:60-62`（`collections` → CollectionsPage、`collections/bilibili/:mediaId` → CollectionsPage、`collections/github` → GithubStarsPage）
- `entrypoints/app/sections/collections/`（目录名通用，内容全是 Bilibili）
- `entrypoints/app/layouts/nav-config.tsx`（`nav.bilibiliFavorites` → `/collections`）

**Problem**: 这是 docs/13 H5 的残留形态。`collections` 这个通用词被 Bilibili 占用了两次：
1. **路由**：`/collections` 直接渲染 B 站收藏页，GitHub 屈居 `/collections/github`。所有新平台路径都是 B 站路径的兄弟兼子路径，nav 高亮靠 `findActiveChildPath` 最长前缀匹配兜底——能工作，但每加一个平台都在加剧「通用路径 = B 站」的语义扭曲。将来若要做「全部收藏」聚合页，`/collections` 已被占。
2. **目录**：`sections/collections/` vs `sections/github-stars/`——前者名字声称通用、内容平台专属；platform-onboarding 契约要求的 per-platform section 模式被第一个平台自己违反了。新贡献者（含 AI）会误判 `sections/collections/` 是共享层。

**Solution**（纯机械改名，趁只有 2 个平台时做，成本最低点）：
1. 路由：`collections/bilibili` + `collections/bilibili/:mediaId` 归 B 站；`/collections` 保留为 redirect（指向 bilibili 或未来的聚合页）；
2. 目录：`sections/collections/` → `sections/bilibili/`；
3. nav 项 path 改 `/collections/bilibili`。

**Benefits**: locality——「哪个目录属于哪个平台」一眼可判，AI 导航不再需要读 CLAUDE.md 才能纠偏；为将来的跨平台聚合页留出 `/collections` 命名空间。零行为变更。

---

## LOW-4. Dashboard 概览是硬编码占位，实现时必须平台无关聚合

**Files**: `entrypoints/app/sections/overview/overview-view.tsx`（统计数字为字面量占位，i18n 守卫白名单豁免中）

**Problem**: 不是耦合问题，是**前瞻约束**：真实实现时若按平台写死统计卡（一张 B 站卡 + 一张 GitHub 卡各查各的），每个新平台又要改 overview。

**Solution**: 实现时用单条 `GROUP BY items.platform` 聚合查询驱动全部平台卡片，卡片元数据（图标/名称/路由）来自平台注册表——overview 对平台数 O(0)。参考 `lib/export/query.ts` 的 schema 驱动模式。

---

## LOW-5. 搜索无跨平台 seam（信息性记录）

**Files**: `collections-view.tsx:369-383`（disabled 占位搜索框）、`use-github-stars.ts`（GitHub 平台内 ILIKE 搜索）

**Problem**: 两个平台的「搜索」是两个不相干的实现：B 站是 UI 占位，GitHub 是 service 层 ILIKE。将来的全局语义检索（embedding 路线图）需要一个平台无关的查询接口。现在不需要动——记录在此防止第三个平台再发明第三种搜索。

**Solution**: 随 embedding 检索 UI 任务定义统一查询 seam；平台内搜索（如 GitHub 语言过滤+ILIKE）保留为平台 service 的本地能力，不强并。

---

## 已验证健康的模块（勿重复审计）

| Module | 证据 |
|---|---|
| `lib/tagging/` 服务层 | `tagPlatformItem(platform, platformItemId)` 全程判别符寻址，无平台 switch；`TaggingInput` DTO 平台无关（`prompt.ts:8-14`） |
| `lib/events/` | `'item-tagged': { platform, platformItemId }`——platform 是 payload 不是分支 |
| `lib/transcription/` | `PipelineRequest.videoId` + `officialSourceLabel`/`asrSourceLabel` 由 adapter 注入（pipeline.ts:42-47） |
| `lib/auto-transcribe/` | 通用状态机零平台知识；B 站特有逻辑（`attr === 9`）隔离在 `lib/bilibili/auto-transcribe-adapter.ts:32` |
| `lib/background/transcription-handlers.ts` | `platformHandlers` registry 按 `msg.platform` 分发（:23-35） |
| `lib/cache/` | key = `local:vc:{platform}:{videoId}`，legacy source 迁移 `'bilibili'→'official'` |
| `lib/export/`、`lib/embedding/` | schema 驱动 / plainText 驱动，零平台字面量 |
| 路由/nav 注册成本 | 每平台 1-2 行路由 + 1 行 nav child，O(1)（问题只在 MEDIUM-3 的命名占用） |
| DB schema | `platform` + `platformItemId` 判别符 + `platformMeta` jsonb，天然多平台 |
| 平台接入契约 | `.trellis/spec/frontend/platform-onboarding.md` 已沉淀可执行契约（bilibili→github 验证过） |

## docs/13 条目最终状态（2026-07-13 核对）

| 条目 | 状态 |
|---|---|
| C1 pipeline `bvid`→`videoId` | FIXED |
| C2 pipeline 硬编码 source 标签 | FIXED（adapter 注入 label） |
| C3 `SubtitleSource` 维度混淆 | FIXED（`'official' \| 'asr'`） |
| C4 转录无平台分发 | FIXED（`platformHandlers` registry） |
| C5 AutoTranscribePipeline 绑定 B 站 | FIXED（`lib/auto-transcribe/` 通用层 + B 站 adapter） |
| C6 消息缺 `platform` 字段 | FIXED（`TranscribeRequest.platform`） |
| H1 BackgroundContext `bvid` 命名 | FIXED（`tabVideoIds`/`activeVideoIds`） |
| H2 cache 平台感知 | FIXED |
| H3 content script per-platform entrypoint | 按设计保留（WXT 约束） |
| H4 `useVideoDetect` 平台专属 | 按设计保留（位置正确） |
| H5 路由参数化 | PARTIAL → 收敛为本文 MEDIUM-3（结论修正：不需要 `:platform` 参数化路由，每平台 O(1) 注册即可；真正的问题是 B 站占用通用路径） |
