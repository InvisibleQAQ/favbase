# Embedding 领域层

pgvector 向量存储 + 语义检索 + 配置解析 + RAG 数据准备（chunker/indexing）。domain 层，依赖 `lib/ai`（provider/client infra）+ `lib/database`（Drizzle RPC proxy）。首个业务消费方：`lib/bilibili/bili-sync-service.persistContent`（转录成功 → chunk → embed → content_state 推进）。

## 分层

- infra（provider 工厂 / `embed*` / `testEmbeddingConnection` / `EMBEDDING_DIMENSIONS`）在 `lib/ai/embedding.ts`，本 barrel re-export
- domain（chunker / indexing 编排 / vector store / 语义检索 / config 解析）在本目录

## 模块结构

- `types.ts` — `ChunkInput = { text, startSec?, endSec? }`：**chunker 与 indexing 之间的唯一契约**。任何内容类型的 chunker 产出 `ChunkInput[]` 即可接入 `indexItemChunks`；时间戳可选（图文平台 undefined → NULL），且**只存列不混入 text**（混入会污染向量）
- `chunker.ts` — `chunkSubtitleRows(rows: SubtitleRow[], opts?) → ChunkInput[]`：字幕内容类型 chunker，零依赖纯函数。行级贪心打包：SubtitleRow 为原子单位（行内不切），默认 target 500 / max 700 / min 100 字符 / gap 2s / overlap 上限 150 字符（`ChunkerOptions` 可覆盖）。累计 ≥target 后在"行尾句末标点或行间 gap ≥2s"处闭合，≥max 硬闭合；新 chunk 带上一 chunk 末尾 1 整行 overlap（>150 字符跳过）；末尾残片 fresh 文本 <min 并入前一 chunk（去 overlap 防重复）；单行 >max 兜底先按标点再按字符硬切（子片共享该行时间戳）。**句末标点集 `。.!?！？;；…` 中英双覆盖是 load-bearing**：subtitle-processor normalize 把全角 `！？；` 转半角但 `。` 保持原样。chunk startSec=首行 start / endSec=末行 end
- `indexing.ts` — `indexItemChunks(db, itemId, chunks, deps?) → 'chunked' | 'embedded'`：**内容类型无关**编排（零平台知识）。流程：`replaceItemChunks` 落库 → content_state='chunked' → `resolveEmbeddingConfig().enabled`（现即"是否配了 apiKey"）才 embed（`createEmbeddingModel` + `embedTexts` → `upsertChunkEmbeddings` → 'embedded'）。embed 任何失败（含 EmbeddingDimensionError/网络/未配置）catch + console.error，停在 'chunked' **不向上抛**；chunk 落库失败则向上抛（调用方决定）。`IndexingDeps`（getConfig/embed）可注入测试（镜像 PipelineDeps DI 风格）
- `config.ts` — `resolveEmbeddingConfig(settings)` 纯函数（镜像 `resolveAsrConfig`）：`UserSettings` → `{ providerId, apiKey, baseUrl, model, enabled }`。**逐字段优先级：用户填写 `embeddingConfigs[providerId]`（非空即赢）> `.env.local`（`VITE_EMBEDDING_*`）> provider def**。env 只是"默认起点"，用户可覆盖且以用户为准。`providerId`：`settings.embeddingProvider`（`DEFAULT_SETTINGS` 已默认读 `VITE_EMBEDDING_PROVIDER`）> 合法 `VITE_EMBEDDING_PROVIDER` > `'openai'`（非法 env provider 忽略）；baseUrl/model 的 def 后备来自 resolved provider。env 是"默认凭证包"，与激活 provider 无关（`import.meta.env` 构建期内联，改 `.env.local` 需重跑 build）。**无启用开关**：`enabled` 派生自 `!!apiKey`（解析出 key 即启用——契合"默认启用"，同时避免完全未配置时无谓 embed + 报错刷屏）。`getEmbeddingSettings()` 异步便利（getValue + resolve，非 React 消费者用）
- `errors.ts` — `EmbeddingDimensionError`（携 expected/actual 维度）。向量长度 ≠ `EMBEDDING_DIMENSIONS`(1536) 时抛出（pgvector 固定列 + ANN 索引装不下异维）
- `vector-store.ts` — `(db: FavbaseDb, ...)` 纯函数集，走现有 Drizzle RPC proxy（**不引入第二套 RPC**）：
  - `toSqlVector(vec)` → `'[a,b,c]'`（纯，可单测）
  - `replaceItemChunks(db, itemId, chunks)` — 事务 delete by item_id + 批量 insert（chunk_index 0 起顺序编号，写 start_sec/end_sec），返回 `ReplacedChunk[]`（id/chunkIndex/chunkText）供 embed 回填；空 chunks 只清空
  - `upsertChunkEmbeddings(db, entries)` — UPDATE `item_chunks.embedding` WHERE id；dim 校验先行，异维抛 `EmbeddingDimensionError`
  - `semanticSearchChunks(db, queryVec, { topK, minScore? })` — `ORDER BY embedding <=> $vec LIMIT topK`（cosine），`score = 1 - distance`，`minScore` 过滤。向量作 `'[...]'::vector` 字符串参数（过 PortBridge 只是文本，RPC 安全）。返回 `{ chunkId, itemId, chunkText, score }[]`
  - `deleteItemEmbeddings(db, itemId)` / `clearAllEmbeddings(db)` — 置 embedding NULL
  - `getEmbeddingStats(db)` → `{ embeddedChunks, totalChunks }`
