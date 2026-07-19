# lib/zhihu

知乎收藏收录领域（第五个平台，镜像 `lib/x/` 分层）。MVP = 拉取当前登录用户的**全部公开收藏夹**及其条目 + 正文 turndown 转 Markdown + PGlite 持久化 + 查询 + Markdown 切块。复用现有表（sources/authors/items/item_sources/item_contents/item_chunks，`platform='zhihu'` 判别列），零新表零迁移。

**认证 bilibili 式（cookie 直读，无捕获）**：扩展 context fetch 带 `credentials:'include'` + `wxt.config.ts` 的 `zhihuHostPermissions`（`https://www.zhihu.com/*` + `https://api.zhihu.com/*`），浏览器自动附带用户真实知乎会话 cookie（z_c0/d_c0/__zse_ck）。无 webRequest 捕获、无 chrome.cookies、无 Connections 卡、无 session key。收藏夹相关 API 不校验 x-zse-96 签名（RSSHub 实证，任务 research/zhihu-api.md）；唯一特殊 header 是 v4 items 端点的 `x-api-version: 3.0.91`。**Referer 无法从 fetch 设置（forbidden header）也未做 DNR 改写**——扩展请求无 referrer 到达，X 平台先例证明该画像可接受；若实测知乎硬要求 Referer，加 `public/rules.json` DNR 规则（见 spec 的 DNR design decision）`[UNKNOWN 待实测]`。

## API 链路（全 GET，串行）

1. `GET www.zhihu.com/api/v4/me` → 当前用户 `url_token`（401 → `ZhihuAuthError`；200 无 url_token → 抛 Error `[UNKNOWN：RSSHub 只读 name，url_token 存在性待实测]`）
2. `GET api.zhihu.com/people/{url_token}/collections` → 公开收藏夹列表（`is_public === false/0` 过滤，字段形态未证实故默认公开；防御式跟随 `paging.next` 分页，RSSHub 未分页）
3. `GET www.zhihu.com/api/v4/collections/{id}/items?offset&limit=20` → 条目，`paging.is_end`/`totals`/空页三重停止条件，offset 步进 20

## 模块结构

