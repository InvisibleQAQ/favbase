# 平台事实分成两份 Platform Descriptor，四处重值注册表原位不动

2026-09-06/07（docs/26）。接入第 N+1 个 **Collection Platform** 曾要在 13 个文件里手写 16 处注册表。其中 12 处的值是纯数据——它们不是工作量的主体（平台专属代码约 2230 行、locale 键约 80 个才是），但它们是**会被忘掉的那部分**：漏一处不会报错，只会让产品某个角落静默地不认识这个平台。本决策把这 12 处收成 **10 个字段、两份 descriptor**，并明确剩下 4 处不收。

记录在此的是**形状**决策：为什么是两份而不是一份 manifest，为什么只收 12 处。过程与范围决策（分三步提交、marquee 不派生等）留在 docs/26 §1。

## Decision

- **领域半边** `lib/collections/platform-descriptor.ts` 的 `PLATFORM_DESCRIPTORS`：`jobPlatform`、`readiness`、`hostPermissions`、`sortKey`、`dimensions`。
- **UI 半边** `entrypoints/app/collection-platform-registry.ts` 的 `PLATFORM_META`：`title`、`icon`、`palette`、`hint`、`childRoutes`。
- 两份都是穷举 `Record<CollectionPlatform, …>`：漏一个平台是**对象字面量上**的编译错误且指名平台，而不是某个消费者里的间接错误。
- 原 analytics 三张维度表合成一个 `dimensions: { ranked, author, source }`，`source: null` 显式表示该平台无 **Source**。「声明了一个 ranked 不含的轴」从此写不出来（契约测试断言成员关系）。
- descriptor 的**值导入只允许 `./platforms`**，且**不得进 `lib/collections/index.ts` barrel**。
- 四处重值注册表原位不动，仍由 `tests/platform-completeness-contract.test.ts` 按 AST 查逐平台覆盖：`COLLECTION_PAGE_LOADERS`（`lazy()` thunk）、`CARD_ADAPTERS`（React 组件）、`AUTO_SYNC_PLATFORM_BY_COLLECTION.runSync`（函数）、`PLATFORM_DOWNSTREAM_ELIGIBILITY`（drizzle `SQL`）。

分成两份不是折中，是三条**从代码里看不出来**的约束的结果——这是本 ADR 存在的唯一理由：

1. **`lib/` 不得依赖 `entrypoints/`**。全仓库零先例（`grep -rn "from '@/entrypoints" lib/` 空结果）。
2. **`icon` 与 `title` 的类型住 app 侧**。`IconifyName = keyof typeof allIcons`（`entrypoints/app/components/iconify/register-icons.ts`）是「图标没在 `icon-sets.ts` 注册就编译报错」的唯一来源，而图标是离线的、没有 CDN 兜底；`LocaleKeys` 同理。放弃这两个类型，就等于放弃那个编译错误。
3. **`wxt.config.ts` 在 Node 侧按相对路径加载 descriptor** 来拼 `host_permissions`（`@/` 别名在 config 里不可用）。所以领域半边必须零 JSX、零浏览器全局、零 drizzle——上面那两条铁律就是为了守住这一点，破了它构建期报错会落在 `wxt.config.ts`，不指向真凶。

## Considered Options

- **一份 manifest 住 `lib/`，`icon` 开 type-only 例外** — 拒绝。要开仓库第一个 `lib/` → `entrypoints/` 依赖边，为一个字段换一条分层先例。
- **一份住 `lib/`，`icon: string` + app 侧另立映射表** — 拒绝。等于还是两份，多一层间接，并且把「图标未注册」从编译错误降级成运行时的空白图标。
- **`as IconifyName` 断言** — 拒绝，同上，编译错误没了。
- **16 处全收，重值一律改 `() => import()` thunk** — 拒绝。`PLATFORM_DOWNSTREAM_ELIGIBILITY` 变 thunk 会把 async 传染进目前同步的 `lib/collections/collection-processing-policy.ts`；且 `wxt.config.ts` 得在 Node 侧引一个含 `entrypoints/` thunk 的模块。它们的值本身就是重物，搬进纯 descriptor 只能改变形态、不能变轻。
- **物理 co-location（`platforms/<id>/` 一平台一目录 + glob 派生）** — 拒绝。glob 派生会废掉现有基于 AST 的完整性契约（没有字面量可读），并打破 `lib/` ↛ `entrypoints/` 分层。

## Consequences

- 注册表手写面 **13 文件 / 16 处 → 6 文件**（2 份 descriptor + 4 处重值）。静默失败面（`platform-onboarding.md` §9）**7 条 → 2 条**，且剩下两条都**不是「平台的事实」**（凭据链是 zod schema / hook / union / React 卡片 / 闭包，是结构与行为；英文硬编码与注册表无关）——那就是 descriptor 能力的边界。
- 代价：同一个平台的事实分两处，读者要读两个文件才看全。`platform-onboarding.md` §6 因此按两份 descriptor 分节，两个文件头注释互相指认对面。
- `mapPlatforms(source, project)` 是所有派生注册表共用的唯一投影 helper，泛型**故意不加 `S extends Record<CollectionPlatform, unknown>` 约束**：加了之后，残缺的 descriptor 会让 `S` 退化、错误级联到 17 个文件，根错误被埋在文件序里；不加，只有直接索引 descriptor 的 5 个文件报错，派生表全部安静。
- `hostPermissions` 的**顺序**成了 manifest 契约：已安装 MV3 扩展的 `host_permissions` 集合一变就要用户重新授权，故 `lib/collections/platform-descriptor.test.ts` 锁 flatMap 后的黄金顺序（不只是集合），`jobPlatform` 唯一性一并锁（同名会让两平台共用一条 job lane，后一个 sync 被当重复丢弃）。
- 反向撒回（12 处派生改回 13 个文件手写）是手工活，这个决策实际不可逆。
- 对 `theme/core/palette.ts` 的品牌色，`theme-config.ts` 的中转层（连 `BrandColoredPlatform` 类型）随之删除；品牌 hex 的 provenance 注释搬到 `PLATFORM_META` 旁，没有留在旧址变成幽灵。
- **`CONTEXT.md` 不变**：Platform Descriptor 是实现构件，不是领域专家会用的词；**Collection Platform** / **Platform Sync** / **Source** / **Collection Item** 的含义一个都没改。
