# lib/github

GitHub Star 收录领域（第二个平台，镜像 `lib/bilibili/` 分层）。MVP = 一键全量拉取 starred repos + 新仓库 README markdown 入库切块 + PGlite 持久化 + 查询。复用现有表（sources/authors/items/item_sources/item_contents/item_chunks，`platform='github'` 判别列），零新表零迁移。

## 模块结构

- `github-api.ts` — GitHub REST API 层：`fetchAllStarred(token, onProgress?)`（`GET /user/starred?per_page=100&sort=created&direction=desc` + `Accept: application/vnd.github.star+json`，star+json 的 `{starred_at, repo}` 摊平为 `GithubStarredRepo`；首页 Link header `rel="last"` 定总页数，逐页拉取带 `(page, totalPages, fetchedCount)` 进度回调，页间 100ms 延迟）、`fetchReadme(token, fullName)`（`GET /repos/{fullName}/readme` + `Accept: application/vnd.github.raw+json` → 原始 markdown；404 → `null`（无 README 是正常状态），其他非 OK 走结构化错误）、`validateToken(token)`（`GET /user` → `{login, avatarUrl}`，设置页测试连接）、`parseLinkHeader(header)`（纯函数，导出供单测）。结构化错误：401 → `GithubAuthError`；403 且 X-RateLimit-Remaining=0 → `GithubRateLimitError`（携带 `resetAt`）。lib 层零 UI 文案（i18n seam 在 UI 边界）
- `github-sync-service.ts` — **DB schema 知识的唯一持有者**（`PLATFORM = 'github'`）。`syncStars(token, onProgress?, onReadmeProgress?, control?)` 按 Stars 分页 → 新仓库差集 → README 串行抓取 → DB 写入推进；Stars 每页与 README 每仓领取前执行 cooperative checkpoint，当前请求不中断。README 单仓失败仍降级为 no-content，已入库仓库仍不重拉。`SyncStarsResult.newItemIds` 由 app.html 调用方 enqueue 共享 Embed/Tags lanes；本目录不 import storage/tagging/embedding barrel。查询仍由 `getStarredRepos/getLanguageCounts/getLastSyncedAt` 持有。

## 约定

- **共享骨架**：写侧走 `ingestCollection`（`lib/ingest/`，docs/16 HIGH-1——事务边界/insert-only/分批/id-map 均由管线持有）；读侧 `escapeLike` 自 `lib/database/sql-utils.ts`，`getStarredRepos` 走 `pagedItemsQuery`、`getLastSyncedAt` 走 `getPlatformLastSyncedAt`（`lib/database/collection-queries.ts`）——本文件只留平台特有 filter/orderBy/mapRow，勿再拷贝
- **Insert-only（与 B站同 ADR）**：items/authors/item_sources 只 insert（`onConflictDoNothing`，first-write-wins），不 update 不 delete。重新同步只追加新 star 的仓库；metadata 不刷新；unstar 不删行（知识资产保留）。唯一例外：`sources` 单行（`platformSourceId='stars'`）upsert 刷新 `lastFetchedAt`。完整 ADR 见 `.trellis/spec/frontend/database-bridge.md`
- **platformMeta 形状**（items，写入方即本目录，读取方按此解读）：`{ description, language, stargazersCount, forksCount, topics, pushedAt, starredAt, ownerAvatarUrl }`（camelCase；starredAt/pushedAt 为 ISO 字符串）。防御式收窄由本目录导出的 `narrowGithubMeta(meta)`（`unknown`→带默认值成品）单点持有，sync-service `mapRow` 与 section `tagged-repo-card` 共用——改形状只此一处
- **`narrowGithubMeta` 导出**（sync-service）：`narrowGithubMeta(meta: unknown): NarrowedGithubMeta`（= `Omit<GithubRepoItem, envelope>`），全字段 `typeof` 收窄，无 envelope fallback。envelope（id/repoId/fullName/ownerLogin/htmlUrl）留各调用点
- token 来源：`UserSettings.githubToken`（`lib/storage/settings.ts`），由调用方（UI hook）读出后作参数传入，本目录不 import `@/lib/storage`
- 运行位置：app.html 页面 context，经 RPC proxy 写 Offscreen PGlite（与 bilibili 同步一致）
- **content_state（zhihu 同规则）**：有 README 的新仓库 → markdown 落 `item_contents.plainText`（截头 `MAX_README_CHARS`）+ `charSplit(preferParagraph:true)` 切块 → `'chunked'`（**不 inline embed**，D3——同步收尾由 `use-github-stars` syncFn `embedNewItems` 自动向量化，设置页「重建向量」为积压兜底）；无 README（404）或拉取失败 → `'no_content'`（**不用 `'pending'`**——那会喂给 auto-transcribe）。插入时错过的 README 永久 no_content（insert-only 快照，无回填——有意决策）
- host 权限：`https://api.github.com/*` 已在 `wxt.config.ts` 静态 `host_permissions`
