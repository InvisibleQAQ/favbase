# app/components/chart

零依赖图表原语：纯 SVG + MUI `Box`。

## 约束

- 不引 ApexCharts、recharts 或任何图表库（docs/25 D3）。Minimal 的 `components/chart/` 是 ApexCharts 包装层，只借它的图例视觉，不移植；要引图表库先回 docs/25 D3。
- 图不承担信息：`DonutChart` 整块 `aria-hidden`，它显示的每个数字都必须由调用方以文本再打印一遍。某个图形成了唯一信息源是 bug，不是「需要加 aria-label」。
- 本目录零主题、零 i18n、零平台知识：颜色只收已解析的 CSS 字符串，数字只收已格式化的字符串或节点；段的 `data-segment` id 是调用方的词汇。
- `ChartLegendItem` 全部是 `span`（phrasing content）：调用方把它放进 `Tab` 的 `label`，`Tab` 渲染 `<button>`，块级后代非法。不要改成 Minimal 的 `<ul>/<li>`。
- 新图表原语沿用同一形状：纯 SVG、props 注入颜色与文案、`aria-hidden` + 调用方打印文本。
