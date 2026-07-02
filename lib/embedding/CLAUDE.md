# Embedding 领域层

pgvector 向量存储 + 语义检索 + 配置解析。domain 层，依赖 `lib/ai`（provider/client infra）+ `lib/database`（Drizzle RPC proxy）。**接口层，当前无业务消费方**（chunker/索引队列/hybrid retriever/批量索引随消费方阶段做）。

## 分层

- infra（provider 工厂 / `embed*` / `testEmbeddingConnection` / `EMBEDDING_DIMENSIONS`）在 `lib/ai/embedding.ts`，本 barrel re-export
- domain（vector store / 语义检索 / config 解析）在本目录

## 模块结构

- `config.ts` — `resolveEmbeddingConfig(settings)` 纯函数（镜像 `resolveAsrConfig`）：`UserSettings` → `{ providerId, apiKey, baseUrl, model, enabled }`，gap 从 provider def 补齐。`getEmbeddingSettings()` 异步便利（getValue + resolve，非 React 消费者用）
- `errors.ts` — `EmbeddingDimensionError`（携 expected/actual 维度）。向量长度 ≠ `EMBEDDING_DIMENSIONS`(1536) 时抛出（pgvector 固定列 + ANN 索引装不下异维）
- `vector-store.ts` — `(db: FavbaseDb, ...)` 纯函数集，走现有 Drizzle RPC proxy（**不引入第二套 RPC**）：
  - `toSqlVector(vec)` → `'[a,b,c]'`（纯，可单测）
  - `upsertChunkEmbeddings(db, entries)` — UPDATE `item_chunks.embedding` WHERE id；dim 校验先行，异维抛 `EmbeddingDimensionError`
  - `semanticSearchChunks(db, queryVec, { topK, minScore? })` — `ORDER BY embedding <=> $vec LIMIT topK`（cosine），`score = 1 - distance`，`minScore` 过滤。向量作 `'[...]'::vector` 字符串参数（过 PortBridge 只是文本，RPC 安全）。返回 `{ chunkId, itemId, chunkText, score }[]`
  - `deleteItemEmbeddings(db, itemId)` / `clearAllEmbeddings(db)` — 置 embedding NULL
  - `getEmbeddingStats(db)` → `{ embeddedChunks, totalChunks }`
- `index.ts` — barrel：re-export infra（from `@/lib/ai`）+ config + errors + vector-store，单一 import 面

## 约定

- 维度锁 1536：canonical `EMBEDDING_DIMENSIONS`（`lib/ai/embedding.ts`）。openai 系 embed 传 `providerOptions.openai.dimensions=1536`；upsert/search 对异维抛 `EmbeddingDimensionError`；`testEmbeddingConnection` 返回真实维度供 UI 早警告。非 1536 provider（gemini 768 / zhipu / bge-m3 / ollama 768）暂不可落库，需消费方阶段做多维迁移
- vector store 做成 `(db)=>` 纯函数：offscreen（`initDbMain`）/ proxy（`initDbProxy`）两端通用、可单测。DB 访问一律走 Drizzle query builder + 原生 `sql` 模板（`<=>` 检索用 `db.execute(sql\`...\`)`，读 `result.rows`）
- 测试：`vector-store.test.ts` 用 in-memory PGlite（`PGlite.create` + vector/uuid_ossp/pg_trgm 扩展 + `runMigrations`）做 upsert/cosine 排序/minScore/stats/clear 往返；`toSqlVector` + 维度守卫纯函数单测。provider 工厂映射测试在 `lib/ai/embedding.test.ts`
