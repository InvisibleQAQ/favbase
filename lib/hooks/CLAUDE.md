# 共享 Hooks

app.html 和 Content Script 共享的 React hooks。

## 模块结构

- `useSettings.ts` — settings 读取 + 显式保存 hook（**无自动保存**——原 debounced 500ms/unmount flush/`updateLlm·updateAsr·updateEmbedding` discriminated union action/瞬时 `saved` flag 已随手动保存模型移除）。返回 `{ settings, loading, currentAsrApiKey, saveLlm, saveAsr, saveEmbedding }`：读取 = `settingsStorage.getValue()` + `watch` 外部变更；`saveXxx(draft)` 立即写入——**先重读存储再 merge**（不同 section 在不同 context 近同时保存不互相覆盖字段）+ 写 `configSavedAt[section] = Date.now()`（设置页持久「已保存」徽标数据源）。`currentAsrApiKey` 为 Content Script 面板保留（转录入口判断是否配了 key）。同文件导出 draft 类型 + 纯派生函数：`LlmDraft/AsrDraft/EmbeddingDraft` + `deriveLlmDraft/deriveAsrDraft/deriveEmbeddingDraft(settings, provider?)`——stored `UserSettings`（per-provider record + env fallback）→ 卡片可编辑的扁平 draft；ASR/Embedding derive 复用 `resolveAsrConfig`/`resolveEmbeddingConfig`（覆写 provider 字段调用），**Embedding 的 `dimensions` 取 raw 存储值**（不走 resolver 过滤，Select 反映真实存储；embed 消费者仍走 resolver 过滤作不变量）。draft 编辑/gating 状态机在 `entrypoints/app/sections/settings/use-config-draft.ts`（app.html 专用，不在本目录）
- `useRetryCountdown.ts` — 共享 retryCountdown hook：`{ countdown, startCountdown(seconds), resetCountdown }`。由 Content Script 侧 `useTranscribe` 使用（app.html 侧 `TranscriptionCoordinator` 自建纯 JS 倒计时，不依赖此 hook）

## 约定

- 设置持久化: `settingsStorage`（`lib/storage/settings.ts`），UserSettings 单对象存储在 `local:settings`。**写入只经 `useSettings.saveLlm/saveAsr/saveEmbedding`**（手动保存，测试连接 gating 在设置页 UI 层）；读取消费者（Content Script 面板等）只用 `settings`/`currentAsrApiKey`。ASR 配置结构化为 `asrConfigs: Record<string, { apiKey, model }>`，Embedding 同构 `embeddingConfigs: Record<string, { apiKey, baseUrl?, model?, dimensions? }>` + `embeddingProvider`（无 `embeddingEnabled` 开关，`enabled` 由 resolver 派生自 apiKey）。新增 ASR/Embedding provider 只需在 `providers.ts` 加定义。app.html 和 Content Script 都直接从 `@/lib/hooks/useSettings` 导入
