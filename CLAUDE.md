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
- `entrypoints/bilibili-video.content/` — B站视频页 Content Script（Shadow DOM React UI）
- `entrypoints/popup/` — Popup（暂未实现业务逻辑）

## 关键文档
- 使用wxt框架进行开发, 必须使用 `context7 mcp`查询 wxt文档.
- `docs/03_favbase-prd.md` — 完整 PRD（知识库全功能）
- `docs/04_bilibili-transcription-spec.md` — B站视频转录功能实现规格
- `.trellis/` — Trellis 开发工作流配置

## 参考项目

- `C:\Users\18368\Desktop\00_myCode\24_cyberSquirrel\02_Bilitato` — Bilitato 开源项目，B站视频 AI 助手，是视频转录功能的主要参考实现

## 模块结构

### B站字幕获取 (Step 1 — 已完成)

全部在 Content Script 中完成，不经过 Background。Content Script 运行在 bilibili.com 域下，对 api.bilibili.com 的 fetch 是同源请求，Cookie 自动携带。

- `lib/types.ts` — SubtitleRow, SubtitleResult, VideoInfo 类型
- `lib/bilibili/video-info.ts` — extractBvid(), extractPageNum(), fetchVideoInfo(), getCidForPage()
- `lib/bilibili/subtitle-fetcher.ts` — fetchBilibiliSubtitle()（调用 /x/player/v2 + 字幕 CDN）
- `entrypoints/bilibili-video.content/` — 嵌入B站右侧栏的面板 UI
  - `index.ts` — 挂载逻辑：anchor 到 `.right-container-inner`，插在 UP 主面板后，`autoMount()` 处理 SPA 切换
  - `hooks/useVideoDetect.ts` — 从 URL 提取 BV 号 + 通过 API 获取 CID
  - `hooks/useSubtitle.ts` — 字幕获取状态管理
  - `components/Panel.tsx` — 主面板容器（纵向折叠/展开）
  - `components/SubtitleView.tsx` — 字幕列表 + 时间戳点击跳转
  - `components/StatusBar.tsx` — 加载/无字幕/错误状态

## 约定

- Content Script UI 使用 WXT `createShadowRootUi` + React，`cssInjectionMode: 'ui'`，`isolateEvents: true`，嵌入 B 站右侧栏（`autoMount` + anchor 降级链）
- Step 1 字幕获取: Content Script 同源直接 fetch api.bilibili.com（Cookie 自动携带）
- 后续 Groq/LLM 需要时再引入 Background 消息桥
- 存储: WXT `storage.defineItem`（`local:` 前缀）
- 字幕获取流程: extractBvid() → fetchVideoInfo() → fetchBilibiliSubtitle(bvid, cid)
- 字幕 CDN (`aisubtitle.hdslb.com`) 跨域但 CORS 允许，Content Script 可直接 fetch
- 无字幕降级: Groq Whisper API (`whisper-large-v3-turbo`)（Step 2）
- LLM 总结: OpenAI 协议兼容多 Provider，Quality/Efficiency 两种模式（Step 2）
