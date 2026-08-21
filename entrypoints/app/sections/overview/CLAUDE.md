# Collection Analytics Dashboard

默认 `#/` Dashboard 是只读收藏数据分析页，不是后台任务监控器。数据只来自持久化收藏表，禁止模拟指标、队列状态、任务进度或 pause/retry 控制。

## 模块结构

- `use-collection-analytics.ts` — 初始化 DB、取消保护、重试和 `'item-tagged'` 刷新；首个成功非空快照按 Item Count 选择最大平台，注册顺序打破平局，手动选择后刷新不抢焦点
- `overview-view.tsx` — loading/error/empty/data 四态，「平台账本」主从视图（2026-08-20 重做）：
  - `SummaryBand` — hairline 三格：收藏总量 / 在用平台（`used / total`）/ 标签覆盖率（`taggedItems / totalItems`，caption 带标签数与已打标数，零标签时只给一句解释）。数字 `h3 component="p"`，Barlow 生效（不再覆写 `fontFamily`）
  - `PlatformShelf`（左列 md:4）— 平台构成 **同时** 是选择器：`Tabs orientation="vertical"`（指示器隐藏，选中态靠色块），每个 Tab label 是全 `span` 网格（Tab 是 `<button>`，内部禁止 div/p）：36px `PlatformTile`（品牌色字形，选中翻珊瑚印章）+ 平台名/计数 + 品牌色比例条/份额；`share === 0` 不渲染条
  - `PlatformDetail`（右列 md:8）— `role="tabpanel"`；头部 40px tile + `h6 component="h2"` 平台名 + `dashboard.itemCount` + outlined 「查看平台收藏」；三态：空平台 `StateBox` / 无维度数据一句话 / `DimensionRanking` 两列网格
  - `DimensionRanking` — `subtitle2 component="h3"` + `DIMENSION_ICONS[kind]` 图标 + `<ol>` 榜单，每项标签/计数 + 以首项为 100% 的比例条（`varAlpha(grey500, 0.64)`）；无 hairline 分隔
  - `TopTags` — **仅 `topTags.length > 0` 时渲染**；outlined `Chip component={RouterLink}` 整 chip 可点，label 带 caption 计数
  - `AnalyticsLoading` — 与新布局几何对齐的骨架（三格 / 左列六行 tile / 右列头部 + 两列榜单）
- `overview-view.test.tsx` / `use-collection-analytics.test.tsx` — 守护可访问状态、唯一 `h1`、六 Tab、标签链接、`1 / 6` 与 `66.7%` 摘要值和选择稳定性
- `export-card.tsx` — 数据导出工具仍由设置页「存储管理」消费，不属于 Dashboard

## 约定

- React 只消费 `@/lib/collections` 的完整 analytics 快照，不导入 entity 或解释 `platform_meta`
- 平台标题、路由和图标来自 `collectionPlatformRegistry`；平台差异用 dimension kind 数据表达（`DIMENSION_LABELS` / `DIMENSION_ICONS` 以 `Record<kind, …>` 穷尽），UI 不写平台条件分支
- **平台身份 = 品牌色图标字形 + 品牌色份额条；选中 = 珊瑚 tile + 淡珊瑚底**（2026-08-20）。`PlatformTile` 收 `platform: CollectionPlatform`，未选中字形色与份额条 `bgcolor` 都读 `theme.vars.palette.platform[platform]`（`theme/core/palette.ts` 六 key 表，github/x 在表里就是 `text.primary`，组件**不写**平台分支）；选中 tile 翻成珊瑚印章（`primary.main` 底 + `primary.contrastText` 字形）+ 行底 `primary.lighter`，**份额条不变珊瑚**（始终品牌色）。详情头部 40px tile 同规则；空态 48px 图标仍 `text.secondary`。`PLATFORM_COLORS` 已删，禁止复活语义色（warning/info/error…）当平台色，禁止在组件里写十六进制
- 榜单比例条仍是次级墨 `varAlpha(grey500, 0.64)`（维度榜单不上品牌色）；两族条同一契约：值为 0 不渲染，值 > 0 至少 `minWidth: 4`（一个圆角单位，最小退化为 4×4 圆点，不出现 1px 假象）；珊瑚只做色块，从不做文字；品牌色只做字形与该平台自己的条，从不做文字/背景/选中；`text.disabled` 不给非 disabled 内容
- 页面使用 MUI 主题 token、tabular numerals、稀疏 hairline 和单层分区；禁止 KPI 卡片墙、嵌套 Card、渐变装饰和无意义动效
- Top Tag 链接固定为 `/collections?tag=<uuid>`；空数据库仍显示六个平台与真实零值
