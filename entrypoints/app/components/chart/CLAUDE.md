# app/components/chart

零依赖图表原语（docs/25 Step 6 / D3：**不引 ApexCharts、不引 recharts、不引任何图表库**）。纯 SVG + MUI `Box`，无 `useTheme`、无 i18n、无平台知识——颜色、文案、数字格式全部由调用方注入。

Minimal 的 `components/chart/` 是 ApexCharts 包装层（`chart.tsx` / `use-chart.ts` / `chart-select.tsx` / `styles.css`），本目录**只借它的图例视觉与 `AnalyticsCurrentVisits` 的卡内布局**，不移植那套包装。

## 模块结构

- `donut-chart.tsx` — `DonutChart`：一个 `<circle>` 画底环（`trackColor`，**永远画**，空库时也有一圈可读的轨道），每个 `share > 0` 的段再画一个 `<circle>`，用 `stroke-dasharray: <弧长> <周长>` 切出弧、`stroke-dashoffset: -(已消耗份额 × 周长)` 转到位；整张 svg `rotate(-90deg)`，让 12 点方向 = 图例第一行。几何全在 `100×100` viewBox 里算（`size` 只缩放渲染盒，`thickness` 按 `size` 折算成 stroke 宽），所以卡片变窄不会改弧的比例。段上带 `data-segment={id}`——**id 是调用方的词汇**（Dashboard 传平台判别符），本组件不认识「平台」
- `chart-legends.tsx` — `ChartLegendItem`：单行图例内容（12px 圆点 + 名称 + 数值 + 可选 `aside`），**全部是 `span`**。Minimal 的复数版是 `<ul>/<li>`；这里只给一行，因为调用方要把它塞进 `Tab` 的 `label`（`Tab` 渲染 `<button>`，块级后代非法），而且 Dashboard 的图例**就是**平台选择器，`role="tablist"` 不能换成 list
- `index.ts` — barrel，只导出上面两个组件与它们的 props 类型
- `donut-chart.test.tsx` — 六段 dasharray 之和 = 周长、段偏移逐段累加、零份额段不渲染但底环仍在、整块 `aria-hidden` 且中心数字照常打印

## 约定

- **图不承担信息**：`DonutChart` 整块 `aria-hidden`，因为它显示的每个数字都必须由调用方以文本再打印一遍（图例行的数值/份额、KPI 卡的总量）。若某个图形是唯一信息源，那是 bug，不是「需要加 aria-label」
- 颜色只收**已解析的 CSS 字符串**（调用方传 `theme.vars.palette.platform[...]` 这类值）。本目录不 import 主题、不写十六进制、不做 `varAlpha`
- 数字只收**已格式化的字符串/节点**。locale 归调用方（Dashboard 用 `sections/overview/analytics-format.ts`）
- 新图表原语（柱、折线）沿用同样的形状：纯 SVG、props 注入颜色与文案、`aria-hidden` + 调用方打印文本。要引图表库先回 docs/25 D3
