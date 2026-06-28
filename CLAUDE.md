# favbase

Turn your social media Favorites into a searchable knowledge base just with a local-first browser extension

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

MUI v7 Dashboard，复刻 material-kit-react 视觉风格。使用 `createHashRouter`（Chrome 扩展页面不支持路径路由）。路由结构：`/`(Dashboard), `/collections`(收藏夹概览), `/collections/bilibili/:mediaId`(收藏夹视频列表), `/settings`。多平台预留：未来 `/collections/zhihu/:id` 等。

- `entrypoints/app/main.tsx` — 入口：fire-and-forget `initDbProxy()` 建立 DB RPC 连接 + Hash Router + lazy 页面加载 + LoadingFallback
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
  - `collections.tsx` → `sections/collections/collections-view.tsx`（B站收藏夹 sidebar+grid 单页布局）
- `entrypoints/app/sections/overview/stat-widget.tsx` — 统计卡片：圆形图标背景 + varAlpha 色调 + title/total
- `entrypoints/app/sections/settings/` — AI 设置页面组件
  - `settings-view.tsx` — 设置页面主视图：DashboardContent + 3 Card 区块
  - `llm-config-card.tsx` — LLM 配置卡片：Provider 选择 + API Key（显示/隐藏）+ Get Key 链接 + Model（Autocomplete，支持远程获取模型列表）+ Custom 字段 + 测试连接（AI SDK `generateText`）
  - `asr-config-card.tsx` — ASR 配置卡片：Provider 选择 + API Key + Model
  - `advanced-settings-card.tsx` — 高级设置：Temperature + MaxTokens + 调用模式（ToggleButtonGroup）
- `entrypoints/app/sections/collections/` — B站收藏夹页面组件（sidebar+grid 单页布局）
  - `collections-view.tsx` — 收藏夹主视图：左侧 240px FolderSidebar + 右侧 VideoGridPanel。`/collections` 和 `/collections/bilibili/:mediaId` 共用组件，通过 useParams 获取 mediaId，无 mediaId 时自动 navigate(replace) 到第一个收藏夹。包含 NotLoggedIn/ErrorState/EmptyFolderState/VideoGridSkeleton 共享状态组件
  - `folder-sidebar.tsx` — 收藏夹侧边栏：固定 240px，单分组"BiliBili 收藏夹"标题可上下折叠/展开列表（MUI Collapse）。列表项显示收藏夹名称 + 视频数量，选中项 varAlpha primary 高亮
  - `use-bili-fav-folders.ts` — B站收藏夹 hook：调用 `bili-sync-service.fetchAndSyncFolders()` 获取列表 + 状态管理（folders/loading/syncing/loginState/error）。auth + API fetch + DB sync 全部由 service 内聚
  - `video-card.tsx` — 视频卡片：封面缩略图 + 左下角播放量标签 + 右下角时长标签 + 标题 + UP主 + 收藏时间（`formatFavTime`：同年显示 MM-DD，跨年显示 N年前，自然年判断）+ 底部操作栏（转录/状态标记/进度）。失效视频灰显（attr===9）无操作栏。操作栏三态：来源标记（CC 官方/ASR Chip）、转录按钮、进度条（LinearProgress + stage 文字 + 取消按钮）
  - `use-bili-fav-videos.ts` — 收藏夹视频 hook：调用 `bili-sync-service.fetchAndSyncVideos(mediaId, page)` 获取视频 + goToPage 翻页 + loading/error/loginState 状态管理。auth + API fetch + source lookup + DB sync 全部由 service 内聚
  - `use-video-transcribe.ts` — 手动视频转录 `useSyncExternalStore` 薄 hook（~58 行）：持有 `TranscriptionCoordinator` ref + 订阅 snapshot + `setVideos` 触发缓存预加载 + start/cancel 透传 + dispose。类型 re-export `VideoTranscribeState`/`ContentStatus` from `lib/bilibili/transcription-coordinator.ts`
  - `use-auto-transcribe.ts` — 自动转录薄 hook（~54 行）：`useSyncExternalStore` 订阅 `AutoTranscribePipeline` 状态 + start/stop 透传 + mediaId 变更时触发 preview 查询 + unmount 时 dispose。所有编排逻辑在 `lib/bilibili/auto-transcribe-pipeline.ts`
  - `auto-transcribe-bar.tsx` — 自动转录进度 UI：全宽面板，独占 title bar 下方一行。idle 态显示预览视频缩略图（100x60）+ 标题/UP主 + 待转录数 + "开始"按钮（全部已转录时显示 check 图标 + 提示文字）。运行时显示丰富进度面板（当前视频缩略图 100x60 + 标题/UP主/时长/阶段文字 + N/Total 进度计数器 + CC/ASR/跳过统计 Chip + 停止 IconButton + LinearProgress 进度条）。完成/停止后显示摘要统计 + 重新开始按钮。面板有 border + background 视觉区分

### B站字幕获取 (Step 1 — 已完成，Bilitato 对齐)

双通道架构：Main World 脚本拦截优先，API 调用降级。

- `lib/bilibili/messaging.ts` — BiliMessageMap（消息类型注册表）+ postBiliMessage()（类型安全发送，支持 defer 延迟）+ onBiliMessage()（类型安全订阅，返回 unsub，内部封装 source 校验）
- `lib/providers.ts` — SdkType + LLMProviderDef + ASRProviderDef 类型定义，LLM_PROVIDER_IDS / ASR_PROVIDER_IDS（`as const`）为 Provider ID 唯一真实来源，推导 LLMProviderId / ASRProviderId 类型。LLM_PROVIDERS(9个，每个含 sdkType) + ASR_PROVIDERS(2个，每个含 baseUrl) 纯数据定义，getProviderDef(id: LLMProviderId) + getAsrProviderDef(id: ASRProviderId) 类型安全查找。sdkType 驱动 AI SDK 构造器选择和 raw fetch 认证策略
- `lib/storage/` — Storage 统一管理目录（barrel `index.ts` re-export 全部 public API，import 路径 `@/lib/storage` 不变）
  - `keys.ts` — STORAGE_KEYS 中央常量注册表，列出所有 storage key（含 video-cache 的注释标记），新增 key 先在此检查冲突
  - `settings.ts` — UserSettings 类型定义 + settingsStorage (WXT `storage.defineItem<UserSettings>`) + DEFAULT_SETTINGS + resolveAsrConfig(settings)（纯函数，ASR 配置解析唯一真实来源）+ getAsrSettings()（异步便利函数，内聚 getValue + resolveAsrConfig，非 React 消费者使用）+ migrateSettingsIfNeeded()（旧平铺 ASR 字段 → asrConfigs Record）
  - `ui-state.ts` — sidebarPinnedStorage（`local:sidebarPinned`，布尔值，默认 true）
  - `index.ts` — barrel re-export + runStorageMigrations()（统一迁移入口，background.ts 只调这一个函数）
