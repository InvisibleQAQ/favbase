# app/components/collection

平台 section 共享展示哑组件 + 页面级编排脚手架（app.html 内共享，同层先例 `components/tags/`、`components/iconify/`）。来源：`docs/14` HIGH-2（哑组件收敛）+ `docs/16` MEDIUM-3（`CollectionPageScaffold` 编排收敛）。

**两级复用**：
1. **哑组件**（state-box/section-title-bar/search-field/card-grid/chip-row/…）——纯展示，各 view 直接消费或经 scaffold 消费。
2. **`CollectionPageScaffold`**（`collection-page-scaffold.tsx`）——六个平台共用的页面级编排。固定「标题/紧凑 pipeline → 搜索 → provider 配置提醒（可选）→ 业务操作（可选）→ 主分类 → 标签 → 次分类（可选）→ 列表」（HEAD `75c42a2` 堆叠；docs/19 P0-1 的三行压缩于 2026-08-20 被用户否决并恢复，只保留色彩与 `role=status`），并持有 tag 接线 + phase 阶梯 + 8-case 渲染 + 双 id 映射 + 主 grid popover/分页；平台只注入 adapter、文案和 slots。
3. **`CollectionCard`**（`collection-card.tsx`）——六平台共用的条目外壳（docs/19 P0-2），平台卡片只装配内容，不允许第七份复制。

**docs/14 曾反对 `CollectionPageFrame` 大一统 frame**（理由：分支顺序有差异、消费方少 3）——`docs/16` 推翻此结论：分支顺序已被纯函数 `resolveCollectionPhase`（+ `collection-phase.test.ts`）消解，消费方涨到 4 且逐字同构。证据变了，结论跟着变。scaffold 接口偏宽（~26 props）但实现更深（隐藏 phase 顺序/双 id/tag 刷新不变量/双 popover 区分/5 个骨架区条件门），不是浅模块。**配置门早退（hasToken/hasConfig）与平台状态组件（Empty/AuthFailed/NotConnected）留在 view**——平台专属，经 slot 注入。

## 铁律（沿用 components/tags）

- 零平台字面量（'bilibili'/'github'）、零平台 lib 导入（grep 可查，prd 验收项）
- 零 `t()` 调用——所有文案（按钮 label、标题、占位符）由消费方翻译后经 props 传入
- 暗色安全：虚线边框用 `varAlpha(grey['500Channel'], 0.24)`，禁止静态 `grey[300]`
- **边界例外（library-gate）**：本目录文件自身仍不得出现 `t()`，但 `collection-page-scaffold.tsx` 允许**导入并渲染**智能模块 `components/library-gate/` 的 `LibraryGateButton` / `useCollectionGate`——翻译发生在那个目录内，进入本目录的只有预翻译字符串（`fetchBlockedHint`）与布尔（`paused`）。不得把这一例外扩大成在哑组件里直接调 `t()`。

## 模块结构

