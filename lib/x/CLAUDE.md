# lib/x

X (Twitter) 书签收录领域（第四个平台，镜像 `lib/github/` 分层）。MVP = 从 X 私有 GraphQL 端点（用户登录态）一次性拉取全部书签 + PGlite 持久化 + 查询 + tweet 文本切块。复用现有表（sources/authors/items/item_sources/item_contents/item_chunks，`platform='x'` 判别列），零新表零迁移。X 无免费官方 API，故读 web 客户端的 `BookmarkSearchTimeline` 内部端点——**防风控（anti-detection）是一等需求**。完整 7 条决策（D1–D7）见 `.trellis/tasks/07-15-add-x-twitter-bookmarks-as-a-collection-platform/prd.md` 与两份 research。

## 模块结构

- `x-api.ts` — X GraphQL「API」层（无 DB 导入、无 UI 文案）：
  - 认证（镜像 bilibili）：`getXAuth()`（`chrome.cookies.get` 读 `ct0` + `auth_token`，任一缺失/过期返回 null）。请求手拼 `Cookie: auth_token=…; ct0=…` header + `x-csrf-token=ct0`（X double-submit CSRF），bearer 为公共 web 常量（**非** OAuth token）
  - `resolveBookmarksQueryId()` — 运行时解析 `BookmarkSearchTimeline` 的 queryId（D7，X 每版轮换故绝不硬编码为唯一来源）：fetch x.com 首页 HTML → 找 `abs.twimg.com/responsive-web/*.js` bundle → 正则 `parseQueryIdFromBundle`（纯函数导出，`operationName↔queryId` 双序匹配）。**任何失败优雅降级**到硬编码 fallback（`fHKoSa-2dbV1UbhUy3EvcA`），永不 crash 同步
  - `fetchAllBookmarks(auth, onProgress?, { shouldStop? })` — 串行游标分页。响应路径 `data.search_by_raw_query.bookmarks_search_timeline.timeline.instructions[]`（兼容旧 `bookmark_timeline_v2` 包装）；bottom cursor = `content.cursorType==='Bottom'` 的 entry。停止条件：entries 空 / bottom cursor 不变 / `shouldStop(id)` 命中已存 id（增量）
  - 纯函数导出供单测：`parseTweets`、`extractBottomCursor`、`mapTweetToRow`（含 `TweetWithVisibilityResults` 拆包 + photo/best-mp4 media 提取 + url 派生）、`buildBookmarksUrl`（只发 `true` features 防 414）、`parseQueryIdFromBundle`。原始行类型 `XRawBookmark`
  - 结构化错误：401/403 → `XAuthError`；429 或 body `errors[].code===88` 重试耗尽 → `XRateLimitError(resetAt)`
