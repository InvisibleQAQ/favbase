# favbase

B站收藏自动转知识库的 Chromium 浏览器扩展。本地优先，可选 WebDAV 同步。

## 技术栈

- **框架**: WXT 0.20.26 (Vite) + React 19 + TypeScript 5.9
- **架构**: Chrome MV3 (Service Worker + Content Script + Shadow DOM UI)
- **存储**: WXT `storage.defineItem`（设置/缓存），后续接入 PGlite + pgvector（知识库）
- **包管理**: pnpm

## 当前状态

MVP 阶段，首个功能：B站视频转录（Bilitato 风格视频页面 AI 助手）。

## 入口点

- `entrypoints/background.ts` — Background Service Worker
- `entrypoints/bilibili-inject.content.ts` — B站视频页 Main World 脚本（`world: 'MAIN'`，`runAt: 'document_start'`）：读取 `__INITIAL_STATE__` 获取 CID、拦截 fetch/XHR 被动捕获字幕、自动触发 CC 按钮、通过 postMessage 桥接数据到 Isolated World
- `entrypoints/bilibili-video.content/` — B站视频页 Content Script（Shadow DOM React UI，Isolated World）
- `entrypoints/popup/` — Popup（暂未实现业务逻辑）

## 关键文档
- 使用wxt框架进行开发, 必须使用 `context7 mcp`查询 wxt文档.
- `docs/03_favbase-prd.md` — 完整 PRD（知识库全功能）
- `docs/04_bilibili-transcription-spec.md` — B站视频转录功能实现规格
- `.trellis/` — Trellis 开发工作流配置

## 参考项目

- `C:\Users\18368\Desktop\00_myCode\24_cyberSquirrel\02_Bilitato` — Bilitato 开源项目，B站视频 AI 助手，是视频转录功能的主要参考实现

## 模块结构

### B站字幕获取 (Step 1 — 已完成，Bilitato 对齐)

双通道架构：Main World 脚本拦截优先，API 调用降级。

- `lib/types.ts` — SubtitleRow, SubtitleResult, VideoInfo, RawSubtitleItem, SubtitleHandshakeMessage, SubtitleDataMessage, SubtitleRouteSwitchMessage 类型
- `lib/bilibili/video-info.ts` — extractBvid(), extractPageNum(), fetchVideoInfo(), getCidForPage(), fetchCidByPageList()（CID 降级路径，用 `/x/player/pagelist` 比 `/x/web-interface/view` 更轻量）
- `lib/bilibili/subtitle-fetcher.ts` — fetchBilibiliSubtitle()（API 降级路径，CDN fetch 带 credentials，响应解析含 5 层 fallback）
- `lib/bilibili/subtitle-processor.ts` — processSubtitles() 四步管线：normalize -> filter -> filler removal -> deduplicate(Jaccard>0.85)。接受 B 站原始格式和 favbase 格式。每条字幕保持独立行，不合并
- `entrypoints/bilibili-inject.content.ts` — Main World 脚本：`__INITIAL_STATE__` CID 读取 + fetch/XHR 拦截 + 自动触发 CC 按钮（stealth CSS 隐藏字幕显示）+ postMessage 桥接 + 定期重发 HANDSHAKE/DATA（`startReemitLoop`，每 1s 持续 10s，解决 content script 晚加载丢消息）+ 300ms SPA 路由轮询（`startRouteMonitor`）+ 路由变化时 `hardResetForRoute` 级联重置
- `entrypoints/bilibili-video.content/` — 嵌入B站右侧栏的面板 UI
  - `index.ts` — 挂载逻辑：anchor 到 `.right-container-inner`，插在 UP 主面板后，`autoMount()` 处理 SPA 切换
  - `hooks/useVideoDetect.ts` — 持久 postMessage 监听器：响应 BILI_ROUTE_SWITCH（SPA 导航重置）+ BILI_SUBTITLE_HANDSHAKE（bvid/cid 解析，cid=0 时不锁定 resolved 等待后续重发），3s 超时降级到 fetchCidByPageList API
  - `hooks/useSubtitle.ts` — 双通道：优先接收 postMessage SUBTITLE_DATA（拦截数据），3s 超时降级到 fetchBilibiliSubtitle API + 失败时自动重试（最多 2 次，间隔 3.5s）；两通道均通过 processSubtitles() 处理
  - `components/Panel.tsx` — 主面板容器：左侧图标栏（数组驱动，CC 等 Tab）+ 右侧内容区（header + 可折叠 body）
  - `components/SubtitleView.tsx` — 逐行字幕列表 + 时间戳点击跳转 + 当前播放行高亮（250ms 轮询 `<video>.currentTime`，二分查找活跃行）+ 自动滚动（尊重用户手动滚动意图，4s 超时恢复）
  - `components/StatusBar.tsx` — 加载/无字幕/错误状态

## 约定

- Content Script UI 使用 WXT `createShadowRootUi` + React，`cssInjectionMode: 'ui'`，`isolateEvents: true`，嵌入 B 站右侧栏（`autoMount` + anchor 降级链）
- Step 1 字幕获取: 双通道架构 — Main World 脚本（`bilibili-inject.content.ts`）拦截 fetch/XHR 被动捕获字幕优先，3s 超时降级到 Content Script 同源 API 调用
- CID 获取: Main World 读取 `window.__INITIAL_STATE__` 优先（定期重发直到 content script 接收），降级到 `/x/player/pagelist` API（轻量，不需要 WBI 签名）
- postMessage 桥接: Main World -> Isolated World，类型 `BILI_ROUTE_SWITCH`(bvid, 路由变化即时通知) → `BILI_SUBTITLE_HANDSHAKE`(bvid+cid, 800ms延迟) → `BILI_SUBTITLE_DATA`(字幕数据)
- 字幕后处理: 所有字幕数据（无论来源）均通过 `processSubtitles()` 四步管线处理（不合并，逐条独立）
- 后续 Groq/LLM 需要时再引入 Background 消息桥
- 存储: WXT `storage.defineItem`（`local:` 前缀）
- SPA 路由监控: inject.ts 300ms 轮询 location.href 检测 BV 号/分P 变化 → hardResetForRoute() 级联重置 → ROUTE_SWITCH 即时通知 → 800ms 后重发 HANDSHAKE → 重触发 CC 按钮
- 字幕获取流程（主路径）: inject.ts 拦截 fetch/XHR → postMessage SUBTITLE_DATA → useSubtitle 接收 → processSubtitles()
- 字幕获取流程（降级路径）: extractBvid() → fetchCidByPageList() → fetchBilibiliSubtitle(bvid, cid) → processSubtitles()（失败自动重试最多 2 次）
- 字幕 CDN (`aisubtitle.hdslb.com`) 跨域但 CORS 允许，Content Script 可直接 fetch（带 `credentials: 'include'`）
- 无字幕降级: Groq Whisper API (`whisper-large-v3-turbo`)（Step 2）
- LLM 总结: OpenAI 协议兼容多 Provider，Quality/Efficiency 两种模式（Step 2）
