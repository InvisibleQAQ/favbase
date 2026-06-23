# favbase

B站收藏自动转知识库的 Chromium 浏览器扩展。本地优先，可选 WebDAV 同步。

## 技术栈

- **框架**: WXT 0.20.26 (Vite) + React 19 + TypeScript 5.9
- **架构**: Chrome MV3 (Service Worker + Content Script + Shadow DOM UI + Extension Page)
- **UI 框架**: MUI v7 (Extension Page) + 原生 CSS + `--fb-*` design tokens (Content Script Shadow DOM)
- **AI SDK**: Vercel AI SDK v6（`ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic` + `@ai-sdk/google` + `@ai-sdk/openai-compatible`）
- **存储**: WXT `storage.defineItem`（设置/缓存） + PGlite 0.5 + Drizzle ORM 0.45 + pgvector（知识库）
- **包管理**: pnpm

## 当前状态

MVP 阶段，首个功能：B站视频转录（Bilitato 风格视频页面 AI 助手）。

## 入口点

- `entrypoints/background.ts` — Background Service Worker
- `entrypoints/bilibili-inject.content.ts` — B站视频页 Main World 脚本（`world: 'MAIN'`，`runAt: 'document_start'`）：读取 `__INITIAL_STATE__` 获取 CID、拦截 fetch/XHR 被动捕获字幕、自动触发 CC 按钮、通过 postMessage 桥接数据到 Isolated World
- `entrypoints/bilibili-video.content/` — B站视频页 Content Script（Shadow DOM React UI，Isolated World）
- `entrypoints/app/` — Extension Page（独立标签页主界面，`chrome-extension://<id>/app.html`），MUI v7 Dashboard
- `entrypoints/popup/` — Popup 跳板：点击扩展图标 → 打开/聚焦 app.html 标签页

## 关键文档
- 使用wxt框架进行开发, 必须使用 `context7 mcp`查询 wxt文档.
- `docs/03_favbase-prd.md` — 完整 PRD（知识库全功能）
- `docs/04_bilibili-transcription-spec.md` — B站视频转录功能实现规格
- `.trellis/` — Trellis 开发工作流配置

## 参考项目

- `C:\Users\18368\Desktop\00_myCode\24_cyberSquirrel\02_Bilitato` — Bilitato 开源项目，B站视频 AI 助手，是视频转录功能的主要参考实现
- `C:\Users\18368\Desktop\00_myCode\24_cyberSquirrel\06_material-kit-react` — Material Kit React，MUI v7 Dashboard 模板，app.html UI 风格参考

## 模块结构

### Extension Page Dashboard (app.html)

MUI v7 Dashboard，复刻 material-kit-react 视觉风格。使用 `createHashRouter`（Chrome 扩展页面不支持路径路由）。

- `entrypoints/app/main.tsx` — 入口：Hash Router + lazy 页面加载 + LoadingFallback
- `entrypoints/app/App.tsx` — 根组件：ThemeProvider + Outlet
- `entrypoints/app/global.css` — 全局样式：DM Sans Variable + Barlow 字体导入 + baseline reset
- `entrypoints/app/theme/` — MUI v7 主题系统（palette/typography/shadows/custom-shadows/components），配色和排版完全对齐 material-kit-react
  - `theme-config.ts` — 调色板常量 + 字体配置（classesPrefix: 'favbase'）
  - `create-theme.ts` — 主题工厂，合并 colorSchemes.light + components + typography + shape
  - `theme-provider.tsx` — ThemeVarsProvider + CssBaseline 包装
  - `extend-theme-types.d.ts` — MUI 类型扩展（customShadows, fontSecondaryFamily, palette 扩展）
  - `core/palette.ts` — 完整色彩系统，使用 `minimal-shared` 的 `createPaletteChannel` + `varAlpha`
  - `core/typography.ts` — 排版比例，h1-h6 响应式 + body/caption/overline/button
  - `core/shadows.ts` — 25 级 MUI 标准阴影
  - `core/custom-shadows.ts` — card/dialog/dropdown + z1-z24 + 各色彩阴影
  - `core/components.tsx` — MUI 组件样式覆盖（Card 圆角 16px，Button 无 elevation，Paper 无 backgroundImage 等）
