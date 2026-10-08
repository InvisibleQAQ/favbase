# lib/collections

跨平台收藏只读领域层（分页查询、Collection Analytics、Processing Coverage），兼平台判别符与注册表之家。UI 经这里读数据，不接触 Drizzle schema，也不解释 `platform_meta`。

## 平台注册表

- `COLLECTION_PLATFORMS`（`platforms.ts`）是持久化平台判别符的唯一白名单，未知 platform 不进入任何聚合结果。新平台先加它，`tsc` 与契约测试再点名其余缺口（流程见 `.trellis/spec/frontend/platform-onboarding.md`）。
- 平台事实分两份 descriptor，别合并（`docs/adr/0004`）：领域半边在 `platform-descriptor.ts`，UI 半边在 `entrypoints/app/collection-platform-registry.ts`——后者的类型是 app 侧的，而 `lib/` 不得依赖 `entrypoints/`。
- **`platform-descriptor.ts` 的值导入只允许 `./platforms`**，其余一律 `import type`：`wxt.config.ts` 在 Node 侧按相对路径加载它来拼 `host_permissions`。守卫 `platform-descriptor.test.ts`。
- **`index.ts` barrel 不得 re-export `platform-descriptor.ts` 的符号**：barrel 另一头是 `collections-query`（drizzle + `@/lib/database`），descriptor 一从 barrel 出口，welcome.html 与 Node 构建配置就得加载 PGlite 才读得到它。
- 上一条管的是 barrel 的出口面，不是 descriptor 的消费者：barrel 内的模块照常 import 它。出口面没有自动守卫——`tests/lib-import-smoke.test.ts` 只证 descriptor 自身加载干净。
- 派生表（如 `PLATFORM_SORT_KEYS`）一律经 `mapPlatforms` 从 descriptor 投影，不手写第二张平台表。
- `hostPermissions` 的 flatMap 顺序是 manifest 契约：已装 MV3 扩展的 `host_permissions` 一变就要用户重新授权。黄金顺序锁在 `platform-descriptor.test.ts`。
- `PLATFORM_DESCRIPTORS.x.hostPermissions` 同时是 `entrypoints/background.ts` 的 X webRequest filter：改这一格同时改 manifest 与捕获范围。
- `jobPlatform` 必须唯一（同名会让两个平台共用一条 job lane）。bilibili / bookmarks / douyin 用平台 id，github / x / zhihu / youtube 是历史别名、未统一；不再给平台 id 发明第二个名字（用户决定）。
- `descriptionField` 只填「**不在** Content 里的简介」的 meta key：youtube 的 meta 有 `description`，但那是 Content 的截断片段，所以填 `null`。已接受的例外是 douyin：视频的 Content 是转录、`desc` 是简介，但图文的 Content 就是 `desc`，descriptor 仍填 `'desc'`，打标签 prompt 对图文会看到两遍——为一个平台的图文拆 descriptor 或在共享 tagging 加判断都被否决（`docs/37 §1.1` D1 副作用行）。
- `dimensions.author` / `source` / `meta.kind` 必须是 `dimensions.ranked` 的成员或 `null`，否则 Dashboard 细分卡静默留空（契约测试守）。`source: null` 显式表示该平台没有 Source。
- 新平台必须在 `PLATFORM_DOWNSTREAM_ELIGIBILITY`（`platform-eligibility.ts`）显式声明，无排除写 `null`。排除规则的 SQL 定义在 `lib/<platform>/`，与内存判定同 owner，本表只登记。

## 共享模块零平台知识

- `collection-analytics.ts`、`collection-processing-policy.ts`、`collections-query.ts`，以及 `lib/tagging/**`、`lib/embedding/**`、`lib/chat/**`、`lib/export/**`，不得出现：带引号的平台 id、对 `meta` / `platformMeta` 的字面 key 读取、SQL 文本里的字面 JSON 路径 key。
- 平台差异写进 descriptor，共享模块按变量读（`->>${field}`）；平台专属的 JSONB 字段或业务数值不得写进 `collection-processing-policy.ts`。
- 守卫：`tests/platform-completeness-contract.test.ts` 的「keeps platform knowledge out of shared modules」。
- 该守卫按名字认 meta：装 descriptor 数据的局部变量别叫 `meta`。别名（`const m = row.platformMeta; m.k`）不追踪，是已知缺口。
- `platforms.ts` / `platform-descriptor.ts` / `platform-eligibility.ts` 是注册表，写平台字面量是本职，不在扫描范围。

