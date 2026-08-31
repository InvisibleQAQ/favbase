# sections/zhihu

知乎收藏页（`/collections/zhihu`，多收藏夹但**无 `:id` 详情路由**——收藏夹经 chips 单维筛选，第五个平台）。视觉结构对齐 X 书签页（`sections/x/`）：28px route h1 + 计数 + lastSynced + 同步按钮 → pipeline 行（strip + 闸门）→ 全宽搜索框 → 配置提醒横幅（若有）→ 收藏夹 chips → 卡片 grid（xs12/sm6/md4/lg3）+ Pagination。**数据一律从 PGlite 经 `lib/zhihu/zhihu-sync-service` 查询方法读取（UI 零 drizzle 导入），不直读知乎 API**；同步（`syncFavorites`）在 app.html context 跑（turndown 需要 DOM + cookie 随 `credentials:'include'` 自动附带），经 RPC proxy 写 Offscreen PGlite。**凭据无 UI 半**：无 Connections 卡——认证是浏览器自己的知乎会话 cookie（bilibili 式直读，见 `lib/zhihu/CLAUDE.md`），未登录在同步时才暴露为 `ZhihuAuthError` → 「打开知乎」空态。

## 模块结构

- `zhihu-view.tsx` — scaffold Adapter；常驻 pipeline 为 Fetch → Embedding/Tagging 并行（无 content 段），段装配/标签/coverage key 经共享 `useCollectionPipeline`（`app/hooks/`，docs/20 中-7），本 view 只传 `backgroundJobRuntime(syncJob, fetchedCountProgress)`；Search 后注入共享 provider Configuration Blocker notice。auth gate、runtime、phase、空态、错误翻译与标签职责不变。
- `zhihu-sync-adapter.ts` — 共享 Sync Adapter（audit #6）：`runZhihuFavoritesSync(onProgress, control)` 单点定义「知乎同步成功意味着什么」——cookie 直读无 auth 解析、进度三元组映射（`ZhihuSyncProgress` fetchedCount/current/total 在此定义）、`startCollectionProcessingJobs` 派发（job namespace 经 `jobPlatformForCollection` SSOT）。手动页面 `syncFn` 与 daily registry 引用**同一函数**；`ZhihuAuthError` 的处理留触发方（手动→auth 空态，daily→静默跳过）。契约测试 `zhihu-sync-adapter.test.ts`；另导出 `zhihuAutoSyncPolicy`（daily 触发策略：恒就绪 + `isSilentError = err instanceof ZhihuAuthError` 静默跳过），app 根 `collection-platform-auto-sync.ts` 将其与 Sync Adapter 配对进 daily registry（docs/20 高-3）
- `use-zhihu-favorites.ts` — 数据 hook：共享 `useCollectionLibrary`（`app/hooks/`，见该目录 CLAUDE.md）的薄 adapter——状态机全在泛型层，本文件只注入模块级 `queryFn`（filter→collectionId 映射 `getFavorites`，publishedAt 降序服务层固定）、`facetsFn=getCollectionCounts`、`lastSyncedFn`、`syncFn=runZhihuFavoritesSync`（模块级引用稳定）、`classifyZhihuSyncError`（在本文件定义——错误分类属触发方），并把泛化字段映射回 favorites/collectionId/collections 命名（进度类型自 adapter re-export）。同步**手动按钮触发，绝不 auto-on-mount**——限流远程端点
- `collection-chips.tsx` — 收藏夹 chip 行：共享 `CollapsibleChipRow`（zhihu icon 继承 shared secondary 色 + `zhihu.collectionsTitle`）薄 adapter——「全部(N)」+ 各夹「标题 (count)」（服务层按数量降序）；默认前 8 项，展开/收起与选中隐藏项保活全由共享组件持有
- `zhihu-card.tsx` — 收藏卡片 = 共享 `CollectionCard` 装配：`header` 作者头像（Avatar 24px，回退 zhihu icon）+ 显示名；`title` 2 行 clamp；`body` 摘要 3 行 clamp；`media` 缩略图作 `1/1` 72px 方图，外壳放在标题/摘要右侧、header 之下（若有，破图回退 zhihu icon）；`meta` 收藏夹归属 bookmark icon + 名；`date` `formatDateTime(publishedAt)`（外壳右格 noWrap）；`stamp` **类型 Chip 徽标**（`TYPE_LABEL_KEY: Record<ZhihuItemType, LocaleKeys>` 映射 `zhihu.type.*`，exhaustive）落在计数行尾；`tags`（`TagRow`，外壳保证在链接之外）。`href = originalUrl` 真实锚点新标签打开（不再 `window.open`）
- `tagged-zhihu-card.tsx` — `TaggedZhihuCard`：TaggedItemGrid `renderCard` adapter，`toZhihuFavoriteItem` 收窄委托 sync-service 导出的 `narrowZhihuMeta`（SSOT，mapRow 与本 adapter 共用，含 type 白名单回退 answer），本文件只装 envelope（originalUrl 取 `item.originalUrl`，`publishedAt` 置 null）
- `zhihu-grid-skeleton.tsx` — 共享 `CardGridSkeleton` 外壳 + 共享 `CollectionCardSkeleton`（`header` 行 + 三行文字，匹配卡片形态）

## 约定

- 页面顺序由共享 scaffold 固定为标题/系统状态 → 搜索 → 配置提醒 → 收藏夹主分类 → 标签 → 列表；本目录只提供 adapter。
- 排序固定 publishedAt 降序（= 内容 updated/created 时间，web v4 items 无收藏时间）；platformMeta 形状见 `lib/zhihu/CLAUDE.md`
- 三种空态：未登录（48px secondary glyph + 可换行居中动作组）/ 库空（48px secondary glyph + 立即同步主按钮）/ 同步失败（ErrorState+retry）；虚线框为共享 `StateBox`
- 路由/导航：`main.tsx` 路由 `collections/zhihu` + `nav-config.tsx` Collections children 叶子（`nav.zhihuFavorites`）；active 判定走 `layouts/nav-active.ts` 最长前缀匹配
- AI 后处理由 `zhihu-sync-adapter.ts` 把 `newItemIds` 交给 `startCollectionProcessingJobs`（手动/自动两触发同源），共享 `zhihu-favorites:embed|tag` 串行 lanes；Fetch worker 接收同一个 cooperative checkpoint。
- i18n：平台特有文案 key 在 `zhihu.*`（zh/en 齐全，`zhihu.count` 带 `.one` 复数变体，`zhihu.noMatches` 保留平台名词）；通用文案（retry/loadFailed）走共享 `common.*`，获取按钮走 `pipeline.fetchNow`（`common.syncNow` 已删）；错误类映射在 view 边界；无硬编码 CJK
