# sections/zhihu

知乎收藏页（`/collections/zhihu`，多收藏夹但**无 `:id` 详情路由**——收藏夹经 chips 单维筛选，第五个平台）。视觉结构对齐 X 书签页（`sections/x/`）：顶栏（标题+计数+lastSynced+同步按钮）→ 同步进度条 → 搜索框 → 收藏夹 chips → 卡片 grid（xs12/sm6/md4/lg3）+ Pagination。**数据一律从 PGlite 经 `lib/zhihu/zhihu-sync-service` 查询方法读取（UI 零 drizzle 导入），不直读知乎 API**；同步（`syncFavorites`）在 app.html context 跑（turndown 需要 DOM + cookie 随 `credentials:'include'` 自动附带），经 RPC proxy 写 Offscreen PGlite。**凭据无 UI 半**：无 Connections 卡——认证是浏览器自己的知乎会话 cookie（bilibili 式直读，见 `lib/zhihu/CLAUDE.md`），未登录在同步时才暴露为 `ZhihuAuthError` → 「打开知乎」空态。

## 模块结构

- `zhihu-view.tsx` — 主视图（镜像 x-view）：展示脚手架全部消费 `components/collection/` 哑组件（含共享 `ErrorState`/`NoMatchesState`/`SyncNowButton`/`SyncProgressBar`），本文件保留编排 + 平台文案。**内容分支顺序不在此维持**——由共享纯函数 `resolveCollectionPhase`（`app/hooks/collection-phase.ts`）返回 phase，本 view 只做 `switch(phase)` → 平台节点映射（authFailed=`syncError.kind==='auth'`）。平台特有渲染：NotLoggedInState（`OpenZhihuButton` 主 + `SyncNowButton` 次）、EmptyLibraryState（**SyncNowButton contained 主按钮**——cookie 直读，同步即主路径；异于 X 空态以 deep-link「打开 x.com/i/bookmarks 登录捕获会话」为主、同步为次）。库有数据时 syncError 降级为顶部错误横幅。**i18n seam**：hook 返回结构化 `ZhihuSyncError`（auth / rate-limit 无 resetAt / unknown），模块级 `syncErrorMessage()` 在此映射文案。同步进度恒 indeterminate（`SyncProgressBar` 不传 value），caption 显示「已拉取 N 条（收藏夹 i/M）」（`zhihu.syncProgress`）。标签接线一律经 `useCollectionTags(PLATFORM, platformItemIds)`（`components/tags/`）——五件套 + `handleTagsChanged` 不变量封在 hook 内，view 直接把它传给 `TagEditPopover`/`TaggedItemGrid` 的 onChanged/onTagsChanged
- `use-zhihu-favorites.ts` — 数据 hook：共享 `useCollectionLibrary`（`app/hooks/`，见该目录 CLAUDE.md）的薄 adapter——状态机全在泛型层，本文件只注入模块级 `queryFn`（filter→collectionId 映射 `getFavorites`，publishedAt 降序服务层固定）、`facetsFn=getCollectionCounts`、`lastSyncedFn`、`syncFn`（cookie 直读无 auth 解析，进度三元组 fetchedCount/current/total）、`classifyZhihuSyncError`（在本文件定义——单触发点，无需下沉 lib），并把泛化字段映射回 favorites/collectionId/collections 命名。同步**手动按钮触发，绝不 auto-on-mount**——限流远程端点
- `collection-chips.tsx` — 收藏夹 chip 行：共享 `ChipRowShell`（zhihu icon + `zhihu.collectionsTitle`）+ `FilterChip`（maxWidth 220）——「全部(N)」+ 各夹「标题 (count)」（服务层按数量降序）。**折叠**逻辑抄 author-chips：`COLLAPSED_COUNT=12` + 展开/收起 raw Chip + 选中夹落 fold 外时补渲染 `selectedHidden`
- `zhihu-card.tsx` — 收藏卡片：作者头像（回退 zhihu icon）+ 显示名 + **类型 Chip 徽标**（`TYPE_LABEL_KEY: Record<ZhihuItemType, LocaleKeys>` 映射 `zhihu.type.*`，exhaustive）+ 标题（2 行 clamp）+ 摘要（3 行 clamp）+ 缩略图（96 高，若有）+ 底部行（收藏夹归属 bookmark icon + `formatDateTime(publishedAt)`）+ 标签行（`TagRow` 在 CardActionArea **之外**）。点击 `window.open(originalUrl)`
- `tagged-zhihu-card.tsx` — `TaggedZhihuCard`：TaggedItemGrid `renderCard` adapter，`toZhihuFavoriteItem` 收窄委托 sync-service 导出的 `narrowZhihuMeta`（SSOT，mapRow 与本 adapter 共用，含 type 白名单回退 answer），本文件只装 envelope（originalUrl 取 `item.originalUrl`，`publishedAt` 置 null）
- `zhihu-grid-skeleton.tsx` — 共享 `CardGridSkeleton` 外壳 + rounded 200 卡片骨架

## 约定

- 页面顺序由共享 scaffold 固定为标题/系统状态 → 搜索 → 收藏夹主分类 → 标签 → 列表；本目录只提供 adapter。
- 排序固定 publishedAt 降序（= 内容 updated/created 时间，web v4 items 无收藏时间）；platformMeta 形状见 `lib/zhihu/CLAUDE.md`
- 三种空态：未登录（打开知乎主按钮）/ 库空（立即同步主按钮）/ 同步失败（ErrorState+retry）；虚线框为共享 `StateBox`
- 路由/导航：`main.tsx` 路由 `collections/zhihu` + `nav-config.tsx` Collections children 叶子（`nav.zhihuFavorites`）；active 判定走 `layouts/nav-active.ts` 最长前缀匹配
- 标签：手动打标已接入（共享 `components/tags/`，platform='zhihu'）；AI 自动打标 + 自动 embed 已接线——**ST3：触发从 lib wrapper `syncFavorites` 上移到 hook `use-zhihu-favorites.ts` 的模块级 `syncFn`**，收尾经 `startJob('zhihu-favorites','tag'/'embed', sp=>tagNewItems/embedNewItems('zhihu', result.newItemIds, undefined, sp))` 注册后台任务（带 done/total 进度 caption + 跨挂载去重 + 全局勿关页计数；模块级函数可调 startJob——store 是模块单例；job platform key=logTag `'zhihu-favorites'`，领域函数收 DB 判别符 `'zhihu'`）。`syncFn` 改 `const result = await syncFavorites(...)`。view 经 scaffold `backgroundJobsBar={<BackgroundJobsBar captions={caps} />}` 渲染 `hook.embedJob/tagJob` 进度。`simple-icons:zhihu`/`solar:bookmark-bold-duotone` 图标在 `components/iconify/icon-sets.ts` 离线注册
- i18n：平台特有文案 key 在 `zhihu.*`（zh/en 齐全，`zhihu.count` 带 `.one` 复数变体，`zhihu.noMatches` 保留平台名词）；通用文案（retry/syncNow/loadFailed）走共享 `common.*`；错误类映射在 view 边界；无硬编码 CJK
