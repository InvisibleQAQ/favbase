# sections/zhihu

知乎收藏页（`/collections/zhihu`，多收藏夹但**无 `:id` 详情路由**——收藏夹经 chips 单维筛选，第五个平台）。视觉结构对齐 X 书签页（`sections/x/`）：顶栏（标题+计数+lastSynced+同步按钮）→ 同步进度条 → 搜索框 → 收藏夹 chips → 卡片 grid（xs12/sm6/md4/lg3）+ Pagination。**数据一律从 PGlite 经 `lib/zhihu/zhihu-sync-service` 查询方法读取（UI 零 drizzle 导入），不直读知乎 API**；同步（`syncFavorites`）在 app.html context 跑（turndown 需要 DOM + cookie 随 `credentials:'include'` 自动附带），经 RPC proxy 写 Offscreen PGlite。**凭据无 UI 半**：无 Connections 卡——认证是浏览器自己的知乎会话 cookie（bilibili 式直读，见 `lib/zhihu/CLAUDE.md`），未登录在同步时才暴露为 `ZhihuAuthError` → 「打开知乎」空态。

## 模块结构

- `zhihu-view.tsx` — 主视图（镜像 x-view）：展示脚手架全部消费 `components/collection/` 哑组件，本文件保留编排 + 平台文案。内容分支顺序：标签筛选激活 → `TaggedItemGrid`；queryError → ErrorState(retryQuery)；authFailed（`syncError.kind==='auth'`）→ NotLoggedInState（`OpenZhihuButton` 主 + `SyncNowButton` 次）；syncError 且库空 → ErrorState(retry=sync)；metaLoading 或（syncing 且库空）→ skeleton；库空 → EmptyLibraryState（**SyncNowButton contained 主按钮**——无站内浮层，同步即主路径，异于 X）；query loading → skeleton；筛选无结果 → NoMatchesState；否则 grid+分页。库有数据时 syncError 降级为顶部错误横幅。**i18n seam**：hook 返回结构化 `ZhihuSyncError`（auth / rate-limit 无 resetAt / unknown），模块级 `syncErrorMessage()` 在此映射文案。同步进度恒 indeterminate，caption 显示「已拉取 N 条（收藏夹 i/M）」（`zhihu.syncProgress`）。标签接线（全部来自 `components/tags/`，`PLATFORM='zhihu'`）：`useItemTags(PLATFORM, platformItemIds)` + 单 `TagEditPopover` + `TagFilterChips`/`useTagFilter`；`useItemTags` 顶层常驻故 `onTagsChanged` 必须传 `handleTagsChanged`（refreshItemTags+refreshUsedTags）
- `use-zhihu-favorites.ts` — 数据 hook（镜像 use-x-bookmarks）：分页查询（collectionId/search/page/queryVersion → `getFavorites`，`PAGE_SIZE=24`，publishedAt 降序服务层固定）；库元信息（`getCollectionCounts` + `getLastSyncedAt` + 无筛选 total 作 libraryCount）；同步 `syncFavorites(onProgress)`（**手动按钮触发，绝不 auto-on-mount**——限流远程端点）。搜索 300ms 防抖；收藏夹切换重置 page=1。错误分类 `classifyZhihuSyncError` 在本文件（单触发点，无需下沉 lib）
- `collection-chips.tsx` — 收藏夹 chip 行：共享 `ChipRowShell`（zhihu icon + `zhihu.collectionsTitle`）+ `FilterChip`（maxWidth 220）——「全部(N)」+ 各夹「标题 (count)」（服务层按数量降序）。**折叠**逻辑抄 author-chips：`COLLAPSED_COUNT=12` + 展开/收起 raw Chip + 选中夹落 fold 外时补渲染 `selectedHidden`
- `zhihu-card.tsx` — 收藏卡片：作者头像（回退 zhihu icon）+ 显示名 + **类型 Chip 徽标**（`TYPE_LABEL_KEY: Record<ZhihuItemType, LocaleKeys>` 映射 `zhihu.type.*`，exhaustive）+ 标题（2 行 clamp）+ 摘要（3 行 clamp）+ 缩略图（96 高，若有）+ 底部行（收藏夹归属 bookmark icon + `formatDateTime(publishedAt)`）+ 标签行（`TagRow` 在 CardActionArea **之外**）。点击 `window.open(originalUrl)`
- `tagged-zhihu-card.tsx` — `TaggedZhihuCard`：TaggedItemGrid `renderCard` adapter，`toZhihuFavoriteItem` 防御式收窄 platformMeta（type 白名单校验回退 answer；originalUrl 取 `item.originalUrl`）。`publishedAt` 置 null
- `zhihu-grid-skeleton.tsx` — 共享 `CardGridSkeleton` 外壳 + rounded 200 卡片骨架

## 约定

- 排序固定 publishedAt 降序（= 内容 updated/created 时间，web v4 items 无收藏时间）；platformMeta 形状见 `lib/zhihu/CLAUDE.md`
- 三种空态：未登录（打开知乎主按钮）/ 库空（立即同步主按钮）/ 同步失败（ErrorState+retry）；虚线框为共享 `StateBox`
- 路由/导航：`main.tsx` 路由 `collections/zhihu` + `nav-config.tsx` Collections children 叶子（`nav.zhihuFavorites`）；active 判定走 `layouts/nav-active.ts` 最长前缀匹配
- 标签：手动打标已接入（共享 `components/tags/`，platform='zhihu'）；AI 自动打标 out of scope。`simple-icons:zhihu`/`solar:bookmark-bold-duotone` 图标在 `components/iconify/icon-sets.ts` 离线注册
- i18n：所有文案 key 在 `zhihu.*`（zh/en 齐全，`zhihu.count` 带 `.one` 复数变体），错误类映射在 view 边界；无硬编码 CJK
