# lib/auto-transcribe

自动转录状态机（平台无关）：两层架构分离通用状态机与平台适配器。

## 模块结构

两层架构：通用状态机 + 平台适配器。状态机管理 phase 生命周期、countdown、progress 订阅、abort、useSyncExternalStore 契约。平台适配器提供 auth、数据获取、转录、错误标记等平台特定操作。

- `types.ts` — 适配器接口 `AutoTranscribeAdapter`（auth/page/pending/preview/transcribe/error/key/status + `getQuotaPause/setQuotaPause` 10 方法；`transcribe(videoId, title, onIndexing?)` 的 `onIndexing` 在转录成功后、本地 chunk+embed 索引期间触发）+ 通用 video/page/preview/quota/state 类型。`AutoTranscribePhase` 含非运行终态 `quota_paused`，`quotaResetAt` 提供 UI 与显式重启 guard
- `pipeline.ts` — `AutoTranscribePipeline` class（构造函数注入 adapter）：普通 `ASR_RATE_LIMIT` 优先使用 provider `retryAfter`，缺失才回退 60 秒；首次或重试遇 `ASR_QUOTA_EXCEEDED` 都进入同一个暂停路径，立即结束本轮且不 claim 下一视频、不递减 remaining、不增加 skipped、不 mark error、不报告 done。provider-scoped reset guard 经 adapter 持久化；重置前拒绝 start，过期只解除 guard，必须用户显式 start，绝不自动恢复。已入队 Embed/Tags 不受状态机控制，继续由独立 lane 排空

## 约定

- 自动转录架构: 两层分离 — `lib/auto-transcribe/pipeline.ts` 是平台无关状态机（phase 生命周期 + countdown + progress + abort + useSyncExternalStore），`lib/bilibili/auto-transcribe-adapter.ts` 是 Bilibili 适配器实现。Pipeline 通过构造函数注入 `AutoTranscribeAdapter` 接口，零平台 import。新增平台自动转录：实现 `AutoTranscribeAdapter` 接口 + 在消费者处注入。`collectionId` 统一 `string` 类型，Bilibili 侧 `Number(collectionId)` 转换
