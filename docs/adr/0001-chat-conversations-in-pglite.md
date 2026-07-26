# Chat 会话历史存 PGlite，只读铁律收窄为表级边界

Chat 曾有文档铁律「全程只读 PGlite、绝不写库」，会话历史存 WXT `local:` storage 单数组。我们决定把 Conversation 迁入 PGlite 新表 `chat_conversations`（整会话 jsonb upsert）：动机是数据归属统一——所有持久结构化数据同库，备份导出（`EXPORT_TABLES` 从 schema 派生）与未来 WebDAV 数据同步（主键并集）零改动自动覆盖，同时消除单数组「每次 save 重写全部会话」的写放大。铁律相应收窄为表级边界：**Chat 的知识库检索工具对 Collection 表仍然 SELECT-only；Chat 唯一可写的表是 `chat_conversations`**。

## Considered Options

- **归一化 conversations + messages 两表** — 拒绝：行级粒度当前无消费者（对话历史搜索非近期需求），`ModelMessage` 是复杂 union，逐行归一化只是把同一坨 jsonb 切碎。
- **留在 WXT storage** — 拒绝：备份/同步不覆盖、写放大；`unlimitedStorage` 已有故 quota 从来不是理由，动机是归属统一。

## Consequences

- 会话**全量存储不再 trim**：40 条滑窗的存储动机已死，`trimMessages` 只在喂模型前应用（含对齐 user 轮防孤立 tool-result）。长对话 reload 后完整可见。
- 会话历史可用性与 offscreen PGlite RPC 绑定：载入失败必须显示错误态，不得静默装成"没有会话"。
- 未来做对话历史搜索需再迁 schema（知情接受）。
