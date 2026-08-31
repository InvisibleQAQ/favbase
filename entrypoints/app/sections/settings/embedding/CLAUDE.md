# Settings Embedding

Embedding 配置卡、向量统计与手动重建 hooks。详细配置契约见父目录 `../CLAUDE.md`。

`embedding-config-card.tsx` 的 section surface 由父目录 `SettingsPanel` 提供；本目录只装配字段、统计和重建状态，不再自画 Card/Header/Content。

- `use-embedding-stats.ts` 只展示 DB durable 事实；挂载读取一次，并在 content/embedding 成功领域事件后以 100ms 窗口合并刷新。
- provider 请求串行与超时不属于 UI，分别由 `lib/embedding/indexing.ts` 与 `lib/ai/embedding.ts` 负责。
- hook 测试使用 happy-dom，mock 只放在 DB/领域事件边界。
