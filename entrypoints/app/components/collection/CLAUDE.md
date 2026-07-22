# app/components/collection

平台 section 共享展示哑组件 + 页面级编排脚手架（app.html 内共享，同层先例 `components/tags/`、`components/iconify/`）。来源：`docs/14` HIGH-2（哑组件收敛）+ `docs/16` MEDIUM-3（`CollectionPageScaffold` 编排收敛）。

**两级复用**：
1. **哑组件**（state-box/section-title-bar/search-field/card-grid/chip-row/…）——纯展示，各 view 直接消费或经 scaffold 消费。
2. **`CollectionPageScaffold`**（`collection-page-scaffold.tsx`）——「单列表 + facet chips + 手动同步」四平台（github/x/zhihu/youtube）的页面级编排。持有 tag 接线 + phase 阶梯 + 8-case 渲染 + 双 id 映射 + 主 grid popover/分页 + 页面骨架区；平台经 props/slots 注入卡片/chips/状态/进度条/文案。

**docs/14 曾反对 `CollectionPageFrame` 大一统 frame**（理由：分支顺序有差异、消费方少 3）——`docs/16` 推翻此结论：分支顺序已被纯函数 `resolveCollectionPhase`（+ `collection-phase.test.ts`）消解，消费方涨到 4 且逐字同构。证据变了，结论跟着变。scaffold 接口偏宽（~26 props）但实现更深（隐藏 phase 顺序/双 id/tag 刷新不变量/双 popover 区分/5 个骨架区条件门），不是浅模块。**配置门早退（hasToken/hasConfig）与平台状态组件（Empty/AuthFailed/NotConnected）留在 view**——平台专属，经 slot 注入。

## 铁律（沿用 components/tags）

- 零平台字面量（'bilibili'/'github'）、零平台 lib 导入（grep 可查，prd 验收项）
- 零 `t()` 调用——所有文案（按钮 label、标题、占位符）由消费方翻译后经 props 传入
- 暗色安全：虚线边框用 `varAlpha(grey['500Channel'], 0.24)`，禁止静态 `grey[300]`

## 模块结构

