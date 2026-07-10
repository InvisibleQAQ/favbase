# 共享 Hooks

app.html 和 Content Script 共享的 React hooks。

## 模块结构

- `useSettings.ts` — deep module：settingsStorage 读写（debounced 500ms + watch 外部变更 + unmount flush）+ LLM/ASR/Embedding computed 属性（currentProviderDef, currentLlmApiKey, currentLlmModel, isCustomProvider, currentAsrDef, currentAsrApiKey, currentAsrModel, currentEmbeddingDef, currentEmbeddingApiKey, currentEmbeddingBaseUrl, currentEmbeddingModel, currentEmbeddingDimensions）+ 收窄 action 接口：`updateLlm(LlmUpdate)` / `updateAsr(AsrUpdate)` / `updateEmbedding(EmbeddingUpdate)` 三个 discriminated union action。ASR computed/action 走 `resolveAsrConfig` / 索引 `settings.asrConfigs[asrProvider]`；**Embedding computed 走 `resolveEmbeddingConfig(settings)`**（镜像 ASR，env `VITE_EMBEDDING_*` 作 UI 默认起点透传），action 按 `resolved.providerId` 索引 `settings.embeddingConfigs` 写字段（新增 provider 只需在 providers.ts 加定义）。**例外：`currentEmbeddingDimensions` 是 raw 值**（直接读 `settings.embeddingConfigs[provider].dimensions`，不走 resolver）——UI 输入框需展示非法输入的错误态，resolver 会把非法值滤成 undefined 导致输入被"吃掉"；embed 消费者用 resolver 过滤值。`EmbeddingUpdate` 含 `{ field: 'dimensions', value: number | undefined }`（undefined = 清空）。**无 `embeddingEnabled`**（启用开关已移除，`enabled` 由 config resolver 派生自 apiKey）。app.html 和 Content Script 共享同一实例
- `useRetryCountdown.ts` — 共享 retryCountdown hook：`{ countdown, startCountdown(seconds), resetCountdown }`。由 Content Script 侧 `useTranscribe` 使用（app.html 侧 `TranscriptionCoordinator` 自建纯 JS 倒计时，不依赖此 hook）

## 约定

- 设置持久化: `settingsStorage`（`lib/storage/settings.ts`），UserSettings 单对象存储在 `local:settings`。`useSettings`（`useSettings.ts`）是共享 deep module — 内聚 storage 读写、computed 属性推导、收窄 action（`updateLlm`/`updateAsr` discriminated union）。ASR 配置结构化为 `asrConfigs: Record<string, { apiKey, model }>`，`resolveAsrConfig` 直接索引 + fallback 到 `defaultModel`。Embedding 同构：`embeddingConfigs: Record<string, { apiKey, baseUrl?, model?, dimensions? }>` + `embeddingProvider`（无 `embeddingEnabled` 开关），computed 走 `resolveEmbeddingConfig(settings)`（用户 > env > def，env 作默认起点透传到 UI）。新增 ASR/Embedding provider 只需在 `providers.ts` 加定义。app.html 和 Content Script 都直接从 `@/lib/hooks/useSettings` 导入
