# app/components/configuration-blocker

Collection 页面的 provider 配置阻塞横幅（`CollectionConfigurationNotice`）。智能模块：自带 i18n、`useSettings` 与 ASR / Embedding / LLM resolver，`components/collection/` 因此保持零 `t()`、零 resolver。

## 约束

- 判定规则不在本目录：`deriveConfigurationBlockers` 住 `lib/collections/configuration-blockers.ts`，与 `getProcessingCoverage` Knowledge Tool 共用。两处各写一份，模型就会把「provider 没配、永远不会动」说成「还在处理中」，与本横幅当面矛盾；Embed / Tags 的阈值不要在这里复述。
- 本目录只拥有 `prerequisiteBlocked` 的取值：它来自各平台转录状态机的 wait signal（`AutoTranscribeState.prerequisiteBlocked`），空 key 本身不构成阻塞。
- `'platform-tab'` 行没有设置链接：修复动作在平台自己的标签页上（打开、登录、验证后刷新），文案里的 `{{platform}}` 是 `t(PLATFORM_META[platform].title)`，本目录不出现平台字面量。
- settings 或 coverage 未就绪时不猜测。传给 lib 的是 `coverageStatus === 'ready' ? coverage : null`：加载态是 app 侧概念，lib 只认 `coverage | null`。
- 形态是全宽横幅，一个 `Alert` 同时列出所有阻塞项。印章 chip + Popover 的压缩形态被用户否决过，别重提（docs/19 P0-1）。
- `role="status"` 显式覆盖 Alert 默认的 `role="alert"`：这是被动区域，页面加载时不得有 live alert 抢读屏。
- 文字不用 `warning.main`、不用珊瑚色：正文 `text.primary`，图标与链接 `text.accent`。
- provider 阻塞项链接到设置页对应的 AI 叶子（`settingsPath('ai/<capability>')`）并带 `?resume=<platform>`。

## 坑

- 渲染测试要包 `ThemeProvider`：`sx` 读 `theme.vars`。