- `x-chunker.ts` — `chunkTweetText(text) → ChunkInput[]` 纯函数（tweet 内容类型 chunker，镜像 `lib/embedding/chunker.ts` 角色）：普通推文 1 chunk；长 premium（note）推文按 `MAX_CHARS=1500` 软切，优先句末标点（`。.!?！？;；…\n`）回看 300 字符，无句断则硬切。无时间戳（图文内容 → NULL start/end 列）
- `x-sync-service.ts` — **DB schema 知识的唯一持有者**（`PLATFORM='x'`）。同步：`syncBookmarks(onProgress?)`（`getXAuth` 抛 XAuthError → 读已存 id 建增量 `shouldStop` → fetchAllBookmarks → `syncBookmarksToDb`）、`syncBookmarksToDb(db, bookmarks)`（导出供测试）。查询（X 收藏页数据来源，UI 零 drizzle 导入）：`getBookmarks({author?, search?, page, pageSize})`（`publishedAt DESC NULLS LAST`；author 精确匹配 handle chip；search 对 title/text/authorName ILIKE，转义 `%_\`）、`getAuthorCounts()`（按作者分组降序，chip 行）、`getLastSyncedAt()`。UI 行类型 `XBookmarkItem` 在此导出。守护测试 `x-sync-service.test.ts`（in-memory PGlite）

## 约定

- **Insert-only（与 B站/github/bookmarks 同 ADR）**：items/authors/item_sources 只 insert（`onConflictDoNothing`，first-write-wins），不 update 不 delete。重新同步只追加新书签；metadata 不刷新；取消书签不删行。唯一例外：`sources` 单行（`platformSourceId='bookmarks'`）upsert 刷新 `lastFetchedAt`。完整 ADR 见 `.trellis/spec/frontend/database-bridge.md`
- **content_state='chunked' + 延迟 embed（D3）**：tweet `full_text` 即内容，同步时写 `item_contents` + `chunkTweetText` 切块 → item `content_state='chunked'`，**但不 inline embed**（数千书签会打爆 embedding provider）。向量化推迟到设置页「重建向量」`rebuildPendingEmbeddings`（现有约定，见 `lib/embedding/CLAUDE.md`）。同步后全文（ILIKE on title/text）即可搜；语义检索需先重建
- **两段式事务**：主插入（sources/authors/items/item_sources）在单事务内 insert-only；content+chunks 对**新插入的 item** 在事务**外**逐条写（`replaceItemChunks` 自开事务，单连接 proxy 上嵌套会死锁——同 bili content-sync 在同步事务外的做法）
- **items 行映射**（PRD Technical Notes）：`platformItemId=rest_id`、`title=full_text` 截断 140 字符（空回退 handle）、`authorName=用户显示名`、`authorId → platform_author_id=用户 rest_id`、`originalUrl=https://x.com/{handle}/status/{rest_id}`、`publishedAt=created_at`
- **platformMeta 形状**（items，写入方即本目录）：`{ text, authorHandle, authorName, avatarUrl, media[], likeCount, retweetCount, replyCount, lang }`（camelCase）。media 项 `{ type, url }`
- **防风控常量**（`x-api.ts`，来源 research/anti-detection-strategy.md）：`PAGE_SIZE=20`（贴合真实 web 客户端=最低指纹风险）、页间 `BASE_DELAY_MS=500 + Math.random()*JITTER_MS(500)` 抖动、串行无并发、`x-rate-limit-remaining<=REMAINING_STOP_THRESHOLD(3)` 主动暂停至 `x-rate-limit-reset`、429/code:88 → sleep 至 reset 后**重试同页**、5xx 瞬态 `MAX_RETRIES=5` 上限指数退避、增量 stop-on-known-id 封顶 re-sync 成本
- **D1a 指纹修复（DNR）**：从 app.html 发请求时 Chrome 设 `Origin: chrome-extension://<id>` 且 fetch 无法覆盖。`public/rules.json` 规则 id:2 在网络栈层把 `Referer→https://x.com/` + `Origin→https://x.com`（`urlFilter:"x.com/i/api/graphql"`，`resourceTypes:["xmlhttprequest"]`）。User-Agent 已是真实 Chrome UA。修复后与真实 in-page 请求的唯一残余差距是 `x-client-transaction-id`（D4 MVP 省略——app.html 无 x.com DOM 无法生成；bird 证明当前端点不带也能成功；靠 pacing+backoff+增量兜底。补它需迁移到 content-script transport，是文档化的 seam）
- 权限：`*://x.com/*` + `https://abs.twimg.com/*`（queryId resolver 用）静态 `host_permissions`；`cookies` perm 已有。**无 Connections 卡（D6）**：cookie 同步时静默读（同 bilibili），缺失/过期 → `XAuthError` → UI「登录 x.com」空态。无 `UserSettings.xToken`、无 `configSavedAt.x`
- 运行位置：app.html 页面 context，经 RPC proxy 写 Offscreen PGlite（与其他平台同步一致）
- 未覆盖（Out of Scope，见 PRD）：Premium「书签文件夹」API（扁平单集合）、写/删书签（只读收录）、`x-client-transaction-id` 生成、inline embedding、tweet 媒体下载/thread 展开、多账号
