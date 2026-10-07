# bilibili-video.content/hooks

面板的数据流与状态 hooks（视频检测 / 字幕 / 转录 / AI 总结）。

## 约束

- 字幕缓存是共享的，下游按 bvid 无条件信任：`CACHE_SUBTITLE` 写进去的行会被转录管线的缓存命中（`lib/transcription/pipeline.ts`）直接投递进 DB。这里只允许写两个来源：bvid 匹配的拦截通道，或 `lib/bilibili/bilibili-api.ts` 的 `fetchSubtitle`。
- 不要在 content script 里绕过 `fetchSubtitle` 自己请求字幕，尤其是非 wbi 的 `x/player/v2`：已登录请求会拿到别的视频的 AI 字幕。`fetchSubtitle` 走 `x/player/wbi/v2` 并校验轨道归属（docs/29）。
- `useSubtitle` 里拦截通道与 API 降级「先到先得」的竞态刻意不加仲裁：两个通道都只可能给出本视频的轨道，竞态没有正确性含义（docs/29 Step 2）。
- 发消息统一用 `lib/background/client.ts` 的 `sendBackgroundMessage` / `onBackgroundPush`（响应与 push 已解码，协议错误进现有失败状态），禁止对响应做裸 `as` 断言。
- 已知缺口：`useTranscribe` / `useSummary` 在 bvid 切换时发的 `*_ABORT` 仍是裸 `browser.runtime.sendMessage`（fire-and-forget、不读响应），新代码别照抄。
- 所有异步回调都要过 staleness 守卫（`bvidRef` / `isStale`）：SPA 切视频后，视频 A 的结果不得落到视频 B 的面板。
- `useSummary` 只在 `generating` 时接受 `SUMMARY_STATUS` 推送，防止已取消 / 已完成后被迟到的推送覆盖；`GET_SUMMARY_CACHE` 是只读探针，永不触发 LLM。
- 总结不经消息通道传字幕：background 直接读字幕缓存（rows 有几十 KB）。
- 「官方字幕优先 → ASR 降级」的策略归 Background handler，hooks 不做决策。

## 坑

- 握手里 `cid = 0` 时不要锁定 resolved，要等后续重发；握手超时才降级到 `fetchCidByPageList`。
- 字幕获取的网络异常降级为 `no_subtitle` 而不是 `error`；`App.tsx` 在两种状态下都展示转录按钮。