- `zhihu-api.ts` — fetch 层（无 DB 导入、无 UI 文案）。结构化错误：401/code 100/101 → `ZhihuAuthError`；403（反爬主形态，**不重试**）/429 重试耗尽 → `ZhihuRateLimitError`（知乎无 reset header，故无 resetAt）；5xx 指数退避 `MAX_RETRIES=5`。**HTTP 200 决不盲信**（X 07-16 教训）：200 + 非 JSON body（challenge HTML）/ `error` body / 无 `data` 数组 → 抛带 body 前 300 字符的 Error，绝不吞成空数组。防限流：严格串行 + 页间 `BASE_DELAY_MS=1000 + Math.random()*JITTER_MS(500)` 抖动（RSSHub 的 Promise.all 并发**有意不抄**——403 限流真实存在）。纯函数导出供单测：`mapCollection`、`mapCollectionItem`（4 类型归一化，见下）、`buildCollectionItemsUrl`、`stripHtmlToText`、`stripImageSizeSuffix`（zhihu-markdown 复用，勿在别处再抄）。`fetchAllFavorites(onProgress?)` 组合 me → collections → 每夹条目，进度回调 `(fetchedCount, collectionIndex, collectionCount)`
- `zhihu-markdown.ts` — `htmlToMarkdown(html)`（turndown 单例）：懒加载图 `data-actualsrc/data-original` 优先 + 尺寸后缀剥离（`_720w.jpg → .jpg`）+ data-URI 占位图回退 alt（公式 LaTeX）、`noscript` 重复图移除、`link.zhihu.com/?target=` 外链解包（`unwrapZhihuRedirect` 导出）。转换失败降级 `stripHtmlToText` 不中断同步。**turndown 依赖 DOM**：app.html 用真实 document，vitest 下用其内置 domino——**不要放进 background SW 执行路径**
- Markdown 切块用共享 `charSplit(text, { preferParagraph: true })`（`lib/embedding/char-split.ts`，docs/16 MEDIUM-4——原 `zhihu-chunker.ts` 已删并入）：`preferParagraph:true` 边界优先级 段落空行（`\n\n`）> 句末标点（`。.!?！？;；…\n`，中英双覆盖）> 硬切，`MAX_CHARS=1500` 回看 300。无时间戳（图文 → NULL start/end 列）
- `zhihu-sync-service.ts` — **DB schema 知识的唯一持有者**（`PLATFORM='zhihu'`）。同步：`syncFavorites(onProgress?)`（fetchAllFavorites → `syncFavoritesToDb` → **return result**；**ST3：自动打标/embed 已从本 wrapper 上移到 hook 层**——`use-zhihu-favorites.ts` 收尾 `startJob('zhihu-favorites','tag'/'embed', …tagNewItems/embedNewItems('zhihu', newItemIds, undefined, onProgress))`，四 collection 平台统一在 hook 层经 `startJob` 注册后台任务（进度 done/total + 跨挂载去重 + 全局勿关页计数）；wrapper 本身不再 import/调 tagging/embedding，`charSplit` 仍留供 `syncFavoritesToDb` 切块）、`syncFavoritesToDb(db, collections, favorites)`（导出供测试：先跨夹去重 + turndown 转 Markdown（CPU 活不进事务）→ 事务骨架委托 `ingestCollection`（`lib/ingest/`，docs/16 HIGH-1）——本函数只声明归一化行：sources=**全部公开收藏夹含空夹**（title 重命名经 upsert 刷新）、items 含 platformMeta/contentState、links 按收藏 membership、content=`{textOf: markdownById, chunk: charSplit(·, {preferParagraph:true})}`）。查询（UI 零 drizzle 导入）：`getFavorites({collectionId?, search?, page, pageSize})`（`publishedAt DESC NULLS LAST`；collectionId 走 `EXISTS(item_sources⋈sources)` 子查询；search 对 title/authorName/platformMeta excerpt ILIKE，转义 `%_\`）、`getCollectionCounts()`（有条目的收藏夹按计数降序，chip 行——空夹自然不出现）、`getLastSyncedAt()`（`max(lastFetchedAt)`）。UI 行类型 `ZhihuFavoriteItem` 在此导出。守护测试 `zhihu-sync-service.test.ts`（in-memory PGlite）

## 4 种条目类型归一化（`mapCollectionItem`，research §3.2）

| type | title | url（确定性构造） | 正文 | 时间（秒） | 缩略图 |
|---|---|---|---|---|---|
| answer | question.title | `/question/{qid}/answer/{id}` | content HTML | updated_time | — |
| article | title | `zhuanlan.zhihu.com/p/{id}` | content HTML | updated | image_url |
| pin | excerpt_title 兜底分段文本截断 | `/pin/{id}` | 分段数组拼 HTML（text 原样/image `<img>`/video 封面/link `<a>`） | created | 首个 image/video 封面 |
| zvideo | title | `/zvideo/{id}` | **无**（no_content） | updated_time | video.url 封面 |

未知 type / 缺 id / 缺 content → 返回 null 跳过（知乎随时可能加类型）。作者缺失回退 `{id:'anonymous', name:'anonymous'}`。

## 约定

- **共享骨架**：写侧走 `ingestCollection`（`lib/ingest/`，docs/16 HIGH-1——事务边界/insert-only/分批/id-map/两段式 content 均由管线持有，不变量见 `lib/ingest/CLAUDE.md`）；读侧 `escapeLike` 自 `lib/database/sql-utils.ts`，`getFavorites` 走 `pagedItemsQuery`、`getLastSyncedAt` 走 `getPlatformLastSyncedAt`（`lib/database/collection-queries.ts`）——本文件只留平台特有 filter/orderBy/mapRow，勿再拷贝
- **Insert-only（与全平台同 ADR）**：items/authors/item_sources 只 insert（`onConflictDoNothing`，first-write-wins）。取消收藏不删行；条目跨夹收藏 = 1 item + N link（对齐 bookmarks 文件夹模型）。唯一例外：`sources` 收藏夹行 upsert 刷新 `title`/`lastFetchedAt`
- **content_state**：answer/article/pin（有正文）→ Markdown 落 `item_contents.plainText` + `charSplit(preferParagraph:true)` 切块 → `'chunked'`（**不 inline embed**，D3——同步收尾 `embedNewItems` 自动向量化新条目（**ST3 触发在 hook 层经 `startJob`**，非本 wrapper），设置页「重建向量」为积压兜底）；zvideo/空正文 → `'no_content'`（**不用 `'pending'`**——那会喂给 auto-transcribe）
- **items 行映射**：`platformItemId = '{type}:{id}'`（类型间 id 命名空间独立，防碰撞）、`title`（api 层保证非空，多级兜底）、`authorName`、`originalUrl`=构造的 web URL、`publishedAt = createdAt*1000`（web v4 items **无收藏时间**，用内容自身 updated/created 兜底——PRD 已决策）
- **platformMeta 形状**（items，写入方即本目录）：`{ type, excerpt, authorName, avatarUrl, thumbnailUrl, collectionId, collectionTitle }`（camelCase；collection 二字段是**首见**归属仅供卡片展示，筛选走 item_sources）。防御式收窄由本目录导出的 `narrowZhihuMeta(meta, { authorName })` 单点持有，sync-service `mapRow` 与 section `tagged-zhihu-card` 共用
- **`narrowZhihuMeta` 导出**（sync-service）：`narrowZhihuMeta(meta: unknown, fb: { authorName }): NarrowedZhihuMeta`（= `Omit<ZhihuFavoriteItem, envelope>`）。type 经 `ZHIHU_TYPES` 白名单回退 `answer`；authorName 缺失回退 `fb.authorName`（空串保留）。envelope（id/platformItemId/title/originalUrl/publishedAt）留各调用点
- 运行位置：**仅 app.html 页面 context**（手动同步按钮 → RPC proxy 写 Offscreen PGlite）。无浮层按钮、无 offscreen 委托、无 background 消息
- 未覆盖（Out of Scope，见 PRD）：私密收藏夹（`is_public` 过滤掉）、他人收藏夹、知乎页浮层按钮、类型双维筛选、inline embedding、增量 stop-on-known-id