- `entrypoints/app/layouts/` — 仪表盘布局系统
  - `core/layout-section.tsx` — 布局骨架：sidebar + sidebarContainer(header+main+footer)，注入 CSS vars via GlobalStyles
  - `core/header-section.tsx` — 粘性 AppBar + 滚动毛玻璃效果（backdrop-filter blur(6px)），slots: leftArea/rightArea/centerArea
  - `core/main-section.tsx` — flex column 主内容区
  - `core/css-vars.ts` — 布局 CSS 变量（nav-zIndex/header-height/nav-width）
  - `dashboard/layout.tsx` — DashboardLayout：组合 NavDesktop + NavMobile + HeaderSection + MainSection。读取 `sidebarPinnedStorage` 控制侧边栏 pinned/unpinned 状态，Header 左侧 toggle 按钮（lg+ 可见）切换，CSS 变量 `--layout-nav-vertical-width` 动态切换 280px/72px
  - `dashboard/nav.tsx` — NavDesktop（固定左侧栏，pinned=280px/unpinned=72px，lg 断点显示）+ NavMobile（Drawer 抽屉，pathname 变化自动关闭，始终 pinned 模式）+ NavContent（路由激活高亮，varAlpha primary channel，unpinned 时仅图标 + MUI Tooltip，Logo 区隐藏 "favbase" 文字）
  - `dashboard/content.tsx` — DashboardContent：Container maxWidth + dashboard padding CSS vars
  - `nav-config.tsx` — 导航项：Dashboard/Collections/Settings，Iconify solar 图标
- `entrypoints/app/components/iconify/` — Iconify 图标系统（与 material-kit-react 同源 `@iconify/react`）
  - `icon-sets.ts` — 30+ 离线注册图标（solar/eva/mingcute/custom 集），含 favbase 专用图标（含 `solar:siderbar-bold-duotone` 用于侧边栏 toggle）
  - `register-icons.ts` — addCollection 离线注册 + `IconifyName` 类型安全
  - `iconify.tsx` — styled(Icon) 包装，未注册图标 console.warn 提醒
- `entrypoints/app/pages/` — 页面组件（lazy loaded）
  - `dashboard.tsx` → `sections/overview/overview-view.tsx`（统计卡片 + 活动列表 + 进度条）
  - `settings.tsx` → `sections/settings/settings-view.tsx`（AI 服务配置：LLM/ASR/高级设置）
  - `collections.tsx` → `sections/collections/collections-view.tsx`（B站收藏夹列表展示）
- `entrypoints/app/sections/overview/stat-widget.tsx` — 统计卡片：圆形图标背景 + varAlpha 色调 + title/total
- `entrypoints/app/sections/collections/` — B站收藏夹页面组件
  - `collections-view.tsx` — 收藏夹主视图：同步按钮 + 卡片网格 + 未登录引导/空状态/loading skeleton
  - `fav-folder-card.tsx` — 收藏夹卡片：封面图 + 名称 + 视频数量
  - `use-bili-fav-folders.ts` — B站收藏夹 hook：getBiliAuth 检测登录 → fetchFavFolderList 获取列表 → 状态管理（folders/loading/syncing/loginState/error）
- `entrypoints/app/sections/settings/` — AI 设置页面组件
  - `settings-view.tsx` — 设置页面主视图：DashboardContent + 3 Card 区块
  - `llm-config-card.tsx` — LLM 配置卡片：Provider 选择 + API Key（显示/隐藏）+ Get Key 链接 + Model（Autocomplete，支持远程获取模型列表）+ Custom 字段 + 测试连接（AI SDK `generateText`）
  - `asr-config-card.tsx` — ASR 配置卡片：Provider 选择 + API Key + Model
  - `advanced-settings-card.tsx` — 高级设置：Temperature + MaxTokens + 调用模式（ToggleButtonGroup）

### B站字幕获取 (Step 1 — 已完成，Bilitato 对齐)

双通道架构：Main World 脚本拦截优先，API 调用降级。

