# app/components/collection

平台收藏页共享的展示哑组件 + 页面级编排 `CollectionPageScaffold` + 条目外壳 `CollectionCard`。平台接入（单列表形态）= scaffold + 用 `CollectionCard` 装配的卡片 + `CollectionCardSkeleton` 形态参数 + chips / 状态 / 文案；编排、卡片外壳与骨架不得再复制一份。

## 铁律

- 零平台字面量、零平台 lib 导入。
- 零 `t()` 调用：所有文案由消费方翻译后经 props 传入。
- 只消费 semantic token（`text.*` / `background.*` / `divider` / `action.*` / `varAlpha(channel)`），不散落 hex / rgba / 字号 / 圆角。状态文案不用 `text.disabled`（信息不是禁用）。
- 垂直节奏 24px：标题栏、pipeline 行、同步失败横幅、搜索框、chip 行各自以 `mb: 3` 收尾，grid gap 也是 24。

## 边界例外

三个具名智能模块，只给 `collection-page-scaffold.tsx` import；本目录文件自身仍不得出现 `t()`：

1. `components/tags/` 的 `useCollectionTags` / `TagFilterChips` / `TaggedItemGrid` / `TagEditPopover`——它们自己渲染带译文的 chip 行、标签网格与编辑 popover，不往本目录交字符串。
2. `components/library-gate/` 的 `LibraryGateButton` / `useCollectionGate`——进入本目录的只有预翻译字符串与布尔。
3. `components/collection-states/use-collection-chrome-copy.ts` 的 `useCollectionChromeCopy`——进入本目录的只有预翻译的外壳文案。直接 import 叶文件，不经 `collection-states` barrel：barrel 会把 react-router、设置页路由表与 Iconify 拖进 scaffold 的模块图。

翻译发生在那三个目录内。不得把例外扩大成在哑组件里直接调 `t()`，也不得给第四个模块开口子而不在这里具名。

## Scaffold

- 区块顺序固定：标题 → pipeline → 搜索 → 配置提醒 → 业务操作 → 主分类 → 标签 → 次分类 → 列表（`collection-page-scaffold.test.tsx` 锁定）。三行压缩布局被用户否决过，别重提（docs/19 P0-1）。
- phase 顺序归纯函数 `resolveCollectionPhase`（`entrypoints/app/hooks/collection-phase.ts`），scaffold 只把 phase 映射到哑组件与平台 slot；不要在 scaffold 或 view 里另写分支。
- 配置门早退（凭据未配置）留在 view，不进 scaffold；早退页面仍用 `SectionTitleBar` 保住单 h1。
- 平台状态（库空 / 未登录 / 需配置）由 view 构造、经 slot 注入，scaffold 不认识它们。省略 `authFailedState` 时该 phase 回退渲染 `emptyState`。
- 两套 popover：主 grid 的 popover 在 scaffold；`tag-filtered` phase 的 popover 封在 `TaggedItemGrid` 内，该 phase scaffold 不渲染主 popover。
- `configurationNotice` 是预构造的 slot：scaffold 不读 provider 配置。
- `CollectionPageCopy` 只放各平台不同的文案。逐字相同的外壳文案（获取按钮两态、错误态标题与重试、同步失败横幅）由 scaffold 经 `useCollectionChromeCopy` 自取，不要加回 copy 字段。
- 同步失败横幅只在 `hasSyncError && libraryCount > 0` 时渲染（库空时走 sync-error phase）；文字色 `error.dark`（暗色 `error.light`），不用 `error.main`。
- `breadcrumbs` 原样转给 `SectionTitleBar links`：scaffold 不构造也不翻译祖先路径。
- slot 的 scope：`primary-category` scope 的区块在标签筛选接管时隐藏，`page` scope 常驻。
- `progressBar` / `backgroundJobsBar` 两个 slot 与 `sync-progress-bar.tsx` / `background-jobs-bar.tsx` 是 pipeline 之前的遗留，已无调用方；新页面一律用 `pipeline`。

## 标题栏与面包屑

- 标题是页面唯一的 h1。传 `links` 时委托 `components/custom-breadcrumbs/`，不传时是 h1 + caption 堆叠；两条路径的 `data-section="title"`、`data-slot="caption"`、单 h1、action 槽必须一致。
- crumb 的 `href` 写路由相对路径（`'/'`），不写 `'#/'`。
- 收藏路由的祖先由 `entrypoints/app/hooks/use-collection-breadcrumbs.ts` 派生，view 不手写 crumb（`tests/platform-completeness-contract.test.ts` 逐平台断言 view 调用了它）。末项文案与加不加级的规则在 `entrypoints/app/hooks/CLAUDE.md`。
- 禁用的获取按钮要解释原因时，Tooltip 必须包一层 `<span>`（disabled Button 不触发事件）。闸门暂停走 tooltip、label 不变；冷却走 `syncDisabledLabel` 倒计时。

## 卡片

- `CollectionCard` 的 `tags` 与 `footer` 渲染在链接之外，防误触跳转。链接之外的行一律用 `CollectionCardRow`——它是这些行内边距的唯一 owner，别处不写 `px` / `pb`。
- `1/1` 缩略图放在标题 / 正文块右侧、header 行之下：识别行（头像 + 作者）永远独占整个内容宽度，缩略图不得与它同行。
- `disabled` 不做整卡 opacity：正文对比度不得降到 disabled 档，只对媒体去色降透明、标题降到 `text.secondary`。
- focus ring 内缩 2px：卡片 `overflow: hidden` 会裁掉外扩的 ring。
- 骨架用 `CollectionCardSkeleton` 选形态参数，与真实卡片同解剖；平台骨架文件不自画 Card 与高度。
- `CARD_GRID_SIZE` 是卡片网格断点的唯一事实源。

## Chips

- `FilterChip` 未选态不写 `variant`，吃主题默认 soft（写 `outlined` 才是覆盖）；选中态是 filled primary，归它独家持有。
- `collapsible-chip-row.tsx` 的展开 / 收起 chip 刻意保留 `outlined`：它是行上的动作，不是又一个可选值。
- 高基数的分类 / tag 筛选必须复用 `CollapsibleChipRow`，不得全量 map `FilterChip`；收起时已选的隐藏项要补渲保持可达。一维带计数的单选 facet 直接用 `components/collection-states/` 的 `FacetChips`。
- chip 行头部图标颜色归 `ChipRowShell`（`text.secondary`），平台不得局部指定品牌色或主色。

## 其它哑组件

- `StateBox` 是 `components/empty-content/` 的薄适配层；标题是 `<p>`，永不是 heading。空态 / 错误 / 无匹配共用同一个密度。
- `SearchField` 不写尺寸，高度由主题的输入框目标决定；`placeholder` 同时是它的可访问名。
- `PipelineProgressStrip` 纯展示、无段级控件：暂停 / 继续归 `components/library-gate/`，由 scaffold 放在 pipeline 行尾。它自身不带 `mb`，外边距归 scaffold 的 pipeline 行。未知或零分母不伪造百分比。
- strip 的文字色：活动段 `text.accent`、失败 `error.dark`（暗色 `error.light`）、其余 `text.secondary`。珊瑚与 `error.main` 只做进度条填充，不做文字。
- `SyncNowButton` 的唯一消费方是 `components/collection-states/`；变体只有 `contained` / `soft`，由那里按规则选。
