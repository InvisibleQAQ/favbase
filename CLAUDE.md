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

- `lib/types.ts` — SubtitleRow, SubtitleResult, RawSubtitleItem, LLMProviderDef(id: LLMProviderId), ASRProviderDef(id: ASRProviderId), UserSettings(provider: LLMProviderId, asrProvider: ASRProviderId) 类型。通过 `import type` 从 providers.ts 引入 ID 类型
- `lib/bilibili/messaging.ts` — BiliMessageMap（消息类型注册表）+ postBiliMessage()（类型安全发送，支持 defer 延迟）+ onBiliMessage()（类型安全订阅，返回 unsub，内部封装 source 校验）
- `lib/providers.ts` — LLM_PROVIDER_IDS / ASR_PROVIDER_IDS（`as const`）为 Provider ID 唯一真实来源，推导 LLMProviderId / ASRProviderId 类型。LLM_PROVIDERS(9个) + ASR_PROVIDERS(2个) 静态定义，getProviderDef(id: LLMProviderId) 类型安全查找
- `lib/storage.ts` — settingsStorage (WXT `storage.defineItem<UserSettings>`)，DEFAULT_SETTINGS 默认值
- `lib/bilibili/api.ts` — BILIBILI_API 端点集中化（pageList/playerV2/playUrl URL builder）+ isSubtitleCdnUrl() 字幕 CDN URL 检测。playUrl(bvid, cid) 用 fnval=16 请求 DASH 音频流
- `lib/bilibili/video-info.ts` — extractBvid()（保留原始大小写，B站 API 区分大小写）, extractPageNum(), fetchCidByPageList()（CID 降级路径，用 BILIBILI_API.pageList()）
- `lib/bilibili/subtitle-fetcher.ts` — fetchBilibiliSubtitle()（API 降级路径，用 BILIBILI_API.playerV2()，CDN fetch 带 credentials，响应解析含 5 层 fallback）
- `lib/bilibili/subtitle-processor.ts` — processSubtitles() 四步管线：normalize -> filter -> filler removal -> deduplicate(Jaccard>0.85)。接受 B 站原始格式和 favbase 格式。每条字幕保持独立行，不合并
- `entrypoints/bilibili-inject.content.ts` — Main World 入口协调器：创建 effects + 状态机 + 拦截器 + 路由监控，5 行 bootstrap
- `lib/bilibili/inject/state.ts` — InjectStateMachine 状态机（createStateMachine(effects)），拥有全部状态转换（bootstrap/markCaptured/resetForRoute）+ 定时器编排 + reemit loop。通过 InjectEffects 接口注入副作用，纯逻辑可单元测试
- `lib/bilibili/inject/effects.ts` — InjectEffects 生产实现（createBrowserEffects()）：DOM 操作（triggerCC/hideSubtitleDisplay/restoreDisplay）+ resolvePageMeta() 页面元数据 + 通过 messaging.ts 的 postBiliMessage() 桥接消息
- `lib/bilibili/inject/interceptors.ts` — fetch/XHR 覆写（installInterceptors(sm)），使用 api.ts 的 isSubtitleCdnUrl() 检测字幕响应后调用 sm.markCaptured()
- `lib/bilibili/inject/route-monitor.ts` — 300ms SPA 路由轮询（startRouteMonitor(sm)），检测 BV 号/分P 变化后调用 sm.resetForRoute()
- `entrypoints/bilibili-video.content/` — 嵌入B站右侧栏的面板 UI
  - `index.ts` — 挂载逻辑：anchor 到 `.right-container-inner`，插在 UP 主面板后，`autoMount()` 处理 SPA 切换
  - `hooks/useVideoDetect.ts` — 通过 onBiliMessage() 订阅 BILI_ROUTE_SWITCH（SPA 导航重置）+ BILI_SUBTITLE_HANDSHAKE（bvid/cid 解析，cid=0 时不锁定 resolved 等待后续重发），3s 超时降级到 fetchCidByPageList API
  - `hooks/useSubtitle.ts` — 三层数据流：(1) GET_VIDEO_CACHE 缓存优先加载 (2) onBiliMessage() 拦截通道 (3) fetchBilibiliSubtitle API 降级 + 重试。所有成功获取的字幕通过 CACHE_SUBTITLE 消息写入 Background 缓存。chrome.storage.onChanged 监听实现跨 tab 实时同步。返回 { rows, loading, status, error, source, cached }
  - `hooks/useSettings.ts` — deep module：settingsStorage 读写（debounced 500ms + watch 外部变更）+ LLM/ASR computed 属性（currentProviderDef, currentLlmApiKey, currentLlmModel, isCustomProvider, currentAsrDef, currentAsrApiKey, currentAsrModel）+ focused action 方法（switchProvider, updateLlmApiKey, updateLlmModel, switchAsrProvider, updateAsrApiKey, updateAsrModel, updatePrefMode 等）。所有 Provider 切换/key 分支逻辑内聚在 hook 内部
  - `components/Panel.tsx` — 主面板容器：左侧图标栏（CC + Settings Tab，activeTab 切换）+ 右侧内容区（header + 可折叠 body），根据 activeTab 渲染 SubtitleView 或 SettingsView。通过 `settingsProps` 单对象透传设置相关数据
  - `components/SubtitleView.tsx` — 逐行字幕列表 + 时间戳点击跳转 + 当前播放行高亮（250ms 轮询 `<video>.currentTime`，二分查找活跃行）+ 自动滚动（尊重用户手动滚动意图，4s 超时恢复）
  - `components/SettingsView.tsx` — 纯渲染设置界面：LLM Provider 下拉（9个）+ 每 Provider 独立 API Key/Model + Custom 额外字段 + ASR Provider 切换 + 调用模式单选。零业务逻辑，所有 computed/action 通过 props 从 useSettings 接收
  - `components/StatusBar.tsx` — 加载/无字幕/错误状态，支持 source='bilibili'|'groq' 和 cached 标记
  - `components/TranscribeButton.tsx` — 转录触发按钮 + 进度条（分阶段）+ 取消按钮 + 错误/重试 + rate limit 倒计时
  - `hooks/useTranscribe.ts` — ASR 转录状态管理：startTranscribe → browser.runtime.sendMessage(TRANSCRIBE_AUDIO) → 监听 TRANSCRIBE_STATUS 推送 → 结果/错误/重试倒计时。SPA 切换时自动重置

