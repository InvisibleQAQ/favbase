# Vercel AI SDK 集成层

Provider factory + 测试连接 + 模型列表获取。为 app.html 设置页面和未来 LLM 总结（Step 3）提供基础设施。

## 模块结构

- `index.ts` — 三函数合一模块。`createLanguageModel(options)` 根据 `def.sdkType` 选择 AI SDK 构造器（openai/anthropic/google/openai-compatible），custom provider 特殊处理 `customProtocol`。`testLlmConnection()` 通过 `generateText()` 验证连接。`fetchAvailableModels()` 原生 fetch 调用 `{baseUrl}/models`，`buildAuthHeaders()` 和 `resolveModelsEndpoint()` 均基于 `sdkType` 分支
- `lib/providers.ts` — Provider 元数据唯一真实来源，被 ai/hooks/storage 共用。SdkType + LLMProviderDef + ASRProviderDef 类型定义，LLM_PROVIDER_IDS / ASR_PROVIDER_IDS（`as const`）为 Provider ID 唯一真实来源，推导 LLMProviderId / ASRProviderId 类型。LLM_PROVIDERS(9个，每个含 sdkType) + ASR_PROVIDERS(2个，每个含 baseUrl) 纯数据定义，getProviderDef(id: LLMProviderId) + getAsrProviderDef(id: ASRProviderId) 类型安全查找。sdkType 驱动 AI SDK 构造器选择和 raw fetch 认证策略

## 约定

- AI SDK Provider 映射: `LLMProviderDef.sdkType` 驱动全部分支。openai → `@ai-sdk/openai`，anthropic → `@ai-sdk/anthropic`，google → `@ai-sdk/google`，openai-compatible → `@ai-sdk/openai-compatible`。custom provider 的 sdkType 静态为 `openai-compatible`，`customProtocol==='claude'` 时运行时覆盖为 anthropic。测试连接用 `generateText()`，模型列表用原生 fetch（AI SDK 无 model listing API），认证 header 由 `buildAuthHeaders(sdkType, apiKey)` 统一构建
- LLM 总结: OpenAI 协议兼容多 Provider，Quality/Efficiency 两种模式（Step 3，待实现）
