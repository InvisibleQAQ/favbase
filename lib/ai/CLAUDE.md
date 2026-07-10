# Vercel AI SDK 集成层

Provider factory + 测试连接 + 模型列表获取 + Embedding 客户端。为 app.html 设置页面、未来 LLM 总结（Step 3）、语义搜索 embedding 提供基础设施。

## 模块结构

- `index.ts` — LLM 三函数 + re-export embedding。`createLanguageModel(options)` 根据 `def.sdkType` 选择 AI SDK 构造器（openai/anthropic/google/openai-compatible），custom provider 特殊处理 `customProtocol`。`testLlmConnection()` 通过 `generateText()` 验证连接。`fetchAvailableModels()` 原生 fetch 调用 `{baseUrl}/models`，`buildAuthHeaders()` 和 `resolveModelsEndpoint()` 均基于 `sdkType` 分支。末尾 re-export `./embedding` 全部 public API（`@/lib/ai` 单一 import 面）
- `embedding.ts` — Embedding provider/client infra（与 `createLanguageModel` 同级）。`createEmbeddingModel({providerId,apiKey,baseUrl?,model})` 按 `EmbeddingProviderDef.sdkType` 分支到 `.textEmbeddingModel(model)`（openai→`@ai-sdk/openai`，gemini→`@ai-sdk/google`，其余→`@ai-sdk/openai-compatible` Bearer header）。`embedText(model,text)`（AI SDK `embed`，空串拒绝）/ `embedTexts(model,texts)`（`embedMany`，空数组短路），模型返回原生维度、不做任何维度 pin（列维度惰性跟随模型，见 `lib/embedding`）。`testEmbeddingConnection({...})` → `{success,message,dimensions}`（embed 探针串，返回真实向量长度供 UI 对照 2000 HNSW 上限）
- `lib/providers.ts` — Provider 元数据唯一真实来源，被 ai/hooks/storage 共用。SdkType + LLMProviderDef + ASRProviderDef + EmbeddingProviderDef 类型定义，LLM_PROVIDER_IDS / ASR_PROVIDER_IDS / EMBEDDING_PROVIDER_IDS（`as const`）为 Provider ID 唯一真实来源。LLM_PROVIDERS(9个) + ASR_PROVIDERS(2个) + EMBEDDING_PROVIDERS(6个：openai/gemini/zhipu/siliconflow/ollama/custom，**每个含 sdkType**) 纯数据定义，getProviderDef / getAsrProviderDef / getEmbeddingProviderDef 类型安全查找。sdkType 驱动 AI SDK 构造器选择

## 约定

- AI SDK Provider 映射: `LLMProviderDef.sdkType` / `EmbeddingProviderDef.sdkType` 驱动全部分支。openai → `@ai-sdk/openai`，anthropic → `@ai-sdk/anthropic`，google → `@ai-sdk/google`，openai-compatible → `@ai-sdk/openai-compatible`。custom provider 的 sdkType 静态为 `openai-compatible`，LLM 侧 `customProtocol==='claude'` 时运行时覆盖为 anthropic。测试连接：LLM 用 `generateText()`，embedding 用 `embed()` 探针；模型列表用原生 fetch（AI SDK 无 model listing API），认证 header 由 `buildAuthHeaders(sdkType, apiKey)` 统一构建
- Embedding 维度：无 canonical 常量（原 `EMBEDDING_DIMENSIONS=1536` 及 openai 系 dimensions pin 已移除）。向量列维度跟随当前模型，惰性切换 + HNSW 2000 上限守卫（`MAX_INDEXABLE_DIMENSIONS`）在 `lib/embedding/`（vector store / 语义检索）实现
- LLM 总结: OpenAI 协议兼容多 Provider，Quality/Efficiency 两种模式（Step 3，待实现）
