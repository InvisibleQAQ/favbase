# sections/bookmarks

浏览器书签收藏页（显示名固定为 `Browser Bookmarks` / `浏览器书签`，路由为 `/collections/bookmarks` + `/collections/bookmarks/:folderId`）。消费共享 `CollectionPageScaffold`，固定顺序：标题/系统状态（无同步按钮）→ 搜索 → 手动正文提取 → 文件夹主分类 → 标签 → 卡片列表。同步挂载时自动触发一次；正文提取仍只能由用户显式启动。

## 模块结构

- `bookmarks-view.tsx` — scaffold Adapter：常驻 pipeline 为 Fetch → Extraction → Embedding/Tagging 并行；Fetch 完成保留本次总数 + 100%，四条 runtime 统一读 background job phase，coverage 来自 DB。文件夹、卡片、page-scope operation 与 `showSyncButton=false` 语义不变。
- `bookmark-extraction-panel.tsx` — 正文提取 operation adapter：idle/running/pausing/paused UI 与 favicon/进度展示，高内聚在平台目录；只调用 hook 暴露的显式 start/pause/resume。
- `use-bookmark-extraction.ts` — 正文提取使用独立 `bookmarks:extract` job，不与挂载触发的元数据 `bookmarks:sync` 互相去重；每条 durable content 成功后立即 enqueue 共享 Embed/Tags 双 lane，Extraction 不等待两 lane 完成。完整 progress、cooperative pause、跨路由与 pending 续传语义不变。
- `use-bookmarks.ts` — 数据 hook。挂载时 `sync()` 自动跑一次，负责本地书签树同步、分页查询与元信息刷新；同步成功后不再链式启动正文提取。搜索 300ms 防抖，folderId/search/page 驱动查询，undefined folderId = 「全部」。
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
