# lib/embedding

Embedding 领域层：chunker、durable chunk 持久化、向量存储与语义检索、配置解析。provider 调用（`embed*`、连接测试）在 `lib/ai/embedding.ts`，本 barrel 只是 re-export。

## 约束

- **lib 层只能 leaf import**：平台 sync-service 与 `lib/ingest` 只许导入 `./char-split`、`./chunker`、`./vector-store`、`./types`，不得 value-import 本 barrel（它连带 `./indexing`、`./config`、`@/lib/ai` 的整张加载图）。守卫 `tests/lib-import-smoke.test.ts`。app.html 消费者用 barrel 合法。
- `config.ts` 在 Background SW 的静态图上（Agent Bridge → `lib/chat`，SW 禁动态 `import()`）：settings 必须从 `@/lib/storage/settings` leaf 取，不走 `@/lib/storage` barrel。同一守卫。
- `ChunkInput` 是 chunker 与持久化之间的唯一契约。时间戳只存列，不混入 `text`（会污染向量）。chunker 的选择是平台 / 内容类型知识，留在调用方。
- 本目录零平台知识，资格规则只来自 `lib/collections/collection-processing-policy.ts`，不在这里重写（规则 owner 与守卫见 `lib/collections/CLAUDE.md`）。
- vector store 是 `(db, …)` 纯函数，走现有 Drizzle RPC proxy，offscreen 与 proxy 两端通用；不引入第二套 RPC。查询向量以 `'[…]'::vector` 字符串参数过桥。
- `replaceItemChunks` 的 returning 行数必须等于输入数，否则事务回滚：不许出现「写了零行却成功」。它自开事务，调用方不要再包事务（单连接 proxy 上嵌套死锁）。
- `diagnostics.ts` 的 trace 只许带 allowlist 里的元数据（标识、阶段、计数、provider / model / 维度、耗时）；禁止正文、chunk 文本、向量、API key、请求头与请求体。诊断 sink 吞掉自身异常，不得改变控制流。

## Embed lane（Processing Queue 的 lib 半边）

队列、暂停状态与重试入口归 app 侧，见 `entrypoints/app/hooks/CLAUDE.md`；这里是 lib 一侧必须守住的契约。

- 不要在本目录加全局 embed FIFO：同一平台的 lane 逐条串行，不同平台互不排队，否则一个未结算的请求会阻塞全部平台。单请求 deadline 归 `lib/ai/embedding.ts`。
- `embedPlatformBacklog` 不收 id 列表，恒排空该平台的 pending candidate（eligible + `'chunked'` + 有 chunk 行）：零新增的同步也会清掉上次中断留下的积压。
- 失败不许伪装成功：`embedPlatformItem` 遇零 chunk、DB 或 provider 异常一律 reject 给 job owner；backlog 单条失败继续，收尾 `failed > 0` 抛错；候选选出后 chunk 消失也计失败。
- 失败的条目持久状态留在 `'chunked'`，所以重试就是再跑一次；设置页「重建向量」是手动兜底。
- 未配置（解析不出 API key）是静默 `0/0`，不是失败：自动派发不能在没配 key 的环境里刷失败 job。
- 暂停是 cooperative checkpoint：每条 item 之前检查，不中断进行中的请求与写入。
- `onProgress` 是 `{ done, total, failed }`：查询后先报一次 `0/total`，之后每条结算报一次，单调且必达 `total`。
- `item-embedded` 领域事件只在向量与 `content_state='embedded'` 都落库之后发。
- 本目录不写 chunk：chunk 持久化只有 `lib/ingest` 调 `replaceItemChunks` 这一条路，嵌入入口只有 `embedPlatformItem` / `embedPlatformBacklog` / `rebuildPendingEmbeddings`。不要再加「落 chunk 后顺手嵌入」的组合函数（`indexItemChunks` 就是这样变成死代码的）。

## 向量维度

- 列维度的唯一真相在 pg catalog（`getEmbeddingColumnDimensions` 读 `atttypmod`），不在 storage 里维护副本。Drizzle schema 的 `{ dimensions: 1536 }` 是名义值，别当真。
- 维度惰性自适应，没有固定维度锁：`upsertChunkEmbeddings` 发现 batch 维度 ≠ 列维度时先 `alterEmbeddingDimensions`（清空旧向量、换列类型、`'embedded'` 回退 `'chunked'`）再落库——换模型本就要全量重算。
- 上限是 `MAX_INDEXABLE_DIMENSIONS`（pgvector HNSW 的硬上限）：超限在 DDL 之前抛 `EmbeddingDimensionLimitError`，条目停在 `'chunked'`；修法是在设置页配 `dimensions` 裁剪。
- 检索时查询向量维度 ≠ 列维度抛 `EmbeddingDimensionError`，不返回空结果：那是配置错乱，显式报错优于静默空结果。
- `dimensions` 的唯一来源是用户配置 `embeddingConfigs[providerId].dimensions`，没有 env 层，也没有 provider def 后备。

## 配置解析

- 逐字段优先级：用户填写 > `.env.local` 的 `VITE_EMBEDDING_*` > provider def。
- env 凭证包（API key / base URL / model）描述的是 `VITE_EMBEDDING_PROVIDER` 指定的那一个 provider，整包 gate：当前 provider 不是它时三个字段都不取 env，否则切换 provider 会继承别家的 key 与 base URL。
- 没有启用开关：`enabled` 派生自「解析得出 API key」。
- `import.meta.env` 构建期内联，改 `.env.local` 要重新 build。

## Chunker 的坑

- 句末标点集必须中英双覆盖（`。.!?！？;；…`）：字幕归一化把全角 `！？；` 转成半角，但 `。` 保持原样。
- `chunkSubtitleRows` 以字幕行为原子单位，时间戳来自行；它的产物不能用 `charSplit` 重切。
- `paragraphSplit` 给有段落结构的文本（Markdown、README、description、网页提取）；推文与抖音 `desc` 刻意用 `charSplit(preferParagraph: false)`，只在句末切。