- `lib/types.ts` — SubtitleRow, SubtitleResult, RawSubtitleItem, LLMProviderDef(id: LLMProviderId), ASRProviderDef(id: ASRProviderId), UserSettings(provider: LLMProviderId, asrProvider: ASRProviderId, temperature, maxTokens) 类型。通过 `import type` 从 providers.ts 引入 ID 类型
- `lib/bilibili/messaging.ts` — BiliMessageMap（消息类型注册表）+ postBiliMessage()（类型安全发送，支持 defer 延迟）+ onBiliMessage()（类型安全订阅，返回 unsub，内部封装 source 校验）
- `lib/providers.ts` — LLM_PROVIDER_IDS / ASR_PROVIDER_IDS（`as const`）为 Provider ID 唯一真实来源，推导 LLMProviderId / ASRProviderId 类型。LLM_PROVIDERS(9个) + ASR_PROVIDERS(2个) 静态定义，getProviderDef(id: LLMProviderId) 类型安全查找
- `lib/storage.ts` — settingsStorage (WXT `storage.defineItem<UserSettings>`)，DEFAULT_SETTINGS 默认值，sidebarPinnedStorage（`local:sidebarPinned`，布尔值，默认 true）
- `lib/bilibili/api.ts` — BILIBILI_API 端点集中化（pageList/playerV2/playUrl/favFolderListAll URL builder）+ isSubtitleCdnUrl() 字幕 CDN URL 检测。playUrl(bvid, cid) 用 fnval=16 请求 DASH 音频流
- `lib/bilibili/auth.ts` — getBiliAuth()：通过 chrome.cookies.get() 读取 SESSDATA + DedeUserID，检查过期时间，返回 BiliAuthInfo | null
- `lib/bilibili/favorites.ts` — fetchFavFolderList(auth)：调用 `/x/v3/fav/folder/created/list-all`，解析返回 BiliFavFolder[]。BiliAuthError 处理 -101 认证失败
- `lib/bilibili/favorites-sync.ts` — syncFavFoldersToDb(db, folders)：将 BiliFavFolder[] upsert 到 PGlite sources 表（db 由调用方注入），返回 Source[]
- `lib/bilibili/video-info.ts` — extractBvid()（保留原始大小写，B站 API 区分大小写）, extractPageNum(), fetchCidByPageList()（CID 降级路径，用 BILIBILI_API.pageList()）
- `lib/bilibili/subtitle-fetcher.ts` — fetchBilibiliSubtitle()（API 降级路径，用 BILIBILI_API.playerV2()，CDN fetch 带 credentials，响应解析含 5 层 fallback）
- `lib/bilibili/subtitle-processor.ts` — processSubtitles() 四步管线：normalize -> filter -> filler removal -> deduplicate(Jaccard>0.85)。接受 B 站原始格式和 favbase 格式。每条字幕保持独立行，不合并
- `entrypoints/bilibili-inject.content.ts` — Main World 入口协调器：创建 effects + 状态机 + 拦截器 + 路由监控，5 行 bootstrap
- `lib/bilibili/inject/state.ts` — InjectStateMachine 状态机（createStateMachine(effects)），拥有全部状态转换（bootstrap/markCaptured/resetForRoute）+ 定时器编排 + reemit loop。通过 InjectEffects 接口注入副作用，纯逻辑可单元测试
- `lib/bilibili/inject/effects.ts` — InjectEffects 生产实现（createBrowserEffects()）：DOM 操作（triggerCC/hideSubtitleDisplay/restoreDisplay）+ resolvePageMeta() 页面元数据 + 通过 messaging.ts 的 postBiliMessage() 桥接消息
- `lib/bilibili/inject/interceptors.ts` — fetch/XHR 覆写（installInterceptors(sm)），使用 api.ts 的 isSubtitleCdnUrl() 检测字幕响应后调用 sm.markCaptured()
- `lib/bilibili/inject/route-monitor.ts` — 300ms SPA 路由轮询（startRouteMonitor(sm)），检测 BV 号/分P 变化后调用 sm.resetForRoute()
- `entrypoints/bilibili-video.content/` — 嵌入B站右侧栏的面板 UI
  - `index.ts` — 挂载逻辑：anchor 到 `.right-container-inner`，插在 UP 主面板后。禁用 `autoMount()`（它在 Vue 水合期间触发导致评论区崩溃），改用手动延迟挂载（page load + 2s）+ 500ms 轮询检测脱离后重挂载
  - `hooks/useVideoDetect.ts` — 通过 onBiliMessage() 订阅 BILI_ROUTE_SWITCH（SPA 导航重置）+ BILI_SUBTITLE_HANDSHAKE（bvid/cid 解析，cid=0 时不锁定 resolved 等待后续重发），3s 超时降级到 fetchCidByPageList API
  - `hooks/useSubtitle.ts` — 三层数据流：(1) GET_VIDEO_CACHE 缓存优先加载 (2) onBiliMessage() 拦截通道 (3) fetchBilibiliSubtitle API 降级 + 重试。所有成功获取的字幕通过 CACHE_SUBTITLE 消息写入 Background 缓存。chrome.storage.onChanged 监听实现跨 tab 实时同步。返回 { rows, loading, status, error, source, cached }
  - `hooks/useSettings.ts` — re-export from `lib/hooks/useSettings.ts`（共享 hook）
  - `components/Panel.tsx` — 主面板容器：左侧图标栏（CC + Settings Tab，activeTab 切换）+ 右侧内容区（header + 可折叠 body），根据 activeTab 渲染 SubtitleView 或 SettingsView。通过 `settingsProps` 单对象透传设置相关数据
  - `components/SubtitleView.tsx` — 逐行字幕列表 + 搜索过滤（100ms debounce，CSS display:none 隐藏不匹配行，保持 activeIndex 稳定）+ 搜索高亮（`<mark>` 标黄匹配文本）+ 来源标签（source badge，显示"官方AI字幕"/"ASR 转录"/"ASR 缓存"）+ 时间戳点击跳转 + 当前播放行高亮（250ms 轮询 `<video>.currentTime`，二分查找活跃行）+ 自动滚动（搜索激活时暂停 auto-scroll，清空搜索后恢复；尊重用户手动滚动意图，4s 超时恢复）
  - `components/SettingsView.tsx` — 纯渲染设置界面：LLM Provider 下拉（9个）+ 每 Provider 独立 API Key/Model + Custom 额外字段 + ASR Provider 切换 + 调用模式单选。零业务逻辑，所有 computed/action 通过 props 从 useSettings 接收
  - `components/StatusBar.tsx` — 加载/无字幕/错误状态（来源信息已迁移到 SubtitleView 的 source badge）
  - `components/TranscribeButton.tsx` — 转录触发按钮 + 进度条（分阶段）+ 取消按钮 + 错误/重试 + rate limit 倒计时。stage/error 通过 `translateStage()`/`translateError()` 调用 `t()` 翻译，不直接渲染 error.message
  - `hooks/useTranscribe.ts` — ASR 转录状态管理：startTranscribe → browser.runtime.sendMessage(TRANSCRIBE_AUDIO) → 监听 TRANSCRIBE_STATUS 推送 → 结果/错误/重试倒计时。SPA 切换时自动重置。TranscribeState.stage 类型为 `TranscribeStage | ''`