### Groq ASR 转录 (Step 2 — 已完成，Bilitato 对齐)

3 层管线：Content Script → Background SW → Offscreen Document（FFmpeg WASM 分块）。

- `lib/transcription/types.ts` — TranscribeRequest/Abort, TranscribeResponse(success|failure), TranscribeStatusPush, TranscribeErrorCode(16种), GroqTranscriptionResult, ChunkPlan, Offscreen 消息类型, VideoCacheEntry(含 rawHash), GetVideoCacheRequest/ClearVideoCacheRequest/CacheSubtitleRequest, BgMessage union
- `lib/transcription/constants.ts` — GROQ_TRANSCRIBE_URL, GROQ_MAX_AUDIO_BYTES(24MB), CHUNK_SECONDS(600), OVERLAP(4s), SAFETY_RATIO(0.72), PROGRESS 阶段映射, 超时常量
- `lib/transcription/groq-client.ts` — ensureGroqConnectivity(apiKey)（6s pre-flight GET /models）+ requestGroqTranscription(blob, apiKey, model, signal)（FormData POST verbose_json+segment）+ mapTranscriptionToRows() + parseRetryAfter() + AsrError 类
- `lib/transcription/audio-extractor.ts` — extractAudioUrl(bvid, cid)（playurl API fnval:16 DASH audio，按 bandwidth 降序取最优）+ fetchAudioBlob(url, signal, onProgress)（streaming 下载，10% 粒度进度映射到 20-55%）
- `lib/transcription/audio-fingerprint.ts` — assertAudioNotReused(blob, bvid)（SHA-256 + LRU(30)，相同 hash 不同 bvid 拒绝）
- `lib/offscreen/main.ts` — Offscreen Document 逻辑：FFmpeg WASM 加载 + resolveAudioDuration(HTML5 Audio) + estimateSafeChunkSeconds(0.72 安全系数) + buildOverlappedChunkPlan(600s+4s overlap) + splitAudioIntoChunks(FFmpeg -c:a copy) + transcribeChunk(per-chunk Groq API) + mergeTimestampedChunkRows(时间偏移+overlap 裁剪+1.5s 近邻去重)。最多 3 轮 30% 缩减
- `entrypoints/offscreen.html` — WXT unlisted page，通过 chrome.offscreen.createDocument 创建
- `lib/cache/video-cache.ts` — 视频缓存模块：normalizeBvid()（防御性小写规范化，所有公开函数入口调用）+ per-bvid 独立 key（`local:vc:{bvid}`）+ 内存缓存层（Map + structuredClone 深拷贝）+ mergeVideoCache（Promise-based per-bvid 写锁 + hash 去重 + quota 降级）+ 旧格式迁移（`local:videoCache` → `local:vc:{bvid}`）+ initCacheStorageListener（Background 侧 chrome.storage.onChanged 同步内存缓存）+ computeRowsHash（轻量指纹）
- `entrypoints/background.ts` — Background SW：onMessage(TRANSCRIBE_AUDIO) 编排完整转录流程（cache check → connectivity → audio extract → download → fingerprint → single/chunked transcribe → processSubtitles → cache write）+ GET_VIDEO_CACHE/CLEAR_VIDEO_CACHE/CACHE_SUBTITLE handler + TRANSCRIBE_ABORT(AbortController per-tab) + OFFSCREEN_CHUNK_PROGRESS 转发 + 进度推送 via tabs.sendMessage。缓存逻辑委托给 lib/cache/video-cache.ts

