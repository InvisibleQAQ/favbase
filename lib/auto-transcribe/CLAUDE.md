# lib/auto-transcribe

平台无关的 producer-fed 串行转录状态机。它不抓远端分页、不查历史 pending、不读取 storage 或 app job store；平台 adapter 只提供单条转录、错误标记、ASR 配置等待、quota guard 与状态监听。

## 模块结构

- `types.ts` — `AutoTranscribeAdapter`、`AutoTranscribeVideo`、phase/state/stats/quota 类型。`configuration_required` 与 `quota_paused` 都是保留当前 session 的可恢复等待态。
- `pipeline.ts` — `AutoTranscribePipeline.createSession()` 创建单 producer inbox。session `append()` 按规范化 video id 去重并增长真实 total，`run(control?)` 串行领取条目，`close()` 表示 producer 结束；只有 close 且队列排空后才完成。普通单条失败 mark error 后继续，Fetch 生命周期完全不可见。

## 约定

- session 输入必须是已经持久化的新 Collection Item 事实；禁止在本模块重建 Source/folder/page crawler 或 historical pending scan。
- 缺 ASR 只在转录返回 `ASR_INVALID_KEY` 且当前配置确实无 key 时进入 `configuration_required`。保留当前条目，等待 adapter 的 `waitForAsrKey()`，经 cooperative checkpoint 后重试同一条。
- 临时 rate limit 最多重试一次；daily quota 写 durable guard，保留当前及后续条目到 reset 后重试，不计 skipped/error。新 session 遇未过期 guard 同样原地等待，不能依赖已删除的历史补扫。每条成功后的 CC/ASR pacing 保持独立。
- cooperative checkpoint 在 runner 入口（早于 durable quota guard 读取）、领取每条视频前及配置恢复后执行；Library Gate 由 app job runner 注入，pipeline 不 import app hooks。
- 实例归 app 层模块级 runtime 所有。组件只能订阅，不得在 mount/unmount 启动、dispose 或补扫队列。关闭 `app.html` 丢失 session 是明确的 page-runtime 契约。
