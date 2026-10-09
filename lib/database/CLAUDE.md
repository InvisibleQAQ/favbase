# PGlite + Drizzle 数据库层

Offscreen Document 持有唯一的 PGlite；app.html 经 3-hop Port 中继（app.html → Background SW PortBridge → Offscreen RPC handler）使用 Drizzle。SQL 在调用端本地构建，只有执行走 RPC。

## 约束

- Offscreen 是 PGlite 的唯一持有者（单连接模型）。`relaxedDurability` 必须为 `false`：RPC 成功不得早于 strict filesystem flush，别为了性能放宽。
- `initDbMain()` 先同步 `startListening()`、再异步建库跑迁移、最后 `setPGlite()` 放行排队请求。顺序反了，调用方 connect 时 listener 还没注册。
- Background SW 禁止 value-import `db.ts` / `proxy-db.ts` / `index.ts`：完整 PGlite 会进 `background.js`。SW 只用 `read-proxy-db.ts`。
- SW 可达的 lib 模块取 schema 走 `@/lib/database/schema`、取 `getDb` 走 `db-state`，对 barrel 只许 `import type`。守卫：`tests/agent-bridge-background-bundle-contract.test.ts`、`scripts/check-background-bundle.mjs`。
- `read-proxy-db.ts`（`drizzle-orm/pg-proxy`）只读、不支持事务，禁止给 app 写路径用。它刻意保留 PGlite 的 `db.execute().rows` 形状（pg-proxy 默认会解包），因为共享的 Chat 检索读 `.rows`。
- 初始化状态只在 `db-state.ts` 持有，main / proxy 两端不得各存一份。
- `schema.ts` / `types.ts` 保持零 PGlite 运行时依赖，任何 context 都能安全 import。
- 共享 helper（`collection-queries.ts`、`platform-sync-record.ts`、`sql-utils.ts`）显式吃 `db`，只 import entity leaf 与 drizzle，不调 `getDb()`、不 value-import barrel。
- 跨 app context 的事务隔离只在 Offscreen handler 成立，调用端的 mutex 不算。规则见 `bridges/CLAUDE.md`。
- 批量 INSERT 用 `sql-utils.ts` 的 `chunk()` 分批：Postgres 一条语句的 bind-param 上限是 65535。
- `escapeLike` 是 ILIKE 注入的唯一防线，只保留这一份。收藏页搜索一律经 `collection-queries.ts` 的 `searchCondition`，不要各自拼 `ilike`。
- `collection-queries.ts` 的查询片段 builder 平台参数刻意是 `string` 而不是 `CollectionPlatform`：新平台的 lib 层要能先于判别符翻转建成并测绿。
- 可选筛选片段在无筛选时返回 `undefined`，调用方无条件 push，由 `and()` 丢掉。
- `pagedItemsQuery` LEFT JOIN `item_contents` 只为带出 `subtitleSource`（`item_id` 是主键，不乘行；count 查询不 join）。`PagedItemRow.subtitleSource` 三值：`undefined` = 这一行不是经分页查询来的（tagged card 从 tagging 行重建，没有这列），`null` = 正文不是转录或还没有正文，否则是转录方法。卡片画 CC / ASR 角标只认后者，别把 `undefined` 当「没有字幕」。
- 「上次同步」读 Platform Sync Record 的 `last_success_at`，不是 `max(sources.lastFetchedAt)`：失败与空库同步从不写 source 行，旧读法会把它们读成「从未同步」。
- Platform Sync Record 的读写只在 `platform-sync-record.ts`，唯一写入方是 app 侧 funnel `entrypoints/app/hooks/platform-sync.ts`。它是设备本地状态，见 `entities/CLAUDE.md`。

## 测试

- DB 测试用内存 `PGlite.create`（带 `vector` / `uuid_ossp` / `pg_trgm` 三个扩展）加真实 `runMigrations`，不 mock proxy。样板：`platform-sync-record.test.ts`。

## 指针

- RPC 协议、事务 owner、deadline：`bridges/CLAUDE.md`。
- 新增表的步骤、表上从列定义看不出来的语义：`entities/CLAUDE.md`。迁移与约束具名规则：`migrations/CLAUDE.md`。
- pgvector 相似度检索、embedding 列维度切换、HNSW 维度上限：`lib/embedding/CLAUDE.md`。
- insert-only 收录事务与正文写入不变量：`lib/ingest/CLAUDE.md`。
- SW 侧 Port 中继（必须在 module load time 同步初始化）：`lib/background/CLAUDE.md`。Offscreen 生命周期：`lib/offscreen/CLAUDE.md`。