- `lib/bilibili/types.ts` — RawSubtitleItem, BiliAuthInfo, BiliFavFolder, BiliFavVideo, BiliFavVideoListResponse, SubtitleTrack, DashAudioStream 等 bilibili 领域类型
- `lib/bilibili/url-utils.ts` — 纯 URL 工具函数（零 chrome.* 依赖，Main World 安全）：extractBvid()（保留原始大小写）, extractPageNum(), isSubtitleCdnUrl()
- `lib/bilibili/bilibili-api.ts` — B站 API 层深模块：内部 ENDPOINTS URL builder + BiliAuthError + buildFetchInit(auth?) helper（有 auth 时显式 Cookie header，否则 credentials:'include'）。导出 getBiliAuth()（chrome.cookies 读 SESSDATA/DedeUserID）, fetchFavFolders(auth)（收藏夹列表）, fetchFavVideos(auth, mediaId, page, ps=20)（收藏夹视频分页列表，`/x/v3/fav/resource/list`）, fetchSubtitle(bvid, cid, auth?)（字幕 API + CDN，Content Script 省略 auth / Extension Page 传 auth）, fetchCidByPageList(bvid, pageNum, auth?)（CID 获取，同上）, fetchPlayUrl(bvid, cid)（DASH manifest）, extractBiliAudioUrl(bvid, cid)（DASH manifest 最优音频流 URL 提取，供 transcription-handlers.ts 注入 pipeline deps）
- `lib/bilibili/bili-sync-service.ts` — Bilibili 领域同步深模块（DB schema 知识的唯一持有者）。6 个高层操作：`checkAuth()`（认证检查，抛 BiliAuthError）, `fetchAndSyncFolders()`（auth + API + fire-and-forget DB sync）, `fetchAndSyncVideos(mediaId, page)`（auth + API + source lookup + DB sync，内聚 sourceId）, `getPendingBvids(pageBvids)`（返回 pending 子集）, `getPendingPreview(mediaId)`（auto-transcribe bar 预览 + 计数）, `markVideoError(bvid)`（标记转录失败）, `persistContent(bvid, rows, source)`（转录结果持久化）。内部委托 favorites-sync/videos-sync/content-sync 实现，消费者（hooks/pipeline）零 drizzle/entity/getDb 导入
- `lib/bilibili/favorites-sync.ts` — syncFavFoldersToDb(db, folders)：将 BiliFavFolder[] 批量 upsert 到 PGlite sources 表。**仅由 bili-sync-service 内部调用**
- `lib/bilibili/videos-sync.ts` — syncFavVideosToDb(db, videos, sourceId)：将 BiliFavVideo[] 批量 upsert 到 PGlite authors + items + item_sources 表，返回 `SyncResult`。事务包裹，批量 INSERT + SELECT 映射。**仅由 bili-sync-service 内部调用**
- `lib/bilibili/content-sync.ts` — persistSubtitleContent(db, bvid, rows, source)：字幕文本持久化到 item_contents 表 + 更新 content_state。**仅由 bili-sync-service 内部调用**
- `lib/bilibili/transcribe-utils.ts` — 转录共享工具函数：`transcribeAndPersist(bvid, title)` 发送 TRANSCRIBE_AUDIO + 成功后调用 `bili-sync-service.persistContent()`；`createStatusListener(matchBvid, onProgress)` 安装 TRANSCRIBE_STATUS 监听器，返回 cleanup 函数
- `lib/bilibili/transcription-coordinator.ts` — 手动转录状态协调器（纯 JS class，零 React 依赖）。`TranscriptionCoordinator` class：`subscribe()`/`getSnapshot()` 支持 `useSyncExternalStore`，`setVideos(videos)` 触发批量 GET_VIDEO_CACHE 缓存预加载，`transcribe(video)` 单视频转录（串行控制 activeBvid），`cancel()` 取消，`dispose()` 清理。内部管理 per-video 状态 Map + 重试倒计时（纯 JS setInterval）+ generation 防过期。通过 `transcribe-utils.ts` 共享 transcribeAndPersist 和 createStatusListener
- `lib/bilibili/auto-transcribe-pipeline.ts` — 自动转录编排深模块（纯逻辑，零 React 依赖，零 DB 依赖）。`AutoTranscribePipeline` class：`subscribe()`/`getSnapshot()` 支持 `useSyncExternalStore` 订阅，`start(mediaId)`/`stop()` 控制接口，`queryPreview(mediaId)` idle 态预览查询。通过 `bili-sync-service` 操作数据（`fetchAndSyncVideos`/`getPendingBvids`/`getPendingPreview`/`markVideoError`），自身不持有任何 DB schema 知识。编排流：分页同步 → 查询 pending → 逐个 `transcribeAndPersist()`（CC 5-10s / ASR 10-15s 随机间隔防检测）→ 429 暂停 60s 重试 → 下一页
- `lib/bilibili/bilibili-transcription-adapter.ts` — B站转录平台适配器：`prepareBiliTranscription(bvid, requestCid?)` 返回 `BiliTranscriptionContext`（`{ cid, fetchOfficialSubtitle, extractAudioUrl, postProcess }` 4 碎片）。内聚 bilibili-specific 转录准备逻辑（auth 获取、CID 解析、官方字幕 API 重试、DASH 音频 URL 提取、字幕后处理）。Background handler 通过此 adapter 获取平台碎片后组装 PipelineDeps，自身不直接 import bilibili-api/subtitle-processor
- `lib/bilibili/subtitle-processor.ts` — processSubtitles() B 站特有四步管线：normalize -> filter（B 站交互关键词过滤：点赞/投币/一键三连等）-> filler removal -> deduplicate(Jaccard>0.85)。接受 B 站原始格式和 favbase 格式。每条字幕保持独立行，不合并。通过 PipelineDeps.postProcess 注入到平台无关的 pipeline，未来其他平台提供各自的 postProcess 实现
- `entrypoints/bilibili-inject.content.ts` — Main World 入口协调器：创建 effects + 状态机 + 拦截器 + 路由监控，5 行 bootstrap
- `lib/bilibili/inject/state.ts` — InjectStateMachine 状态机（createStateMachine(effects)），拥有全部状态转换（bootstrap/markCaptured/resetForRoute）+ 定时器编排 + reemit loop。通过 InjectEffects 接口注入副作用，纯逻辑可单元测试
- `lib/bilibili/inject/effects.ts` — InjectEffects 生产实现（createBrowserEffects()）：DOM 操作（triggerCC/hideSubtitleDisplay/restoreDisplay）+ resolvePageMeta() 页面元数据 + isPageMetaConsistent()（检查 `__INITIAL_STATE__` bvid 与 URL bvid 一致性，SPA 过渡期间返回 false）+ 通过 messaging.ts 的 postBiliMessage() 桥接消息
- `lib/bilibili/inject/interceptors.ts` — fetch/XHR 覆写（installInterceptors(sm)），使用 url-utils.ts 的 isSubtitleCdnUrl() 检测字幕响应后调用 sm.markCaptured()
- `lib/bilibili/inject/route-monitor.ts` — 300ms SPA 路由轮询（startRouteMonitor(sm)），检测 BV 号/分P 变化后调用 sm.resetForRoute()
- `entrypoints/bilibili-video.content/` — 嵌入B站右侧栏的面板 UI
  - `index.ts` — 挂载逻辑：anchor 到 `.right-container-inner`，插在 UP 主面板后。禁用 `autoMount()`（它在 Vue 水合期间触发导致评论区崩溃），改用手动延迟挂载（page load + 2s）+ 500ms 轮询检测脱离后重挂载
  - `hooks/useVideoDetect.ts` — 通过 onBiliMessage() 订阅 BILI_ROUTE_SWITCH（SPA 导航重置）+ BILI_SUBTITLE_HANDSHAKE（bvid/cid 解析，cid=0 时不锁定 resolved 等待后续重发），3s 超时降级到 fetchCidByPageList API
  - `hooks/useSubtitle.ts` — 三层数据流：(1) GET_VIDEO_CACHE 缓存优先加载 (2) onBiliMessage() 拦截通道 (3) fetchSubtitle API 降级 + 重试。所有成功获取的字幕通过 CACHE_SUBTITLE 消息写入 Background 缓存。跨 tab 同步通过 `onVideoCacheChange(bvid, cb)` 订阅（`lib/cache/video-cache.ts` 封装 key 格式）。返回 { rows, loading, status, error, source, cached }
  - `components/Panel.tsx` — 主面板容器：左侧图标栏（CC + Settings Tab，activeTab 切换）+ 右侧内容区（header + 可折叠 body），根据 activeTab 渲染 SubtitleView 或 SettingsView。通过 `settingsProps` 单对象透传设置相关数据
  - `components/SubtitleView.tsx` — 逐行字幕列表 + 搜索过滤（100ms debounce，CSS display:none 隐藏不匹配行，保持 activeIndex 稳定）+ 搜索高亮（`<mark>` 标黄匹配文本）+ 来源标签（source badge，显示"官方AI字幕"/"ASR 转录"/"ASR 缓存"）+ 时间戳点击跳转 + 当前播放行高亮（250ms 轮询 `<video>.currentTime`，二分查找活跃行）+ 自动滚动（搜索激活时暂停 auto-scroll，清空搜索后恢复；尊重用户手动滚动意图，4s 超时恢复）
  - `components/SettingsView.tsx` — 纯渲染设置界面：LLM Provider 下拉（9个）+ 每 Provider 独立 API Key/Model + Custom 额外字段 + ASR Provider 切换 + 调用模式单选。零业务逻辑，通过 `updateLlm`/`updateAsr` 两个 props 接收所有 action
  - `components/StatusBar.tsx` — 加载/无字幕/错误状态（来源信息已迁移到 SubtitleView 的 source badge）
  - `components/TranscribeButton.tsx` — 转录触发按钮 + 进度条（分阶段）+ 取消按钮 + 错误/重试 + rate limit 倒计时。stage/error 通过 `translateStage()`/`translateError()` 调用 `t()` 翻译，不直接渲染 error.message
  - `hooks/useTranscribe.ts` — 转录状态管理：startTranscribe → browser.runtime.sendMessage(TRANSCRIBE_AUDIO) → 监听 TRANSCRIBE_STATUS 推送 → 结果/错误。useRetryCountdown 共享倒计时。SPA 切换时自动重置（bvidRef staleness guard：Promise 回调检查 bvidRef.current 是否仍匹配，防止视频 A 的转录结果写入视频 B）。官方字幕优先 → ASR 降级策略由 Background handler 层统一管理

