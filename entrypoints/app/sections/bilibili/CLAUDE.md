# bilibili

app.html B站收藏夹页面 adapter，消费共享 `CollectionPageScaffold`。固定顺序：页面标题/系统状态 → 搜索 → 自动转录 → 收藏夹主分类 → 标签 → 服务端排序次分类 → 视频列表。

## 模块结构

- `bilibili-view.tsx` — 页面 Adapter：通过共享 pipeline 展示 Sync/Transcription/Embedding/Tagging；认证门隐藏 strip，后两条 lane 来自独立 tracked Promise，禁止用 `indexing` 冒充 Tagging。标题、服务端搜索、换夹 remount 与 operation scope 不变。
- `video-grid-skeleton.tsx` — `VideoGridSkeleton`：共享 `CardGridSkeleton` 外壳（grid-of-8）+ B站卡片内部形态（Card+媒体块 130+两行文字），由 scaffold 的普通列表 phase 与 `TaggedItemGrid` 共用
- `folder-chips.tsx` — 横向收藏夹过滤器：共享 `ChipRowShell`（camera icon + `collections.foldersTitle`）+ `FilterChip`（maxWidth 200），本文件保留内容逻辑——loading 骨架 chip / folders 为空显示 `collections.noFolders` / 点击 = `onSelect(folder.id)`（驱动 navigate）。**不显示 per-chip 视频数**（纯名称，选中夹计数在标题 caption）
- `use-bili-fav-folders.ts` — B站收藏夹 hook：挂载时只 await `fetchAndSyncFolders()` 并发布 folders，避免路由进入触发全量视频分页；显式同步按钮才继续 await `syncAllFavoriteVideos()` 遍历全部收藏夹。本地持有 `syncProgress` 并在完成/失败时清空。auth + API fetch + DB sync 全部由 service 内聚
- `video-card.tsx` — 视频卡片：封面缩略图 + 左下角播放量标签 + 右下角时长标签 + 标题 + UP主 + 收藏时间（`formatFavTime`：同年显示 MM-DD，跨年显示 N年前，自然年判断）+ 标签行（共享 `TagRow`（`components/tags/`），CardActionArea **之外**避免误触跳转、ActionBar 之上；`tags` prop undefined 时整个区域不渲染（向后兼容），`[]` 时只显示编辑按钮无空行占位）+ 底部操作栏（转录/状态标记/进度）。失效视频灰显（attr===9）无操作栏无标签行。导出 `INVALID_ATTR = 9` 供调用方判断。操作栏三态：来源标记（CC 官方/ASR Chip，`state.indexed` 时并列"已索引"secondary Chip（`card.indexed`，database 图标）——content_state='embedded' 才显示）、转录按钮、进度条（LinearProgress + stage 文字 + 取消按钮；转录完成后本地索引期间 stage='indexing' 显示 `stage.indexing`"正在建立索引…"）
- `tagged-video-card.tsx` — `TaggedVideoCard`：TaggedItemGrid `renderCard` 的 B 站卡片 adapter。`toBiliFavVideo` 把平台无关 `TaggedItem` 映射回 `BiliFavVideo` 最小形状复用 VideoCard（platformMeta 取 cover/intro/duration/cnt_info/attr/type/fav_time，缺失给默认值；upper/id 用占位）。不传 `transcribeState`（无操作栏——标签筛选网格是知识库视图非夹内视图），传 `tags` + `onEditTags`。**adapter 知识归 adapter**：`BiliFavVideo` 类型导入只在本文件，共享模块零平台导入
- `use-bili-fav-videos.ts` — 收藏夹视频浏览 hook：调用 fetch-only `bili-sync-service.fetchFavoriteVideosPage(mediaId, page, order, keyword)` 获取当前 UI 页，不写库、不污染全量同步基线；goToPage、服务端排序/搜索与 `fetchIdRef` 过期响应保护保持不变
- `use-video-transcribe.ts` — 手动转录薄 hook；除 `bilibili:transcribe` 外，注入 `trackJobRun` 观察 Embedding/Tagging Promise。observer 不取消、不 await 业务 Promise，路由切换后的运行态仍由模块 store 保留。
- `use-auto-transcribe.ts` — 自动转录薄 hook（~55 行）：接收 `collectionId` + `AutoTranscribeAdapter`，创建 `AutoTranscribePipeline`（构造函数注入 adapter）+ `useSyncExternalStore` 订阅状态 + start/stop 透传 + collectionId 变更时触发 preview 查询 + unmount 时 dispose。类型 re-export from `lib/auto-transcribe/types.ts`
- `auto-transcribe-bar.tsx` — 自动转录进度 UI：全宽面板，独占 title bar 下方一行。idle 态：previewLoading 时 CircularProgress 占位；pendingCount===null（source 已建但 items 未同步）时显示无数量的通用面板 + 既有"开始"按钮；pendingCount===0 时 check 图标 + "所有视频已转录"；其余显示预览缩略图 + 待转录数 + "开始"按钮。运行时显示丰富进度面板（当前视频缩略图 100x60 + 标题/作者/时长/阶段文字（`stageLabel`：videoStage==='indexing' 时显示 `autoTranscribe.indexing`"正在建立索引…"，本地 chunk+embed 阶段）+ N/Total 进度计数器（N = existing + cc + asr + skipped，从 stats 推导）+ 已有/CC/ASR/跳过统计 Chip + 停止 IconButton + LinearProgress 进度条）。完成/停止后显示摘要统计 + 重新开始按钮。面板有 border + background 视觉区分。类型从 `lib/auto-transcribe/types.ts` 导入

