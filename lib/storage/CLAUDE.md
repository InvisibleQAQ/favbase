# Storage

Storage 统一管理目录（barrel `index.ts` re-export 全部 public API，import 路径 `@/lib/storage` 不变）。

## 模块结构

- `keys.ts` — STORAGE_KEYS 静态 key 注册表 + STORAGE_PREFIXES 动态 key 前缀注册表，新增 key/前缀先在此检查冲突
- `settings.ts` — UserSettings 类型定义 + settingsStorage (WXT `storage.defineItem<UserSettings>`) + DEFAULT_SETTINGS + resolveAsrConfig(settings)（纯函数，ASR 配置解析唯一真实来源）+ getAsrSettings()（异步便利函数，内聚 getValue + resolveAsrConfig，非 React 消费者使用）+ migrateSettingsIfNeeded()（旧平铺 ASR 字段 → asrConfigs Record）。Embedding（语义搜索）字段：`embeddingEnabled` / `embeddingProvider` / `embeddingConfigs: Record<string, { apiKey, baseUrl?, model? }>`，默认 `false`/`VITE_EMBEDDING_PROVIDER || 'openai'`/`{}`（`embeddingProvider` 默认读 env，镜像 `asrProvider`；旧 settings 无此字段时 computed 端 `?? DEFAULT_SETTINGS` fallback，无需迁移）。apiKey/model/baseUrl 的 env 兜底（`VITE_EMBEDDING_*`）在 `lib/embedding/config.ts` 的 `resolveEmbeddingConfig`（非本文件）
- `ui-state.ts` — sidebarPinnedStorage（`local:sidebarPinned`，布尔值，默认 true）
- `index.ts` — barrel re-export + runStorageMigrations()（统一迁移入口，background.ts 只调这一个函数）

## 约定

- 存储: `lib/storage/` 目录统一管理（import 路径 `@/lib/storage`）。WXT `storage.defineItem`（`local:` 前缀），import from `wxt/utils/storage`（非 `wxt/storage`）。`keys.ts` 是命名空间唯一真实来源：`STORAGE_KEYS` 管理静态 key，`STORAGE_PREFIXES` 管理动态 key 前缀（如 `videoCache: 'vc:'`）。新增 key/前缀先在此检查冲突。非 React 消费者用 `getAsrSettings()`（异步，内聚 getValue + resolveAsrConfig），React 消费者通过 `useSettings` hook 操作 `settingsStorage`。`runStorageMigrations()`（`index.ts`）是统一迁移入口，background.ts 只调这一个函数
