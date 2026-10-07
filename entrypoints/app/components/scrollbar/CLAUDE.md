# app/components/scrollbar

自绘滚动条容器（Minimal 移植，包 `simplebar-react`）。

## 约束

- 本目录是 `simplebar-react` 的唯一入口，`lib/**` 与其它 `entrypoints/**` 不得 import。守卫 `tests/ui-vendor-boundaries.test.ts` 的 `VENDOR_RULES`（同时反向断言本目录确实用了它）。
- simplebar 的样式表由 `scrollbar.tsx` import，不要挪进 `global.css`：否则这条边界只挡代码不挡 CSS。
- simplebar 保留真实 `overflow` 元素、只隐藏原生条，键盘与读屏滚动靠它；`scrollbar.test.tsx` 钉住 `.simplebar-content-wrapper` 还在。

## 坑

- `styles.css` 用裸变量 `--palette-text-disabled`：主题的 `cssVarPrefix` 是空串，变量名就是 palette 路径。
- happy-dom 没有 `ResizeObserver`，stub 在 `tests/setup/app-dom.ts`。