- `state-box.tsx` — `StateBox`：虚线空态/错误框。结构化 props `icon`（ReactNode，调用方控制颜色/边距）/ `title`（包 h6）/ `description`（包 body2 secondary 居中 maxWidth 400）/ `action`（ReactNode，调用方控制按钮 variant/loading）+ `minHeight`（默认 320）+ `children` 逃生口（纯文字空态如 NoMatches、EmptyFolder 的自定义 Typography）
- `section-title-bar.tsx` — `SectionTitleBar`：标题行（`variant="h5" component="h1"` title——视觉 h5、语义是页面唯一 h1——loading 时传 Skeleton——+ caption（`text.secondary`）+ spacer + **可选**获取按钮，`variant="contained"` 经主题即深墨底白字；`mb: 2`）。三件套 `onSync/syncLabel/syncingLabel` 全可选：传 `onSync` 才渲染按钮（三态：syncing 时 CircularProgress+syncingLabel+disabled，否则 restart 图标+syncLabel）。六平台按钮文案统一为 `pipeline.fetchNow`/`pipeline.fetching`（view 翻译后传入）。**可选禁用门 `syncDisabled?`/`syncDisabledLabel?`/`syncDisabledTooltip?`**：`syncDisabled` 时按钮硬禁用（`disabled=syncing||syncDisabled`）+ 显示 `syncDisabledLabel`（缺省回退 `syncLabel`）；`syncDisabledTooltip` 存在时用 Tooltip 包裹（disabled Button 需 `<span>` wrapper）解释禁用原因——闸门暂停走 tooltip（label 保持「立即获取」），X 冷却走 `syncDisabledLabel` 倒计时
- `search-field.tsx` — `SearchField`：全宽默认尺寸（56px）搜索框 + `eva:search-fill` adornment（`text.secondary`）。受控（value+onChange）或禁用占位（disabled）两态；自带 `mb: 3`，可选 `sx` 在其后合并覆盖（scaffold 不传）
- `card-grid.tsx` — `CardGrid`（container spacing 2.5）+ `CardGridItem`（断点 xs12/sm6/md4/lg3 唯一事实源 `CARD_SIZE`）+ `CardGridPagination`（居中分页，totalPages≤1 返回 null）+ `CardGridSkeleton({ card })`（grid-of-8 外壳，卡片内部由各平台传入——保留平台骨架形态差异）
- `chip-row.tsx` — `ChipRowShell`（icon+subtitle2 加粗标题头部 + 可选 `headerExtra`（如清除按钮）+ flexWrap chip 行容器；自带 `mb: 3`，可选 `sx` 在其后合并覆盖）+ `FilterChip`（选中 = 珊瑚印章 filled primary + 深墨 contrastText / 未选 outlined default 细线 + 可选 `maxWidth` 省略号截断 + 可选 `icon`（如语言色点））
- `collection-card.tsx` — `CollectionCard`：条目外壳。props 全结构化、零 `t()`、零平台字面量：`href?`（真实 `<a target=_blank rel=noopener noreferrer>`，中键/Ctrl 可用；无 href 或 `disabled` 时渲染 div 并灰显）、`media?: { src?, alt, fallbackIcon, aspect: '16/9'|'1/1'|'none', overlay? }`（`16/9` 顶部全宽封面；`1/1` 72px 方缩略图放在**标题/正文块右侧、header 行之下**——识别行（头像+作者）永远独占整个内容宽度，缩略图绝不与它同行（2026-08-20 浏览器复核修正）；`none` 不渲染；`onError` → 隐藏 img 显示平台字形占位，底 `background.neutral` 两模式可用；`overlay` 放 `CoverBadge` 时长/播放量角标）、`header?`（头像+作者行）、`title`（`subtitle2` → `p`，`titleLines` 2|3 clamp + `title` tooltip）、`body?`（描述/摘要）、`meta?` + `date?`（外壳用 `grid-template-columns: 1fr auto`，日期 `noWrap` + `title` 永不被挤压，颜色 `text.secondary` 非 disabled）、`stats?` + `stamp?`（计数行 + 行尾平台/类型印章）、`tags?`（**链接之外**；缺省整行不渲染）、`footer?`（链接之外的平台操作栏，如 B站转录）。外壳统一：`height: 1` 等高、1px divider 细线零阴影、圆角 ×3、整卡 hover = `background.neutral`（120ms）、隐藏 CardActionArea 自带 focusHighlight。`CoverBadge { align }`：caption 字号黑 scrim 白字角标。测试 `collection-card.test.tsx`（锚点/禁用/空行不渲染/日期格/破图回退/tags+footer 在链接外）
- `collapsible-chip-row.tsx` — `CollapsibleChipRow<T>`：所有高基数分类/tag 筛选的共享折叠契约。默认显示前 8 项，超过后提供展开/收起；支持可选 All chip、单选或多选 selected keys、可选 item icon；收起时所有已选隐藏项都补渲保持可达。文案由消费方预翻译传入，组件零 `t()`。新增平台的分类筛选必须复用此组件，不得全量 map `FilterChip`。
- `error-state.tsx` — `ErrorState { title, message, retryLabel, onRetry }`：danger-triangle 图标 + StateBox + outlined 重试按钮。query/sync 失败共用（github/x/zhihu）
- `no-matches-state.tsx` — `NoMatchesState { message }`：StateBox + disabled Typography 单行。`message` 平台特有名词由调用方传（`t('x.noMatches')` 等），维持零 `t()`
- `sync-now-button.tsx` — `SyncNowButton { syncing, onSync, label, variant?='outlined' }`：空态/未登录态内的手动获取按钮（三态 restart 图标 / CircularProgress+disabled），label 统一传 `t('pipeline.fetchNow')`。`contained` 用于获取即主路径的空态（zhihu/github/youtube），`outlined` 用于次要（x）
- `pipeline-progress-strip.tsx` — `PipelineProgressStrip`：单行、可横向滚动的 micro-segment strip；已知正分母显示整数百分比，未知/零分母不伪造百分比，Fetch 可用显式 lifecycle `100%` 保留本次完成值。**纯展示，无段级控件**——暂停/继续收敛到 per-platform 闸门按钮（`components/library-gate/`，由 scaffold 持有）；外边距（mb）由 scaffold 的 pipeline 行统一持有，strip 自身无 mb。只渲染预翻译 label 与判别状态，零平台知识、零 `t()`。文字色契约：活动段 `text.accent`、失败 `error.dark`（暗色 `error.light`）、其余 `text.secondary`——珊瑚与 `error.main` 只落在进度条填充（色块），不做文字。
- `sync-progress-bar.tsx` / `background-jobs-bar.tsx` — 旧 slot 的兼容展示模块；六个平台 Collection view 已迁移到 pipeline，不得用于新页面。
- `collection-page-scaffold.tsx` — `CollectionPageScaffold<T>`（页面级编排，非哑组件）。`pipeline?` 位于标题后且常驻（`data-section="pipeline"` 行 = strip `flex:1 minWidth:0` + 闸门按钮，`mb: 2`）；`configurationNotice?` 是预构造 React slot，固定紧跟 Search，scaffold 不读取 provider 配置、不调用 `t()`。scaffold 内部读 `useCollectionGate(platform)`；旧 `progressBar/backgroundJobsBar` 仅作未迁移调用方 fallback。数据/phase/tag/grid 与 `page|primary-category` scope 语义不变。同步失败横幅文字色 `error.dark`（暗色 `error.light`），不用 `error.main`。契约测试 `collection-page-scaffold.test.tsx` 锁定 title → pipeline → search → notice → operation → primary → tags → secondary → content 顺序。
- `index.ts` — barrel，消费方单一 import 面

