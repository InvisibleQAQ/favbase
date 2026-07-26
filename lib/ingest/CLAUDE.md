# lib/ingest

共享收藏收录 Module（docs/16 HIGH-1）：6 个平台 Adapter（github/bookmarks/x/zhihu/youtube/bilibili）共用唯一的 collection metadata 持久化实现。平台只声明归一化行 + 自己的 content chunker；schema 知识与不变量由本 Module 持有。Bilibili 的延迟转录不塞进 collection 模式，而是复用同一 Module 的 existing-item content operation。

## 模块结构

- `ingest.ts` — `ingestCollection(db, input) → IngestResult`。输入 `IngestInput`：`platform` + 归一化行数组 `sources`（`{platformSourceId, title, platformMeta?}`——meta 缺省 `{}`）/ `authors`（`{platformAuthorId, name, avatarUrl}`）/ `items`（`{platformItemId, platformAuthorId, title, authorName, originalUrl, publishedAt, contentState('pending'|'no_content'|'chunked'), platformMeta}`）/ `links`（`{platformItemId, platformSourceId}`）+ 可选 `content: { textOf(platformItemId), chunk(plainText) }`。输出：`inserted`（本轮新插入的 `{platformItemId, itemId}`）、`contentPersisted`（本轮实际写入 content+chunks 的 platformItemId——(新插入 ∪ 自愈幽灵) ∩ chunk 行落库成功，即 content-persisted seam）、`healedItemIds`（`contentPersisted` 中的自愈子集）、`droppedItemIds`、`droppedLinkItemIds`、`linkCount`。同文件还导出两个明确 operation：`persistItemContent(db,itemId,text,chunkText) → boolean`（**返回值 = chunk 行是否真的写入**——`true` 才许可宣告 `'chunked'`，chunker 产出 0 chunk 返回 false，保证自愈收敛）；`persistExistingItemContent(db,platform,platformItemId,text,preparedChunks) → 'chunked'|null` 供延迟内容 Adapter 使用，内部拥有 item lookup、`item_contents` upsert、prepared chunk replacement 与最终 `content_state='chunked'`。正文 upsert 与回退到 `has_content` 在短事务内完成，chunk replacement 失败时错误向上抛且状态保持 `has_content`，禁止留下“新正文 + 旧向量”仍标 `embedded`；missing/blank/no-chunks 均零写入返回 null

## 幽灵消除（2026-07 修复，铁律）

- **`'chunked'` 只能由 chunk 行写入成功产生**：平台声明 `contentState:'chunked'` 的 item 在事务内以 `'has_content'` 中间态入库，phase 5（事务外）逐条写完 content+chunks 后才置 `'chunked'`；写入失败/中断停在 `'has_content'`，空文本收敛到 `'no_content'`。镜像 bookmarks `saveBookmarkContent` 的安全顺序。修复前的顺序（事务内预宣告 chunked + 事务外慢写）在页面关闭/dev 重载时批量产出「chunked 零 chunk 行」幽灵——embed 批处理静默跳过、设置页重建被 `EXISTS` 过滤，全库零向量的根因
- **同步自愈（ghost sweep）**：`content` 存在时 phase 5 兼扫平台幽灵（`contentState IN ('chunked','has_content')` 且零 chunk 行、非本轮新插入）。文本来源顺序：本轮 `textOf` → 已存 `item_contents.plainText` → 都没有则诚实回退 `'no_content'`。治愈的 id 并入 `contentPersisted`/`healedItemIds`，顺现有链路进 embed/tag lane，无需一次性迁移。github 侧配套 `getReposNeedingReadme`（幽灵仓库补拉 README，「无回填」ADR 的 bug 修复例外，见 `lib/github/CLAUDE.md`）。**bilibili 不受影响**：其同步不传 `content`，sweep 不运行（字幕 chunker 带时间戳，不能用 charSplit 重切）

## 管线持有的不变量

- **事务边界**：sources/authors/items/links 单事务 insert-only；`sources` upsert 是 ADR 唯一例外（title/platformMeta/lastFetchedAt 刷新，重命名经此流入），items 为空也执行（UI 区分「从未同步」与「同步过但为空」）
- **Insert-only**（`.trellis/spec/frontend/database-bridge.md`）：authors/items/item_sources `onConflictDoNothing`，first-write-wins；items/links 管线内按 first-seen 去重（items 按 platformItemId，links 按 (item, source) 对）
- **分批**：所有 INSERT 走 `chunk(500)`（bind-param < PG 65535）
- **id-map re-select 按 platform 全量**：覆盖本轮之前已存在的行——已知 item 新加入另一 source 仍会得到 link（youtube 全量重拉依赖此语义）
- **preExisting 差集**：content 对本轮新插入 item 写 + 幽灵自愈（见上方「幽灵消除」，健康的 preExisting 仍绝不重写）
- **两段式 content 写入**：item_contents upsert + `replaceItemChunks` 在事务**外**逐条执行（`replaceItemChunks` 自开事务，单连接 proxy 嵌套死锁）；声明 `'chunked'` 的 item 事务内先落 `'has_content'`，chunk 行写成后才逐条置 `'chunked'`（空文本 → `'no_content'`）；embedding 不 inline（D3——管线保持零 storage/AI 依赖；同步后由 app.html 侧派发共享 embed lane 排空平台积压，设置页「重建向量」为手动兜底）
- **Existing-item replacement**：以 `(platform, platformItemId)` 寻址；prepared chunks 允许 Bilibili 保留 start/end 时间戳；重转录覆盖 plain text、事务重建 chunks，并把 `embedded` 等旧状态回退到 durable `chunked` seam。该 operation 不启动 Embedding/Tagging/Processing Queue
- **Offscreen 安全**：零 `@/lib/storage` 触达，`replaceItemChunks` 从 `@/lib/embedding/vector-store` leaf 导入（barrel 有 chrome.storage 模块加载副作用；x 同步跑在无 chrome.storage 的 offscreen）

## 约定

- 平台差异留在调用方：入库前的去重/归一化（如 zhihu turndown、youtube 首见列表归属）、结果统计形状（各平台 `Sync*Result`）、空输入早退（bookmarks 空树零写入、zhihu 空收藏夹零写入）、author 过滤（x/youtube 剔除空 id）
- 消费方：6 个平台 Adapter 的 `sync*ToDb`；Bilibili folders/videos 也只传归一化 metadata，转录另走 existing-item operation；各自的 in-memory PGlite 守护测试验证等价性
- MEDIUM-2 已接线（以数据形式，管线自身零 tagging/embedding/storage 依赖）：content 步骤把实际持久化的 id（新插入 ∪ 自愈）收进 `contentPersisted`，各平台 sync-service 经 `Sync*Result.newItemIds` 透出，触发点在 app.html 侧调用方（zhihu/youtube 的生产入口 wrapper、x 的 `use-x-bookmarks` syncFn、github 的 `use-github-stars` syncFn）`startCollectionProcessingJobs`——tag lane 吃这批 ids（`tagNewItems`），embed lane 无视 ids、恒排空平台 `'chunked'` 积压（`embedPlatformBacklog`，见 `entrypoints/app/hooks/CLAUDE.md`）。x 已单一入口 app.html（07-20 删除 x.com 浮层按钮），旧「浮层 offscreen 路径不打标/不 embed」的欠账随之消失——恒打标恒 embed，见 `lib/x/CLAUDE.md`
