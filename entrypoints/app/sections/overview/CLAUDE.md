# Collection Analytics Dashboard

默认 `#/` Dashboard：只读的收藏数据分析页，不是后台任务监控器。形态是四张 KPI 卡 + 构成 / 细分 / Top tags 三张 Card（Minimal analytics）。

## 约束

- 数据只来自持久化收藏表：禁止模拟指标、队列状态、任务进度或 pause/retry 控制。禁的是编造指标，不是卡片形态。
- React 只消费 `@/lib/collections` 的完整 analytics 快照，不导入 entity，也不解释 `platform_meta`。
- KPI 字段映射只有一个 owner：`overview-view.tsx` 的 `buildKpis`，只许绑定 `CollectionAnalyticsSnapshot` 的字段。
- 无数据显示 `—`，不显示假 0%；没有时间序列查询，所以不画 sparkline、不写趋势百分比——编造曲线是对用户自己收藏库的谎言。
- 平台标题、路由、图标来自 `collectionPlatformRegistry`；按判别符取单个平台用它导出的 `collectionPlatformById`，不要在本目录再 `new Map(...)`。
- 平台差异只用 dimension kind 表达（`DIMENSION_LABELS` / `DIMENSION_ICONS` 是穷尽 `Record`，新 kind 在此编译失败），UI 不写平台条件分支；空库仍列出全部平台与真实零值。
- 平台色只读 `theme.vars.palette.platform[platform]`：组件里不写十六进制、不写平台分支、不拿语义色当平台色。
- 图例圆点不因选中改色（它要一直和自己那段弧对得上）；选中态是 8% 主色洗底。维度榜单的比例条用次级灰，不上品牌色。
- 图表原语不认识平台（`entrypoints/app/components/chart/CLAUDE.md`）：环图整块 `aria-hidden`，它显示的每个数字都要由图例行或 KPI 卡以文本再打印一遍。
- 榜单比例条：值为 0 不渲染，值大于 0 至少 4px 宽，不出现 1px 假象。
- 每路由恰一个 h1（共享 `SectionTitleBar`；`/` 是根，不传 `links`），heading 不跳级：Card 标题 `component="h2" variant="h4"`，榜单标题是 h3，KPI 标题是 `<p>` 不进大纲。`overview-view.test.tsx` 锁。
- Top tags 为空时整个 Grid item 不渲染，条件在编排层，卡内不自己 return null；Top Tag 链接固定 `/collections?tag=<uuid>`。
- 首个非空快照默认选中条目数最多的平台（注册顺序打破平局）；用户手动选择后，刷新不抢焦点。
- 禁止嵌套 Card（KPI 卡与三张 Card 都是顶层 Grid item），禁止无意义动效。
- `AnalyticsLoading` 是与真实布局同几何的骨架，不要换成 `components/loading-screen/`。
- `analytics-format.ts` 留在本目录：它是显式收 locale 的纯函数，不进 `app/utils/`（那里只放不依赖 locale 的工具）。
- `export-card.tsx` 住在本目录但不属于 Dashboard：只由设置页「存储」消费，surface 复用 `sections/settings/settings-panel.tsx`。导出结果走 toast，`busy` 是持续态，留在卡内。

### 刻意的视觉决定

- KPI 数值是固定字阶的窄例外：`[data-slot="kpi-value"]` 照搬 Minimal `h4`、随断点变字号，覆盖只写在调用点，主题阶梯不动（`.trellis/spec/frontend/ui-design-system.md` §5，docs/31 Step 5）。别推广到其他调用点，也别"修回"固定字阶。
- KPI 卡的渐变压在 `common.white` 底上，两个 scheme 同值——白底是暗色模式下不发灰的原因。
- KPI caption 不加 Minimal 的 `opacity: .72`：在彩卡上 12px 文字的对比度会跌破 4.5:1。
- 构成卡的环图与图例上下堆叠，不左右并排（用户决定）：该卡在 `lg` 只占 4/12，放不下并排。
- 构成卡的图例即平台选择器：竖向 `Tabs`，隐藏指示条 + 选中洗底。它与设置页 `SectionRail` 的下划线形态刻意不统一，禁止顺手统一（spec §11 Vertical Tabs）。
- 细分卡的榜单从 `lg` 起才双列：`md` 时该卡只有 6/12，双列会把榜单挤扁。

## 坑

- 骨架数字行的高度走 `sx` 而不是 `height` prop：prop 是内联 style，会压过响应式的 `sx`。
- `docs/ui-baseline/app-runtime-check.mjs` 的 dashboard 探针读 `[data-slot="kpi-value"]`，改 KPI DOM 时同步那处选择器。
