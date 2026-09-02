# Collection Analytics Dashboard

默认 `#/` Dashboard 是只读收藏数据分析页，不是后台任务监控器。数据只来自持久化收藏表，禁止模拟指标、队列状态、任务进度或 pause/retry 控制。

## 模块结构

- `use-collection-analytics.ts` — 初始化 DB、取消保护、重试和 `'item-tagged'` 刷新；首个成功非空快照按 Item Count 选择最大平台，注册顺序打破平局，手动选择后刷新不抢焦点
- `overview-view.tsx` — loading/error/empty/data 四态，「平台账本」主从视图（2026-08-20 重做；2026-08-28 docs/23 Phase 4 套上 Phase 1-3 token/primitives）：
  - 路由标题 = 共享 `SectionTitleBar`（`title` + `caption`=subtitle），页面唯一 h1（Barlow 700 / 28px）；不再自画 `<header>`。加载与错误态标题照常渲染
  - `SummaryBand`（`data-section="summary"`）— hairline 三格：收藏总量 / 在用平台（`used / total`）/ 标签覆盖率（`taggedItems / totalItems`，caption 带标签数与已打标数，零标签时只给一句解释）。数字 `h3 component="p"`（Barlow 600 / 20px，是数字不是标题）；上下边与格间线全部读 `theme.vars.palette.divider`
  - `PlatformShelf`（`lg` 起左列 4/12，`lg` 以下全宽堆叠在详情之上——pinned 300px 侧栏下 1024 视口内容区只有 676px，4/12 分栏会截断平台名）— `h2` 区块标题 + 平台构成 **同时** 是选择器：`Tabs orientation="vertical"`（指示器隐藏，选中态靠色块），每个 Tab label 是全 `span` 网格（Tab 是 `<button>`，内部禁止 div/p）：36px `PlatformTile`（品牌色字形，选中翻珊瑚印章）+ 平台名/计数 + 品牌色比例条（`data-slot="share-bar"`）/份额；`share === 0` 不渲染条。行 `borderRadius 0.75`、`minHeight 56`、hover `action.hover`、选中 8% 品牌洗底（`varAlpha(primary.mainChannel, 0.08)`）；主题已接管 tab 字体（`textTransform`/`opacity` 不再本地覆写）
  - `PlatformDetail`（`lg` 起右列 8/12，以下全宽，与 shelf 之间 hairline）— `role="tabpanel"`；头部 48px tile + `h2` 平台名 + `dashboard.itemCount` + outlined 「查看平台收藏」；三态：空平台 `StateBox`（48px 字形）/ 无维度数据一句话 / `DimensionRanking` 两列网格（`md` 起双列）
  - `DimensionRanking` — `h6 component="h3"`（14px 紧凑标题，大纲层级 h3）+ `DIMENSION_ICONS[kind]` 图标 + `<ol>` 榜单，每项标签/计数 + 以首项为 100% 的比例条（`varAlpha(grey500, 0.64)`）；无 hairline 分隔
  - `TopTags` — **仅 `topTags.length > 0` 时渲染**；`Divider` + `h2` 标题；outlined `Chip component={RouterLink}` 整 chip 可点，label 带 caption 计数
  - `AnalyticsLoading` — `role="status" aria-busy` + 与真实布局同几何的骨架（hairline 三格 / 左列 h2 行 + 六行 36px tile / 右列 48px 头部 + 两列榜单）
  - 节奏：区块之间 `SECTION_GAP = 4`（32px：band → 两列、`Divider my`、库空态 `mt`），区块内部沿用共享 24px（`SectionTitleBar mb 3`、详情头部 `mb 3`、h2 `mb 2`）
- `overview-view.test.tsx` / `use-collection-analytics.test.tsx` — 守护 loading `role=status` / 错误重试 / 标题经 `SectionTitleBar` + caption / 唯一 `h1` / 标题大纲 `[1, 2, 2, 3, 2]` 无跳级 / 六 Tab 与 `aria-controls` / 零份额无条、部分平台=0 时 tabpanel 空态 / 有数据无维度一句话 / 零标签 caption 与 Top tags 不渲染 / `1 / 6` 与 `66.7%` 摘要值 / 标签链接 / 选择稳定性
- `export-card.tsx` — 数据导出工具仍由设置页「存储管理」消费，不属于 Dashboard；surface 复用 `sections/settings/SettingsPanel`，不自画第二套 Card/Header/Content

## 约定

- React 只消费 `@/lib/collections` 的完整 analytics 快照，不导入 entity 或解释 `platform_meta`
- 平台标题、路由和图标来自 `collectionPlatformRegistry`；平台差异用 dimension kind 数据表达（`DIMENSION_LABELS` / `DIMENSION_ICONS` 以 `Record<kind, …>` 穷尽），UI 不写平台条件分支
- **字阶按 docs/23 §7.4**：路由 h1（28）→ 区块 h2（Barlow 24）→ 榜单 h3（`h6` 变体 14px）；summary 数字是 `h3` 变体的 `<p>`，Card/榜单标题不自动成 heading；每路由恰一个 h1，heading 不跳级（测试锁定）
- **平台身份 = 品牌色图标字形 + 品牌色份额条；选中 = 主色 tile + 8% 主色洗底**（2026-08-20；洗底 2026-09-01 改为 `varAlpha(primary.mainChannel, 0.08)`，跟随色彩预设）。`PlatformTile` 收 `platform: CollectionPlatform`，未选中字形色与份额条 `bgcolor` 都读 `theme.vars.palette.platform[platform]`（`theme/core/palette.ts` 六 key 表，github/x 在表里就是 `text.primary`，组件**不写**平台分支）；选中 tile 翻成主色印章（`primary.main` 底 + `primary.contrastText` 字形）+ 行底 8% 品牌洗，**份额条不变主色**（始终品牌色）。详情头部 48px tile 同规则；空态 48px 图标仍 `text.secondary`。`PLATFORM_COLORS` 已删，禁止复活语义色（warning/info/error…）当平台色，禁止在组件里写十六进制
- 榜单比例条仍是次级墨 `varAlpha(grey500, 0.64)`（维度榜单不上品牌色）；两族条同一契约：值为 0 不渲染，值 > 0 至少 `minWidth: 4`（一个圆角单位，最小退化为 4×4 圆点，不出现 1px 假象）；珊瑚只做色块，从不做文字；品牌色只做字形与该平台自己的条，从不做文字/背景/选中；`text.disabled` 不给非 disabled 内容
- hairline 唯一来源是 `theme.vars.palette.divider`（本地 `hairline(theme)` 只是拼 `1px solid`），不再有页面私有 alpha；圆角按主题分档 0.5（条）/ 0.75（tile、tab 行）；tabular numerals 由 `CssBaseline` 全局提供，页面不写 `fontVariantNumeric`
- 页面使用 MUI 主题 token、稀疏 hairline 和单层分区；禁止 KPI 卡片墙、嵌套 Card、渐变装饰和无意义动效
- Top Tag 链接固定为 `/collections?tag=<uuid>`；空数据库仍显示六个平台与真实零值
