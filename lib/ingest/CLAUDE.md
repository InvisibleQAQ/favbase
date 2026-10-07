# lib/ingest

共享收藏收录管线：各平台的 sync-service 只声明归一化行（sources / authors / items / links）与自己的 chunker，schema 知识与下列不变量由 `ingest.ts` 持有。写 sync service 之前把本文件读完。

## Insert-only

本文件是 insert-only 规则的记录处，各 sync-service 与测试的文件头都指向这里。

- `authors` / `items` / `item_sources` 只 insert（`onConflictDoNothing`，first-write-wins）：重新同步不 update、不 delete——取消收藏不删行，标题与 `platform_meta` 不刷新。
- 唯一例外是 `sources`：upsert 刷新 `title` / `platformMeta` / `lastFetchedAt`（收藏夹重命名经此流入），`items` 为空也执行，好让平台报出的每个 Source 都刷新。
- `sources.lastFetchedAt` 只是单个 Source 的新鲜度。「平台上次同步」读 Platform Sync Record（`lib/database/platform-sync-record.ts`）：失败与空库早退的同步根本不写 source 行。
- `platform_sync_records` 是状态行，不适用本规则，也不由本模块写（唯一写入方是 `entrypoints/app/hooks/platform-sync.ts` 的 funnel）。
- 健康的已有条目绝不重写正文；正文只为本轮新插入的条目与幽灵写。

## 幽灵消除

幽灵 = `content_state` 声称有正文（`'chunked'` / `'has_content'`）却零 chunk 行的条目：embed 批处理静默跳过它，设置页重建又被 `EXISTS(chunks)` 过滤掉。下面三条缺一不可。

- **`'chunked'` 只能在 chunk 行写成之后写入**：平台声明 `'chunked'` 的条目以 `'has_content'` 入库，事务外逐条写完 chunk 才翻状态；中断就停在 `'has_content'`。这个顺序只由模块私有的 `chunkAndSettle` 持有。
- **`'has_content'` ⇒ 正文已落盘**（docs/33 D6）：新条目的 `item_contents.plainText` 与 item 行在同一个事务里写入；正文为空的直接以 `'no_content'` 入库。
- 上一条的原因：下一次同步的 `textOf` 通常覆盖不到上次没轮到的条目（抖音逐页入库、X 遇已知 id 即停、YouTube 不再拉已入库视频的详情），正文不随行落盘它们就永久落 `'no_content'`。
- **带 `content` 的每次调用都清扫本平台幽灵**，文本来源顺序：本轮 `textOf`（归一化后非空才算）→ 已存 `plainText`（原样重切，不重写正文）→ 都没有才回退 `'no_content'`。
- 治愈的 id 并入 `contentPersisted`，顺现有链路进 embed / tag lane，所以不需要一次性迁移。
- 清扫只在带 `content` 的调用里跑：一次运行可能一页都不入库的平台，必须自己保证每次运行至少调一次（抖音放在运行开头，见 `lib/douyin/CLAUDE.md`）。
- bilibili 的同步不传 `content`，清扫不运行：字幕 chunk 带时间戳，不能用 `charSplit` 重切。
- 「写正文 + 写 chunk + 手写 `content_state`」的组合只能出现在本模块。事务之外的入口只有两个：`settleItemContent`（不透明文本）与 `persistExistingItemContent`（延迟转录）；别在平台目录里自己拼。
- `settleItemContent` 返回 `true`（chunk 行真的写入）才许可调用方派发 Embed / Tag；它自己不发领域事件、不派发 lane。

## 其他不变量

- 两段式 content 写入：正文在入库事务内，chunk 在事务外逐条写——`replaceItemChunks` 自开事务，在单连接 proxy 上嵌套会死锁。
- 同事务的代价：`textOf` 在事务里被调用，它抛错或正文 insert 失败，回滚的是这次调用的全部 source / author / item / link 行。
- 每个新条目的正文只写一次：chunk 阶段不再 upsert `item_contents`（`ingest.test.ts` 锁住）。
- `item_contents` 的 insert 批用 `CONTENT_INSERT_CHUNK_SIZE`（20），不是通用的 500：它受语句长度而不是 bind 参数数的限制——一条正文可达 100 KB，500 行就是一条 50 MB 的语句。
- `plain_text` 与 `subtitle_source` 总在同一条语句里一起写，三个写入方都如此，非转录显式写 `null`：旧的 `'asr'` / `'official'` 才不会活过它描述的正文（docs/29 Step 5）。
- 上一条里 insert `values` 的 `null` 与列默认值等价，是刻意保留的显式写法，别删。
- `persistExistingItemContent` 的 `subtitleSource` 必填、无默认值：可选参数会让漏传的调用方静默写 NULL。
- `persistExistingItemContent` 先在短事务里写正文并回退到 `'has_content'`，再换 chunk：换 chunk 失败时错误上抛、状态留在 `'has_content'`，不会出现「新正文 + 旧向量」仍标 `'embedded'`。它不启动 Embedding / Tagging。
- id-map 按 platform 全量 re-select：已入库的条目新加入另一个 Source 仍会得到 link（youtube 全量重拉依赖它）。
- 正文入库前先过 `storableText`：剔除 U+0000 再 trim，且先于任何判空。Postgres `text` 存不了 U+0000，而正文在入库事务里，一条这样的正文会让整次入库回滚（UTF-16 的 github README 是现成触发源）。
- 源码里写转义 `'\u0000'`，不写字面 NUL 字符。
- 加载图零 `@/lib/storage`、零 embedding / tagging barrel：`replaceItemChunks` 从 `@/lib/embedding/vector-store` leaf 导入，embedding 不 inline。守卫 `tests/lib-import-smoke.test.ts`。

## 已知缺口

- `persistExistingItemContent` 不过 `storableText`：chunk 是调用方备好的，只洗正文会让 chunk 行照样带 U+0000，含 U+0000 的转录照旧在这里失败。
- `title` / `platform_meta` 里的 U+0000 仍让入库事务整体失败。
- 幽灵清扫「回退 `'no_content'`」那一档，只对「正文同事务落盘」之前留下的幽灵可达。

## 指针

- 平台差异留在调用方：入库前的去重与归一化、空输入早退、author 过滤、结果统计形状。
- 同步后的 embed / tag 派发只经 `entrypoints/app/hooks/platform-sync.ts` 的 funnel，见 `entrypoints/app/hooks/CLAUDE.md`。
- `tests/ingest-test-support.ts` 的 `withChunkWritesCutShort`：注入不了 chunker 的平台用它在自己的同步入口复现「chunk 阶段中途断掉」。
- github 为幽灵仓库补拉 README（`getReposNeedingReadme`）是「不回填」的例外，见 `lib/github/CLAUDE.md`。