- `index.ts` — barrel：re-export infra（from `@/lib/ai`）+ types + chunker + indexing + config + errors + vector-store，单一 import 面

## 约定

- 两层解耦：chunker 选择是平台/内容类型知识，组合点在平台 service（如 `bili-sync-service.persistContent`：`chunkSubtitleRows(rows)` + `indexItemChunks(db, itemId, chunks)`）。新平台接入 = 新 chunker 产出 `ChunkInput[]` + 平台 service 组合调用，**不改 indexing/vector-store**
- 失败策略：chunk 必做（本地零成本），embed 尽力而为（未启用/失败停 'chunked'，只 console 记录，不影响转录成功状态）
- 维度锁 1536：canonical `EMBEDDING_DIMENSIONS`（`lib/ai/embedding.ts`）。openai 系 embed 传 `providerOptions.openai.dimensions=1536`；upsert/search 对异维抛 `EmbeddingDimensionError`；`testEmbeddingConnection` 返回真实维度供 UI 早警告。非 1536 provider（gemini 768 / zhipu / bge-m3 / ollama 768）暂不可落库（EmbeddingDimensionError 被 indexing catch 停 'chunked'），需后续多维迁移
- vector store 做成 `(db)=>` 纯函数：offscreen（`initDbMain`）/ proxy（`initDbProxy`）两端通用、可单测。DB 访问一律走 Drizzle query builder + 原生 `sql` 模板（`<=>` 检索用 `db.execute(sql\`...\`)`，读 `result.rows`）
- 测试：`vector-store.test.ts` 用 in-memory PGlite（`PGlite.create` + vector/uuid_ossp/pg_trgm 扩展 + `runMigrations`）做 upsert/cosine 排序/minScore/stats/clear 往返；`toSqlVector` + 维度守卫纯函数单测。`chunker.test.ts` 纯函数单测（标点双覆盖/gap 闭合/overlap/min 并入/超长兜底/时间戳）。`indexing.test.ts` in-memory PGlite + 注入 `IndexingDeps`（落库/状态推进/embed 失败停 chunked/重建无残留/NULL 时间戳）。provider 工厂映射测试在 `lib/ai/embedding.test.ts`。注意：测试文件需 `vi.mock('@/lib/storage')`（barrel 加载时触碰 chrome.runtime）
