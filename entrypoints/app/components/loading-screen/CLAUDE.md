# app/components/loading-screen

路由 `Suspense fallback` 用的不定量进度条（Minimal 移植）。

- 不移植 Minimal 的 `splash-screen`：app.html 没有全屏启动屏场景。
- `sections/overview` 的 `AnalyticsLoading` 不要换成本组件：它是有几何感知的骨架。
