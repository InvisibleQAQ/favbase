# app/components/loading-screen

路由级 pending 态（Minimal `components/loading-screen/` 移植，docs/25 Step 3）。

`main.tsx` 的路由 `Suspense fallback` 用它，取代原先内联的 `LoadingFallback`。

## 模块结构

- `loading-screen.tsx` — `LoadingScreen`：居中的不定量 `LinearProgress`（最大 360px），撑满所在盒子；`portal` 可选，`slots.progress` 可整体替换，`slotProps.progress` 透给进度条。

## 约定

- **不移植 `splash-screen`**。Minimal 的 `loading-screen/index.ts` 连带导出带 logo 的全屏启动屏，app.html 没有这个场景。
- **`sections/overview` 的 `AnalyticsLoading` 保留**，不要换成本组件。那是有几何感知的骨架（docs/25 Step 3 第 8 点明确保留），信息量高于一条进度条。
- 进度条用 `color="inherit"`，颜色跟随所在容器的文字色，不自带调色。

## 测试

`loading-screen.test.tsx` — 不定量 `role="progressbar"` 且无 `aria-valuenow`、`slots.progress` 可替换、`portal` 渲染到父节点之外。
