# lib/hooks

app.html 与 Content Script 共用的 React hooks。app.html 专用的 hook 在 `entrypoints/app/hooks/`，不放这里。

## 约束

- UI 侧写 `UserSettings` 只经 `useSettings` 的 `save*`（另一个写入方是 SW 里的 WebDAV pull）；读取方（Content Script 面板等）只用 `settings` 与派生字段。
- 没有自动保存：`save*(draft)` 是显式保存。draft 编辑与「测试连接后才能保存」的 gating 在 `entrypoints/app/sections/settings/use-config-draft.ts`，不在本目录。
- `save*` 必须先重读存储再 merge：不同 section 可能在不同 context 近乎同时保存，拿 React state 里的快照写回会互相覆盖字段。
- 每次保存都写 `configSavedAt[section]`：它既是设置页「已保存」徽标的数据源，也是 WebDAV 首配时钟的 seed（`lib/sync/CLAUDE.md`）。
- 新增凭据型平台要在 `useSettings.ts` 加 `derive<Pascal>Draft` 函数声明和 `UseSettingsReturn` 上的 `save<Pascal>` 成员。守卫：`tests/platform-completeness-contract.test.ts`（按 AST 查声明，局部 `const` 不算）。
- 新增 ASR / Embedding provider 只在 `lib/providers.ts` 加定义，不改本目录。

## 坑

- `useRetryCountdown` 只给 Content Script 的 `useTranscribe` 用；app.html 的 `TranscriptionCoordinator` 自己做纯 JS 倒计时，不依赖 React hook。