### Groq ASR 转录 (Step 2 — 已完成，Bilitato 对齐)

3 层管线：Content Script → Background SW → Offscreen Document（FFmpeg WASM 分块）。

- `lib/subtitle/types.ts` — 通用字幕共享类型（平台无关）：SubtitleSource(`'bilibili' | 'groq'`，字幕来源唯一类型定义), SubtitleRow(`{ start, end, text }`，通用字幕行), SubtitleResult(`{ status, rows, source?, error? }`，字幕获取结果)。所有层（bilibili/transcription/cache/offscreen/UI）统一从此模块导入
- `lib/transcription/types.ts` — 转录核心类型：TranscribeRequest/Abort, TranscribeResponse(success|failure), TranscribeStage(13种 union，含 subtitle_check), TranscribeStatusPush(stage enum + stageParams), TranscribeErrorCode(12种) + TranscribeErrorInfo(code + debug message + params) + createErrorInfo(code, message, params?) 工厂函数 + isTranscribeError(err) 类型守卫。纯数据错误模型，无类继承，IPC 天然兼容。内部引用 SubtitleRow/SubtitleSource from `lib/subtitle/types`
- `lib/transcription/constants.ts` — GROQ_MAX_AUDIO_BYTES(24MB), CHUNK_SECONDS(600), OVERLAP(4s), SAFETY_RATIO(0.72), PROGRESS 阶段映射, 超时常量
- `lib/transcription/groq-client.ts` — ensureGroqConnectivity(apiKey, baseUrl?)（6s pre-flight GET /models）+ requestGroqTranscription(blob, apiKey, model, signal?, baseUrl?)（FormData POST verbose_json+segment）+ mapTranscriptionToRows() + parseRetryAfter()。baseUrl 可选参数支持多 ASR Provider（Groq/SiliconFlow），默认 Groq。错误通过 createErrorInfo() 抛出 TranscribeErrorInfo 纯对象，isTranscribeError() 防双层包装。API 类型内聚于此文件，不导出
- `lib/transcription/audio-extractor.ts` — 平台无关的音频下载：fetchAudioBlob(url, signal, onProgress)（streaming 下载，10% 粒度进度映射到 20-55%）。错误通过 createErrorInfo() 抛出。不含 B 站特定逻辑，音频 URL 提取已移至 bilibili-api.ts 的 extractBiliAudioUrl()
- `lib/transcription/audio-fingerprint.ts` — assertAudioNotReused(blob, bvid)（SHA-256 + LRU(30)，相同 hash 不同 bvid 拒绝）
- `lib/transcription/pipeline.ts` — TranscriptionPipeline 深模块：`runTranscriptionPipeline(request, deps, onProgress)` 编排完整转录策略（cache → official subtitle → ASR fallback → postProcess → cache save）。`PipelineDeps` 6 方法接口（`getAsrConfig`/`fetchOfficialSubtitle`/`transcribeAudio`/`cacheGet`/`cacheSave`/`postProcess`），转录策略的唯一真实来源。`postProcess` 通过 DI 注入平台特有的字幕后处理（B 站注入 `processSubtitles`，未来其他平台注入各自实现）。`AsrConfig`（apiKey/model/baseUrl）是 ASR 配置统一类型。`toErrorInfo()` 通过 `isTranscribeError()` 识别纯数据错误对象
- `lib/offscreen/types.ts` — Offscreen 协议类型：SubsystemState(`'pending'|'ready'|'failed'`) + OffscreenStatus（双子系统状态）+ OffscreenStatusRequest + ChunkPlan, OffscreenPrepareRequest/TranscribeRequest/ReleaseRequest, OffscreenProgressMessage/ResultMessage/ErrorMessage, OffscreenRequest（含 StatusRequest）/OffscreenMessage union
- `lib/offscreen/lifecycle.ts` — Offscreen Document 生命周期管理（Background 侧）：`ensure()` 统一入口（in-flight promise 守卫，防止并发 TOCTOU 竞态）+ `getSubsystemStatus()` 查询 FFmpeg/PGlite 子系统状态（ensure + sendMessage OFFSCREEN_STATUS）。所有需要 Offscreen Document 的调用点（FFmpeg 分块、PGlite RPC）均通过此模块
- `lib/offscreen/main.ts` — Offscreen Document 逻辑：模块级 `subsystemStatus` 追踪双子系统初始化状态（FFmpeg lazy init 成功→ready/失败→failed/reset→pending，PGlite init 成功→ready/失败→failed）。FFmpeg 全局互斥锁（`withFfmpegLock` Promise-chain mutex，handlePrepare/handleTranscribe 串行执行）。fetchAudioBytes(自行 fetch audioUrl) + resolveAudioDuration(HTML5 Audio 优先，ffprobe 降级) + FFmpeg 本地 WASM 加载(public/ffmpeg/) + estimateSafeChunkSeconds(0.72 安全系数) + buildOverlappedChunkPlan(600s+4s overlap) + splitAudioIntoChunks(FFmpeg -c:a copy) + transcribeChunk(委托 `requestGroqTranscription`，错误直接透传 TranscribeErrorInfo 纯对象，IPC 天然兼容) + mergeTimestampedChunkRows(时间偏移+overlap 裁剪+1.5s 近邻去重)。最多 3 轮 30% 缩减。Session Map 带 10min TTL 自动清理（60s 扫描）+ FFmpeg 操作失败后 resetFFmpeg() 防止状态污染。OFFSCREEN_STATUS handler 返回当前子系统状态
- `entrypoints/offscreen.html` — WXT unlisted page，通过 lifecycle.ensure() 按需创建
- `lib/cache/types.ts` — 缓存领域类型：VideoCacheEntry(含 rawHash), GetVideoCacheRequest, CacheSubtitleRequest
- `lib/cache/video-cache.ts` — 视频缓存模块：normalizeBvid()（防御性小写规范化，所有公开函数入口调用）+ per-bvid 独立 key（`local:vc:{bvid}`）+ 内存缓存层（Map + structuredClone 深拷贝）+ getVideoCache(bvid)（空 rows 条目视为缓存未命中返回 null，消费者无需二次验证）+ mergeVideoCache(bvid, rows, source)（深接口：hash/timestamp 内部计算，Promise-based per-bvid 写锁 + hash 去重 + quota 降级）+ 旧格式迁移（`local:videoCache` → `local:vc:{bvid}`）+ initCacheStorageListener（Background 侧 chrome.storage.onChanged 同步内存缓存）+ onVideoCacheChange(bvid, cb)（Content Script 侧订阅缓存变更，封装 key 格式，返回 unsub）。computeRowsHash / CHROME_KEY_PREFIX 为模块内部，不导出
- `entrypoints/background.ts` — Background SW dispatcher：`createBackgroundContext()` 工厂函数创建深模块（内聚 3 个 Map：abortControllers/tabBvids/sessionTabMap + activeBvids Set 去重），`onMessage` switch 路由到独立 handler。有状态 handler 统一签名 `(msg, sender, ctx)`，无状态 handler 签名 `(msg)`。onInstalled/onStartup 确保 Offscreen 存活
- `lib/background/types.ts` — BackgroundContext 深模块接口：`startTranscription(tabId, bvid)` 返回 AbortController（同 bvid 已有 in-flight 返回 null 去重）/ `abortTranscription(tabId)` / `finishTranscription(tabId)` / `getBvidForTab(tabId)` / `registerChunkSession` / `unregisterChunkSession` / `resolveProgressTarget(sessionId)` + `sendToTab` / `ensureOffscreen`。零 Map 暴露
- `lib/background/messages.ts` — Background SW 消息注册表：BgClientMessage（TranscribeRequest/Abort + GetVideoCacheRequest/CacheSubtitleRequest）, BgInternalMessage（OffscreenProgressMessage）, BgMessage union。从各领域模块导入成员类型后组合
- `lib/background/port-bridge.ts` — PortBridge 双向 Chrome Port 中继：app.html → Background SW → Offscreen（3-hop 架构）。监听 `favbase-db` channel，为每个 Extension Page 连接创建到 Offscreen 的中继，指数退避重连（200ms-5s，最多 20 次）。Must 在 module load time 同步初始化（MV3 SW 要求）
- `lib/background/transcription-handlers.ts` — 平台无关的转录调度层，有状态 handler 统一签名 `(msg, sender, ctx)`。`handleTranscribe`：dedup 检查 → `prepareBiliTranscription()` 获取平台碎片 → 组装 PipelineDeps → `runTranscriptionPipeline` → 清理。零 bilibili-api/subtitle-processor 直接 import，平台知识通过 `bilibili-transcription-adapter` 注入。`createTranscribeAudio(tabId, ctx, extractAudioUrl)` 平台无关 ASR 基础设施（connectivity + download + fingerprint + direct/chunked + offscreen 会话管理），`extractAudioUrl` 由 adapter 注入。`handleTranscribeAbort` 委托 `ctx.abortTranscription`。`handleOffscreenProgress` 通过 `ctx.resolveProgressTarget` 精确路由（sessionId 无法解析时 warn + 丢弃，不广播）。零模块级状态
- `lib/background/cache-handlers.ts` — handleGetVideoCache + handleCacheSubtitle，纯函数签名 `(msg)`，委托 lib/cache/video-cache.ts

