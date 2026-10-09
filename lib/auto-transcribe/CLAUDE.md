# lib/auto-transcribe

平台无关的 producer-fed 串行转录状态机。平台 adapter 只提供单条转录、错误标记、前置条件判定与等待、quota guard 与状态监听。

## 约束

- 本模块不抓远端分页、不查历史 pending、不读 storage、不 import app 层的 hooks / job store。session 的输入必须是已持久化的新 Collection Item；禁止在这里重建 Source / folder / page crawler 或历史补扫（抖音的 D7 积压补扫在 app 侧 producer 里喂进来，不在这里查）。
- session 是单 producer inbox：`append()` 按规范化 video id 去重并增长真实 total，`close()` 表示 producer 结束。完成要三个条件同时成立：已 close、队列排空、停放等前置条件的条目已恢复。
- 普通单条失败标记 error 后继续下一条，不中断 session。
- 前置条件（`TranscribePrerequisite`：ASR key、平台标签页）由 adapter 的 `missingPrerequisite(error)` **按此刻**判定，错误码本身不够（`ASR_INVALID_KEY` 但 key 已保存、`DOUYIN_TAB_MISSING` 但标签页在，都是普通单条失败）。判定为缺 → 当前条目停放，后续视频继续消费；`waitForPrerequisite(error)` 只在一轮停放的第一条被调、收那条错误（后停放的条目共用这一次等待），恢复后停放条目按原顺序重新入队，过一次 checkpoint 再重试。
- adapter 可以在等待期间短路 `transcribe()`（抖音对需要用户动作的前置条件这样做），本模块不替平台决定。
- `configuration_required` 只在没有其他可运行条目时才成为 phase；`prerequisiteBlocked` 是独立的 UI 阻塞信号（横幅按它选文案），两者不要合并。它与 `quota_paused` 都是保留当前 session 的可恢复等待态。
- 单条失败的判定顺序是契约：前置条件 → `ASR_QUOTA_EXCEEDED` → 带 `retryAfter` 的临时限流（按形状判，不按 `ASR_RATE_LIMIT` 码判；quota 先判是因为它也带 `retryAfter`）→ 普通失败。daily quota 写 durable guard，当前及后续条目留到 reset 后重试，不计入 skipped / error；新 session 遇到未过期的 guard 同样原地等待。
- 临时限流不计次、不标 error：条目不出队，`'paused'` 倒计时 `max(retryAfter, min(600, 60·2^(k-1)))` 秒后重试同一条，次数不设上限（docs/38）。k 是本 session 连续收到的临时限流次数（第一次为 1），任何其他结果（成功、普通失败、抛错、停放、quota）即复位。
- 上一条的下限存在是因为 provider 的 `retry-after` 单独不可信：Groq ASPH 等满 7–21 s 仍被拒（docs/37 Step 4）。60 / 600 是共享机制的模块常量，不走平台 `envNumber`。
- 别加回单条重试上限（docs/38 §2 否决清单）：v1 没有 `'error'` 的重试入口、积压补扫只捡 `'pending'`，上限等于永久丢条目。超长作品靠 Offscreen 的分块续传才能结束（`lib/offscreen/CLAUDE.md`），不是靠放弃。
- cooperative checkpoint 的位置是契约：runner 入口（早于读 durable quota guard）、领取每条视频前、配置恢复后、quota 与临时限流的等待结束后（重发同一条之前：限流等待可长达 30 min，期间按下的暂停必须挡住重发）。Library Gate 由 app 层的 job runner 注入。
- 上一条里重发同一条之前的两个 checkpoint 放行后要再 `throwIfAborted()`（与领取每条视频前同形）：checkpoint 不认 `stop()`，暂停期间按下的停止否则会在放行后重发，普通失败还会 `markError`。
- `'paused'` / `'waiting'` / `'quota_paused'` 的倒计时秒数一律从 deadline 算，不逐 tick 递减：后台标签页的定时器被节流，而等待长到 30 min（平台冷却）或 quota reset。
- 实例归 app 层模块级 runtime 所有。组件只能订阅，不得在 mount / unmount 时启动、dispose 或补扫队列。关闭 app.html 会丢 session，这是明确的 page-runtime 契约，不是 bug。