### Groq ASR 转录 (Step 2 — 已完成，Bilitato 对齐)

3 层管线：Content Script → Background SW → Offscreen Document（FFmpeg WASM 分块）。

- `lib/transcription/types.ts` — TranscribeRequest/Abort, TranscribeResponse(success|failure), TranscribeStage(12种 union), TranscribeStatusPush(stage enum + stageParams), TranscribeErrorCode(14种) + TranscribeErrorInfo(code + debug message + params), GroqTranscriptionResult, ChunkPlan, Offscreen 消息类型, VideoCacheEntry(含 rawHash), GetVideoCacheRequest/ClearVideoCacheRequest/CacheSubtitleRequest, BgMessage union
- `lib/transcription/constants.ts` — GROQ_TRANSCRIBE_URL, GROQ_MAX_AUDIO_BYTES(24MB), CHUNK_SECONDS(600), OVERLAP(4s), SAFETY_RATIO(0.72), PROGRESS 阶段映射, 超时常量
- `lib/transcription/groq-client.ts` — ensureGroqConnectivity(apiKey)（6s pre-flight GET /models）+ requestGroqTranscription(blob, apiKey, model, signal)（FormData POST verbose_json+segment）+ mapTranscriptionToRows() + parseRetryAfter() + AsrError 类
- `lib/transcription/audio-extractor.ts` — extractAudioUrl(bvid, cid)（playurl API fnval:16 DASH audio，按 bandwidth 降序取最优）+ fetchAudioBlob(url, signal, onProgress)（streaming 下载，10% 粒度进度映射到 20-55%）
- `lib/transcription/audio-fingerprint.ts` — assertAudioNotReused(blob, bvid)（SHA-256 + LRU(30)，相同 hash 不同 bvid 拒绝）
- `lib/transcription/pipeline.ts` — TranscriptionPipeline 深模块：`runTranscriptionPipeline(request, deps, onProgress)` 纯函数编排转录 8 阶段（cache check → settings → connectivity → extract → download → fingerprint → transcribe/chunk → process+cache）。不依赖 Chrome API，通过 `PipelineDeps` 接口注入所有外部依赖。`toErrorInfo()` 错误映射 + `transcribeWithFakeProgress()` 进度模拟内聚于此
- `lib/offscreen/main.ts` — Offscreen Document 逻辑：fetchAudioBytes(自行 fetch audioUrl) + resolveAudioDuration(HTML5 Audio 优先，ffprobe 降级) + FFmpeg 本地 WASM 加载(public/ffmpeg/) + estimateSafeChunkSeconds(0.72 安全系数) + buildOverlappedChunkPlan(600s+4s overlap) + splitAudioIntoChunks(FFmpeg -c:a copy) + transcribeChunk(per-chunk Groq API) + mergeTimestampedChunkRows(时间偏移+overlap 裁剪+1.5s 近邻去重)。最多 3 轮 30% 缩减
- `entrypoints/offscreen.html` — WXT unlisted page，通过 chrome.offscreen.createDocument 创建
- `lib/cache/video-cache.ts` — 视频缓存模块：normalizeBvid()（防御性小写规范化，所有公开函数入口调用）+ per-bvid 独立 key（`local:vc:{bvid}`）+ 内存缓存层（Map + structuredClone 深拷贝）+ mergeVideoCache（Promise-based per-bvid 写锁 + hash 去重 + quota 降级）+ 旧格式迁移（`local:videoCache` → `local:vc:{bvid}`）+ initCacheStorageListener（Background 侧 chrome.storage.onChanged 同步内存缓存）+ computeRowsHash（轻量指纹）
- `entrypoints/background.ts` — Background SW：TRANSCRIBE_AUDIO 通过 `runTranscriptionPipeline()` 委托转录编排（构造 PipelineDeps 适配器 + AbortController per-tab + onProgress→notifyTab 桥接），pipeline 返回后处理失败通知。GET_VIDEO_CACHE/CLEAR_VIDEO_CACHE/CACHE_SUBTITLE handler + TRANSCRIBE_ABORT + OFFSCREEN_CHUNK_PROGRESS 转发 + 进度推送 via tabs.sendMessage。缓存逻辑委托给 lib/cache/video-cache.ts

