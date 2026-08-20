# app/components/configuration-blocker

Collection 页面 provider 配置阻塞智能模块。`CollectionConfigurationNotice` 订阅 `useSettings`，复用 ASR/Embedding/LLM resolver，并结合平台 `ProcessingCoverage` 与 Bilibili 权威 `configuration_required` phase 推导阻塞；settings 或 coverage 未就绪时不猜测。

- 形态 = **全宽横幅**（HEAD `75c42a2` 形态；docs/19 P0-1 的印章 chip + Popover 于 2026-08-20 被用户否决并恢复）：一个 `Alert severity="warning" variant="outlined"` 可同时呈现 ASR、Embedding、Tags 阻塞——标题 `configurationBlocker.title` + 每项一行文案 + 右侧「配置 …」文字链接。`role="status"`（显式覆盖 Alert 默认的 `role="alert"`——被动区域，页面加载时不得有 live alert 抢读屏）。色彩按 catalog-card token：底 `warning.lighter`（暗色 `varAlpha(warning.mainChannel, 0.16)`，`theme.applyStyles('dark')`）、边 `warning.light`、正文 `text.primary`、图标与链接 `text.accent`（链接走主题 `textPrimary` 覆盖）——无珊瑚文字、无白字珊瑚底、不用 `warning.main` 文字。
- 每项链接 `/settings?section=<capability>&resume=<platform>`；只传结构化数据给共享 scaffold 的 `configurationNotice` slot（scaffold 把它固定放在搜索框之后）。
- ASR 仅由状态机 wait signal 触发；空 key 本身不构成阻塞。Embed/Tags 仅在 ready coverage 且 `total > done` 时触发。
- 本目录拥有 i18n 与 provider 知识；`components/collection/` 继续保持零 `t()`、零 resolver。测试 `collection-configuration-notice.test.tsx`（派生逻辑 + 无 alert/一个 status + 文案与链接齐全 + settings loading 不猜；渲染包 `ThemeProvider`，因 sx 读 `theme.vars`）。