- `state-box.tsx` — `StateBox`：虚线空态/错误框。结构化 props `icon`（ReactNode，调用方控制颜色/边距）/ `title`（包 h6）/ `description`（包 body2 secondary 居中 maxWidth 400）/ `action`（ReactNode，调用方控制按钮 variant/loading）+ `minHeight`（默认 320）+ `children` 逃生口（纯文字空态如 NoMatches、EmptyFolder 的自定义 Typography）
- `section-title-bar.tsx` — `SectionTitleBar`：标题行（h5 title——loading 时传 Skeleton——+ caption + spacer + **可选**同步按钮）。同步三件套 `onSync/syncLabel/syncingLabel` 全可选：传 `onSync` 才渲染按钮（三态：syncing 时 CircularProgress+syncingLabel+disabled，否则 restart 图标+syncLabel）；省略则无按钮（如 bookmarks 挂载自动同步）。**可选冷却门 `syncDisabled?`/`syncDisabledLabel?`**（X 5 分钟冷却专用，其他平台不传 = 现状）：`syncDisabled` 时按钮硬禁用（`disabled=syncing||syncDisabled`）+ 显示 `syncDisabledLabel`（缺省回退 `syncLabel`）
- `search-field.tsx` — `SearchField`：全宽搜索框 + `eva:search-fill` adornment。受控（value+onChange）或禁用占位（disabled）两态
- `card-grid.tsx` — `CardGrid`（container spacing 2.5）+ `CardGridItem`（断点 xs12/sm6/md4/lg3 唯一事实源 `CARD_SIZE`）+ `CardGridPagination`（居中分页，totalPages≤1 返回 null）+ `CardGridSkeleton({ card })`（grid-of-8 外壳，卡片内部由各平台传入——保留平台骨架形态差异）
- `chip-row.tsx` — `ChipRowShell`（icon+subtitle2 加粗标题头部 + 可选 `headerExtra`（如清除按钮）+ flexWrap chip 行容器）+ `FilterChip`（选中 filled primary / 未选 outlined default + 可选 `maxWidth` 省略号截断 + 可选 `icon`（如语言色点））
- `collapsible-chip-row.tsx` — `CollapsibleChipRow<T>`：所有高基数分类/tag 筛选的共享折叠契约。默认显示前 8 项，超过后提供展开/收起；支持可选 All chip、单选或多选 selected keys、可选 item icon；收起时所有已选隐藏项都补渲保持可达。文案由消费方预翻译传入，组件零 `t()`。新增平台的分类筛选必须复用此组件，不得全量 map `FilterChip`。
- `error-state.tsx` — `ErrorState { title, message, retryLabel, onRetry }`：danger-triangle 图标 + StateBox + outlined 重试按钮。query/sync 失败共用（github/x/zhihu）
- `no-matches-state.tsx` — `NoMatchesState { message }`：StateBox + disabled Typography 单行。`message` 平台特有名词由调用方传（`t('x.noMatches')` 等），维持零 `t()`
- `sync-now-button.tsx` — `SyncNowButton { syncing, onSync, label, variant?='outlined' }`：空态/未登录态内的手动同步按钮（三态 restart 图标 / CircularProgress+disabled）。`contained` 用于同步即主路径的空态（zhihu/github），`outlined` 用于次要（x）
- `sync-progress-bar.tsx` — `SyncProgressBar { value?, caption? }`：顶栏下方进度条。`value==null` → indeterminate（x/zhihu 游标分页），传 0–100 → determinate（github page/totalPages）；`caption` 平台文案由调用方翻译后传入
- `background-jobs-bar.tsx` — `BackgroundJobsBar { captions: string[] }`（ST3）：同步收尾后台任务（embed/tag）的进度 caption 条，每条一行 `CircularProgress size={12}` + `Typography variant="caption"`；`captions` 空数组渲染 null（自隐）。**零 t()**——文案由 view 从 `hook.embedJob/tagJob.progress` 派生并 `t('backgroundJobs.embedding'|'.tagging',{done,total})` 后传入。scaffold 经 `backgroundJobsBar?` slot 消费；4 collection view（x/github/zhihu/youtube）装配
- `collection-page-scaffold.tsx` — `CollectionPageScaffold<T>`（页面级编排，非哑组件）。props 三类：**数据**（items/getRowKey/getTagId/libraryCount/loading/metaLoading/syncing/queryError/hasSyncError/authFailed/page/totalPages/… + onSync/onRetryQuery/onPageChange/searchInput + **可选** syncDisabled?/syncDisabledLabel? 冷却门直传 SectionTitleBar，X 专用其他平台省略）、**文案** `copy: CollectionPageCopy`（预翻译，零 t() 契约）、**slots**（renderCard/renderTaggedCard/skeleton/chips/emptyState/authFailedState?/progressBar?/**backgroundJobsBar?**）。内部：`useCollectionTags` + `resolveCollectionPhase`（由原始信号计算，view 不再手写 phase input）+ 8-case switch + 双 id 映射（`getRowKey` 行 key vs `getTagId` 打标 id）+ 主 grid `TagEditPopover` + `CardGridPagination` + 骨架区（`DashboardContent` → SectionTitleBar → `{syncing && progressBar}` → **`{backgroundJobsBar}`（无条件，节点自隐）** → `{hasSyncError && libraryCount>0 && banner}` → SearchField → `{libraryCount>0 && chips}` → TagFilterChips → content）。**`backgroundJobsBar?`（ST3，可选，向后兼容）**：装 `BackgroundJobsBar`，展示本平台 embed/tag done/total 进度；其他形态平台（bilibili/bookmarks）不传 = 现状不变。为避免 barrel 循环引用，内部从各哑组件文件直接 import（非 `./index`）
- `index.ts` — barrel，消费方单一 import 面

**分支链**：8 分支 phase 顺序（tag-filtered→query-error→auth-failed→sync-error→skeleton→empty-library→no-matches→grid）由纯函数 `resolveCollectionPhase`（`app/hooks/collection-phase.ts`）持有并单测锁定；`CollectionPageScaffold` 消费它并映射到哑组件 + 平台 slot。**两套 popover**：主 grid popover 在 scaffold；`tag-filtered` phase 的 popover 封在 `TaggedItemGrid` 内部（scaffold 该 phase 不渲染主 popover）。**github 无 auth-failed**：省略 `authFailedState` slot，scaffold 在该 phase 回退渲染 `emptyState`（NoTokenState 已在 view 早退，phase 不可达）。

## 消费方（各平台 section adapter）

- `sections/bilibili/`（B站）：bilibili-view（StateBox×3 / SectionTitleBar / SearchField 受控（服务端 keyword 搜当前夹）/ CardGrid+分页）、folder-chips（ChipRowShell+FilterChip，保留 loading 骨架/空态逻辑）、video-grid-skeleton（CardGridSkeleton + Card 媒体骨架）
**scaffold 消费方（4 平台，view 退化为配置门 + 平台状态组件 + slot 装配 ~180-214 行）**：
- `sections/github-stars/`：github-stars-view（**消费 `CollectionPageScaffold`**；配置门 NoTokenState 早退；无 authFailedState → 回退 emptyState；progressBar determinate；RepoGridSkeleton = CardGridSkeleton + rounded 148）、language-chips（ChipRowShell+FilterChip，All chip+色点逻辑）
- `sections/x/`：x-view（**消费 `CollectionPageScaffold`**；无配置门；authFailedState=NotLoggedInState；progressBar 恒 indeterminate）、author-chips（CollapsibleChipRow 薄 adapter）、tweet-grid-skeleton
- `sections/zhihu/`：zhihu-view（**消费 `CollectionPageScaffold`**；无配置门；authFailedState=NotLoggedInState；progressBar indeterminate）、collection-chips（CollapsibleChipRow 薄 adapter）、zhihu-grid-skeleton
- `sections/youtube/`：youtube-view（**消费 `CollectionPageScaffold`**；配置门 NotConnectedState 早退；authFailedState=AuthFailedState；progressBar indeterminate）、playlist-chips（CollapsibleChipRow 薄 adapter）、youtube-grid-skeleton

**哑组件直接消费方（不进 scaffold，形态不同）**：
- `sections/bilibili/`：bilibili-view（服务端 keyword 搜/双 hook）、folder-chips、video-grid-skeleton
- `sections/bookmarks/`：bookmarks-view（SectionTitleBar **无 onSync**，挂载自动同步）、folder-chips、bookmark-grid-skeleton
- `components/tags/`：tagged-item-grid（StateBox minHeight 240 空态 + CardGrid）、tag-filter-chips

平台 N 接入（单列表形态）= `CollectionPageScaffold` + 平台卡片/chips/状态组件/文案，编排零复制。
