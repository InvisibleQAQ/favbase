# Cross-platform Collections Query

跨平台收藏只读领域层。消费规范化收藏表，向 app.html 提供分页条目与完整 Collection Analytics 快照；UI 不接触 Drizzle schema，也不解释 `platform_meta`。

## 模块结构

- `platforms.ts` — `COLLECTION_PLATFORMS` / `CollectionPlatform` / `isCollectionPlatform`，持久化平台判别符的唯一白名单
- `collections-query.ts` — `getCollectionItems`：限定平台注册项，标题/作者 ILIKE 搜索，全局分页；排序按平台现有时间语义（Bilibili `fav_time`、GitHub `starredAt`、YouTube `addedAt`，其余 `publishedAt`），无日期条目置后并以 `createdAt`/id 稳定排序；分页后批量加载 tags
- `collection-analytics.ts` — `getCollectionAnalytics`：一次返回去重 Item Count、Used Tags、Tagged Items、六平台构成、Top Tags 和平台原生维度；补齐零平台、稳定排序并限制榜单长度
- `collection-processing-policy.ts` — Collection processing stage SQL facts 的唯一 Implementation：可选 platform scope、Bilibili `attr=9` exclusion、Content/Embedding/Tags 的 `total`/`done` 与 pending candidate；Coverage 和各 worker Adapter 不重写资格规则。
- `processing-coverage.ts` — `getProcessingCoverage(platform, db?)`：单次平台聚合返回 acquisition/content/embedding/tagging 的 Item 级覆盖率，只消费 processing policy，React 不接触 schema/SQL。
- `cooperative-checkpoint.ts` — 领域 worker 只依赖的最小暂停协议 `{ checkpoint(): Promise<void> }`；app runtime 持有状态机，lib 不反向依赖 React/store。
- `collection-analytics.test.ts` — in-memory PGlite 守护六平台维度、membership 与 item 计数差异、未知平台排除、标签口径和排名稳定性
- `collections-query.test.ts` — in-memory PGlite 守护混合排序、平台过滤、搜索转义、分页和标签水合
- `index.ts` — 公共导出面

## 约定

- 新平台必须先加入 `COLLECTION_PLATFORMS`，再补 app 侧元数据与卡片 adapter；未知 platform 不进入聚合结果
- 时间字段只在本 module 解释，禁止在 React 中抓多平台页面后客户端 merge/sort（会破坏全局分页）
- 查询参数始终绑定，LIKE 输入必须经 `escapeLike`；UI 通过 `getCollectionItems` 读取，零 entity/getDb 导入
- `CollectionItemsQuery.tagId` 是可选单标签 SQL 条件，必须在 count/order/limit/offset 前过滤；不得改用无分页的 `getItemsByTags`
- analytics 来源榜单按 `item_sources` membership 计数，总量/平台构成按 `items` 计数；Top Tags 按 distinct item-tag link，Used Tags 排除孤立标签
- Processing Coverage 只描述已持久化且符合阶段资格的 Collection Items，不代表远端同步完整度；Embedding=`embedded/(chunked+embedded)`，Tagging=至少一个 tag/(chunked+embedded)。Coverage 的 state-based total 不等于 worker candidate：Embedding candidate 还必须有 durable chunks，Tags candidate 不要求 chunks。
- cooperative pause 只能放在“领取下一项/下一页”边界；当前网络请求、provider 调用和 DB 写入必须先完整收尾，禁止把它伪装成取消。
