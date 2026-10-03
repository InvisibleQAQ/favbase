# PGlite + Drizzle 数据库层

RPC Proxy 架构（参考 memorall 3-hop PortBridge 模式）：Offscreen Document 持有 PGlite，app.html 通过 PortBridge 中继（app.html → Background SW → Offscreen）透明使用 Drizzle query builder。app.html 启动时 fire-and-forget 调用 `initDbProxy()`，Background SW 负责 Offscreen 生命周期管理。

## 模块结构

- `constants.ts` — `DB_CHANNEL_NAME`('favbase-db'), `DB_DATA_DIR`('idb://favbase'), `DatabaseMode` enum
- `entities/` — Per-table Drizzle schema 定义（entity-per-file）
- `schema.ts` — 集中导出所有表定义（轻量，无 PGlite 运行时依赖）
- `types.ts` — 仅 type 导出（Author/Item/Source 等 Select/Insert 类型）
- `db.ts` — 兼容入口与 Offscreen 主实现：`initDbMain()` 用 strict durability 创建 PGlite、跑迁移并启动 RPC handler；继续转出旧有 `initDbProxy()`/`getDb()`/`closeDb()` 公共接口
- `proxy-db.ts` — app/常规调用端的完整 PGlite Drizzle adapter：创建 `PGliteSharedProxy` + Drizzle；Background 禁止 value-import 此文件或 `db.ts`/`index.ts`
- `proxy-client.ts` — main-agnostic RPC client construction：创建 transport/proxy 并等待 health ready，供普通与只读 Drizzle adapter 复用
- `read-proxy-db.ts` — Agent Bridge Background 专用只读 Drizzle adapter，使用 `drizzle-orm/pg-proxy` 并兼容现有 raw `db.execute().rows` 形状；不支持事务，禁止给 app 写路径使用
- `db-state.ts` / `db-types.ts` — main/proxy 共用的初始化状态与纯类型；状态只能在此持有，不得在两端复制
- `bridges/` — RPC 桥接层
- `migrations/` — 自定义迁移系统
- `index.ts` — Public API barrel
- `sql-utils.ts` — 平台无关纯函数（零导入零副作用，offscreen 安全）：`chunk<T>(arr, size)`（INSERT 分批，bind-param < 65535，主要消费方 `lib/ingest/ingest.ts`）、`escapeLike(input)`（LIKE/ILIKE 元字符转义，ILIKE 注入唯一防线；docs/32 Step 9 起平台 sync-service 不再直接调它，收藏页搜索一律经 `collection-queries.ts` 的 `searchCondition`，另一个调用方是 `lib/chat/retrieval.ts` 的关键词检索）。勿再各自拷贝（docs/15 MEDIUM-3）
- `collection-queries.ts` — 收藏页共享读骨架：`pagedItemsQuery(db, {conditions, orderBy, page, pageSize, mapRow})`（固定 7 列 select + 并行 `count(*)` + 分页 + 行映射，返回 `{rows, total}`）、`getPlatformLastSyncedAt(platform: CollectionPlatform, db)`（「上次同步」= Platform Sync Record 的 `last_success_at`，从未成功为 null；docs/32 Step 1 起不再是 `max(sources.lastFetchedAt)`——失败与空库同步从不写 source 行，旧读法把它们读成「从未同步」。参数类型收窄为 `CollectionPlatform`：entity 的 `platform` 列是 `$type<CollectionPlatform>()`，全部调用方传的本就是平台字面量；自 docs/32 Step 9 起它不再有 lib 包装，调用方全在 app 侧：`useCollectionLibrary`（五个平铺收藏页，按 config 的 `platform` 调它）、B站 `sections/bilibili/use-bili-fav-folders.ts`（页面 caption）、x 的 `xAutoSyncPolicy.probeReady`（`sections/x/x-sync-adapter.ts`，冷却判定））。docs/32 Step 9 起还持有四个**查询片段 builder**（平台参数一律 `string`，同 `IngestInput.platform`，好让新平台的 lib 层先于判别符建成并测绿）：`searchCondition(search, targets)`（trim + `escapeLike` + `%…%`，对每个 target `ilike` 再 OR；空白 = `undefined`；target 是列或 `` sql`${items.platformMeta}->>'key'` ``）、`sourceMembership(platform, platformSourceId)`（`item_sources` EXISTS 子查询，空 id = `undefined`；模板里的换行与缩进是 SQL 文本的一部分，与被替换的三处逐字节相同，重排缩进不改语义但会让 SQL 比对报差异）、`sourceItemCounts(db, platform)`（每 Source 条目计数，计数降序再按标题，返回 `{ platformSourceId, title, count }`，调用方各自映射 facet 键）、`platformItemIds(db: Pick<FavbaseDb, 'select'>, platform)`（已存 `platformItemId` 集合；`ingestCollection` 传事务 `tx`）。可选筛选返回 `undefined`，调用方无条件 push，`and()` 丢掉它、其余参数编号不变——**push 顺序决定参数编号**。消费方：五个平台 sync-service（github / x / zhihu / youtube / bookmarks）、聚合页 `lib/collections/collections-query.ts`（搜索）、`lib/ingest/ingest.ts`（preExisting 差集）。各平台 getX 只声明 filter 条件 + orderBy + mapRow + 可搜字段（docs/15 MEDIUM-3）
- `platform-sync-record.ts` — **Platform Sync Record** 的全部读写（docs/32 §5.1，术语见 `CONTEXT.md`）：`getPlatformSyncRecord(platform, db)`（读，`db` 在后，同 `getPlatformLastSyncedAt`）+ `recordPlatformSyncAttempt(db, platform, at)`（upsert：盖 `last_attempt_at`、`last_result` 置 NULL，不碰成功时间与计数）/ `recordPlatformSyncSuccess(db, platform, {at, fetched, inserted})` / `recordPlatformSyncFailure(db, platform)`（写，`db` 在前，同 `lib/ingest` 的写 operation；成功/失败是对 attempt 开出的那一行的 UPDATE）。与 `collection-queries.ts` 同档：显式吃 `db`、只 import entity leaf + drizzle，不调 `getDb()`、不值导入 barrel，offscreen 安全。唯一写入方是 app 侧 funnel `entrypoints/app/hooks/platform-sync.ts`；单测 `platform-sync-record.test.ts`（内存 PGlite + 真迁移）

## 约定

- PGlite 数据库: Offscreen Document 是唯一持有者（单连接模型），持久化到 IndexedDB（`idb://favbase`），`relaxedDurability=false`，RPC 成功不得早于 strict filesystem flush。扩展：pgvector（`@electric-sql/pglite-pgvector`）、uuid-ossp、pg_trgm（内置 contrib）。`initDbMain()` 在 Offscreen 启动时调用：先同步注册 `DatabaseRpcHandler.startListening()`（`onConnect` listener 立即可用），再异步创建 PGlite + 跑迁移，完成后 `setPGlite()` 解除排队请求。这避免了调用方 connect 时 listener 未注册的时序竞态。app.html 通过 3-hop PortBridge 中继访问 DB：`initDbProxy()` → `chrome.runtime.connect('favbase-db')` → Background SW PortBridge → Offscreen RPC Handler。Handler 用显式 transaction identity 在所有 proxy 间拥有事务；owning port 断开时 server-side rollback 后释放队列。Drizzle query builder 在调用端本地构建 SQL，仅执行通过 RPC 代理
