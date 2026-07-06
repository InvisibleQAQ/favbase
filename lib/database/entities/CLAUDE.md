# Database Entities

Per-table Drizzle schema 定义（entity-per-file）。

## 模块结构

- `authors.ts` — authors 表（platform + platform_author_id 唯一约束）
- `sources.ts` — sources 表（收藏夹/播放列表）
- `items.ts` — items 表（核心条目，content_state 6 态 CHECK 约束，FK → authors）
- `item-sources.ts` — item_sources 关联表（复合主键 item_id + source_id）
- `item-contents.ts` — item_contents 表（1:1，PK = item_id FK → items）
- `item-chunks.ts` — item_chunks 表（含 VECTOR(1536) embedding 列 + nullable `start_sec`/`end_sec` real 列：字幕 chunk 时间跨度（首行 start/末行 end），图文内容与 v003 前旧行为 NULL；时间戳只存列不混入 chunk_text）

## 约定

- Drizzle Schema: entity-per-file（`lib/database/entities/`），`schema.ts` 集中导出，`types.ts` 仅 type 导出（无运行时依赖，proxy 线程安全导入）。新增表：添加 entity 文件 + 更新 schema.ts + types.ts + 写迁移脚本
