# bilibili-video.content/hooks

B站视频页面板 UI 数据流与状态管理 hooks

## 模块结构

- `useVideoDetect.ts` — 通过 onBiliMessage() 订阅 BILI_ROUTE_SWITCH（SPA 导航重置）+ BILI_SUBTITLE_HANDSHAKE（bvid/cid 解析，cid=0 时不锁定 resolved 等待后续重发），3s 超时降级到 fetchCidByPageList API
- `useSubtitle.ts` — 三层数据流：(1) GET_VIDEO_CACHE 缓存优先加载 (2) onBiliMessage() 拦截通道 (3) fetchSubtitle API 降级 + 重试。所有成功获取的字幕通过 CACHE_SUBTITLE 消息写入 Background 缓存。跨 tab 同步通过 `onVideoCacheChange(bvid, cb)` 订阅（`lib/cache/video-cache.ts` 封装 key 格式）。返回 { rows, loading, status, error, source, cached }
- `useTranscribe.ts` — 转录状态管理：`sendBackgroundMessage({ type:'TRANSCRIBE_AUDIO', platform:'bilibili', videoId:bvid, cid, title })` → `onBackgroundPush('TRANSCRIBE_STATUS', ...)` 监听推送（匹配 `m.videoId`）→ 已解码结果/错误。useRetryCountdown 共享倒计时。SPA 切换时自动重置（bvidRef staleness guard：Promise 回调检查 bvidRef.current 是否仍匹配，防止视频 A 的转录结果写入视频 B）。官方字幕优先 → ASR 降级策略由 Background handler 层统一管理

- `useSummary.ts` — AI 总结状态机（镜像 useTranscribe）：bvid 变化时先通过 typed Background client 发 `SUMMARIZE_ABORT` 旧视频 → 重置 → 发 `GET_SUMMARY_CACHE` 只读探针（命中即展示，永不触发 LLM）。`generate()`/`regenerate()` 走同一个 `run(force)` 发 `SUMMARIZE_VIDEO`；订阅 `onBackgroundPush('SUMMARY_STATUS', ...)` 刷新流式 Markdown（**仅在 generating 时接受**，防止已取消/已完成后被迟到的推送覆盖）。全部回调经 `isStale(bvid)` 守卫，SPA 切视频后旧结果不会落到新视频面板。字幕不由本 hook 传——background 直接读字幕缓存，避免几十 KB 的 rows 走消息通道

## 约定

- 无字幕降级: useSubtitle 返回 no_subtitle（网络异常也降级为 no_subtitle 而非 error）→ App 显示 TranscribeButton（status 为 no_subtitle 或 error 时均展示）→ 用户点击 → TRANSCRIBE_AUDIO（含 `platform:'bilibili'`）→ Background dispatcher 按 platform 分发到 `handleBiliTranscribe`（adapter 准备平台碎片 → 组装 PipelineDeps → pipeline 统一编排）→ 结果回写 SubtitleView
- Runtime 消息：hooks 不直接调用 `browser.runtime.sendMessage`，统一使用 `lib/background/client.ts` 的 `sendBackgroundMessage`/`onBackgroundPush`；响应和 push 已在 client 解码，协议错误进入现有失败状态，不允许裸 `as TranscribeResponse`/`as SummaryResponse`
