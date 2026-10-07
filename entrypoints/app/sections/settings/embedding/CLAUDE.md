# Settings Embedding

Embedding 配置卡、向量统计与手动重建。五卡共用的「测试→验证→保存」模型见父目录 `../CLAUDE.md`。

## 约束

- 卡片 surface 由父目录的 `SettingsPanel` 提供，本目录不自画 Card/Header/Content。
- 没有启用开关：`enabled` 由 `resolveEmbeddingConfig` 从 apiKey 派生，别加回开关字段。
- 全部字段都是连接字段（含 `dimensions`）：维度会改变探针返回值，改任何一项都必须重测才能保存。
- 探针返回维度超过 `MAX_INDEXABLE_DIMENSIONS` 不算验证通过（`acceptResult` 拒绝）：存了也无法入库。
- 重建恒走已保存配置（`resolveEmbeddingConfig(settings)`，与 indexing 同源），不看未保存的 draft。
- 重建先在本地判「未配置」，再 `ensure(saved.baseUrl)`：不为无法 embed 的 provider 弹授权恢复 Dialog。
- 整张卡只有一个 `useHostPermission()` 实例，`ensure` 同时传给测试与重建，Dialog 唯一。
- 统计只展示 DB durable 事实：`use-embedding-stats.ts` 订阅 `item-content-updated` / `item-embedded` 领域事件合并刷新；不得用临时 job progress 冒充 Indexed Vectors / Total Chunks。
- 两个 hook 互不感知，「重建完刷新统计」只在卡片里接线。
- provider 请求的串行与超时不属于 UI，归 `lib/embedding/indexing.ts` 与 `lib/ai/embedding.ts`。

## 坑

- 维度 Select 的「自动」用哨兵 `"auto"` ↔ `undefined`，不能用 `""`：MUI Select 把空串当成未选择。
- hook 测试的 mock 只放在 DB / 领域事件边界。