### 数据导出模块

PGlite 全量导出（JSON / CSV+ZIP），纯 app.html 侧运行。高内聚 4 模块 + 1 UI 组件。

- `lib/export/query.ts` — `queryAllTables(db, includeEmbedding)` 并发查询 6 张表，Date→ISO 序列化，可选剥离 embedding 列。`isTableDataEmpty()` 判空
- `lib/export/serialize-json.ts` — `toExportJson(data)` 纯函数，输出 `{ exported_at, version:1, tables }` JSON string
- `lib/export/serialize-csv.ts` — `toExportCsvZip(data)` 纯函数，RFC 4180 CSV + fflate ZIP 打包，返回 Uint8Array
- `lib/export/download.ts` — `triggerDownload(blob, filename)` 浏览器下载 + `buildExportFilename(format)` 文件名生成
- `entrypoints/app/sections/overview/export-card.tsx` — MUI Card 导出 UI：格式切换（JSON/CSV）+ embedding Checkbox + 导出按钮 + 空数据/DB 未就绪错误处理

### Vercel AI SDK 集成层

Provider factory + 测试连接 + 模型列表获取。为 app.html 设置页面和未来 LLM 总结（Step 3）提供基础设施。

- `lib/ai/index.ts` — 三函数合一模块。`createLanguageModel(options)` 根据 `def.sdkType` 选择 AI SDK 构造器（openai/anthropic/google/openai-compatible），custom provider 特殊处理 `customProtocol`。`testLlmConnection()` 通过 `generateText()` 验证连接。`fetchAvailableModels()` 原生 fetch 调用 `{baseUrl}/models`，`buildAuthHeaders()` 和 `resolveModelsEndpoint()` 均基于 `sdkType` 分支

