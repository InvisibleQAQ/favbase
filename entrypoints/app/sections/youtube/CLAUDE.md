# sections/youtube

YouTube 公开播放列表收藏页（`/collections/youtube`，扁平单集合无详情路由，第六个平台）。视觉结构对齐 X/知乎收藏页：顶栏（标题+计数+lastSynced+同步按钮）→ 同步进度条 → 搜索框 → 播放列表 chips → 卡片 grid（xs12/sm6/md4/lg3）+ Pagination。**数据一律从 PGlite 经 `lib/youtube/youtube-sync-service` 查询方法读取（UI 零 drizzle 导入），不直读 Data API**；同步（`syncYoutubePlaylists`）在 app.html context 跑，经 RPC proxy 写 Offscreen PGlite。**凭据是 API key 形态（无 OAuth）**：`youtubeApiKey`/`youtubeChannel` 在 `UserSettings`（设置页「账号连接」的 `youtube-connection-card` 填写+测试，见 `sections/settings/CLAUDE.md`），「未配置」是**单一同步维度**（settings 同步读 `hasConfig`——旧双门禁的异步授权探针随 OAuth 移除）。

## 模块结构

- `youtube-view.tsx` — scaffold Adapter；常驻 pipeline 为 Fetch → Embedding/Tagging 并行，远端抓取总量保持 unknown，AI lanes 读取 background jobs；未配置/auth gate 隐藏 strip。现有 phase、设置跳转、错误翻译与标签职责不变。
- `use-youtube-playlists.ts` — 数据 hook：共享 `useCollectionLibrary`（`app/hooks/`）的薄 adapter——只注入模块级 `queryFn`（filter→playlistId 映射 `getPlaylistVideos`，addedAt 降序服务层固定）、`facetsFn=getPlaylistCounts`、`lastSyncedFn`、`syncFn`（useCallback 闭包持 apiKey/channel——**配置解析留在 adapter 闭包**（spec 铁律），进度 `YoutubePlaylistsProgress`）、`classifyYoutubeSyncError`，并把泛化字段映射回 videos/playlistId/playlists 命名。**配置门在 adapter**（github token-gate 模式）：`sync` 外包一层无配置静默 no-op；`hasConfig`/`settingsLoading` 来自 `useSettings`。同步**手动按钮触发，绝不 auto-on-mount**——远程有配额端点；每次同步全量重拉（playlistItems 位置序无增量游标，insert-only 幂等）
- `playlist-chips.tsx` — 播放列表 chip 行：共享 `CollapsibleChipRow` 薄 adapter（`mdi:youtube` icon + `youtube.playlistsTitle`/`allPlaylists`/`showMore(Less)Playlists` key，label「列表名 (count)」，key=playlistId，服务层按数量降序）。库空时由 view 隐藏整行
- `youtube-card.tsx` — 视频卡片：16:9 缩略图（`CardMedia` lazy，`aspectRatio:'16 / 9'`；无图回退 `mdi:youtube` 灰底——`varAlpha(grey 500Channel, 0.12)` 暗色安全）+ 右下角时长角标（共享 `formatDuration`（`app/utils/`，h:mm:ss/m:ss），黑色 scrim 双模式恒定；`durationSeconds<=0` 不渲染——直播/缺数据）+ 标题（2 行 clamp）+ 频道名（上传者）+ 底部行（play icon+`formatCompactNumber(viewCount)`、`formatDateTime(addedAt)`）+ 标签行（共享 `TagRow`，CardActionArea **之外**防误触跳转；`tags?` undefined 时整区不渲染）。点击 `window.open(originalUrl)`。`useTranslation()` 订阅保证 locale 切换 re-render 格式化输出
- `tagged-youtube-card.tsx` — `TaggedYoutubeCard`：TaggedItemGrid `renderCard` 的 YouTube 卡片 adapter。`toYoutubeVideoItem` 把平台无关 `TaggedItem` 映射回 `YoutubeVideoItem`（originalUrl 取 `item.originalUrl`；platformMeta 收窄委托 sync-service 导出的 `narrowYoutubeMeta`（SSOT，mapRow 与本 adapter 共用），本文件只装 envelope 字段 + spread）。**adapter 知识归 adapter**：`YoutubeVideoItem` 类型导入只在本文件与 view/card
- `youtube-grid-skeleton.tsx` — 共享 `CardGridSkeleton` 外壳 + 16:9 媒体块 + 两行文字骨架（匹配卡片形态）

## 约定

- 页面顺序由共享 scaffold 固定为标题/系统状态 → 搜索 → 播放列表主分类 → 标签 → 列表；本目录只提供 adapter。
- 排序固定 addedAt 降序（`platformMeta->>'addedAt'` ISO 字典序，服务层固定，MVP 无排序控件）；chips 筛选走 item_sources（跨列表视频在每个所属列表 chip 下都可见）；platformMeta 形状见 `lib/youtube/CLAUDE.md`
- 四种空/异常态：未配置（NotConnectedState 整页短路，引导设置）/ 密钥无效（AuthFailedState，content phase）/ 库空（EmptyLibraryState 引导同步）/ 同步失败（ErrorState+retry）；虚线框为共享 `StateBox`
- 路由/导航：`main.tsx` 路由 `collections/youtube`（**无 `:id` 详情路由**——扁平单集合）+ `nav-config.tsx` Collections children 叶子（`nav.youtubePlaylists`）；兄弟叶 active 互斥判定见 `layouts/nav-active.ts`（最长前缀匹配）
- AI 后处理仍由 `use-youtube-playlists.ts` 注册 `youtube-playlists:embed|tag` jobs；view 只把 jobs 交给共享 pipeline Adapter。
- i18n：平台特有文案 key 在 `youtube.*`（zh/en 齐全，`youtube.count` 带 `.one` 复数变体，`youtube.noMatches` 保留平台名词）；通用文案（retry/syncNow/loadFailed）走共享 `common.*`；限流文案复用 `settings.youtube.rateLimited`（恒无 resetAt 变体）；错误类映射在 view 边界；无硬编码 CJK
