# Cross-platform Collections Query

跨平台收藏只读领域层。消费规范化收藏表，向 app.html 提供分页条目与完整 Collection Analytics 快照；UI 不接触 Drizzle schema，也不解释 `platform_meta`。

## 模块结构

- `platforms.ts` — `COLLECTION_PLATFORMS` / `CollectionPlatform` / `isCollectionPlatform`，持久化平台判别符的唯一白名单
- `platform-descriptor.ts` — **Platform Descriptor 的领域半边**（docs/26 Step 2）：`PLATFORM_DESCRIPTORS` 穷举五字段（`jobPlatform` / `readiness` / `hostPermissions` / `sortKey` / `dimensions`），`PlatformReadiness`、`PlatformSortKey`、`PlatformDimensions` 三个类型也住这里；`mapPlatforms(source, project)` 是全部派生注册表共用的唯一投影 helper（也吃 app 侧 `PLATFORM_META`）。`dimensions` 一个字段吃掉原来的三张表，`source: null` 显式表示该平台无 Source。**两条铁律**：① 值导入只允许 `./platforms`（`wxt.config.ts` 在 Node 侧按相对路径加载本文件建 `host_permissions`，其余一律 `import type`）；② **不得进 `index.ts` barrel**（barrel 经 `collections-query` 拖 drizzle + `@/lib/database`）。UI 半边（`title`/`icon`/`palette`/`hint`/`childRoutes`）在 `entrypoints/app/collection-platform-registry.ts`，因为它的类型是 app 侧的，而 `lib/` 不得依赖 `entrypoints/`
- `platform-sort-keys.ts` — `PLATFORM_SORT_KEYS` 由 descriptor 的 `sortKey` 派生 + re-export `PlatformSortKey` 类型；导出名与类型不变，`collections-query` 与 barrel 零改动
- `collections-query.ts` — `getCollectionItems`：限定平台注册项，标题/作者 ILIKE 搜索，全局分页；按 `COLLECTION_PLATFORMS` 遍历 `PLATFORM_SORT_KEYS` 生成绑定参数的排序 `CASE`（无日期条目置后并以 `createdAt`/id 稳定排序）；分页后批量加载 tags
- `analytics-types.ts` — `CollectionAnalyticsDimensionKind` 的定义处（纯类型，零 import）。拆出来是为了让消费者能命名维度而不拖 `collection-analytics.ts` 的 drizzle + `getDb` + 六张表；`collection-analytics.ts` re-export 它，`@/lib/collections` barrel 与全部现有消费者路径不变
- `collection-analytics.ts` — `getCollectionAnalytics`：一次返回去重 Item Count、Used Tags、Tagged Items、六平台构成、Top Tags 和平台原生维度；补齐零平台、稳定排序并限制榜单长度。维度直接读 `PLATFORM_DESCRIPTORS[p].dimensions`（`ranked`/`author`/`source`），本文件不再持有维度表
- `platform-eligibility.ts` — `PLATFORM_DOWNSTREAM_ELIGIBILITY: Record<CollectionPlatform, SQL | null>`，穷举登记每个平台的 downstream eligibility predicate（`null` = 无专属排除；bilibili 取 `lib/bilibili/video-eligibility.ts` 的 `bilibiliDownstreamEligibleSql()`）。规则归平台 owner，本表只登记，契约测试按 AST 对账六平台显式键
- `collection-processing-policy.ts` — Collection processing stage SQL facts 的唯一 Implementation：可选 platform scope、按 registry 注入的 per-platform downstream eligibility（scoped 取该平台 predicate，未知平台字符串仍 eligible；unscoped 把每条 predicate 放宽为 `platform <> X OR eligible(X)` 后合取）、Content/Embedding/Tags 的 `total`/`done` 与 pending candidate。第三参数默认 `PLATFORM_DOWNSTREAM_ELIGIBILITY`，调用方零改动、不可能忘注入；源码不含任何平台字面量/`platformMeta`（契约守卫）。Coverage 和各 worker Adapter 不重写资格规则。
- `processing-coverage.ts` — `getProcessingCoverage(platform, db?)`：单次平台聚合返回 acquisition/content/embedding/tagging 的 Item 级覆盖率，只消费 processing policy，React 不接触 schema/SQL。
- `cooperative-checkpoint.ts` — 领域 worker 只依赖的最小暂停协议 `{ checkpoint(): Promise<void> }`；app runtime 持有状态机，lib 不反向依赖 React/store。
- `platform-descriptor.test.ts` — descriptor 形状：六平台顺序、每平台至少一个 origin、`jobPlatform` 唯一（同名会让两平台共用一条 job lane），以及 **`hostPermissions` flatMap 的黄金顺序**（manifest 契约：已装 MV3 扩展的 `host_permissions` 一变就要用户重新授权）
- `collection-analytics.test.ts` — in-memory PGlite 守护六平台维度、membership 与 item 计数差异、未知平台排除、标签口径和排名稳定性
- `collections-query.test.ts` — in-memory PGlite 守护混合排序、平台过滤、搜索转义、分页和标签水合
- `index.ts` — 公共导出面

## 约定

- 新平台必须先加入 `COLLECTION_PLATFORMS`，再补 app 侧元数据与卡片 adapter；未知 platform 不进入聚合结果
- 新平台必须在 `PLATFORM_DESCRIPTORS` 声明五个领域字段（排序键、host permissions、维度都在其中）；删掉任一平台键由 `satisfies Record<CollectionPlatform, PlatformDescriptor>` 在对象字面量上报错并指名平台。派生表（`PLATFORM_SORT_KEYS` 等）不再手写
- descriptor 的 `dimensions.author` / `dimensions.source` 必须是 `dimensions.ranked` 的成员或 `null`（契约测试守），否则 Dashboard 细分卡会静默留空
- 新平台必须在 `PLATFORM_DOWNSTREAM_ELIGIBILITY` 显式声明（无排除写 `null`）；平台专属排除的 SQL 必须定义在 `lib/<platform>/` 并与内存判定同 owner，禁止把平台 JSONB 字段或业务数值写进 `collection-processing-policy.ts`
- 时间字段只在本 module 解释，禁止在 React 中抓多平台页面后客户端 merge/sort（会破坏全局分页）
- `collections-query.ts` 的排序 SQL 必须从声明表生成；平台判别符、JSON 字段名、格式正则都使用绑定参数，不得把平台/字段字面量拼进 SQL
- 查询参数始终绑定，LIKE 输入必须经 `escapeLike`；UI 通过 `getCollectionItems` 读取，零 entity/getDb 导入
- `CollectionItemsQuery.tagId` 是可选单标签 SQL 条件，必须在 count/order/limit/offset 前过滤；不得改用无分页的 `getItemsByTags`
- analytics 来源榜单按 `item_sources` membership 计数，总量/平台构成按 `items` 计数；Top Tags 按 distinct item-tag link，Used Tags 排除孤立标签
- Processing Coverage 只描述已持久化且符合阶段资格的 Collection Items，不代表远端同步完整度；Embedding=`embedded/(chunked+embedded)`，Tagging=至少一个 tag/(chunked+embedded)。Coverage 的 state-based total 不等于 worker candidate：Embedding candidate 还必须有 durable chunks，Tags candidate 不要求 chunks。
- cooperative pause 只能放在“领取下一项/下一页”边界；当前网络请求、provider 调用和 DB 写入必须先完整收尾，禁止把它伪装成取消。
