# lib/github

GitHub Star 收录领域（第二个平台，镜像 `lib/bilibili/` 分层）。MVP = 一键全量拉取 starred repos + PGlite 持久化 + 查询。复用现有表（sources/authors/items/item_sources，`platform='github'` 判别列），零新表零迁移。

## 模块结构

- `github-api.ts` — GitHub REST API 层：`fetchAllStarred(token, onProgress?)`（`GET /user/starred?per_page=100&sort=created&direction=desc` + `Accept: application/vnd.github.star+json`，star+json 的 `{starred_at, repo}` 摊平为 `GithubStarredRepo`；首页 Link header `rel="last"` 定总页数，逐页拉取带 `(page, totalPages, fetchedCount)` 进度回调，页间 100ms 延迟）、`validateToken(token)`（`GET /user` → `{login, avatarUrl}`，设置页测试连接）、`parseLinkHeader(header)`（纯函数，导出供单测）。结构化错误：401 → `GithubAuthError`；403 且 X-RateLimit-Remaining=0 → `GithubRateLimitError`（携带 `resetAt`）。lib 层零 UI 文案（i18n seam 在 UI 边界）
- `github-sync-service.ts` — **DB schema 知识的唯一持有者**（`PLATFORM = 'github'`）。同步：`syncStars(token, onProgress?)`（fetchAllStarred → `syncStarsToDb`，错误向上抛给 UI）、`syncStarsToDb(db, repos)`（导出供测试；事务骨架委托 `ingestCollection`（`lib/ingest/`，docs/16 HIGH-1）——本函数只声明归一化行（单 source `'stars'`、owners 为 authors、无 content），并从 `droppedItemIds`/`droppedLinkItemIds` 汇报 dropped repos（console.warn + `SyncStarsResult.droppedRepoIds`））。查询（GitHub 收藏页数据来源，UI 零 drizzle 导入）：`getStarredRepos({language?, search?, page, pageSize})`（starred_at 降序 = `platformMeta->>'starredAt'` ISO 字符串字典序；search 对 title/description ILIKE，转义 `%_\`）、`getLanguageCounts()`（按语言分组降序，排除 null）、`getLastSyncedAt()`。UI 行类型 `GithubRepoItem` 在此导出。守护测试 `github-sync-service.test.ts`（in-memory PGlite）

## 约定

- **共享骨架**：写侧走 `ingestCollection`（`lib/ingest/`，docs/16 HIGH-1——事务边界/insert-only/分批/id-map 均由管线持有）；读侧 `escapeLike` 自 `lib/database/sql-utils.ts`，`getStarredRepos` 走 `pagedItemsQuery`、`getLastSyncedAt` 走 `getPlatformLastSyncedAt`（`lib/database/collection-queries.ts`）——本文件只留平台特有 filter/orderBy/mapRow，勿再拷贝
- **Insert-only（与 B站同 ADR）**：items/authors/item_sources 只 insert（`onConflictDoNothing`，first-write-wins），不 update 不 delete。重新同步只追加新 star 的仓库；metadata 不刷新；unstar 不删行（知识资产保留）。唯一例外：`sources` 单行（`platformSourceId='stars'`）upsert 刷新 `lastFetchedAt`。完整 ADR 见 `.trellis/spec/frontend/database-bridge.md`
- **platformMeta 形状**（items，写入方即本目录，读取方按此解读）：`{ description, language, stargazersCount, forksCount, topics, pushedAt, starredAt, ownerAvatarUrl }`（camelCase；starredAt/pushedAt 为 ISO 字符串）
- token 来源：`UserSettings.githubToken`（`lib/storage/settings.ts`），由调用方（UI hook）读出后作参数传入，本目录不 import `@/lib/storage`
- 运行位置：app.html 页面 context，经 RPC proxy 写 Offscreen PGlite（与 bilibili 同步一致）
- items `contentState` 固定 `'no_content'`（repo 无转录内容）；AI 标签/README/embedding 接入是后续任务
- host 权限：`https://api.github.com/*` 已在 `wxt.config.ts` 静态 `host_permissions`
