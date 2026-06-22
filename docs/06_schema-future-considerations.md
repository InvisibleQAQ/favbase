# Schema 未来演进备忘

v1 schema 设计时识别出的未来扩展点，当前不纳入，记录备查。

## 1. LLM 总结（Step 3 预留）

LLM 总结功能需要存储 AI 生成的摘要。建议方案：

- 在 `items` 表新增 `summary TEXT NULL` 列（通过迁移脚本）
- `item_contents` 存原始纯文本不变，`summary` 是派生产物
- 摘要可能需要独立的 embedding（摘要语义 vs 原文语义），届时评估是否在 `items` 上加 `summary_embedding VECTOR(1536)` 或复用 chunk 管线

迁移成本：一条 `ALTER TABLE items ADD COLUMN summary TEXT`，零破坏性。

## 2. 标签/话题系统

PRD User Story 当前只有"按 UP 主过滤"，未来可能需要标签维度。建议方案：

```sql
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE item_tags (
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);
```

- 标签来源：用户手动打标 / LLM 自动提取 / 平台原生标签（B站分区、小红书话题等）
- 可从 `items.platform_meta` JSONB 中的平台标签迁移到 `tags` 表
- 当前 `platform_meta` 已经可以存平台原生标签，正式 tag 系统是上层抽象

## 3. 边界情况与运维

### 同一视频重复导入

- `items` 表 `UNIQUE(platform, platform_item_id)` 约束天然去重
- 从不同收藏夹导入同一视频时，只新增 `item_sources` 关联行，不重复创建 item
- 应用层：`INSERT ... ON CONFLICT DO NOTHING` 或先查后插

### 内容消失（视频下架/删稿）

- `content_state` 标记为 `no_content`，已入库的文本和 chunk 保留不删
- 用户搜索仍能命中已存内容（本地优先的核心价值）
- 未来可加 `is_available` 布尔列标记原始链接是否仍可访问

### VideoCacheEntry 与 PGlite 并存

- 现有字幕获取流程写 `chrome.storage.local`（VideoCacheEntry）
- Ingestion Pipeline 写 PGlite `item_contents` + `item_chunks`
- 过渡期两者并存：Content Script 实时播放用 cache，知识库搜索用 PGlite
- 最终 cache 可退化为纯热缓存，PGlite 是持久化唯一真实来源

### PGlite 存储配额

- IndexedDB 配额通常 ≥500MB（Chrome 按磁盘空间动态分配）
- 5000 条视频估算 ~330MB（含向量索引），在安全范围内
- 超限时 `storage.estimate()` API 可提前预警
- v1 不需要 schema 层面处理，应用层监控即可
