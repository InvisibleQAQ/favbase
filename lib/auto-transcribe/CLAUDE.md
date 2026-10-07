# lib/auto-transcribe

平台无关的 producer-fed 串行转录状态机。平台 adapter 只提供单条转录、错误标记、ASR 配置等待、quota guard 与状态监听。

## 约束

- 本模块不抓远端分页、不查历史 pending、不读 storage、不 import app 层的 hooks / job store。session 的输入必须是已持久化的新 Collection Item；禁止在这里重建 Source / folder / page crawler 或历史补扫。
- session 是单 producer inbox：`append()` 按规范化 video id 去重并增长真实 total，`close()` 表示 producer 结束。完成要三个条件同时成立：已 close、队列排空、停放的缺 ASR 条目已恢复。
- 普通单条失败标记 error 后继续下一条，不中断 session。
- 缺 ASR 只在转录返回 `ASR_INVALID_KEY` 且当前配置确实没有 key 时触发：当前条目停放，后续视频继续消费；`waitForAsrKey()` 恢复后停放条目按原顺序重新入队，过一次 checkpoint 再重试。
- `configuration_required` 只在没有其他可运行条目时才成为 phase；`asrBlocked` 是独立的 UI 阻塞信号，两者不要合并。它与 `quota_paused` 都是保留当前 session 的可恢复等待态。
- 临时 rate limit 每条最多重试一次。daily quota 写 durable guard，当前及后续条目留到 reset 后重试，不计入 skipped / error；新 session 遇到未过期的 guard 同样原地等待。
- cooperative checkpoint 的位置是契约：runner 入口（早于读 durable quota guard）、领取每条视频前、配置恢复后。Library Gate 由 app 层的 job runner 注入。
- 实例归 app 层模块级 runtime 所有。组件只能订阅，不得在 mount / unmount 时启动、dispose 或补扫队列。关闭 app.html 会丢 session，这是明确的 page-runtime 契约，不是 bug。