### PGlite + Drizzle 数据库层

RPC Proxy 架构（参考 memorall 3-hop PortBridge 模式）：Offscreen Document 持有 PGlite，app.html 通过 PortBridge 中继（app.html → Background SW → Offscreen）透明使用 Drizzle query builder。app.html 启动时 fire-and-forget 调用 `initDbProxy()`，Background SW 负责 Offscreen 生命周期管理。

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
  - `proxy-driver.ts` — `PGliteSharedProxy`（implements PGliteLike，请求 ID 关联 + 30s 超时 + 事务互斥锁：`transaction()` 持锁期间 `query()`/`exec()` 排队等待，防止并发查询混入事务上下文。`createTxClient()` 返回绕过锁的内部客户端供事务回调使用）
  - `chrome-port-rpc.ts` — `createChromePortTransport()`（`chrome.runtime.connect`，指数退避重连，消息队列）
  - `rpc-handler.ts` — `DatabaseRpcHandler`（Offscreen singleton，`chrome.runtime.onConnect` 监听，in-flight 去重，PGlite ready gate 排队机制）
- `lib/database/migrations/` — 自定义迁移系统
  - `index.ts` — `runMigrations(pg)` 跑迁移：读 `_migrations` 表 → 按 version 顺序执行未应用的迁移
  - `v001-init.ts` — v1 初始化：CREATE EXTENSION + 6 张业务表 + 索引 + GIN trigram 索引 + updated_at 触发器
- `lib/database/index.ts` — Public API barrel

### 共享 Hooks

