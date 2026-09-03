# Collection Analytics Dashboard

默认 `#/` Dashboard 是只读收藏数据分析页，不是后台任务监控器。数据只来自持久化收藏表，禁止模拟指标、队列状态、任务进度或 pause/retry 控制。

2026-09-03（docs/25 Step 6）改成 Minimal analytics 形态：**四张 KPI 卡 + 三张 Card**（构成 / 细分 / Top tags），`Grid spacing={3}`。docs/19 时代的「禁止 KPI 卡片墙 / hairline 单层分区」已被 docs/25 §3.1 推翻——禁的是**编造指标**，不是卡片形态。

## 模块结构

- `use-collection-analytics.ts` — 初始化 DB、取消保护、重试和 `'item-tagged'` 刷新；首个成功非空快照按 Item Count 选择最大平台，注册顺序打破平局，手动选择后刷新不抢焦点
- `overview-view.tsx`（编排，≤200 行）— 路由标题 = 共享 `SectionTitleBar`（`title` + `caption`=subtitle，不传 `links`：`/` 是根，无面包屑），页面唯一 h1；四态 loading/error/empty/data。**`buildKpis(snapshot, t, locale)` 是 KPI 字段映射的唯一 owner**（docs/25 D17）：总条目 `totalItems`(primary) / 在用平台 `filter(itemCount>0).length` + `/ platforms.length`(info) / 已用标签 `usedTags`(warning) / 打标覆盖率 `taggedItems/totalItems`(success，`totalItems===0` 显示 `—` 而不是假 0%，caption 零标签时 `dashboard.noTags`、否则 `dashboard.taggedCount`)。Grid 排布：KPI `{xs:12,sm:6,md:3}` ×4 → 库空态 `{xs:12}` → 构成 `{xs:12,md:6,lg:4}` → 细分 `{xs:12,md:6,lg:8}` → Top tags `{xs:12}`（**空标签时整个 Grid item 不渲染**，条件在编排层，卡内不再自己 return null）
- `analytics-widget-summary.tsx` — `AnalyticsWidgetSummary`：Minimal `AnalyticsWidgetSummary` 去掉 ApexCharts。`Card p:3 height:1 boxShadow:none`，135° 渐变 `varAlpha(<color>.lighterChannel,.48) → varAlpha(<color>.lightChannel,.48)` **压在 `common.white` 底上**（白底是暗色模式不发灰的原因，两 scheme 同值），文字 `<color>.darker`，右上 48px `absolute` 图标，文本块 `pr: 8` 给图标让位。标题 `subtitle2 component="p"`、数值 `h3 component="p"` + `data-slot="kpi-value"`、可选 caption `caption component="p"`（**不加 `opacity`**：Minimal 那句 `.72` 在这张彩卡上把 12px caption 压到 3.48:1（success）/3.66（warning）/3.91（primary），低于 4.5:1；满墨是 6.37–11.40:1。字号已经足够表达层级）。**无 sparkline、无趋势箭头**（无周序列查询，不造数据）
- `analytics-platform-composition.tsx` — `AnalyticsPlatformComposition`：`CardHeader` 标题（`component="h2" variant="h4"`）+ 200px `DonutChart`（中心打印 `totalItems`）→ dashed `Divider` → 六行图例。**图例即选择器**：`Tabs orientation="vertical"`（指示器隐藏，行间距经 `tabsClasses.list`——MUI 9 已无 `MuiTabs-flexContainer`，写那个类名是死 CSS）六个 `Tab`，label 是 `ChartLegendItem`（12px 圆点用 `theme.vars.palette.platform[p]`，与自己那段弧同色）+ `aside` = `data-slot="share-label"` 份额。行 `minHeight 44`、`borderRadius .75`、hover `action.hover`、选中 `varAlpha(primary.mainChannel, .08)` 洗底。**上下堆叠而非左右并排**（用户 2026-09-03 决定）：该卡 `lg` 只有 4/12，1200 视口下卡内仅 ~220px，放不下环图 + 六行标签；Minimal 的 `AnalyticsCurrentVisits` 本来也是堆叠
- `analytics-platform-detail.tsx` — `AnalyticsPlatformDetail`：`role="tabpanel"` 的 Card（与 tablist 分居两张卡，ARIA 按 id 关联，合法）。`CardHeader` = 48px `PlatformTile`（`avatar`）+ 平台名（`component="h2" variant="h4"`）+ `dashboard.itemCount`（`subheader`）+ outlined「查看平台收藏」（`action`）。三态：空平台 `StateBox`（48px 字形）/ 无维度数据一句话 / `AnalyticsDimensionRanking` 网格（**`lg` 起双列**——该卡在 `md` 只有 6/12，双列会把榜单挤成 120px）
- `analytics-dimension-ranking.tsx` — `AnalyticsDimensionRanking` + `DIMENSION_LABELS` / `DIMENSION_ICONS`（`Record<kind, …>` 穷尽，新 kind 在此编译失败）。`h6 component="h3"`（14px 紧凑标题，大纲 h3）+ `<ol>` 榜单，每项标签/计数 + 以首项为 100% 的比例条（`varAlpha(grey500, .64)`）
- `analytics-top-tags.tsx` — `AnalyticsTopTags`：Card + `CardHeader`（h2）+ soft `Chip component={RouterLink}` 整 chip 可点（Step 1 后 Chip 默认 soft，不再写 `variant="outlined"`），label 带 caption 计数。**空态由编排层挡**（见 `overview-view.tsx`）
- `analytics-loading.tsx` — `AnalyticsLoading`：`role="status" aria-busy` + `aria-label`（选择器契约不变）+ 与真实布局同几何的骨架（四张 KPI 卡 / 构成卡 200px 圆 + 六行 / 细分卡 48px 头部 + 两列榜单）。**不换成 `components/loading-screen/`**
- `analytics-format.ts` — `formatNumber(value, locale)` / `formatShare(value, locale)`：本页三处以上共用。locale 显式传入保持纯函数；不进 `app/utils/`（那里明确「非 locale 依赖」），也不进 `lib/i18n`（docs/25 §0.2：本轮不动 `lib/**`），且 analytics 既不要 compact notation 也不要日期
- `overview-view.test.tsx` / `use-collection-analytics.test.tsx` — 守护 loading `role=status` / 错误重试 / 标题经 `SectionTitleBar` + caption / 唯一 `h1` / 大纲 `[1, 2, 2, 3, 2]` 无跳级（KPI 标题是 `<p>` 不进大纲；Export 卡在设置页不在此页，docs/25 C-7）/ 六 Tab 与 `aria-controls` / 空库四值 `['0','0 / 6','0','—']` 且无 `[data-segment]` 弧、六个 `share-label` 都是 `0%` / 有数据四值 `['3','1 / 6','1','66.7%']` 与唯一 `data-segment="github"` / 有数据无维度一句话 / 零标签 caption 与 Top tags 不渲染 / 标签链接 / 选择稳定性
- `export-card.tsx` — 数据导出工具仍由设置页「存储管理」消费，**不属于 Dashboard**；surface 复用 `sections/settings/SettingsPanel`，不自画第二套 Card/Header/Content。**导出结果全走 toast**（docs/25 Step 5）：卡内无 `error` state、无内联 Alert；共享 `run(section, task)` 里 task 返回字符串 = 可行动的拒绝（空库）→ `toast.warning(该具体文案)`，throw = 失败 → `toast.error(t(errorKey(err)))` 保留 `export.dbNotReady`/`export.failed` 的区分，成功 → `toast.success(t('snackbar.exported'))`。`busy` 仍在卡内（持续态，不进 toast）。测试 `export-card.test.tsx`