## 约定

- Content Script UI 使用 WXT `createShadowRootUi` + React，`cssInjectionMode: 'ui'`，`isolateEvents: true`，嵌入 B 站右侧栏（`autoMount` + anchor 降级链）
- **WXT Shadow DOM 宽度陷阱**: WXT 注入 `:host{all:initial !important}`，底层 `@webext-core/isolated-element` 在 shadow root 内创建 `<html><body>` 包装（body 有 UA `margin:8px`）。`:host` 和 `html,body` 的关键布局属性必须用 `!important` 覆盖，否则宿主元素会 `display:inline` 导致不撑满宽度
- BVID 规范化: `extractBvid()` 保留原始大小写（B站 API 区分大小写），`normalizeBvid()`（`lib/cache/video-cache.ts`）仅在缓存层做小写规范化。storage key、写锁使用小写 bvid；API 调用和消息传递保留原始大小写，比较时用 `.toLowerCase()` 做大小写无关匹配
- Step 1 字幕获取: 双通道架构 — Main World 脚本（`bilibili-inject.content.ts`）拦截 fetch/XHR 被动捕获字幕优先，3s 超时降级到 Content Script 同源 API 调用
- CID 获取: Main World 读取 `window.__INITIAL_STATE__` 优先（定期重发直到 content script 接收），降级到 `/x/player/pagelist` API（轻量，不需要 WBI 签名）
- postMessage 桥接: Main World -> Isolated World，通过 `lib/bilibili/messaging.ts` 统一收发。BiliMessageMap 定义所有消息类型，发送用 postBiliMessage()，接收用 onBiliMessage()。消息流：`BILI_ROUTE_SWITCH`(bvid, 路由变化即时通知) → `BILI_SUBTITLE_HANDSHAKE`(bvid+cid, 800ms延迟) → `BILI_SUBTITLE_DATA`(字幕数据, defer 发送)。新增消息类型只需在 BiliMessageMap 加一行
- 字幕后处理: 所有字幕数据（无论来源）均通过 `processSubtitles()` 四步管线处理（不合并，逐条独立）
- Background 消息桥: Content Script ↔ Background 通过 browser.runtime.sendMessage/onMessage。消息类型定义在 `lib/transcription/types.ts`（BgMessage union）。Background → Content Script 进度推送用 browser.tabs.sendMessage。Background ↔ Offscreen 用 chrome.runtime.sendMessage（Chrome-specific API）
- 存储: WXT `storage.defineItem`（`local:` 前缀），import from `wxt/utils/storage`（非 `wxt/storage`）
- 设置持久化: `settingsStorage`（`lib/storage.ts`），UserSettings 单对象存储在 `local:settings`。useSettings 是 deep module — 内聚 storage 读写、computed 属性推导、focused action 方法，SettingsView 是纯渲染组件
- Inject 状态机: 三阶段生命周期 idle → triggering → captured，通过 InjectEffects 接口注入 DOM/postMessage 副作用，状态转换集中在 state.ts 的 createStateMachine() 内。routeGeneration 作为并发守卫防止路由切换后旧 in-flight 拦截结果被采纳
- SPA 路由监控: route-monitor.ts 300ms 轮询 location.href 检测 BV 号/分P 变化 → sm.resetForRoute() 级联重置（generation++、清理定时器、restoreDisplay） → ROUTE_SWITCH 即时通知 → 800ms 后重发 HANDSHAKE → 重触发 CC 按钮
- 字幕获取流程（主路径）: interceptors.ts 拦截 fetch/XHR → sm.markCaptured() 解析+桥接 → postMessage SUBTITLE_DATA → useSubtitle 接收 → processSubtitles()
- 字幕获取流程（降级路径）: extractBvid() → fetchCidByPageList() → fetchBilibiliSubtitle(bvid, cid) → processSubtitles()（失败自动重试最多 2 次）
- 字幕 CDN (`aisubtitle.hdslb.com`) 跨域但 CORS 允许，Content Script 可直接 fetch（带 `credentials: 'include'`）
- 无字幕降级: useSubtitle 返回 no_subtitle（网络异常也降级为 no_subtitle 而非 error）→ App 显示 TranscribeButton（status 为 no_subtitle 或 error 时均展示）→ 用户点击 → TRANSCRIBE_AUDIO → Background 编排完整 Groq Whisper 转录 → 结果通过 processSubtitles() 后回写 SubtitleView
- CDN 请求头: `declarativeNetRequest` 静态规则（`public/rules.json`）在网络栈层面为 bilivideo 域名设置 `Referer: https://www.bilibili.com/` + `Origin`。Background SW 的 fetch() 自身设置的 Referer 会被 Chrome MV3 剥离，必须用 declarativeNetRequest
- ASR 转录流程: cache check → ensureGroqConnectivity(pre-flight) → extractAudioUrl(playurl fnval:16+high_quality:1, 含 json.code 校验) → fetchAudioBlob(streaming+progress) → assertAudioNotReused(SHA-256) → ≤24MB: requestGroqTranscription / >24MB: Offscreen FFmpeg 分块 → processSubtitles → cache
- 视频缓存: `lib/cache/video-cache.ts` 模块。per-bvid 独立 key `local:vc:{bvid}`（chrome.storage 中为 `vc:{bvid}`）。内存缓存层（Map<string, VideoCacheEntry>）+ Promise-based per-bvid 写锁 + computeRowsHash 去重。所有来源（bilibili/groq）字幕统一缓存。旧 `local:videoCache` 单体 key 在首次访问时自动迁移。Background 侧 initCacheStorageListener 保持内存缓存与 storage 同步，Content Script 侧 chrome.storage.onChanged 实现跨 tab UI 实时更新
- Offscreen Document: WXT unlisted page `entrypoints/offscreen.html`，逻辑在 `lib/offscreen/main.ts`。通过 chrome.offscreen.createDocument 按需创建（singleton），FFmpeg WASM stream-copy 分块，600s 默认 + 4s overlap
- LLM 总结: OpenAI 协议兼容多 Provider，Quality/Efficiency 两种模式（Step 3，待实现）
