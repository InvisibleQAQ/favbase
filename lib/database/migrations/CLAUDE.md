# Database Migrations

自定义迁移系统。

## 模块结构

- `index.ts` — `runMigrations(pg)` 跑迁移：读 `_migrations` 表 → 按 version 顺序执行未应用的迁移
- `v001-init.ts` — v1 初始化：CREATE EXTENSION + 6 张业务表 + 索引 + GIN trigram 索引 + updated_at 触发器
- `v002-vector-index.ts` — v2 向量索引：`CREATE INDEX IF NOT EXISTS idx_item_chunks_embedding ON item_chunks USING hnsw (embedding vector_cosine_ops)`。选 HNSW（pglite-pgvector 0.0.4 同时支持 hnsw/ivfflat；HNSW 无需 training step，IVFFlat 需预填数据建 centroid）。`vector_cosine_ops` 配 `<=>` 运算符（`lib/embedding` 语义检索用）。`IF NOT EXISTS` 保证幂等
- `v003-chunk-timestamps.ts` — v3 chunk 时间戳：`ALTER TABLE item_chunks ADD COLUMN IF NOT EXISTS start_sec REAL / end_sec REAL`（nullable）。字幕 chunk 保住时间跨度供未来"跳转视频时间点"，时间戳只存列不混入 chunk_text（污染向量）。旧行/图文内容为 NULL。`IF NOT EXISTS` 保证幂等

- `v004-tags.ts` — v4 AI 标签：`CREATE TABLE IF NOT EXISTS tags`（name 唯一）+ `item_tags`（复合 PK + 双 FK cascade + tag_id 索引）。平台无关 M:N，未来文章/仓库 item 直接复用。`IF NOT EXISTS` 保证幂等
- `v005-chat-conversations.ts` — v5 Chat 会话历史：`CREATE TABLE IF NOT EXISTS chat_conversations`（整会话 jsonb 行：title + model_messages 全量 + created_at/updated_at）。复用 v001 的 `update_updated_at_column()` 触发器函数；触发器用 `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` 保证幂等（PG 无 `CREATE TRIGGER IF NOT EXISTS`）

## 约定

- 数据库迁移: 自定义迁移系统（非 drizzle-kit），`_migrations` 表追踪版本。迁移脚本直接写 SQL（不用 Drizzle 内部 Symbol 反射）。`runMigrations(pg)` 在 `initDbMain()` 内自动执行。新增迁移：在 `lib/database/migrations/` 添加 `vNNN-*.ts`，在 `index.ts` 的 `migrations` 数组追加条目
- embedding 列维度不归迁移系统管：v001 建列为 vector(1536) 只是初始值，运行时由 `lib/embedding/vector-store.ts` 的惰性维度切换（`ALTER ... TYPE vector(N) USING NULL::vector(N)`）跟随当前模型改动，v002 的 HNSW 索引在 ALTER 时被 PostgreSQL 自动重建（opclass 保留）。当前维度真相在 pg catalog（`atttypmod`），迁移脚本不感知