## 约定

- React 只消费 `@/lib/collections` 的完整 analytics 快照，不导入 entity 或解释 `platform_meta`
- **KPI 卡只允许绑定 `CollectionAnalyticsSnapshot` 字段**（`buildKpis` 一处映射）。无数据显示 `—`，不显示 0 假象；没有时间序列就不画 sparkline、不写趋势百分比——编造一条曲线是对用户自己收藏库的谎言
- 平台标题、路由和图标来自 `collectionPlatformRegistry`；按判别符取单个平台用它导出的 `collectionPlatformById`（**不要在本目录再 `new Map(...)`**——那张 map 曾在三处各建一份）。平台差异用 dimension kind 数据表达（`DIMENSION_LABELS` / `DIMENSION_ICONS` 穷尽），UI 不写平台条件分支
- **字阶**：路由 h1（Barlow 28）→ Card 标题 `component="h2" variant="h4"`（16px，与 `sections/settings/settings-panel.tsx` 同一写法，最接近 Minimal 的 17-18px 卡标题）→ 榜单 `h6 component="h3"`（14px）；KPI 数值是 `h3`(20px) 的 `<p>`。每路由恰一个 h1，heading 不跳级（测试锁定）
- **平台身份 = 品牌色圆点/字形**：图例圆点、48px 详情 tile 都读 `theme.vars.palette.platform[platform]`（六 key 表，github/x 在表里就是 `text.primary`，组件**不写**平台分支）。**选中 = 8% 主色洗底**（`varAlpha(primary.mainChannel, .08)`，跟随色彩预设）；圆点不因选中改色——它要一直和自己那段弧对得上。`PLATFORM_COLORS` 已删，禁止复活语义色当平台色，禁止在组件里写十六进制
- 榜单比例条是次级墨 `varAlpha(grey500, .64)`（维度榜单不上品牌色）；值为 0 不渲染，值 > 0 至少 `minWidth: 4`（最小退化为 4×4 圆点，不出现 1px 假象）。珊瑚只做色块从不做文字；品牌色只做字形/圆点与该平台自己的弧
- 图形不承担信息：环图整块 `aria-hidden`，它显示的每个数字都由图例行或 KPI 卡以文本再打印一遍（`components/chart/CLAUDE.md`）
- tabular numerals 由 `CssBaseline` 全局提供，页面不写 `fontVariantNumeric`；圆角按主题分档 0.5（条）/ 0.75（tile、tab 行）；卡片半径由主题 `--card-radius` 管，页面不改
- 禁止嵌套 Card（KPI 卡与三张 Card 都是顶层 Grid item）、禁止无意义动效
- Top Tag 链接固定为 `/collections?tag=<uuid>`；空数据库仍显示六个平台与真实零值
- `docs/ui-baseline/app-runtime-check.mjs` 的 dashboard 实况探针读 `[data-slot="kpi-value"]`（Step 6 前读 `[data-section="summary"]`）。改 KPI DOM 时同步那处选择器
