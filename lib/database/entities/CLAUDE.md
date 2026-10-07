# Database Entities

一表一文件的 Drizzle schema。这里只记从列定义上看不出来的语义。

## 约束

- 新增表：entity 文件 + `../schema.ts` 导出 + `../types.ts` 类型 + 迁移脚本，四处一起改。
- entity 保持零运行时依赖：跨模块类型（`ModelMessage`、`CollectionPlatform`、`SubtitleSource`）只 `import type`。
- `check()` 的约束名必须与迁移 SQL 里的 `CONSTRAINT <name>` 同名。本仓库不用 drizzle-kit，entity 里的名字不会被任何东西读到，对不上也不报错。规则与已知残留（`items.content_state`）见 `../migrations/CLAUDE.md`。
- 平台 id 列不加 CHECK：接新平台不许要迁移。

## 各表

- `item_chunks.embedding` 声明的 `{ dimensions: 1536 }` 只是名义值（drizzle 必填，只喂本项目不用的 drizzle-kit）。真实维度由 `lib/embedding/vector-store.ts` 运行时 ALTER，事实源是 pg catalog 的 `atttypmod`。
- `item_chunks.start_sec` / `end_sec` 是字幕 chunk 的时间跨度，图文内容为 NULL。时间戳只存列，不混进 `chunk_text`（会污染向量）。
- `item_contents.subtitle_source` 只有转录正文有值。NULL 表示不是转录，或加列之前写入、不回填的 B 站行。
- `subtitle_source` 是字幕来源，不是 `sources` 表那个 **Source**（`CONTEXT.md`）。写正文必同时写它，不变量归 `lib/ingest/CLAUDE.md`。
- `tags` 的 name 全局唯一、无 userId（单用户扁平命名空间）、无 `updated_at`（行不可变，不支持重命名）。
- `chat_conversations.model_messages` 存整个模型态对话的全量，滑窗在喂模型处而不在存储。`updated_at` 由 v001 的触发器函数刷新。唯一写入方是 `lib/chat/history.ts`。

## `platform_sync_records`（Platform Sync Record）

- 每平台一行的 upsert 状态行，与 `sources` 同类：不受 insert-only 约束，也不是历史日志。
- 设备本地事实：将来的 WebDAV 数据同步（`lib/sync/CLAUDE.md`）必须排除本表。A 设备的记录合并到 B，B 会以为今天已同步过而压掉自己的每日自动同步。
- `platform` 存条目平台 id（github 是 `'github'`，不是 job 命名空间 `'github-stars'`）。
- `last_result` 在开跑时置 NULL，所以 NULL 表示未结束。
- `last_success_at` / `last_fetched` / `last_inserted` 由同一次成功一起写，失败不改它们。
- 唯一写入方是 app 侧 funnel，经 `lib/database/platform-sync-record.ts`。
