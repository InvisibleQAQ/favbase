# lib/bookmarks

浏览器书签收录领域（第三个平台，镜像 `lib/github/` 分层）。MVP = 读本地 `chrome.bookmarks` 树 + PGlite 持久化 + 查询。复用现有表（sources/authors/items/item_sources，`platform='bookmarks'` 判别列），零新表零迁移。**首个无远程凭证平台**：书签是本地数据，故无 token/cookie、无 `validateCredential`、无 auth/rate-limit 错误类、无 API host 权限（平台接入契约的「凭证那半套」不适用，见 `.trellis/spec/frontend/platform-onboarding.md`）。

## 模块结构

- `bookmarks-api.ts` — 本地书签「API」层（无 DB 导入、无 UI 文案）：`readBookmarkTree()`（唯一 impure 入口，`browser.bookmarks.getTree()` → `flattenBookmarkTree`）。纯函数导出供单测：`flattenBookmarkTree(roots)`（DFS 扁平化为 `{folders, bookmarks}`——node 有 `children` 且无 `url` 为文件夹、有 `url` 为书签；跳过合成根 `'0'`，顶层容器 Bookmarks Bar/Other 成真实文件夹；非 http(s) 书签过滤掉；每条书签带**直接父文件夹 id**）、`normalizeUrl(url)`（去重键：host 小写 + 剥 `utm_*`/`ref`/`fbclid`/`gclid` 等追踪参 + 去非根路径尾斜杠；不可解析回退 trim 原串）、`isHttpUrl`、`extractDomain`（host 去 `www.`）。守护测试 `bookmarks-api.test.ts`
- `bookmarks-sync-service.ts` — **DB schema 知识的唯一持有者**（`PLATFORM='bookmarks'`）。同步：`syncBookmarks()`（readBookmarkTree → `syncBookmarkTreeToDb`）、`syncBookmarkTreeToDb(db, tree)`（导出供测试；空树零写入早退后，事务骨架委托 `ingestCollection`（`lib/ingest/`，docs/16 HIGH-1）——本函数只声明归一化行：sources=**有≥1直接书签的文件夹**（含 `platformMeta.path`）、authors=去重域名、items 按 `normalizedUrl` 去重、links 每个「书签×文件夹」对一条，无 content）。查询（书签页数据来源，UI 零 drizzle 导入）：`getBookmarks({folderId?, search?, page, pageSize})`（`publishedAt DESC NULLS LAST` = dateAdded 降序；`folderId` 用 `EXISTS(item_sources⋈sources)` 子查询限定；search 对 title/domain ILIKE，转义 `%_\`）、`getFolders()`（有书签的文件夹，`createdAt` 升序=首见树序，返回 `{folderId=platformSourceId, title, path}`）、`getLastSyncedAt()`（`max(lastFetchedAt)`）。UI 行类型 `BookmarkItem`、`BookmarkFolderRef` 在此导出。守护测试 `bookmarks-sync-service.test.ts`（in-memory PGlite）

## 约定

- **共享骨架**：写侧走 `ingestCollection`（`lib/ingest/`，docs/16 HIGH-1——事务边界/insert-only/分批/id-map 均由管线持有）；读侧 `escapeLike` 自 `lib/database/sql-utils.ts`，`getBookmarks` 走 `pagedItemsQuery`、`getLastSyncedAt` 走 `getPlatformLastSyncedAt`（`lib/database/collection-queries.ts`）——本文件只留平台特有 filter/orderBy/mapRow，勿再拷贝
- **Insert-only（与 B站/github 同 ADR）**：items/authors/item_sources 只 insert（`onConflictDoNothing`，first-write-wins），不 update 不 delete。重新同步（每次访问自动触发）只追加新书签；标题/元数据不刷新；删除的书签不删行；书签跨文件夹移动**保留双 link**（与 bilibili 一致）。唯一例外：`sources` 文件夹行 upsert 刷新 `title`/`platformMeta.path`/`lastFetchedAt`（文件夹重命名经此反映）。完整 ADR 见 `.trellis/spec/frontend/database-bridge.md`
- **items 行映射**：`platformItemId=normalizedUrl`（稳定去重键，非 chrome 节点 id——节点 id 跨设备不稳定）、`title=bookmark.title`（空回退 url）、`authorName=domain`、`originalUrl=bookmark.url`、`publishedAt=new Date(dateAdded)`、`contentState='no_content'`（书签暂无抽取内容；defuddle 网页转 markdown 内容管线是**后续任务**，届时把此 seam 翻成 `pending`）
- **platformMeta 形状**（items）：`{ domain, dateAdded }`（dateAdded 为 ms epoch，与 publishedAt 冗余保无损）。favicon **不入库**，UI 用 MV3 本地 `_favicon` API 渲染（`sections/bookmarks/bookmark-card.tsx`）
- **文件夹 = source**：`platformSourceId=chrome 文件夹节点 id`（profile 内稳定，1:1 对应本地 PGlite）；`platformMeta.path` 存全路径供展示/调试。删+重建文件夹得新 id → 新 source（旧的 insert-only 保留），MVP 可接受。**空文件夹跳过**（无直接书签的文件夹不建 source，含只含子文件夹者）
- 运行位置：app.html 页面 context，经 RPC proxy 写 Offscreen PGlite（与 bilibili/github 同步一致）
- 权限：`bookmarks`（读树）+ `favicon`（本地图标）已在 `wxt.config.ts` 静态 `permissions`，**无 host 权限**（收录 only）
