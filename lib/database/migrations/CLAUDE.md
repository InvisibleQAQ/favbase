# Database Migrations

自定义迁移系统（不是 drizzle-kit）：`_migrations` 表追踪版本，脚本直接写 SQL，`runMigrations(pg)` 在 `initDbMain()` 内自动执行。

## 约束

- 新增迁移：加 `vNNN-*.ts`，并在 `index.ts` 的 `migrations` 数组末尾追加条目。
- 每个迁移必须幂等（`IF NOT EXISTS`）。触发器用 `DROP TRIGGER IF EXISTS` 加 `CREATE TRIGGER`，因为 PG 没有 `CREATE TRIGGER IF NOT EXISTS`。
- revert 代码撤不掉已执行的迁移。现有迁移都只做加法（新表、可空且无默认值的新列），所以留下的空表空列无害；新迁移尽量照此写。
- 当前立场（随上线而变，不是定律）：扩展尚未上线，库里只有测试数据，所以迁移一般不回填、也没有数据修复迁移，旧行留 NULL。要写回填、或扩展上线之后，先问用户。
- 唯一的例外是 v008，它回填 `item_chunk_terms`（用户 2026-10-13 批准）。它在 RPC handler 放行之前跑完，所以升级后 Offscreen 第一次启动会把所有 DB 请求挡住一次。
- 迁移连同开库必须在 30 s 内跑完：调用端的 `health` RPC 超时就是这么长（`../bridges/proxy-driver.ts`），超时后该 context 的 `initDbProxy` 会一直保持失败，直到页面重载或 SW 重启。`idb://` 上每条语句都触发一次 IndexedDB 同步，所以回填要大批量：20k chunk 在 Chrome 实测 2000 一批 6.9 s、500 一批 11.9 s。
- v008 用 JS 分词（`../text-search.ts` 的 `segmentWords`）。以后改分词，或者 ICU 词典漂移，都不会让 v008 重跑：要重切旧行，就得写一个新迁移。
- 平台 id 列不加 CHECK：接新平台不许要迁移。
- 迁移不管 embedding 列的维度：v001 的 `vector(1536)` 只是初始值，运行时由 `lib/embedding/vector-store.ts` 按当前模型 ALTER，v002 的 HNSW 索引随 ALTER 自动重建。迁移脚本里不要读取或写死维度。
- 向量索引用 HNSW 不用 IVFFlat：IVFFlat 要先有数据才能建 centroid。opclass 是 `vector_cosine_ops`，对应检索用的 `<=>`。

## 约束具名

- CHECK 约束一律在迁移 SQL 里写成 `CONSTRAINT <name>`，名字与 entity 的 `check()` 相同。
- 原因：行内匿名写法由 PG 自动命名为 `<table>_<column>_check`。之后按 entity 的名字写的 `DROP CONSTRAINT IF EXISTS <name>` 会静默跳过，旧约束照样生效。
- 后果：将来放宽取值的迁移看起来跑通了，新取值却仍被旧约束拒绝。
- 守卫写法：写入非法值，并断言报错里的约束名。样板：`lib/ingest/ingest.test.ts` 的 `/chk_subtitle_source/`。
- 已知残留：v001 的 `items.content_state` 是行内匿名写法，库里叫 `items_content_state_check`，entity 写的是 `chk_content_state`。改它之前先按库里的真名 DROP。

## 坑

- `ADD COLUMN IF NOT EXISTS … CONSTRAINT …`：列已存在时，约束随整条语句一起跳过。重跑不会重复建约束，但也不能靠重跑给已有的列补约束。

守卫：`../platform-sync-record.test.ts`（迁移连跑两次，约束仍只有一个）。