### Vercel AI SDK 集成层

Provider factory + 测试连接 + 模型列表获取。为 app.html 设置页面和未来 LLM 总结（Step 3）提供基础设施。

- `lib/ai/provider-factory.ts` — `createLanguageModel(options)` 将 `LLMProviderId` + 用户配置映射为 AI SDK `LanguageModel`。openai → `@ai-sdk/openai`，claude → `@ai-sdk/anthropic`，gemini → `@ai-sdk/google`，其余（modelscope/zhipu/openrouter/deepseek/kimi/custom-openai）→ `@ai-sdk/openai-compatible`，custom-claude → `@ai-sdk/anthropic`
- `lib/ai/test-connection.ts` — `testLlmConnection()` 通过 `generateText()` 发送 "Reply with exactly 'ok'" 验证 API Key 和端点可达性
- `lib/ai/fetch-models.ts` — `fetchAvailableModels()` 原生 fetch 调用 `{baseUrl}/models`，适配不同 Provider 认证（Claude 用 `x-api-key` + `anthropic-version`，其余用 `Authorization: Bearer`）

### PGlite + Drizzle 数据库层

RPC Proxy 架构（参考 memorall）：Offscreen Document 持有 PGlite，Background SW / app.html 通过 Chrome Port 透明使用 Drizzle query builder。

- `lib/database/constants.ts` — `DB_CHANNEL_NAME`('favbase-db'), `DB_DATA_DIR`('idb://favbase'), `DatabaseMode` enum
- `lib/database/entities/` — Per-table Drizzle schema 定义（entity-per-file）
  - `authors.ts` — authors 表（platform + platform_author_id 唯一约束）
  - `sources.ts` — sources 表（收藏夹/播放列表）
  - `items.ts` — items 表（核心条目，content_state 6 态 CHECK 约束，FK → authors）
  - `item-sources.ts` — item_sources 关联表（复合主键 item_id + source_id）
  - `item-contents.ts` — item_contents 表（1:1，PK = item_id FK → items）
  - `item-chunks.ts` — item_chunks 表（含 VECTOR(1536) embedding 列）