## 约定

- B 站收藏夹：页面编排必须经 `CollectionPageScaffold`，路由、默认跳首夹和服务端搜索语义不变。主分类标题使用 `collections.foldersTitle`，页面标题使用 `collections.sidebarTitle`，禁止当前收藏夹名冒充页面标题。
- B 站视频持久化: 显式同步由 `useBiliFavFolders` 触发 `syncAllFavoriteVideos`，按收藏夹完整抓取后调用 `syncFavVideosToDb`。普通浏览只 fetch 当前页；自动转录经 `fetchAndSyncVideos` await 当前收藏页入库后才查 pending，写入失败阻断翻页。insert-only 不更新已有记录，`content_state='pending'`
- 视频排序: 服务端排序，不做客户端排序。`order` 参数贯穿 `SortControl` → `useBiliFavVideos.order` → `fetchFavoriteVideosPage` → `fetchFavVideos`；显式增量同步有意固定 `mtime` + 空关键词，避免 `view`/`pubtime`/搜索结果破坏旧条目截断语义
- 视频搜索: 服务端搜索。`keyword` 贯穿 scaffold `SearchField` → `BilibiliView` → `BilibiliCollectionPage` → `useBiliFavVideos.keyword` → `fetchFavoriteVideosPage` → `fetchFavVideos`；只影响 UI 浏览，不影响全量同步。切换收藏夹同步清空 input+keyword/ref
- RAG 索引 UI: 转录成功后 `transcribeAndPersist` await 本地 chunk+embed（见 `lib/bilibili`/`lib/embedding` CLAUDE.md），期间视频卡片 stage='indexing' / AutoTranscribeBar videoStage='indexing' 显示"正在建立索引…"（app.html 本地阶段，不走 background 推送）。已索引标记：coordinator `setVideos` 并行 `getEmbeddedBvids` 预加载 + 转录完成 onIndexed('embedded') 即时置位，`video-card.tsx` 渲染"已索引"Chip。i18n key：`stage.indexing`/`autoTranscribe.indexing`/`card.indexed`（zh/en 齐全）
- 标签 UI: 状态与 phase 编排由 `CollectionPageScaffold` 内部的 `useCollectionTags`/`TaggedItemGrid` 持有，本 section 只提供 `PLATFORM = 'bilibili'`、`getTagId(video.bvid)` 和卡片 adapter。筛选**跨收藏夹**、多选 **AND 语义**；激活时 scaffold 隐藏 `primary-category` scope 的 AutoTranscribe/Sort，并以标签结果替换普通列表。只有转录+索引过的视频才有 AI 标签，大部分卡片无标签是正常态。
