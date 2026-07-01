# lib/auto-transcribe

自动转录状态机（平台无关）：两层架构分离通用状态机与平台适配器。

## 模块结构

两层架构：通用状态机 + 平台适配器。状态机管理 phase 生命周期、countdown、progress 订阅、abort、useSyncExternalStore 契约。平台适配器提供 auth、数据获取、转录、错误标记等平台特定操作。

- `types.ts` — 适配器接口 `AutoTranscribeAdapter`（8 方法：checkAuth/fetchPage/getPendingIds/getPreview/transcribe/markError/hasAsrKey/createStatusListener）+ 通用类型：`AutoTranscribeVideo`（videoId/title/cover/author/duration/isInvalid）、`AutoTranscribePageResult`、`AutoTranscribePreview`、`AutoTranscribeState`（phase/stats/currentVideo/countdown/previewLoading 等 UI 状态，previewLoading 区分初始态与查询完毕态）、`AutoTranscribePhase`（7 态：idle/syncing/transcribing/waiting/paused/done/cancelled）
- `pipeline.ts` — `AutoTranscribePipeline` class（构造函数注入 `AutoTranscribeAdapter`）：`subscribe()`/`getSnapshot()` 支持 `useSyncExternalStore`，`start(collectionId)`/`stop()` 控制接口，`queryPreview(collectionId)` idle 态预览查询。编排流：adapter.checkAuth → 分页 adapter.fetchPage → adapter.getPendingIds → 逐个 adapter.transcribe（CC 5-10s / ASR 10-15s 随机间隔）→ rate limit 暂停 60s 重试 → 下一页。零平台依赖，通过 adapter 接口消费所有平台操作。新增平台只需实现 `AutoTranscribeAdapter` 接口

## 约定

- 自动转录架构: 两层分离 — `lib/auto-transcribe/pipeline.ts` 是平台无关状态机（phase 生命周期 + countdown + progress + abort + useSyncExternalStore），`lib/bilibili/auto-transcribe-adapter.ts` 是 Bilibili 适配器实现。Pipeline 通过构造函数注入 `AutoTranscribeAdapter` 接口，零平台 import。新增平台自动转录：实现 `AutoTranscribeAdapter` 接口 + 在消费者处注入。`collectionId` 统一 `string` 类型，Bilibili 侧 `Number(collectionId)` 转换
