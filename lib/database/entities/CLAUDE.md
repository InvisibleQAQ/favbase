# Database Entities

Per-table Drizzle schema 定义（entity-per-file）。

## 模块结构

- `authors.ts` — authors 表（platform + platform_author_id 唯一约束）
- `sources.ts` — sources 表（收藏夹/播放列表）
- `items.ts` — items 表（核心条目，content_state 6 态 CHECK 约束，FK → authors）
- `item-sources.ts` — item_sources 关联表（复合主键 item_id + source_id）
- `item-contents.ts` — item_contents 表（1:1，PK = item_id FK → items）
- `tags.ts` — tags 表（name 全局唯一，无 userId——单用户扁平命名空间，无 updated_at——行不可变，重命名 out of scope）
- `item-tags.ts` — item_tags 关联表（复合主键 item_id + tag_id，双 FK cascade，tag_id 索引供按标签筛选）
- `chat-conversations.ts` — chat_conversations 表（Chat 多会话历史：`title` NOT NULL 可空串 + `model_messages` jsonb `$type<ModelMessage[]>` **全量**存整个模型态对话（滑窗在喂模型处，不在存储）；`ModelMessage` 从 `ai` 包 type-only import，编译期擦除保持零运行时依赖；updated_at 由 v001 触发器函数刷新。唯一写入方 `lib/chat/history.ts`）
- `item-chunks.ts` — item_chunks 表（embedding 列：Drizzle 声明 `{ dimensions: 1536 }` 仅为名义值——drizzle 必填但只喂 drizzle-kit DDL 生成（本项目不用），实际列维度跟随当前 embedding 模型由 `lib/embedding/vector-store.ts` 运行时 ALTER，唯一真相在 pg catalog `atttypmod`；另含 nullable `start_sec`/`end_sec` real 列：字幕 chunk 时间跨度（首行 start/末行 end），图文内容与 v003 前旧行为 NULL；时间戳只存列不混入 chunk_text）

## 约定

- Drizzle Schema: entity-per-file（`lib/database/entities/`），`schema.ts` 集中导出，`types.ts` 仅 type 导出（无运行时依赖，proxy 线程安全导入）。新增表：添加 entity 文件 + 更新 schema.ts + types.ts + 写迁移脚本
