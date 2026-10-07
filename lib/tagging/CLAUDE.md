# lib/tagging

AI 标签：内容落库后自动打标 + 标签 CRUD。`tags` / `item_tags` 的 schema 知识只在本目录；全部操作以 `(platform, platformItemId)` 寻址，调用方不接触 DB uuid，也不 import drizzle / entity。

## 约束

- `tag-queries.ts` 是只读 leaf（零 storage / LLM / 写路径依赖）：Background SW 里的 `listTags` Knowledge Tool 静态 import 它，禁止让它经 `index.ts` / `tagging-service.ts` 拉入写路径。守卫 `tests/agent-bridge-background-bundle-contract.test.ts`。
- prompt 里的「JSON」字样是硬约束，不可删：openai-compatible provider 走 `response_format: json_object`，OpenAI 规范要求 prompt 含 "json"，否则 400。守卫 `tagging.test.ts`。
- 同一模式下 schema 不发给模型，输出结构 `{"tags": [...]}` 只能靠 prompt 传达，改 schema 要同时改 prompt。
- `generateTags` 按 `supportsSchemaDelivery`（`lib/ai`）分叉：schema 发得出去的 provider 用 `generateObject({ schema })`，其余用 `output: 'no-schema'` + 客户端 Zod 校验。别统一成一条路径。
- `TaggingInput` 是内容类型无关的 DTO，禁止 import 平台类型。
- 本目录非测试文件零平台知识：不写带引号的平台 id，不按字面 key 读 `meta` / `platformMeta`。「哪个 meta key 是简介」读 `PLATFORM_DESCRIPTORS[platform].descriptionField`。规则 owner 与守卫见 `lib/collections/CLAUDE.md`。
- `TaggedItem.platformMeta` 整列透传给卡片 adapter 不受上一条限制：那是列引用，不是读 key。
- 资格规则只来自 `lib/collections/collection-processing-policy.ts` 的 Tags pending candidate（eligible + `chunked|embedded` + 无 tag）；Tags 不要求 chunk 行。
- `tagPlatformItem` never throws：返回 `'tagged' | 'skipped' | 'failed'`，已有链接幂等跳过，失败保持未打标；`item-tagged` 事件只在成功时发。`generateTags` 自己抛错不吞，失败语义由 service 层决定。
- 没有启用开关：`enabled` 派生自 LLM 配置可解析（`lib/storage/resolve.ts` 的 `resolveLlmConfig`，与总结共用）。未配置时静默 no-op，backlog 报 `0/0` 且不查 DB。
- `tagNewItems` 串行逐条，单条失败不中断；每条之前执行 cooperative checkpoint，不中断进行中的 LLM / DB 工作。队列与暂停状态归 app 层的 Tags lane，lib 不 import store。
- `onProgress` 从 0 单调到输入总数，`skipped` / `failed` 同样推进。
- 喂给 prompt 的已有标签取全库，不按平台过滤：LLM 应跨平台复用标签名。页面级筛选才传 `platform`。
- 聚合页（`/collections`）调 `getAllUsedTags` 必须传 `COLLECTION_PLATFORMS`，否则未知持久化平台的标签会进入筛选。
- `getItemsByTags` 是 AND 语义且无分页；需要分页的列表用 `lib/collections` 的 `getCollectionItems({ tagId })`。
- 孤儿 tag 靠 inner join 自然隐身，不需要清理任务；remove 只解链，不删 tag 行。
- `tags` / `item_tags` 不受 insert-only 规则约束，但打标必须幂等（upsert + `onConflictDoNothing`）。`tags.name` 全局唯一（单用户，无 userId）。

## 坑

- 本目录的测试要 `vi.mock('@/lib/storage')`：`config.ts` 走 storage barrel，加载时触碰 `chrome.runtime`。