- `lib/database/schema.ts` — 集中导出所有表定义（轻量，无 PGlite 运行时依赖）
- `lib/database/types.ts` — 仅 type 导出（Author/Item/Source 等 Select/Insert 类型）
- `lib/database/db.ts` — `initDbMain()`（Offscreen 端：创建 PGlite + 跑迁移 + 启动 RPC handler）、`initDbProxy()`（调用端：创建 PGliteSharedProxy + Drizzle）、`getDb()`/`closeDb()`
- `lib/database/bridges/` — RPC 桥接层
  - `types.ts` — RPC 协议：RpcRequest/RpcResponse/RpcTransport 接口
  - `serialization.ts` — Date ↔ `{ __type:'Date', __value: ISO }` 标记序列化（Chrome Port 安全）
  - `proxy-driver.ts` — `PGliteSharedProxy`（implements PGliteLike，请求 ID 关联 + 30s 超时）
  - `chrome-port-rpc.ts` — `createChromePortTransport()`（`chrome.runtime.connect`，指数退避重连，消息队列）
  - `rpc-handler.ts` — `DatabaseRpcHandler`（Offscreen singleton，`chrome.runtime.onConnect` 监听，in-flight 去重，PGlite ready gate 排队机制）
- `lib/database/migrations/` — 自定义迁移系统
  - `index.ts` — `runMigrations(pg)` 跑迁移：读 `_migrations` 表 → 按 version 顺序执行未应用的迁移
  - `v001-init.ts` — v1 初始化：CREATE EXTENSION + 6 张业务表 + 索引 + GIN trigram 索引 + updated_at 触发器
- `lib/database/index.ts` — Public API barrel

### 共享 Hooks

- `lib/hooks/useSettings.ts` — deep module：settingsStorage 读写（debounced 500ms + watch 外部变更）+ LLM/ASR computed 属性（currentProviderDef, currentLlmApiKey, currentLlmModel, isCustomProvider, currentAsrDef, currentAsrApiKey, currentAsrModel）+ focused action 方法（switchProvider, updateLlmApiKey, updateLlmModel, switchAsrProvider, updateAsrApiKey, updateAsrModel, updatePrefMode, updateTemperature, updateMaxTokens）。app.html 和 Content Script 共享同一实例

## 约定

