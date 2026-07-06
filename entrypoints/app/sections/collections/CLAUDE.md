# collections

app.html B站收藏夹页面组件（sidebar+grid 单页布局）。

## 模块结构

- `collections-view.tsx` — 收藏夹主视图：左侧 240px FolderSidebar + 右侧 VideoGridPanel。`/collections` 和 `/collections/bilibili/:mediaId` 共用组件，通过 useParams 获取 mediaId，无 mediaId 时自动 navigate(replace) 到第一个收藏夹。包含 NotLoggedIn/ErrorState/EmptyFolderState/VideoGridSkeleton 共享状态组件 + `SortControl`（三个文字 Button + Iconify 图标的排序控件，`SORT_OPTIONS` 常量映射 mtime/view/pubtime → 图标 + i18n labelKey，选中项 primary 主色 + 下划线；渲染在 AutoTranscribeBar 下方、视频网格上方，not_logged_in/error 时不渲染）
- `folder-sidebar.tsx` — 收藏夹侧边栏：固定 240px，单分组"BiliBili 收藏夹"标题可上下折叠/展开列表（MUI Collapse）。列表项显示收藏夹名称 + 视频数量，选中项 varAlpha primary 高亮
- `use-bili-fav-folders.ts` — B站收藏夹 hook：调用 `bili-sync-service.fetchAndSyncFolders()` 获取列表 + 状态管理（folders/loading/syncing/loginState/error）。auth + API fetch + DB sync 全部由 service 内聚
- `video-card.tsx` — 视频卡片：封面缩略图 + 左下角播放量标签 + 右下角时长标签 + 标题 + UP主 + 收藏时间（`formatFavTime`：同年显示 MM-DD，跨年显示 N年前，自然年判断）+ 底部操作栏（转录/状态标记/进度）。失效视频灰显（attr===9）无操作栏。操作栏三态：来源标记（CC 官方/ASR Chip）、转录按钮、进度条（LinearProgress + stage 文字 + 取消按钮）
- `use-bili-fav-videos.ts` — 收藏夹视频 hook：调用 `bili-sync-service.fetchAndSyncVideos(mediaId, page, order)` 获取视频 + goToPage 翻页 + `order`/`setOrder` 排序（`BiliFavOrder`，默认 `mtime`，切换排序经 effect 依赖重置到第 1 页重新拉取）+ loading/error/loginState 状态管理。auth + API fetch + source lookup + DB sync 全部由 service 内聚
- `use-video-transcribe.ts` — 手动视频转录 `useSyncExternalStore` 薄 hook（~58 行）：持有 `TranscriptionCoordinator` ref + 订阅 snapshot + `setVideos` 触发缓存预加载 + start/cancel 透传 + dispose。类型 re-export `VideoTranscribeState`/`ContentStatus` from `lib/bilibili/transcription-coordinator.ts`
- `use-auto-transcribe.ts` — 自动转录薄 hook（~55 行）：接收 `collectionId` + `AutoTranscribeAdapter`，创建 `AutoTranscribePipeline`（构造函数注入 adapter）+ `useSyncExternalStore` 订阅状态 + start/stop 透传 + collectionId 变更时触发 preview 查询 + unmount 时 dispose。类型 re-export from `lib/auto-transcribe/types.ts`
- `auto-transcribe-bar.tsx` — 自动转录进度 UI：全宽面板，独占 title bar 下方一行。idle 态三分支：previewLoading 时 CircularProgress 占位、pendingCount===null 时不渲染（source 未 sync）、pendingCount===0 时 check 图标 + "所有视频已转录"、其他时显示预览缩略图 + 待转录数 + "开始"按钮。运行时显示丰富进度面板（当前视频缩略图 100x60 + 标题/作者/时长/阶段文字 + N/Total 进度计数器（N = existing + cc + asr + skipped，从 stats 推导）+ 已有/CC/ASR/跳过统计 Chip + 停止 IconButton + LinearProgress 进度条）。完成/停止后显示摘要统计 + 重新开始按钮。面板有 border + background 视觉区分。类型从 `lib/auto-transcribe/types.ts` 导入

## 约定

- B 站收藏夹: app.html Collections 页面为 sidebar+grid 单页布局（`collections-view.tsx`）。左侧 240px `FolderSidebar`（可折叠分组列表），右侧 `VideoGridPanel`（标题栏+视频网格+分页）。`/collections` 和 `/collections/bilibili/:mediaId` 共用同一组件，通过 `useParams` 获取 mediaId 驱动右侧内容切换，无 mediaId 时自动 navigate(replace) 到第一个收藏夹。`useBiliFavFolders` hook 调用 `bili-sync-service.fetchAndSyncFolders()` 获取数据并管理 UI 状态
- B 站视频持久化: `useBiliFavVideos` 调用 `bili-sync-service.fetchAndSyncVideos(mediaId, page, order)`，service 内部处理 auth + source lookup + `syncFavVideosToDb`。批量 upsert + 事务保证原子性。MVP insert-only 不更新已有记录，`content_state='pending'`
- 视频排序: 服务端排序，不做客户端排序（分页拉取时客户端只能排当前页，语义错误）。`order` 参数（`BiliFavOrder` = `mtime`|`view`|`pubtime`，均降序）贯穿 `SortControl` → `useBiliFavVideos.order` → `fetchAndSyncVideos` → `fetchFavVideos` → B站 `/x/v3/fav/resource/list?order=`，由 B站服务端对整个收藏夹排序，分页保持一致。切换排序重置到第 1 页
