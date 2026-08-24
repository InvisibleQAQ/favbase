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
- `sql-utils.ts` — 平台无关纯函数（零导入零副作用，offscreen 安全）：`chunk<T>(arr, size)`（INSERT 分批，bind-param < 65535，主要消费方 `lib/ingest/ingest.ts`）、`escapeLike(input)`（LIKE/ILIKE 元字符转义，ILIKE 注入唯一防线，各平台 sync-service 查询共用）。勿再各自拷贝（docs/15 MEDIUM-3）
- `collection-queries.ts` — 收藏页共享读骨架：`pagedItemsQuery(db, {conditions, orderBy, page, pageSize, mapRow})`（固定 7 列 select + 并行 `count(*)` + 分页 + 行映射，返回 `{rows, total}`）、`getPlatformLastSyncedAt(platform, db)`（`max(lastFetchedAt)` over sources，统一单源/多源两种旧写法）。各平台 getX 只声明 filter 条件 + orderBy + mapRow（docs/15 MEDIUM-3）

## 约定

- PGlite 数据库: Offscreen Document 是唯一持有者（单连接模型），持久化到 IndexedDB（`idb://favbase`），`relaxedDurability=false`，RPC 成功不得早于 strict filesystem flush。扩展：pgvector（`@electric-sql/pglite-pgvector`）、uuid-ossp、pg_trgm（内置 contrib）。`initDbMain()` 在 Offscreen 启动时调用：先同步注册 `DatabaseRpcHandler.startListening()`（`onConnect` listener 立即可用），再异步创建 PGlite + 跑迁移，完成后 `setPGlite()` 解除排队请求。这避免了调用方 connect 时 listener 未注册的时序竞态。app.html 通过 3-hop PortBridge 中继访问 DB：`initDbProxy()` → `chrome.runtime.connect('favbase-db')` → Background SW PortBridge → Offscreen RPC Handler。Handler 用显式 transaction identity 在所有 proxy 间拥有事务；owning port 断开时 server-side rollback 后释放队列。Drizzle query builder 在调用端本地构建 SQL，仅执行通过 RPC 代理