- Extension Page (app.html): MUI v7 + Emotion CSS-in-JS + `createHashRouter`。Chrome 扩展页面 URL 不支持路径路由，必须用 hash router。主题系统复刻 material-kit-react（`minimal-shared` 工具库 + `@iconify/react` 图标）。新增页面：在 `pages/` 添加 lazy 组件 + `main.tsx` 路由配置 + `nav-config.tsx` 导航项
- Content Script UI 使用 WXT `createShadowRootUi` + React，`cssInjectionMode: 'ui'`，`isolateEvents: true`，嵌入 B 站右侧栏 `.right-container-inner`（UP 主面板后）。**禁用 `autoMount()`** — 它通过 MutationObserver 在锚点出现瞬间挂载，正值 Vue 水合阶段，注入外部节点会破坏 VDOM 导致评论区消失。必须手动延迟挂载：等 `document.readyState === 'complete'` + 2s（与 Bilitato 一致），SPA 路由切换后通过 500ms 轮询检测脱离并 1s 延迟重挂载
- **WXT Shadow DOM 宽度陷阱**: WXT 注入 `:host{all:initial !important}`，底层 `@webext-core/isolated-element` 在 shadow root 内创建 `<html><body>` 包装（body 有 UA `margin:8px`）。`:host` 和 `html,body` 的关键布局属性必须用 `!important` 覆盖，否则宿主元素会 `display:inline` 导致不撑满宽度
- **Content Script Design Tokens**: `style.css` 的 `:host` 定义 `--fb-*` CSS 自定义属性，色值/阴影/圆角从 `entrypoints/app/theme/theme-config.ts` 手动同步。修改 app.html 调色板后需同步更新 content script 的 `--fb-*` token。字体保持系统字体栈（不加载 DM Sans/Barlow）
- BVID 规范化: `extractBvid()` 保留原始大小写（B站 API 区分大小写），`normalizeBvid()`（`lib/cache/video-cache.ts`）仅在缓存层做小写规范化。storage key、写锁使用小写 bvid；API 调用和消息传递保留原始大小写，比较时用 `.toLowerCase()` 做大小写无关匹配
- Step 1 字幕获取: 双通道架构 — Main World 脚本（`bilibili-inject.content.ts`）拦截 fetch/XHR 被动捕获字幕优先，3s 超时降级到 Content Script 同源 API 调用
- CID 获取: Main World 读取 `window.__INITIAL_STATE__` 优先（定期重发直到 content script 接收），降级到 `/x/player/pagelist` API（轻量，不需要 WBI 签名）
- postMessage 桥接: Main World -> Isolated World，通过 `lib/bilibili/messaging.ts` 统一收发。BiliMessageMap 定义所有消息类型，发送用 postBiliMessage()，接收用 onBiliMessage()。消息流：`BILI_ROUTE_SWITCH`(bvid, 路由变化即时通知) → `BILI_SUBTITLE_HANDSHAKE`(bvid+cid, 800ms延迟) → `BILI_SUBTITLE_DATA`(字幕数据, defer 发送)。新增消息类型只需在 BiliMessageMap 加一行
- 字幕后处理: 所有字幕数据（无论来源）均通过 `processSubtitles()` 四步管线处理（不合并，逐条独立）
- Background 消息桥: Content Script ↔ Background 通过 browser.runtime.sendMessage/onMessage。消息类型定义在 `lib/transcription/types.ts`（BgMessage union）。Background → Content Script 进度推送用 browser.tabs.sendMessage。Background ↔ Offscreen 用 chrome.runtime.sendMessage（Chrome-specific API）。新增消息类型：`CHECK_BILI_LOGIN`（检测 B 站登录状态）、`FETCH_FAV_FOLDERS`（拉取收藏夹列表 + upsert DB）
- B 站认证: manifest 声明 `cookies` 权限。`lib/bilibili/auth.ts` 的 `getBiliAuth()` 通过 `chrome.cookies.get()` 读取 SESSDATA + DedeUserID，检查 expirationDate。Background SW 是唯一调用 B 站 API 的上下文（统一出口），手动拼 `Cookie: SESSDATA=xxx` header
- B 站收藏夹: `FETCH_FAV_FOLDERS` 流程：getBiliAuth() → fetchFavFolderList() → syncFavFoldersToDb()（upsert sources 表）→ 返回 Source[]。app.html 通过 `useBiliFavFolders` hook 获取数据并管理 UI 状态（loading/syncing/loginState/error）
- 存储: WXT `storage.defineItem`（`local:` 前缀），import from `wxt/utils/storage`（非 `wxt/storage`）
- 设置持久化: `settingsStorage`（`lib/storage.ts`），UserSettings 单对象存储在 `local:settings`。`useSettings`（`lib/hooks/useSettings.ts`）是共享 deep module — 内聚 storage 读写、computed 属性推导、focused action 方法。app.html 和 Content Script 都从此 hook 读写，Content Script 的 `hooks/useSettings.ts` 是 re-export
- 侧边栏 Pin/Unpin: `sidebarPinnedStorage`（`lib/storage.ts`），布尔值存储在 `local:sidebarPinned`（默认 true）。DashboardLayout 读取并通过 toggle 按钮切换。Pinned=280px 展开（图标+文字），Unpinned=72px 图标栏（MUI Tooltip 显示菜单名）。Mobile（lg 以下）不受影响，始终 Drawer 模式
- AI SDK Provider 映射: openai → `@ai-sdk/openai`，claude → `@ai-sdk/anthropic`，gemini → `@ai-sdk/google`，其余 OpenAI 兼容 → `@ai-sdk/openai-compatible`。测试连接用 `generateText()`，模型列表用原生 fetch（AI SDK 无 model listing API）
- Inject 状态机: 三阶段生命周期 idle → triggering → captured，通过 InjectEffects 接口注入 DOM/postMessage 副作用，状态转换集中在 state.ts 的 createStateMachine() 内。routeGeneration 作为并发守卫防止路由切换后旧 in-flight 拦截结果被采纳
- SPA 路由监控: route-monitor.ts 300ms 轮询 location.href 检测 BV 号/分P 变化 → sm.resetForRoute() 级联重置（generation++、清理定时器、restoreDisplay） → ROUTE_SWITCH 即时通知 → 800ms 后重发 HANDSHAKE → 重触发 CC 按钮
- 字幕获取流程（主路径）: interceptors.ts 拦截 fetch/XHR → sm.markCaptured() 解析+桥接 → postMessage SUBTITLE_DATA → useSubtitle 接收 → processSubtitles()
- 字幕获取流程（降级路径）: extractBvid() → fetchCidByPageList() → fetchBilibiliSubtitle(bvid, cid) → processSubtitles()（失败自动重试最多 2 次）
- 字幕 CDN (`aisubtitle.hdslb.com`) 跨域但 CORS 允许，Content Script 可直接 fetch（带 `credentials: 'include'`）
- 无字幕降级: useSubtitle 返回 no_subtitle（网络异常也降级为 no_subtitle 而非 error）→ App 显示 TranscribeButton（status 为 no_subtitle 或 error 时均展示）→ 用户点击 → TRANSCRIBE_AUDIO → Background 编排完整 Groq Whisper 转录 → 结果通过 processSubtitles() 后回写 SubtitleView
- CDN 请求头: `declarativeNetRequest` 静态规则（`public/rules.json`）在网络栈层面为 bilivideo 域名设置 `Referer: https://www.bilibili.com/` + `Origin`。Background SW 的 fetch() 自身设置的 Referer 会被 Chrome MV3 剥离，必须用 declarativeNetRequest
- ASR 转录流程: cache check → ensureGroqConnectivity(pre-flight) → extractAudioUrl(playurl fnval:16+high_quality:1, 含 json.code 校验) → fetchAudioBlob(streaming+progress) → assertAudioNotReused(SHA-256) → ≤24MB: requestGroqTranscription / >24MB: Offscreen FFmpeg 分块 → processSubtitles → cache
- 视频缓存: `lib/cache/video-cache.ts` 模块。per-bvid 独立 key `local:vc:{bvid}`（chrome.storage 中为 `vc:{bvid}`）。内存缓存层（Map<string, VideoCacheEntry>）+ Promise-based per-bvid 写锁 + computeRowsHash 去重。所有来源（bilibili/groq）字幕统一缓存。旧 `local:videoCache` 单体 key 在首次访问时自动迁移。Background 侧 initCacheStorageListener 保持内存缓存与 storage 同步，Content Script 侧 chrome.storage.onChanged 实现跨 tab UI 实时更新
- Offscreen Document: WXT unlisted page `entrypoints/offscreen.html`，逻辑在 `lib/offscreen/main.ts`。通过 chrome.offscreen.createDocument 按需创建（singleton）。**双职责**：FFmpeg WASM 分块 + PGlite 数据库持有者。两套 IPC 完全隔离：FFmpeg 用 `chrome.runtime.onMessage`（request/response），PGlite 用 `chrome.runtime.onConnect`（port-based RPC，channel name `favbase-db`）。Background 传 audioUrl（非 ArrayBuffer），Offscreen 自行 fetch 音频数据。FFmpeg WASM 从 `public/ffmpeg/`（@ffmpeg/core@0.12.10）本地加载
- PGlite 数据库: Offscreen Document 是唯一持有者（单连接模型），持久化到 IndexedDB（`idb://favbase`）。扩展：pgvector（`@electric-sql/pglite-pgvector`）、uuid-ossp、pg_trgm（内置 contrib）。`initDbMain()` 在 Offscreen 启动时调用：先同步注册 `DatabaseRpcHandler.startListening()`（`onConnect` listener 立即可用），再异步创建 PGlite + 跑迁移，完成后 `setPGlite()` 解除排队请求。这避免了调用方 connect 时 listener 未注册的时序竞态。Background SW 和 app.html 通过 `initDbProxy()` 创建 `PGliteSharedProxy`，Drizzle query builder 在调用端本地构建 SQL，仅执行通过 RPC 代理
- 数据库迁移: 自定义迁移系统（非 drizzle-kit），`_migrations` 表追踪版本。迁移脚本直接写 SQL（不用 Drizzle 内部 Symbol 反射）。`runMigrations(pg)` 在 `initDbMain()` 内自动执行。新增迁移：在 `lib/database/migrations/` 添加 `vNNN-*.ts`，在 `index.ts` 的 `migrations` 数组追加条目
- Drizzle Schema: entity-per-file（`lib/database/entities/`），`schema.ts` 集中导出，`types.ts` 仅 type 导出（无运行时依赖，proxy 线程安全导入）。新增表：添加 entity 文件 + 更新 schema.ts + types.ts + 写迁移脚本
- i18n 架构: `lib/i18n/` 自研轻量方案（无外部依赖），`detectLocale()` 基于 `navigator.language` 选择 zh-CN 或 en。locale 文件在 `lib/i18n/locales/{zh-CN,en}.ts`，`LocaleKeys` 类型从 zh-CN 推导。**seam 在 UI 边界**：lib 层（groq-client/audio-extractor/offscreen 等）只传结构化数据（TranscribeErrorCode + params / TranscribeStage + stageParams），UI 层通过 `t()` 翻译。`TranscribeErrorInfo.message` 是英文 debug-only 字段（console 用），不渲染到 UI。`t()` 对未知 key 返回 key 字符串本身（fallback）。新增 error/stage locale key 时需同时更新 zh-CN.ts 和 en.ts
- LLM 总结: OpenAI 协议兼容多 Provider，Quality/Efficiency 两种模式（Step 3，待实现）
