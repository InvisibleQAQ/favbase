# app/components/scrollbar

自绘滚动条容器（Minimal `components/scrollbar/` 移植，docs/25 Step 3；引入 simplebar 是 docs/25 D5 用户决定）。

## 模块结构

- `scrollbar.tsx` — `Scrollbar`：包 `simplebar-react`，`fillContent` 默认开（内容撑满轨道），`slotProps.wrapperSx/contentWrapperSx/contentSx` 透到三层 simplebar 节点。
- `styles.css` — import simplebar 自带样式 + 用 `--palette-text-disabled` 重着色。`theme-config.ts` 的 `cssVarPrefix` 是空串，所以变量名就是裸 palette 路径。
- `classes.ts` — `scrollbarClasses.root`（`favbase__scrollbar__root`）。

## 铁律：本目录是 simplebar 的唯一入口

docs/25 跨 Step 铁律 6。`simplebar-react` 只允许在本目录 import，`lib/**` 与其它 `entrypoints/**` 一律不得出现。样式表也跟着组件走（由 `scrollbar.tsx` import，不进 `global.css`），否则这条边界只挡代码不挡 CSS。

守卫：`tests/ui-vendor-boundaries.test.ts`。它同时反向断言「本目录确实 import 了它」——一条没人违反也没人使用的规则等于没有规则。Step 5 的 `sonner` 加到同一张表。

## 代价（D5 记录在案）

约 14KB gz、一层额外 DOM 包裹、一条自绘滚动条。可达性方面 simplebar 保留真实 `overflow` 元素、只隐藏原生条，键盘与读屏滚动不受影响——`scrollbar.test.tsx` 有一条断言专门钉住 `.simplebar-content-wrapper` 还在。

happy-dom 无 `ResizeObserver`，由 `tests/setup/app-dom.ts` 提供 stub。

## 测试

`scrollbar.test.tsx` — 挂载 simplebar 且 children 可达、真实滚动容器仍在、外部 className 与自有类名合并。
