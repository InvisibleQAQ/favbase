# app/components/collection

平台 section 共享展示哑组件（app.html 内共享，同层先例 `components/tags/`、`components/iconify/`）。来源：`docs/14_multi-platform-cohesion-audit.md` HIGH-2——两个平台 view 之间 ~200 行结构等价脚手架复制且已分叉（暗色修复只落 github 一侧），抽哑组件收敛。**只抽哑组件，不做 `CollectionPageFrame` 大一统框架**（审计明确反对：两 view 内容分支顺序/chips 显隐/进度条种类不同，强行统一会造出接口和实现一样宽的浅模块）。各平台 view 保留自己的编排，只消费哑组件。

## 铁律（沿用 components/tags）

- 零平台字面量（'bilibili'/'github'）、零平台 lib 导入（grep 可查，prd 验收项）
- 零 `t()` 调用——所有文案（按钮 label、标题、占位符）由消费方翻译后经 props 传入
- 暗色安全：虚线边框用 `varAlpha(grey['500Channel'], 0.24)`，禁止静态 `grey[300]`

## 模块结构

- `state-box.tsx` — `StateBox`：虚线空态/错误框。结构化 props `icon`（ReactNode，调用方控制颜色/边距）/ `title`（包 h6）/ `description`（包 body2 secondary 居中 maxWidth 400）/ `action`（ReactNode，调用方控制按钮 variant/loading）+ `minHeight`（默认 320）+ `children` 逃生口（纯文字空态如 NoMatches、EmptyFolder 的自定义 Typography）
- `section-title-bar.tsx` — `SectionTitleBar`：标题行（h5 title——loading 时传 Skeleton——+ caption + spacer + **可选**同步按钮）。同步三件套 `onSync/syncLabel/syncingLabel` 全可选：传 `onSync` 才渲染按钮（三态：syncing 时 CircularProgress+syncingLabel+disabled，否则 restart 图标+syncLabel）；省略则无按钮（如 bookmarks 挂载自动同步）
- `search-field.tsx` — `SearchField`：全宽搜索框 + `eva:search-fill` adornment。受控（value+onChange）或禁用占位（disabled）两态
- `card-grid.tsx` — `CardGrid`（container spacing 2.5）+ `CardGridItem`（断点 xs12/sm6/md4/lg3 唯一事实源 `CARD_SIZE`）+ `CardGridPagination`（居中分页，totalPages≤1 返回 null）+ `CardGridSkeleton({ card })`（grid-of-8 外壳，卡片内部由各平台传入——保留平台骨架形态差异）
- `chip-row.tsx` — `ChipRowShell`（icon+subtitle2 加粗标题头部 + 可选 `headerExtra`（如清除按钮）+ flexWrap chip 行容器）+ `FilterChip`（选中 filled primary / 未选 outlined default + 可选 `maxWidth` 省略号截断 + 可选 `icon`（如语言色点））
- `collapsible-chip-row.tsx` — `CollapsibleChipRow<T>`：无界 chip 行（作者/收藏夹类）。ChipRowShell + "All" chip + 每项 FilterChip，超过 `collapsedCount`（默认 12）折叠并出 show-more/less 切换；选中项被折叠时补渲一枚保持可达。泛型注入 `items/getKey/getLabel/icon/title/allLabel/selected/onSelect/showMoreLabel(overflow)/showLessLabel`，维持零 `t()`（文案调用方翻译后传入，`showMoreLabel` 是 `(n)=>string` 承接 `{n}`）。消费方：x `author-chips`、zhihu `collection-chips`
- `error-state.tsx` — `ErrorState { title, message, retryLabel, onRetry }`：danger-triangle 图标 + StateBox + outlined 重试按钮。query/sync 失败共用（github/x/zhihu）
- `no-matches-state.tsx` — `NoMatchesState { message }`：StateBox + disabled Typography 单行。`message` 平台特有名词由调用方传（`t('x.noMatches')` 等），维持零 `t()`
- `sync-now-button.tsx` — `SyncNowButton { syncing, onSync, label, variant?='outlined' }`：空态/未登录态内的手动同步按钮（三态 restart 图标 / CircularProgress+disabled）。`contained` 用于同步即主路径的空态（zhihu/github），`outlined` 用于次要（x）
- `sync-progress-bar.tsx` — `SyncProgressBar { value?, caption? }`：顶栏下方进度条。`value==null` → indeterminate（x/zhihu 游标分页），传 0–100 → determinate（github page/totalPages）；`caption` 平台文案由调用方翻译后传入
- `index.ts` — barrel，消费方单一 import 面

**分支链不在本目录**：8 分支内容 phase 的顺序（tag-filtered→query-error→auth-failed→sync-error→skeleton→empty-library→no-matches→grid）由纯函数 `resolveCollectionPhase`（`app/hooks/collection-phase.ts`）持有并单测锁定，各 view `switch(phase)` 映射到本目录哑组件 + 平台卡片。本目录仍只出哑组件，不做 `CollectionPageFrame` 大一统 frame。

## 消费方（3 组 adapter）

- `sections/bilibili/`（B站）：bilibili-view（StateBox×3 / SectionTitleBar / SearchField 受控（服务端 keyword 搜当前夹）/ CardGrid+分页）、folder-chips（ChipRowShell+FilterChip，保留 loading 骨架/空态逻辑）、video-grid-skeleton（CardGridSkeleton + Card 媒体骨架）
- `sections/github-stars/`：github-stars-view（StateBox×4 / SectionTitleBar / SearchField 受控 / CardGrid+分页 / CardGridSkeleton + rounded 平板）、language-chips（ChipRowShell+FilterChip，保留 All chip+色点逻辑）
- `sections/bookmarks/`：bookmarks-view（StateBox×3 / SectionTitleBar **无 onSync 无按钮** / SearchField 受控 / CardGrid+分页）、folder-chips（ChipRowShell+FilterChip，All chip+文件夹名）、bookmark-grid-skeleton（CardGridSkeleton + rounded 96）
- `sections/x/`：x-view（StateBox×4 / SectionTitleBar 手动 onSync / SearchField 受控 / CardGrid+分页 / SyncProgressBar 恒 indeterminate）、author-chips（CollapsibleChipRow 薄 adapter，注入作者类型/twitter icon/x.* i18n key/label）、tweet-grid-skeleton（CardGridSkeleton + rounded 200）
- `sections/zhihu/`：zhihu-view、collection-chips（CollapsibleChipRow 薄 adapter，注入收藏夹类型/zhihu icon/zhihu.* i18n key/label）
- `components/tags/`：tagged-item-grid（StateBox minHeight 240 空态 + CardGrid）、tag-filter-chips（ChipRowShell headerExtra 清除按钮 + FilterChip）

平台 N 接入 = 编排自己的 view + 提供平台卡片，脚手架零复制。
