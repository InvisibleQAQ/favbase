# sections/bookmarks

浏览器书签收藏页（显示名固定为 `Browser Bookmarks` / `浏览器书签`，路由为 `/collections/bookmarks` + `/collections/bookmarks/:folderId`）。消费共享 `CollectionPageScaffold`，固定顺序：标题/系统状态（含统一「立即获取」按钮）→ 搜索 → 正文提取进度面板 → 文件夹主分类 → 标签 → 卡片列表。同步挂载时自动触发一次（`startJob` 去重使按钮与 auto-sync 互不冲突）；**同步成功后自动链式启动正文提取**（2026-07-26 推翻 `5a04c87` 的「手动提取」决策——控制面收敛为统一获取按钮 + per-platform 闸门，暂停/继续经 `pauseLibrary('bookmarks')`，不再有平台私有启停按钮）。

## 模块结构

- `bookmarks-view.tsx` — scaffold Adapter：常驻 pipeline 为 Fetch → Extraction → Embedding/Tagging 并行；Search 后注入共享 provider Configuration Blocker notice。coverage/runtime、统一获取按钮、文件夹、卡片和 page-scope operation 不变。
- `bookmark-extraction-panel.tsx` — 正文提取 operation adapter：**纯进度展示**（无 start/pause/resume 按钮）。idle/running/pausing/paused 文案 + favicon/进度条；pausing/paused 直接镜像共享 job phase（闸门驱动），复用 `bookmarks.extractionPausing/extractionPaused` key。
- `use-bookmark-extraction.ts` — 正文提取使用独立 `bookmarks:extract` job，不与挂载触发的元数据 `bookmarks:sync` 互相去重；`startBookmarkExtraction()` 是自动链式的目标（sync runner 与每日 auto-sync registry 都调它）。runner 把 `startJob` 的 cooperative checkpoint 透传给 `extractPendingBookmarks`（每条领取前 checkpoint → 闸门可暂停/继续、born-paused 生效）；原 bespoke AbortController 暂停模块（`bookmark-extraction-control.ts`）已删除，phase 从 job phase 派生，`lastProgress` 兜底改用 `job.lastProgress`（job store 完成时保留末次 progress，失败 run 回退上一次成功值——面板同时进入 error 展示，可接受）。每条 durable content 成功后立即 enqueue 共享 Embed/Tags 双 lane，Extraction 不等待两 lane 完成。
- `bookmarks-sync-adapter.ts` — 共享 Sync Adapter（audit #6）：`runBookmarksSync(onProgress, control)` 单点定义「书签同步成功意味着什么」——本地书签树同步（无凭据）、**成功后链式 `startBookmarkExtraction()`**（恢复 `5a04c87` 删掉的链路，控制面归闸门；动态 import 保持 defuddle/linkedom worker 不进 App 启动 chunk）+ **派发 backlog embed lane**（`startCollectionProcessingJobs` 空 `itemIds`——提取只领 `'pending'`，早前中断留下的 `'chunked'` 未嵌积压靠这条批处理 lane 重试）。手动页面 runner 与 daily registry 引用**同一函数**。契约测试 `bookmarks-sync-adapter.test.ts`
- `use-bookmarks.ts` — 数据 hook。挂载时 `sync()` 自动跑一次（runner = `initDbProxy` + `runBookmarksSync`），负责分页查询与元信息刷新。搜索 300ms 防抖，folderId/search/page 驱动查询，undefined folderId = 「全部」。
- `folder-chips.tsx` — 文件夹 chip 行：共享 `ChipRowShell`（folder icon + `bookmarks.foldersTitle`）+ `FilterChip`——「全部({{count}})」chip（选中态 = 无 folderId）+ 各文件夹（`maxWidth 200`，**无 per-chip 计数**，bilibili 风纯名称）。点击 = `onSelect(folderId|undefined)` 驱动 navigate
- `bookmark-card.tsx` — 书签卡片（不复用 RepoCard）：favicon（Avatar rounded，MV3 本地 `_favicon` API `chrome.runtime.getURL('/_favicon/?pageUrl=…&size=32')`，无图回退 bookmark icon）+ title（2 行截断）+ 底部行（domain + `formatDateTime(dateAdded)`）+ 标签行（共享 `TagRow`，CardActionArea **之外**防误触 `window.open` 跳转；`tags?` undefined 时整区不渲染）。`BookmarkCardProps { bookmark, tags?, onEditTags? }`。点击 `window.open(url)`。`useTranslation()` 订阅保证 locale 切换 re-render 格式化输出
- `tagged-bookmark-card.tsx` — `TaggedBookmarkCard`：TaggedItemGrid `renderCard` 的书签 adapter。`toBookmarkItem` 把平台无关 `TaggedItem` 映射回 `BookmarkItem`（url 取 `item.originalUrl`；platformMeta 防御式取 domain/dateAdded，缺失给安全默认，镜像 `toGithubRepoItem`）。**adapter 知识归 adapter**：`BookmarkItem` 类型导入只在本文件与 card
- `bookmark-grid-skeleton.tsx` — `BookmarkGridSkeleton`：共享 `CardGridSkeleton` 外壳（grid-of-8）+ rounded 96 高（匹配紧凑书签卡片），view 与 TaggedItemGrid（`skeleton` prop）共用

## 约定

- 排序固定 dateAdded 降序（MVP 无排序控件）；platformMeta 形状见 `lib/bookmarks/CLAUDE.md`
- 三种非常态：库空（EmptyState 无按钮）/ 同步失败（ErrorState+retry=sync）/ 筛选无结果（NoMatchesState）；虚线框为共享 `StateBox`
- 路由/导航：`main.tsx` 路由 `collections/bookmarks` + `collections/bookmarks/:folderId` + `nav-config.tsx` Collections children 叶子（`nav.bookmarks`）；兄弟叶 active 互斥判定见 `layouts/nav-active.ts`（最长前缀匹配，`:folderId` 详情路由归属 bookmarks 叶）。默认 `/collections/bookmarks`=「全部」，无 auto-nav 到首个文件夹（不同于 bilibili）
- 搜索限定当前选中文件夹（folderId + search 同时传 `getBookmarks`）；「全部」时搜全库
- 标签/Embedding：成功提取后逐条立即 enqueue，避免 run 末批处理制造 orphan；独立 `bookmarks:embed|tag` lane 串行领取 item 并在领取前 checkpoint，暂停互不影响。
- icon：`solar:bookmark-bold-duotone`（nav/卡片回退）+ `solar:folder-with-files-bold-duotone`（文件夹 chip），`icon-sets.ts` 离线注册