**分支链**：8 分支 phase 顺序（tag-filtered→query-error→auth-failed→sync-error→skeleton→empty-library→no-matches→grid）由纯函数 `resolveCollectionPhase`（`app/hooks/collection-phase.ts`）持有并单测锁定；`CollectionPageScaffold` 消费它并映射到哑组件 + 平台 slot。**两套 popover**：主 grid popover 在 scaffold；`tag-filtered` phase 的 popover 封在 `TaggedItemGrid` 内部（scaffold 该 phase 不渲染主 popover）。**github 无 auth-failed**：省略 `authFailedState` slot，scaffold 在该 phase 回退渲染 `emptyState`（NoTokenState 已在 view 早退，phase 不可达）。

## 消费方（各平台 section adapter）

- `sections/bilibili/`（B站）：bilibili-view（scaffold adapter + 服务端 keyword 搜当前夹 + 转录/排序 slots；排序三选作为 `secondaryCategory` 独占一行）、folder-chips（ChipRowShell+FilterChip，保留 loading 骨架/空态逻辑）、video-grid-skeleton（CardGridSkeleton + Card 媒体骨架）
**scaffold 消费方（六平台）**：
- `sections/github-stars/`：github-stars-view（**消费 `CollectionPageScaffold`**；配置门 NoTokenState 早退；无 authFailedState → 回退 emptyState；progressBar determinate；RepoGridSkeleton = CardGridSkeleton + rounded 148）、language-chips（ChipRowShell+FilterChip，All chip+色点逻辑）
- `sections/x/`：x-view（**消费 `CollectionPageScaffold`**；无配置门；authFailedState=NotLoggedInState；progressBar 恒 indeterminate）、author-chips（CollapsibleChipRow 薄 adapter）、tweet-grid-skeleton
- `sections/zhihu/`：zhihu-view（**消费 `CollectionPageScaffold`**；无配置门；authFailedState=NotLoggedInState；progressBar indeterminate）、collection-chips（CollapsibleChipRow 薄 adapter）、zhihu-grid-skeleton
- `sections/youtube/`：youtube-view（**消费 `CollectionPageScaffold`**；配置门 NotConnectedState 早退；authFailedState=AuthFailedState；progressBar indeterminate）、playlist-chips（CollapsibleChipRow 薄 adapter）、youtube-grid-skeleton

**平台特有 slot**：
- `sections/bilibili/`：AutoTranscribe 与服务端排序均为 `primary-category` scope；标签结果接管时自隐。AutoTranscribe idle 态返回 null（不占行）。
- `sections/bookmarks/`：正文提取为 page scope；标题栏与其他平台同构显示「立即获取」按钮（挂载自动同步保留，`startJob` 去重使按钮与 auto-sync 互不冲突）。
- `components/tags/`：tagged-item-grid（StateBox minHeight 240 空态 + CardGrid）、tag-filter-chips

平台 N 接入（单列表形态）= `CollectionPageScaffold` + `CollectionCard` 装配的平台卡片 + chips/状态组件/文案，编排与卡片外壳零复制。
