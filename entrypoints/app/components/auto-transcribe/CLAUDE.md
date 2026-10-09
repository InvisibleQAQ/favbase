# app/components/auto-transcribe

自动转录进度条 `AutoTranscribeBar` 与订阅 hook `useAutoTranscribe(pipeline)`，各转录平台的收藏页共用（docs/37 D-d）。

## 约束

- bar 在 idle 时返回 null：pipeline strip 的 Transcribe 段已承载覆盖率。配额暂停是 `role="status"`，不是 alert。
- `configuration_required` 不画：缺前置条件（ASR key、平台标签页）的提醒由页面的 `CollectionConfigurationNotice` 统一出，进度条不重复画 warning。
- bar 自持下边距（`mb`）：scaffold 的 operation slot 不加间距。
- `useAutoTranscribe` 是传入 pipeline 单例的纯 `useSyncExternalStore` 订阅：不得加 mount 查询或 start / stop / dispose 副作用。pipeline 实例归各平台 section 的 `auto-transcribe-runtime.ts`，本目录不 import 任何平台模块。
