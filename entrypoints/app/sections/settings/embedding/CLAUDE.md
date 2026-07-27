# Settings Embedding

Embedding 配置卡、向量统计与手动重建 hooks。详细配置契约见父目录 `../CLAUDE.md`。

- `use-embedding-stats.ts` 只展示 DB durable 事实；挂载读取一次，并在 content/embedding 成功领域事件后以 100ms 窗口合并刷新。
- provider 请求串行与超时不属于 UI，分别由 `lib/embedding/indexing.ts` 与 `lib/ai/embedding.ts` 负责。
- hook 测试使用 happy-dom，mock 只放在 DB/领域事件边界。