- `lib/hooks/useSettings.ts` — deep module：settingsStorage 读写（debounced 500ms + watch 外部变更 + unmount flush）+ LLM/ASR computed 属性（currentProviderDef, currentLlmApiKey, currentLlmModel, isCustomProvider, currentAsrDef, currentAsrApiKey, currentAsrModel）+ 收窄 action 接口：`updateLlm(LlmUpdate)` / `updateAsr(AsrUpdate)` 两个 discriminated union action 替代原 11 个独立 callback。ASR computed 和 action 直接从 `settings.asrConfigs[asrProvider]` 索引（新增 ASR provider 只需在 providers.ts 加定义）。app.html 和 Content Script 共享同一实例
- `lib/hooks/useRetryCountdown.ts` — 共享 retryCountdown hook：`{ countdown, startCountdown(seconds), resetCountdown }`。由 Content Script 侧 `useTranscribe` 使用（app.html 侧 `TranscriptionCoordinator` 自建纯 JS 倒计时，不依赖此 hook）

## 约定

- Extension Page (app.html): MUI v7 + Emotion CSS-in-JS + `createHashRouter`。Chrome 扩展页面 URL 不支持路径路由，必须用 hash router。主题系统复刻 material-kit-react（`minimal-shared` 工具库 + `@iconify/react` 图标）。新增页面：在 `pages/` 添加 lazy 组件 + `main.tsx` 路由配置 + `nav-config.tsx` 导航项
- Content Script UI 使用 WXT `createShadowRootUi` + React，`cssInjectionMode: 'ui'`，`isolateEvents: true`，嵌入 B 站右侧栏 `.right-container-inner`（UP 主面板后）。**禁用 `autoMount()`** — 它通过 MutationObserver 在锚点出现瞬间挂载，正值 Vue 水合阶段，注入外部节点会破坏 VDOM 导致评论区消失。必须手动延迟挂载：等 `document.readyState === 'complete'` + 2s（与 Bilitato 一致），SPA 路由切换后通过 500ms 轮询检测脱离并 1s 延迟重挂载
- **WXT Shadow DOM 宽度陷阱**: WXT 注入 `:host{all:initial !important}`，底层 `@webext-core/isolated-element` 在 shadow root 内创建 `<html><body>` 包装（body 有 UA `margin:8px`）。`:host` 和 `html,body` 的关键布局属性必须用 `!important` 覆盖，否则宿主元素会 `display:inline` 导致不撑满宽度
- **Content Script Design Tokens**: `style.css` 的 `:host` 定义 `--fb-*` CSS 自定义属性，色值/阴影/圆角从 `entrypoints/app/theme/theme-config.ts` 手动同步。修改 app.html 调色板后需同步更新 content script 的 `--fb-*` token。字体保持系统字体栈（不加载 DM Sans/Barlow）
- BVID 规范化: `extractBvid()` 保留原始大小写（B站 API 区分大小写），`normalizeBvid()`（`lib/cache/video-cache.ts`）仅在缓存层做小写规范化。storage key、写锁使用小写 bvid；API 调用和消息传递保留原始大小写，比较时用 `.toLowerCase()` 做大小写无关匹配
- Step 1 字幕获取: 双通道架构 — Main World 脚本（`bilibili-inject.content.ts`）拦截 fetch/XHR 被动捕获字幕优先，3s 超时降级到 Content Script 同源 API 调用
- CID 获取: Main World 读取 `window.__INITIAL_STATE__` 优先（定期重发直到 content script 接收），降级到 `/x/player/pagelist` API（轻量，不需要 WBI 签名）
- postMessage 桥接: Main World -> Isolated World，通过 `lib/bilibili/messaging.ts` 统一收发。BiliMessageMap 定义所有消息类型，发送用 postBiliMessage()，接收用 onBiliMessage()。消息流：`BILI_ROUTE_SWITCH`(bvid, 路由变化即时通知) → `BILI_SUBTITLE_HANDSHAKE`(bvid+cid, 800ms延迟) → `BILI_SUBTITLE_DATA`(字幕数据, defer 发送)。新增消息类型只需在 BiliMessageMap 加一行
- 字幕后处理: pipeline 通过 `PipelineDeps.postProcess` 注入平台特有的字幕后处理。B 站注入 `processSubtitles()`（四步管线，不合并，逐条独立）。Content Script 侧（useSubtitle）直接 import `processSubtitles`（同域，方向正确）
- Background 消息桥: Content Script ↔ Background 通过 browser.runtime.sendMessage/onMessage。消息类型定义在 `lib/background/messages.ts`（BgMessage = BgClientMessage | BgInternalMessage）。BgClientMessage 成员来自各领域模块（`lib/transcription/types.ts` 的 TranscribeRequest/Abort + `lib/cache/types.ts` 的 GetVideoCacheRequest/CacheSubtitleRequest），BgInternalMessage 来自 `lib/offscreen/types.ts`。Background → Content Script 进度推送用 browser.tabs.sendMessage。Background ↔ Offscreen 用 chrome.runtime.sendMessage（Chrome-specific API）。Handler 签名分两层：有状态 handler `(msg, sender: { tab?: { id?: number } }, ctx: BackgroundContext)` + 无状态 handler `(msg)`。同 bvid 并发转录自动去重（`ctx.startTranscription` 返回 null → 返回 TRANSCRIBE_DUPLICATE 错误）。新增消息类型：在对应领域模块定义类型 + 在 `lib/background/messages.ts` 注册到 union + 在 `lib/background/` 对应领域 handler 文件添加 handler 函数（有状态签名或无状态签名） + `background.ts` dispatcher switch 添加 case
- B 站认证: manifest 声明 `cookies` 权限。`lib/bilibili/bilibili-api.ts` 的 `getBiliAuth()` 通过 `chrome.cookies.get()` 读取 SESSDATA + DedeUserID，检查 expirationDate。需要认证的 API（如 fetchFavFolders）手动拼 `Cookie: SESSDATA=xxx` header，Content Script 侧 API 通过 `credentials: 'include'` 自动带 cookie
- Bilibili 领域同步: `lib/bilibili/bili-sync-service.ts` 是 DB schema 知识的唯一持有者。所有消费者（`useBiliFavFolders`/`useBiliFavVideos`/`AutoTranscribePipeline`/`transcribe-utils`）通过 service 高层操作访问数据，零 drizzle/entity/getDb 导入。service 内部委托 `favorites-sync`/`videos-sync`/`content-sync` 三个实现模块。新增 B 站同步操作：在 service 添加函数，消费者不直接操作 DB
- B 站收藏夹: app.html Collections 页面为 sidebar+grid 单页布局（`collections-view.tsx`）。左侧 240px `FolderSidebar`（可折叠分组列表），右侧 `VideoGridPanel`（标题栏+视频网格+分页）。`/collections` 和 `/collections/bilibili/:mediaId` 共用同一组件，通过 `useParams` 获取 mediaId 驱动右侧内容切换，无 mediaId 时自动 navigate(replace) 到第一个收藏夹。`useBiliFavFolders` hook 调用 `bili-sync-service.fetchAndSyncFolders()` 获取数据并管理 UI 状态
- B 站视频持久化: `useBiliFavVideos` 调用 `bili-sync-service.fetchAndSyncVideos(mediaId, page)`，service 内部处理 auth + source lookup + `syncFavVideosToDb`。批量 upsert + 事务保证原子性。MVP insert-only 不更新已有记录，`content_state='pending'`
- 存储: `lib/storage/` 目录统一管理（import 路径 `@/lib/storage`）。WXT `storage.defineItem`（`local:` 前缀），import from `wxt/utils/storage`（非 `wxt/storage`）。STORAGE_KEYS（`lib/storage/keys.ts`）是中央 key 注册表，新增 key 先在此检查冲突。非 React 消费者用 `getAsrSettings()`（异步，内聚 getValue + resolveAsrConfig），React 消费者通过 `useSettings` hook 操作 `settingsStorage`。`runStorageMigrations()`（`lib/storage/index.ts`）是统一迁移入口，background.ts 只调这一个函数
- 设置持久化: `settingsStorage`（`lib/storage/settings.ts`），UserSettings 单对象存储在 `local:settings`。`useSettings`（`lib/hooks/useSettings.ts`）是共享 deep module — 内聚 storage 读写、computed 属性推导、收窄 action（`updateLlm`/`updateAsr` discriminated union）。ASR 配置结构化为 `asrConfigs: Record<string, { apiKey, model }>`，`resolveAsrConfig` 直接索引 + fallback 到 `defaultModel`。新增 ASR provider 只需在 `providers.ts` 加定义。app.html 和 Content Script 都直接从 `@/lib/hooks/useSettings` 导入
- 侧边栏 Pin/Unpin: `sidebarPinnedStorage`（`lib/storage/ui-state.ts`），布尔值存储在 `local:sidebarPinned`（默认 true）。DashboardLayout 读取并通过 toggle 按钮切换。Pinned=280px 展开（图标+文字），Unpinned=72px 图标栏（MUI Tooltip 显示菜单名）。Mobile（lg 以下）不受影响，始终 Drawer 模式
- AI SDK Provider 映射: `LLMProviderDef.sdkType` 驱动全部分支。openai → `@ai-sdk/openai`，anthropic → `@ai-sdk/anthropic`，google → `@ai-sdk/google`，openai-compatible → `@ai-sdk/openai-compatible`。custom provider 的 sdkType 静态为 `openai-compatible`，`customProtocol==='claude'` 时运行时覆盖为 anthropic。测试连接用 `generateText()`，模型列表用原生 fetch（AI SDK 无 model listing API），认证 header 由 `buildAuthHeaders(sdkType, apiKey)` 统一构建
- Inject 状态机: 三阶段生命周期 idle → triggering → captured，通过 InjectEffects 接口注入 DOM/postMessage 副作用，状态转换集中在 state.ts 的 createStateMachine() 内。双层防污染守卫：(1) generation 并发守卫防止路由切换后旧 in-flight 拦截结果被采纳 (2) `isPageMetaConsistent()` 检查 `__INITIAL_STATE__` bvid 与 URL bvid 一致性，SPA 过渡期间（`__INITIAL_STATE__` 尚未更新）拒绝 markCaptured / emitHandshake / autoTrigger，防止旧视频字幕被标记为新视频 bvid。fetch 拦截器必须在 `await` 之前捕获 generation（interceptors.ts），XHR 在 send() 时捕获
- SPA 路由监控: route-monitor.ts 300ms 轮询 location.href 检测 BV 号/分P 变化 → sm.resetForRoute() 级联重置（generation++、清理定时器、restoreDisplay） → ROUTE_SWITCH 即时通知 → 800ms 后重发 HANDSHAKE → 重触发 CC 按钮
- 字幕获取流程（主路径）: interceptors.ts 拦截 fetch/XHR → sm.markCaptured() 解析+桥接 → postMessage SUBTITLE_DATA → useSubtitle 接收 → processSubtitles()
- 字幕获取流程（降级路径）: extractBvid() → fetchCidByPageList() → fetchSubtitle(bvid, cid) → processSubtitles()（失败自动重试最多 2 次）
- 字幕 CDN (`aisubtitle.hdslb.com`) 跨域但 CORS 允许，Content Script 可直接 fetch（带 `credentials: 'include'`）
- 无字幕降级: useSubtitle 返回 no_subtitle（网络异常也降级为 no_subtitle 而非 error）→ App 显示 TranscribeButton（status 为 no_subtitle 或 error 时均展示）→ 用户点击 → TRANSCRIBE_AUDIO → Background handler（adapter 准备平台碎片 → 组装 PipelineDeps → pipeline 统一编排）→ 结果回写 SubtitleView
- CDN 请求头: `declarativeNetRequest` 静态规则（`public/rules.json`）在网络栈层面为 bilivideo 域名设置 `Referer: https://www.bilibili.com/` + `Origin`。Background SW 的 fetch() 自身设置的 Referer 会被 Chrome MV3 剥离，必须用 declarativeNetRequest
- 转录总流程: handler 调用 `prepareBiliTranscription()` adapter 获取平台碎片（auth + CID 解析 + 官方字幕 fetcher + 音频 URL 提取器 + postProcess） → 组装 PipelineDeps → pipeline 统一编排（cache → subtitle_check 官方字幕优先（含重试）→ ASR fallback（connectivity → extractAudioUrl(注入) → fetchAudioBlob → assertAudioNotReused → ≤24MB 直传 / >24MB Offscreen FFmpeg 分块）→ postProcess(注入) → cache save）。TranscribeRequest.cid 可选：content script 有 cid 就传，app.html 不传由 adapter 解析。ASR 配置（apiKey/model/baseUrl）统一由 `AsrConfig` 类型承载，`resolveAsrConfig` 是唯一真实来源。新增平台：创建对应 `xxx-transcription-adapter.ts` 提供同样 4 碎片，handler 加一个 dispatch 分支
- 视频缓存: `lib/cache/video-cache.ts` 模块。per-bvid 独立 key `local:vc:{bvid}`（chrome.storage 中为 `vc:{bvid}`，key 前缀由内部 `CHROME_KEY_PREFIX` 常量管理）。内存缓存层（Map<string, VideoCacheEntry>）+ Promise-based per-bvid 写锁 + 内部 hash 去重（computeRowsHash 不导出）。`getVideoCache(bvid)` 返回 null 表示缓存未命中（包括空 rows 条目），消费者拿到 non-null 结果即保证 rows 非空，无需二次验证。调用方只传 `mergeVideoCache(bvid, rows, source)`，hash/timestamp 由 cache 内部管理。所有来源（bilibili/groq）字幕统一缓存。旧 `local:videoCache` 单体 key 在首次访问时自动迁移。Background 侧 initCacheStorageListener 保持内存缓存与 storage 同步，Content Script 侧通过 `onVideoCacheChange(bvid, cb)` 订阅跨 tab 缓存变更（key 格式封装在缓存模块内部，调用方无需知道）
- Offscreen Document: WXT unlisted page `entrypoints/offscreen.html`，逻辑在 `lib/offscreen/main.ts`。通过 `lib/offscreen/lifecycle.ts` 的 `ensure()` 按需创建（singleton，in-flight promise 守卫防并发竞态）+ `getSubsystemStatus()` 查询子系统健康状态。Document 常驻不销毁（PGlite 需要）。**双职责**：FFmpeg WASM 分块 + PGlite 数据库持有者，两个子系统完全独立（一个挂了不影响另一个）。显式子系统状态契约：`subsystemStatus: { ffmpeg: SubsystemState, pglite: SubsystemState }`（`'pending'|'ready'|'failed'`），通过 `OFFSCREEN_STATUS` 消息 pull 查询。FFmpeg 全局互斥锁（`withFfmpegLock` Promise-chain mutex）保证 prepare/transcribe 串行执行。两套 IPC 完全隔离：FFmpeg 用 `chrome.runtime.onMessage`（request/response），PGlite 用 `chrome.runtime.onConnect`（port-based RPC，channel name `favbase-db`）。Background 传 audioUrl（非 ArrayBuffer），Offscreen 自行 fetch 音频数据。FFmpeg WASM 从 `public/ffmpeg/`（@ffmpeg/core@0.12.10）本地加载。Session Map 带 10min TTL 自动清理防泄漏，FFmpeg 操作失败后自动 reset 实例防状态污染
- PGlite 数据库: Offscreen Document 是唯一持有者（单连接模型），持久化到 IndexedDB（`idb://favbase`）。扩展：pgvector（`@electric-sql/pglite-pgvector`）、uuid-ossp、pg_trgm（内置 contrib）。`initDbMain()` 在 Offscreen 启动时调用：先同步注册 `DatabaseRpcHandler.startListening()`（`onConnect` listener 立即可用），再异步创建 PGlite + 跑迁移，完成后 `setPGlite()` 解除排队请求。这避免了调用方 connect 时 listener 未注册的时序竞态。app.html 通过 3-hop PortBridge 中继访问 DB：`initDbProxy()` → `chrome.runtime.connect('favbase-db')` → Background SW PortBridge → Offscreen RPC Handler。Background SW 在 `onInstalled`/`onStartup` 确保 Offscreen 存活。Drizzle query builder 在调用端本地构建 SQL，仅执行通过 RPC 代理
- 数据库迁移: 自定义迁移系统（非 drizzle-kit），`_migrations` 表追踪版本。迁移脚本直接写 SQL（不用 Drizzle 内部 Symbol 反射）。`runMigrations(pg)` 在 `initDbMain()` 内自动执行。新增迁移：在 `lib/database/migrations/` 添加 `vNNN-*.ts`，在 `index.ts` 的 `migrations` 数组追加条目
- Drizzle Schema: entity-per-file（`lib/database/entities/`），`schema.ts` 集中导出，`types.ts` 仅 type 导出（无运行时依赖，proxy 线程安全导入）。新增表：添加 entity 文件 + 更新 schema.ts + types.ts + 写迁移脚本
- i18n 架构: `lib/i18n/` 自研轻量方案（无外部依赖），observable locale + `useSyncExternalStore`。`localeStorage`（`local:locale`，`lib/storage/ui-state.ts`）持久化用户偏好 `'auto' | 'zh-CN' | 'en'`（默认 `'auto'` 跟随 `navigator.language`）。`t()` 读可变 `currentMessages` 引用，DEV 模式对 missing key 输出 `console.warn`。React 消费者通过 `useTranslation()`（`lib/i18n/use-translation.ts`）订阅 locale 变化驱动 re-render，返回 `{ t, locale, preference, setLocale }`。`storage.watch()` 跨 context 同步（Content Script ↔ app.html）。有模块级 helper 的组件保留 `import { t } from '@/lib/i18n'` + 在组件内 `useTranslation()` 订阅；纯 JSX 组件用 `const { t } = useTranslation()`。locale 文件在 `lib/i18n/locales/{zh-CN,en}.ts`，`LocaleKeys` 类型从 zh-CN 推导。**seam 在 UI 边界**：lib 层只传结构化数据（TranscribeErrorCode + params / TranscribeStage + stageParams），UI 层通过 `t()` 翻译。新增 error/stage locale key 时需同时更新 zh-CN.ts 和 en.ts
- LLM 总结: OpenAI 协议兼容多 Provider，Quality/Efficiency 两种模式（Step 3，待实现）
