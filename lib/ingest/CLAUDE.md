# lib/ingest

共享收藏收录管线（docs/16 HIGH-1）：5 个平台 sync-service（github/bookmarks/x/zhihu/youtube）曾各自拷贝的五阶段 insert-only 事务骨架（~165 行 ×5）收敛到唯一实现。平台只声明归一化行 + 自己的 content chunker；schema 知识与不变量由管线持有。bilibili 形态不同（转录管线驱动，非批量收录），不进本抽象（docs/15 已圈定）。

## 模块结构

- `ingest.ts` — `ingestCollection(db, input) → IngestResult`。输入 `IngestInput`：`platform` + 归一化行数组 `sources`（`{platformSourceId, title, platformMeta?}`——meta 缺省 `{}`）/ `authors`（`{platformAuthorId, name, avatarUrl}`）/ `items`（`{platformItemId, platformAuthorId, title, authorName, originalUrl, publishedAt, contentState('pending'|'no_content'|'chunked'), platformMeta}`）/ `links`（`{platformItemId, platformSourceId}`）+ 可选 `content: { textOf(platformItemId), chunk(plainText) }`。输出：`inserted`（本轮新插入的 `{platformItemId, itemId}`，content 只对这些持久化）、`contentPersisted`（本轮实际写入 content+chunks 的 platformItemId——新插入 ∩ 非空文本，即 content-persisted seam，调用方喂给自动打标；无 `content` 输入时恒空）、`droppedItemIds`（author 无法解析）、`droppedLinkItemIds`（link 两端解析失败，排除 author-drop 成因）、`linkCount`（去重后写入的 link 行数）

## 管线持有的不变量

- **事务边界**：sources/authors/items/links 单事务 insert-only；`sources` upsert 是 ADR 唯一例外（title/platformMeta/lastFetchedAt 刷新，重命名经此流入），items 为空也执行（UI 区分「从未同步」与「同步过但为空」）
- **Insert-only**（`.trellis/spec/frontend/database-bridge.md`）：authors/items/item_sources `onConflictDoNothing`，first-write-wins；items/links 管线内按 first-seen 去重（items 按 platformItemId，links 按 (item, source) 对）
- **分批**：所有 INSERT 走 `chunk(500)`（bind-param < PG 65535）
- **id-map re-select 按 platform 全量**：覆盖本轮之前已存在的行——已知 item 新加入另一 source 仍会得到 link（youtube 全量重拉依赖此语义）
- **preExisting 差集**：content 只对本轮新插入 item 写
- **两段式 content 写入**：item_contents upsert + `replaceItemChunks` 在事务**外**逐条执行（`replaceItemChunks` 自开事务，单连接 proxy 嵌套死锁）；空/纯空白文本跳过；embedding 不 inline（D3——管线保持零 storage/AI 依赖；同步后由 app.html 侧调用方 `void embedNewItems` 自动补齐新条目，设置页「重建向量」为积压兜底）
- **Offscreen 安全**：零 `@/lib/storage` 触达，`replaceItemChunks` 从 `@/lib/embedding/vector-store` leaf 导入（barrel 有 chrome.storage 模块加载副作用；x 同步跑在无 chrome.storage 的 offscreen）

## 约定

- 平台差异留在调用方：入库前的去重/归一化（如 zhihu turndown、youtube 首见列表归属）、结果统计形状（各平台 `Sync*Result`）、空输入早退（bookmarks 空树零写入、zhihu 空收藏夹零写入）、author 过滤（x/youtube 剔除空 id）
- 消费方：5 个平台 sync-service 的 `sync*ToDb`；各自的 in-memory PGlite 守护测试即本管线的等价性验证
- MEDIUM-2 已接线（以数据形式，管线自身零 tagging/embedding/storage 依赖）：content 步骤把实际持久化的 id 收进 `contentPersisted`，各平台 sync-service 经 `Sync*Result.newItemIds` 透出，触发点在 app.html 侧调用方（zhihu/youtube 的生产入口 wrapper、x 的 `use-x-bookmarks` syncFn、github 的 `use-github-stars` syncFn）`void tagNewItems(platform, ids)`（`lib/tagging`）+ `void embedNewItems(platform, ids)`（`lib/embedding`，自动向量化新条目）。x 的 offscreen 浮层路径不打标也不 embed（欠账显式记录，见 `lib/x/CLAUDE.md`）
