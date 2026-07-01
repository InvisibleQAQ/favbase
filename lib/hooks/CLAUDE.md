# 共享 Hooks

app.html 和 Content Script 共享的 React hooks。

## 模块结构

- `useSettings.ts` — deep module：settingsStorage 读写（debounced 500ms + watch 外部变更 + unmount flush）+ LLM/ASR computed 属性（currentProviderDef, currentLlmApiKey, currentLlmModel, isCustomProvider, currentAsrDef, currentAsrApiKey, currentAsrModel）+ 收窄 action 接口：`updateLlm(LlmUpdate)` / `updateAsr(AsrUpdate)` 两个 discriminated union action 替代原 11 个独立 callback。ASR computed 和 action 直接从 `settings.asrConfigs[asrProvider]` 索引（新增 ASR provider 只需在 providers.ts 加定义）。app.html 和 Content Script 共享同一实例
- `useRetryCountdown.ts` — 共享 retryCountdown hook：`{ countdown, startCountdown(seconds), resetCountdown }`。由 Content Script 侧 `useTranscribe` 使用（app.html 侧 `TranscriptionCoordinator` 自建纯 JS 倒计时，不依赖此 hook）

## 约定

- 设置持久化: `settingsStorage`（`lib/storage/settings.ts`），UserSettings 单对象存储在 `local:settings`。`useSettings`（`useSettings.ts`）是共享 deep module — 内聚 storage 读写、computed 属性推导、收窄 action（`updateLlm`/`updateAsr` discriminated union）。ASR 配置结构化为 `asrConfigs: Record<string, { apiKey, model }>`，`resolveAsrConfig` 直接索引 + fallback 到 `defaultModel`。新增 ASR provider 只需在 `providers.ts` 加定义。app.html 和 Content Script 都直接从 `@/lib/hooks/useSettings` 导入
