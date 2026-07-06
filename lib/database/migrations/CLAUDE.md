# Database Migrations

自定义迁移系统。

## 模块结构

- `index.ts` — `runMigrations(pg)` 跑迁移：读 `_migrations` 表 → 按 version 顺序执行未应用的迁移
- `v001-init.ts` — v1 初始化：CREATE EXTENSION + 6 张业务表 + 索引 + GIN trigram 索引 + updated_at 触发器
- `v002-vector-index.ts` — v2 向量索引：`CREATE INDEX IF NOT EXISTS idx_item_chunks_embedding ON item_chunks USING hnsw (embedding vector_cosine_ops)`。选 HNSW（pglite-pgvector 0.0.4 同时支持 hnsw/ivfflat；HNSW 无需 training step，IVFFlat 需预填数据建 centroid）。`vector_cosine_ops` 配 `<=>` 运算符（`lib/embedding` 语义检索用）。`IF NOT EXISTS` 保证幂等
- `v003-chunk-timestamps.ts` — v3 chunk 时间戳：`ALTER TABLE item_chunks ADD COLUMN IF NOT EXISTS start_sec REAL / end_sec REAL`（nullable）。字幕 chunk 保住时间跨度供未来"跳转视频时间点"，时间戳只存列不混入 chunk_text（污染向量）。旧行/图文内容为 NULL。`IF NOT EXISTS` 保证幂等

## 约定

- 数据库迁移: 自定义迁移系统（非 drizzle-kit），`_migrations` 表追踪版本。迁移脚本直接写 SQL（不用 Drizzle 内部 Symbol 反射）。`runMigrations(pg)` 在 `initDbMain()` 内自动执行。新增迁移：在 `lib/database/migrations/` 添加 `vNNN-*.ts`，在 `index.ts` 的 `migrations` 数组追加条目
