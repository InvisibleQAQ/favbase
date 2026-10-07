# Vercel AI SDK 集成层

LLM / Embedding 的 provider factory、连接测试、模型列表。设置页、AI 标签、AI 总结、Chat、语义检索共用，对外 import 面是 `@/lib/ai`。

## 约束

- `lib/providers.ts` 是 Provider id 与元数据的唯一事实源。`sdkType` 驱动全部分支（SDK 构造器、认证 header、models 端点），不要按 provider id 另开分支。
- custom provider 的 `sdkType` 静态为 `openai-compatible`；LLM 侧 `customProtocol === 'claude'` 时在运行时改走 anthropic。
- AI SDK 没有 model listing API：模型列表与 ASR 探针走原生请求。
- `testAsrConnection` 只验凭证与可达性（`GET /models`），不验模型名，所以设置页 ASR 卡的 model 字段不算连接字段。
- 总结（`lib/summary`）走 `streamText` 纯文本流加自定义协议，刻意不走 `generateObject`；协议段内的 JSON 由客户端 Zod 校验。

## 结构化输出（`generateObject`）

- 能力位 `LLMProviderDef.supportsJsonSchema` 表示端点接受 `response_format: json_schema`，未设即保守的 `json_object`。
- 能力位只能经 `createOpenAICompatible({ supportsStructuredOutputs })` 在 provider 级生效：`languageModel(id, config)` 的第二参数被 `@ai-sdk/openai-compatible` 实现丢弃。
- 能力矩阵：只有 openrouter 开（网关对不支持的上游静默降级，不 400）。
- DeepSeek、ZhiPu 官方只接受 `json_object`，发 `json_schema` 直接 400。
- kimi 部分模型支持，但 Zod 生成的 `$schema` 键会破坏它的 constrained decoding，所以不开。modelscope、custom 能力未知，不开。
- `supportsSchemaDelivery(providerId, customProtocol?)` 判定 Zod schema 是否真的发给了模型：custom 仅 claude 协议为 true；原生 sdkType（openai / anthropic / google）为 true；openai-compatible 看能力位。
- 调用方必须按它分叉（样板 `lib/tagging/tagger.ts`）：true 用 `generateObject({ schema })`；false 用 `generateObject({ output: 'no-schema' })` 加客户端 Zod parse 兜底。
- `'no-schema'` 分支的 schema 为 null，不会触发 SDK 的 responseFormat 警告，请求体仍带 `response_format: json_object`。
- `json_object` 模式下 schema 不发给模型，prompt 是唯一的 schema 载体；OpenAI 规范还要求 prompt 含 "json" 字样。调用方的 prompt 必须自带 JSON 格式说明（样板 `lib/tagging/prompt.ts`）。
- 守卫：`ai.test.ts`（能力矩阵）。

## Embedding

- 没有 canonical 维度常量：向量列维度跟随当前模型，惰性切换与 HNSW 维度上限在 `lib/embedding/CLAUDE.md`。
- 用户可选的 `dimensions` 裁剪按 sdkType 透传：openai 进 `{ openai: { dimensions } }`（仅 v3 系模型生效），google 进 `outputDimensionality`。
- openai-compatible 的 providerOptions key 是本项目的 providerId：SDK 取 `config.provider.split('.')[0]`，而 `createOpenAICompatible({ name })` 的 provider 是 `${name}.embedding`。第三方端点是否尊重 `dimensions` 取决于各家实现。
- 无效的 `dimensions`（undefined、`<= 0`、非有限数）不透传，与 `resolveEmbeddingConfig` 同规则。
- `testEmbeddingConnection` 的探针必须带上配置的 `dimensions`：返回的维度要等于真实落库维度，UI 拿它对照索引上限。
- `embedText` / `embedTexts` 共用同一个 abort deadline。`embedTexts` 不覆盖 `maxParallelCalls`，单批调度由 provider 自身能力决定。
- 跨平台并发归各自的 Collection Embed lane，这里不设全局 FIFO。

## 已知缺口

- 设置项 `prefMode`（quality / efficiency）没有任何消费者：总结恒用合并的单次调用。