## 查询与 SQL

- 跨平台排序与分页只在 SQL 里做：禁止在 React 里抓多平台页面后客户端 merge / sort，那会破坏全局分页。时间字段只在本目录解释。
- 排序 `CASE` 从 `PLATFORM_SORT_KEYS` 生成；平台判别符、JSON 字段名、格式正则都走绑定参数，不把字面量拼进 SQL。
- `CollectionItemsQuery.tagId` 必须在 count / order / limit / offset 之前进 SQL；不得改用无分页的 `getItemsByTags`。
- LIKE 输入必须转义：搜索条件走 `lib/database/collection-queries.ts` 的 `searchCondition`。
- meta 维度查询里 `platform_meta->>$n` 只在子查询投影一次、外层再 `GROUP BY`：同一表达式在 SELECT / GROUP BY / ORDER BY 各写一遍会成为三个不同的绑定参数，Postgres 报「must appear in the GROUP BY clause」。
- 计数口径：来源榜单按 `item_sources` membership，总量与平台构成按 `items`；Top Tags 按 distinct item-tag link，Used Tags 排除孤立标签。

## Processing Coverage 与处理策略

- `collection-processing-policy.ts` 是各阶段资格规则（`total` / `done` / pending candidate）的唯一实现；coverage 与各 worker 只消费它，不重写。
- Coverage 只描述已持久化且符合阶段资格的条目，不代表远端同步完整度。state-based `total` 不等于 worker candidate：Embedding candidate 还要求有 chunk 行，Tags candidate 不要求。
- downstream eligibility 只能待在 `count(*) filter` 里，不得提到 `WHERE`：`acquired` 数的是 scope 内每一行，提上去会把失效的 B 站视频从「已拉取」里静默扣掉。守卫 `processing-coverage.test.ts`。
- **Background SW 图上的 import 约束**：`processing-coverage.ts` 的 `getDb` 取 `@/lib/database/db-state`、`FavbaseDb` 取 `@/lib/database/db-types`，不得走 `@/lib/database` barrel（它值导入 PGlite）。
- 同一约束沿传递闭包展开：`configuration-blockers.ts`、`collection-processing-policy.ts`、`platform-eligibility.ts` 与 `lib/bilibili/video-eligibility.ts` 里的 `@/lib/database` 必须保持 `import type`。
- 违反上两条时唯一的运行信号是构建期 `scripts/check-background-bundle.mjs` 报一条不点名文件的错。源码层守卫是 `tests/agent-bridge-background-bundle-contract.test.ts`；往这张图上加新 import 时把新边也加进去。
- `deriveConfigurationBlockers` 是「已持久化的活儿在等一个没人配的 provider」的唯一实现，Collection 页横幅与 `getProcessingCoverage` Knowledge Tool 共用——否则模型会把「永远不会动」说成「还在处理中」。Knowledge Tool 没有平台状态机上下文，`asrBlocked` 传 `false`。

## 平台错误基类与暂停协议

- `sync-errors.ts` 零 import（连 type import 都没有）、不进 barrel、按文件路径 import：`bilibili-api.ts` 把它带进 Background SW 图。
- 每个平台的 `*AuthError` / `*RateLimitError` 必须继承这里的基类，app 侧只按基类分类。守卫 `tests/platform-completeness-contract.test.ts`、`tests/lib-import-smoke.test.ts`。
- `reason: 'rejected'` 只在 favbase 请求前已确认自己持有凭据而平台拒绝时用，其余一律 `'missing'`（知乎、抖音从不在本地查登录态，恒 `'missing'`）。
- cooperative pause（`cooperative-checkpoint.ts`）只能放在「领取下一项 / 下一页」的边界：进行中的网络请求、provider 调用与 DB 写入必须完整收尾，它不是取消。lib 不反向依赖 React / store。
