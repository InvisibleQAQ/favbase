# sections/bookmarks

浏览器书签收藏页（`/collections/bookmarks` + `/collections/bookmarks/:folderId`）。视觉结构对齐 GitHub Stars 收藏页（`sections/github-stars/`）扁平堆叠：标题栏（标题+计数+lastSynced，**无同步按钮**）→ 手动正文提取控件 → 搜索框 → 文件夹 chips（「全部」+ 各文件夹）→ 标签筛选 chips → 卡片 grid（xs12/sm6/md4/lg3）+ Pagination。**数据一律从 PGlite 经 `lib/bookmarks/bookmarks-sync-service` 查询方法读取（UI 零 drizzle 导入）**；同步（`syncBookmarks`）**挂载时自动触发一次**（本地读取瞬时 + insert-only），正文提取不会随打开页面自动启动。

## 模块结构

- `bookmarks-view.tsx` — 主视图：展示脚手架全部消费 `components/collection/` 哑组件（StateBox/SectionTitleBar/SearchField/CardGrid/*），本文件保留编排 + 平台文案。标题栏下方的正文提取控件常驻：idle 显示真实 pending 数量与手动按钮；running 显示当前网页 identity/进度与“暂停”；pausing 禁用按钮并明确当前条目完成后暂停；paused 保留最近进度并显示“继续”。名称回退逻辑与 favicon URL 统一放在 `bookmark-display.ts`。
- `use-bookmark-extraction.ts` — 正文提取经共享 `backgroundJobs` store 跑成单个 `bookmarks:sync` job；只由 hook 暴露的 `start()/resume()` 手动触发，store guard 负责跨挂载去重。完整 `ExtractionProgress` 必须透传（不可解构丢 `current`）。模块级控制器在 `bookmark-extraction-control.ts`：`pause()` abort 只在条目边界生效；`done < total` 才进入 paused，最后一条完成不误判；状态跨 Hash Router 路由保留但不持久化到 app.html 重开。逐条 tag/embed 与 pending 续传语义不变。
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
- 标签：手动打标已接入（共享 `components/tags/` 模块，platform='bookmarks'）；AI 自动打标 + 自动 embed 已接线——提取 worker（`bookmarks:sync` job）每成功一条（→'chunked'）即经 `onItemExtracted` 逐条喂 `tagNewItems`/`embedNewItems`（逐条而非 run 末：中途关页不遗留 chunked-未-embed 孤儿，chunked 不会被重取）。逐条 embed/tag 保持 `void` fire-and-forget，**不建独立 `bookmarks:embed`/`bookmarks:tag` job**（分母 run 前不可知 + run 末批量会回归 orphan-safety）——它们紧随 extraction 骑 `bookmarks:sync` 进度即可
- icon：`solar:bookmark-bold-duotone`（nav/卡片回退）+ `solar:folder-with-files-bold-duotone`（文件夹 chip），`icon-sets.ts` 离线注册
