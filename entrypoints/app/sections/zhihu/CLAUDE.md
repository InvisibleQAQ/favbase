# sections/zhihu

知乎收藏页（`/collections/zhihu`，多收藏夹但**无 `:id` 详情路由**——收藏夹经 chips 单维筛选，第五个平台）。视觉结构对齐 X 书签页（`sections/x/`）：顶栏（标题+计数+lastSynced+同步按钮）→ 同步进度条 → 搜索框 → 收藏夹 chips → 卡片 grid（xs12/sm6/md4/lg3）+ Pagination。**数据一律从 PGlite 经 `lib/zhihu/zhihu-sync-service` 查询方法读取（UI 零 drizzle 导入），不直读知乎 API**；同步（`syncFavorites`）在 app.html context 跑（turndown 需要 DOM + cookie 随 `credentials:'include'` 自动附带），经 RPC proxy 写 Offscreen PGlite。**凭据无 UI 半**：无 Connections 卡——认证是浏览器自己的知乎会话 cookie（bilibili 式直读，见 `lib/zhihu/CLAUDE.md`），未登录在同步时才暴露为 `ZhihuAuthError` → 「打开知乎」空态。

## 模块结构

- `zhihu-view.tsx` — scaffold Adapter；常驻 pipeline 为 Fetch → Embedding/Tagging 并行，Search 后注入共享 provider Configuration Blocker notice。auth gate、runtime、phase、空态、错误翻译与标签职责不变。
- `zhihu-sync-adapter.ts` — 共享 Sync Adapter（audit #6）：`runZhihuFavoritesSync(onProgress, control)` 单点定义「知乎同步成功意味着什么」——cookie 直读无 auth 解析、进度三元组映射（`ZhihuSyncProgress` fetchedCount/current/total 在此定义）、`startCollectionProcessingJobs` 派发（job namespace 经 `jobPlatformForCollection` SSOT）。手动页面 `syncFn` 与 daily registry 引用**同一函数**；`ZhihuAuthError` 的处理留触发方（手动→auth 空态，daily→静默跳过）。契约测试 `zhihu-sync-adapter.test.ts`
- `use-zhihu-favorites.ts` — 数据 hook：共享 `useCollectionLibrary`（`app/hooks/`，见该目录 CLAUDE.md）的薄 adapter——状态机全在泛型层，本文件只注入模块级 `queryFn`（filter→collectionId 映射 `getFavorites`，publishedAt 降序服务层固定）、`facetsFn=getCollectionCounts`、`lastSyncedFn`、`syncFn=runZhihuFavoritesSync`（模块级引用稳定）、`classifyZhihuSyncError`（在本文件定义——错误分类属触发方），并把泛化字段映射回 favorites/collectionId/collections 命名（进度类型自 adapter re-export）。同步**手动按钮触发，绝不 auto-on-mount**——限流远程端点
- `collection-chips.tsx` — 收藏夹 chip 行：共享 `ChipRowShell`（zhihu icon + `zhihu.collectionsTitle`）+ `FilterChip`（maxWidth 220）——「全部(N)」+ 各夹「标题 (count)」（服务层按数量降序）。**折叠**逻辑抄 author-chips：`COLLAPSED_COUNT=12` + 展开/收起 raw Chip + 选中夹落 fold 外时补渲染 `selectedHidden`
- `zhihu-card.tsx` — 收藏卡片：作者头像（回退 zhihu icon）+ 显示名 + **类型 Chip 徽标**（`TYPE_LABEL_KEY: Record<ZhihuItemType, LocaleKeys>` 映射 `zhihu.type.*`，exhaustive）+ 标题（2 行 clamp）+ 摘要（3 行 clamp）+ 缩略图（96 高，若有）+ 底部行（收藏夹归属 bookmark icon + `formatDateTime(publishedAt)`）+ 标签行（`TagRow` 在 CardActionArea **之外**）。点击 `window.open(originalUrl)`
- `tagged-zhihu-card.tsx` — `TaggedZhihuCard`：TaggedItemGrid `renderCard` adapter，`toZhihuFavoriteItem` 收窄委托 sync-service 导出的 `narrowZhihuMeta`（SSOT，mapRow 与本 adapter 共用，含 type 白名单回退 answer），本文件只装 envelope（originalUrl 取 `item.originalUrl`，`publishedAt` 置 null）
- `zhihu-grid-skeleton.tsx` — 共享 `CardGridSkeleton` 外壳 + rounded 200 卡片骨架

## 约定

- 页面顺序由共享 scaffold 固定为标题/系统状态 → 搜索 → 收藏夹主分类 → 标签 → 列表；本目录只提供 adapter。
- 排序固定 publishedAt 降序（= 内容 updated/created 时间，web v4 items 无收藏时间）；platformMeta 形状见 `lib/zhihu/CLAUDE.md`
- 三种空态：未登录（打开知乎主按钮）/ 库空（立即同步主按钮）/ 同步失败（ErrorState+retry）；虚线框为共享 `StateBox`
- 路由/导航：`main.tsx` 路由 `collections/zhihu` + `nav-config.tsx` Collections children 叶子（`nav.zhihuFavorites`）；active 判定走 `layouts/nav-active.ts` 最长前缀匹配
- AI 后处理由 `zhihu-sync-adapter.ts` 把 `newItemIds` 交给 `startCollectionProcessingJobs`（手动/自动两触发同源），共享 `zhihu-favorites:embed|tag` 串行 lanes；Fetch worker 接收同一个 cooperative checkpoint。
- i18n：平台特有文案 key 在 `zhihu.*`（zh/en 齐全，`zhihu.count` 带 `.one` 复数变体，`zhihu.noMatches` 保留平台名词）；通用文案（retry/loadFailed）走共享 `common.*`，获取按钮走 `pipeline.fetchNow`（`common.syncNow` 已删）；错误类映射在 view 边界；无硬编码 CJK
