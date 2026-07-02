# Vercel AI SDK 集成层

Provider factory + 测试连接 + 模型列表获取 + Embedding 客户端。为 app.html 设置页面、未来 LLM 总结（Step 3）、语义搜索 embedding 提供基础设施。

## 模块结构

- `index.ts` — LLM 三函数 + re-export embedding。`createLanguageModel(options)` 根据 `def.sdkType` 选择 AI SDK 构造器（openai/anthropic/google/openai-compatible），custom provider 特殊处理 `customProtocol`。`testLlmConnection()` 通过 `generateText()` 验证连接。`fetchAvailableModels()` 原生 fetch 调用 `{baseUrl}/models`，`buildAuthHeaders()` 和 `resolveModelsEndpoint()` 均基于 `sdkType` 分支。末尾 re-export `./embedding` 全部 public API（`@/lib/ai` 单一 import 面）
- `embedding.ts` — Embedding provider/client infra（与 `createLanguageModel` 同级）。`createEmbeddingModel({providerId,apiKey,baseUrl?,model})` 按 `EmbeddingProviderDef.sdkType` 分支到 `.textEmbeddingModel(model)`（openai→`@ai-sdk/openai`，gemini→`@ai-sdk/google`，其余→`@ai-sdk/openai-compatible` Bearer header）。`embedText(model,text,providerId?)`（AI SDK `embed`，空串拒绝）/ `embedTexts(model,texts,providerId?)`（`embedMany`，空数组短路）。openai 系传 `providerOptions.openai.dimensions=EMBEDDING_DIMENSIONS`。`testEmbeddingConnection({...})` → `{success,message,dimensions}`（embed 探针串，返回真实向量长度）。`EMBEDDING_DIMENSIONS=1536` 常量
- `lib/providers.ts` — Provider 元数据唯一真实来源，被 ai/hooks/storage 共用。SdkType + LLMProviderDef + ASRProviderDef + EmbeddingProviderDef 类型定义，LLM_PROVIDER_IDS / ASR_PROVIDER_IDS / EMBEDDING_PROVIDER_IDS（`as const`）为 Provider ID 唯一真实来源。LLM_PROVIDERS(9个) + ASR_PROVIDERS(2个) + EMBEDDING_PROVIDERS(6个：openai/gemini/zhipu/siliconflow/ollama/custom，**每个含 sdkType**) 纯数据定义，getProviderDef / getAsrProviderDef / getEmbeddingProviderDef 类型安全查找。sdkType 驱动 AI SDK 构造器选择

## 约定

- AI SDK Provider 映射: `LLMProviderDef.sdkType` / `EmbeddingProviderDef.sdkType` 驱动全部分支。openai → `@ai-sdk/openai`，anthropic → `@ai-sdk/anthropic`，google → `@ai-sdk/google`，openai-compatible → `@ai-sdk/openai-compatible`。custom provider 的 sdkType 静态为 `openai-compatible`，LLM 侧 `customProtocol==='claude'` 时运行时覆盖为 anthropic。测试连接：LLM 用 `generateText()`，embedding 用 `embed()` 探针；模型列表用原生 fetch（AI SDK 无 model listing API），认证 header 由 `buildAuthHeaders(sdkType, apiKey)` 统一构建
- Embedding 维度锁 1536: canonical `EMBEDDING_DIMENSIONS`。openai 系 `providerOptions.openai.dimensions=1536` 强制；异维 provider（gemini 768 等）由 `lib/embedding` 的 VectorStore upsert 抛 `EmbeddingDimensionError`，`testEmbeddingConnection` 返回真实维度供 UI 警告。领域向量存储（vector store / 语义检索）在 `lib/embedding/`
- `ProviderOptions` 类型未被 `ai` re-export，`embedding.ts` 用 `NonNullable<Parameters<typeof embed>[0]['providerOptions']>` 从 SDK 参数推导（免加 `@ai-sdk/provider-utils` 直接依赖）
- LLM 总结: OpenAI 协议兼容多 Provider，Quality/Efficiency 两种模式（Step 3，待实现）
