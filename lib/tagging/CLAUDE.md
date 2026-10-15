# lib/tagging

AI 标签：内容落库后自动打标 + 标签 CRUD。`tags` / `item_tags` 的 schema 知识只在本目录；全部操作以 `(platform, platformItemId)` 寻址，调用方不接触 DB uuid，也不 import drizzle / entity。

## 约束

- `tag-queries.ts` 是只读 leaf（零 storage / LLM / 写路径依赖）：Background SW 里的 `listTags` Knowledge Tool 静态 import 它，禁止让它经 `index.ts` / `tagging-service.ts` 拉入写路径。它为名字过滤 value-import `@/lib/database/collection-queries` 的 `searchCondition`，所以那个文件也在 SW 图上。守卫 `tests/agent-bridge-background-bundle-contract.test.ts`。
- `getAllUsedTags` 不设上限（app 的标签筛选与打标 prompt 要全量）；有界读是 `searchUsedTags`。两者共用 `selectUsedTags` 一个查询骨架，别复制 SQL。
- prompt 里的「JSON」字样是硬约束，不可删：openai-compatible provider 走 `response_format: json_object`，OpenAI 规范要求 prompt 含 "json"，否则 400。守卫 `tagging.test.ts`。
- 同一模式下 schema 不发给模型，输出结构 `{"tags": [...]}` 只能靠 prompt 传达，改 schema 要同时改 prompt。
- `generateTags` 按 `supportsSchemaDelivery`（`lib/ai`）分叉：schema 发得出去的 provider 用 `generateObject({ schema })`，其余用 `output: 'no-schema'` + 客户端 Zod 校验。别统一成一条路径。
- `TaggingInput` 是内容类型无关的 DTO，禁止 import 平台类型。
- 本目录非测试文件零平台知识：不写带引号的平台 id，不按字面 key 读 `meta` / `platformMeta`。「哪个 meta key 是简介」读 `PLATFORM_DESCRIPTORS[platform].descriptionField`。规则 owner 与守卫见 `lib/collections/CLAUDE.md`。
- `TaggedItem.platformMeta` 整列透传给卡片 adapter 不受上一条限制：那是列引用，不是读 key。
- 资格规则只来自 `lib/collections/collection-processing-policy.ts` 的 Tags pending candidate（eligible + `chunked|embedded` + 无 tag）；Tags 不要求 chunk 行。
- `tagPlatformItem` never throws：返回 `'tagged' | 'skipped' | 'failed' | 'deferred'`，已有链接幂等跳过，失败保持未打标；`item-tagged` 事件只在成功时发。`generateTags` 自己抛错不吞，失败语义由 service 层决定。
- `tagPlatformBacklog` 同样 never throws：读配置或查候选失败只记日志、报 `0/0` 后返回，条目仍是 Tags pending candidate，由下一次同步收尾续上。否则一次成功的 Platform Sync 会以 failed 的 Tags run 收尾。`tagNewItems` 的循环本来不抛，不用包。
- 没有启用开关：`enabled` 派生自 LLM 配置可解析（`lib/storage/resolve.ts` 的 `resolveLlmConfig`，与总结共用）。未配置时静默 no-op，backlog 报 `0/0` 且不查 DB：每次 Platform Sync 收尾都会派发 `tagPlatformBacklog`，没配 LLM 的用户也一样。
- `tagNewItems` 串行逐条，单条失败不中断；每条之前执行 cooperative checkpoint，不中断进行中的 LLM / DB 工作。队列与暂停状态归 app 层的 Tags lane，lib 不 import store。
- `onProgress` 从 0 单调推进，`skipped` / `failed` 同样推进；正常到输入总数，遇 `'deferred'` 提前结束，那一条不推进。
- 喂给 prompt 的已有标签取全库，不按平台过滤：LLM 应跨平台复用标签名。页面级筛选才传 `platform`。
- 聚合页（`/collections`）调 `getAllUsedTags` 必须传 `COLLECTION_PLATFORMS`，否则未知持久化平台的标签会进入筛选。
- `getItemsByTags` 是 AND 语义且无分页；需要分页的列表用 `lib/collections` 的 `getCollectionItems({ tagId })`。
- 孤儿 tag 靠 inner join 自然隐身，不需要清理任务；remove 只解链，不删 tag 行。
- `tags` / `item_tags` 不受 insert-only 规则约束，但打标必须幂等（upsert + `onConflictDoNothing`）。`tags.name` 全局唯一（单用户，无 userId）。

## Tagging Budget（docs/41）

- 检查与扣账只在 `tagPlatformItem` 一处（docs/41 §3）：lane、app 层、平台 adapter 不另做预算判断，也不按平台分账。
- 先查后扣：剩余 `> 0` 即放行，调用后按实际用量扣；不做调用前预估（docs/41 §2 已否决，超支本来有界）。
- 账本读失败按用完处理（`'deferred'`）：读不到账本就不花钱。
- 调用一结算就扣账，早于空标签判断与写库；扣账失败只 warn，不得把 `'tagged'` 改成 `'failed'`（钱已经花了）。
- 拿到回应之后才失败的路径必须包成 `TaggingSpendError(tokens, cause)` 抛出，否则按 0 扣账；没拿到回应的错误（HTTP、网络）原样抛。
- 用量只许多估：端点不报或报 0 的那一项按字符数估（openai-compatible 把缺失的计数转成 0）。
- `tagNewItems` 在第一条 `'deferred'` 处正常返回，不是失败：额度全平台共用，后面的条目同样会被挡。被挡下的条目仍是 Tags pending candidate，由下一次同步收尾的 backlog 续上，lib 不记「谁被挡过」。
- 上限每次检查都重读 settings，别缓存：调高要对进行中的 run 立即生效。

## 跨标签页的条目认领

- 每个 app.html 标签页各有一份 job store、各跑一份 Tags backlog，DB 却是共用的：`tagPlatformItem` 按条目认领（`TaggingDeps.claim`，默认是 `ifAvailable` 的 Web Lock），否则两个标签页会对同一条各调一次 LLM。去重只在这里做，lane 不另做。
- 认领被别处持有时返回 `'skipped'`：持有方正在打这一条；它失败的话，条目仍是 pending candidate，由下一次同步续上。
- 从候选检查到写库都在认领之内，别把候选查询挪到认领外面：拿到认领时，另一个标签页可能刚打完这一条，只有认领内的检查看得到。
- 没有 `navigator.locks` 时返回 `'failed'`，不退回无认领执行，与账本锁同一立场（`lib/storage/CLAUDE.md`）。

## 坑

- 本目录的测试要 `vi.mock('@/lib/storage')`：`config.ts` 与 `budget.ts` 走 storage barrel，加载时触碰 `chrome.runtime`。
- Node 与 happy-dom 都没有 `navigator.locks`：测试里调真实的 `tagPlatformItem` / `tagNewItems` / `tagPlatformBacklog` 要注入 `claim`，否则每一条都是 `'failed'`。
- 预算日界（`budget.ts` 的 `localDayKey`）与每日自动同步（`entrypoints/app/hooks/daily-sync-gate.ts`）是同一个本地自然日的两份实现：lib 不能 import `entrypoints/`。改一边要同改另一边。
