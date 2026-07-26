# lib/auto-transcribe

自动转录状态机（平台无关）：两层架构分离通用状态机与平台适配器。

## 模块结构

两层架构：通用状态机 + 平台适配器。状态机管理 phase 生命周期、countdown、progress 订阅、abort、useSyncExternalStore 契约。平台适配器提供 auth、数据获取、转录、错误标记等平台特定操作。

- `types.ts` — 适配器接口 `AutoTranscribeAdapter`（auth/page/pending/preview/transcribe/error/key/status + `getQuotaPause/setQuotaPause` 10 方法；`transcribe(videoId, title, onIndexing?)` 的 `onIndexing` 在转录成功后、本地 chunk+embed 索引期间触发）+ 通用 video/page/preview/quota/state 类型。`AutoTranscribePhase` 含非运行终态 `quota_paused`，`quotaResetAt` 提供 UI 与显式重启 guard
- `pipeline.ts` — `AutoTranscribePipeline` class（构造函数注入 adapter）：普通 `ASR_RATE_LIMIT` 优先使用 provider `retryAfter`，缺失才回退 60 秒；首次或重试遇 `ASR_QUOTA_EXCEEDED` 都进入同一个暂停路径，立即结束本轮且不 claim 下一视频、不递减 remaining、不增加 skipped、不 mark error、不报告 done。**`start(collectionId, control?)` 为 async 且先 `await adapter.getQuotaPause()` 读持久 guard 再决定跑不跑**（修复竞态：新实例内存 `quotaResetAt` 为 null，自动调用会撞上窗口；读失败回退内存镜像；`startPending` 防 await 期间重入，`isActive()` 供调度方去重）；guard 未到期 = patch `quota_paused` 后静默跳过——恢复 = 下一次自动 start（次日每日自动同步重评），2026-07-26 起**不再要求用户显式重启**（推翻旧「绝不自动恢复」ADR，按钮已随统一控制面删除）。可选 `CooperativeCheckpoint`（`@/lib/collections` 纯类型）在进入网络前、每页前、每条视频领取前 `await checkpoint()`——闸门 born-paused/暂停在 item 边界生效，不取消 run。已入队 Embed/Tags 不受状态机控制，继续由独立 lane 排空

## 约定

- 自动转录架构: 两层分离 — `lib/auto-transcribe/pipeline.ts` 是平台无关状态机（phase 生命周期 + countdown + progress + abort + useSyncExternalStore），`lib/bilibili/auto-transcribe-adapter.ts` 是 Bilibili 适配器实现。Pipeline 通过构造函数注入 `AutoTranscribeAdapter` 接口，零平台 import、零 storage、零 app hooks——cooperative checkpoint 由调用方（app 层 `startJob` runner）作为参数注入，不在本目录 import 闸门。新增平台自动转录：实现 `AutoTranscribeAdapter` 接口 + 在消费者处注入。`collectionId` 统一 `string` 类型，Bilibili 侧 `Number(collectionId)` 转换
- 实例归属: 生产实例是 app 层模块级单例（`entrypoints/app/sections/bilibili/auto-transcribe-runtime.ts`），随 `bilibili:transcribe` job 跨路由存活；`dispose()` 只服务测试/极端清理路径，组件卸载不再调用（旧的 hook-ref + 卸载 abort 形态已废）
