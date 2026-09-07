# Platform Descriptor 收敛手册

> 把接入一个 Collection Platform 时要手写的 **16 处注册表收敛成 2 份 descriptor**，并把
> `.trellis/spec/frontend/platform-onboarding.md` §9 的**无守卫清单从 7 条压到 2 条**。
>
> 本文是执行手册，不是论证。为什么要做、为什么是这个形状，看 §1 决策记录；
> 接入平台的**契约**仍然是 `.trellis/spec/frontend/platform-onboarding.md`，本文只负责把它
> 描述的成本降下来。术语（**Collection Platform** / **Platform Sync** / **Source** /
> **Collection Item**）在根 `CONTEXT.md` 定义一次，本文不重定义。
>
> 事实基线：**2026-09-06 源码复核**（`main`，`1e88094`）。行号按该 commit。

---

## 0. 一页纸

### 0.1 做什么

三步，三个独立 commit，**按顺序执行，每步可单独回滚**：

| Step | 一句话 | 依赖 | 风险 | 状态 |
| --- | --- | --- | --- | --- |
| **1** | 零依赖前置：能独立做完的五件事，先把 §9 的 3 条无守卫项和 2 处噪音清掉 | 无 | 低 | **已落地 2026-09-07** |
| **2** | descriptor 双份落地，12 处注册表改派生，删两张表，重写契约测试 | Step 1 | **中**（动 manifest） | 待执行 |
| **3** | 文档同步：spec §6/§7/§9/§12/§13 重写 + 根 CLAUDE.md + ADR 0004 | Step 2 | 无 | 待执行 |

### 0.2 不做什么

以下四项**经决策明确排除**，执行时不要"顺手做了"：

1. **4 处重值注册表不动**：`COLLECTION_PAGE_LOADERS`（`lazy()` thunk）、`CARD_ADAPTERS`（React 组件引用）、`AUTO_SYNC_PLATFORM_BY_COLLECTION.runSync`（函数）、`PLATFORM_DOWNSTREAM_ELIGIBILITY`（drizzle `SQL` 对象）。它们的**值本身就是重物**，搬进纯 descriptor 就得改成 `() => import()` thunk，而 `PLATFORM_DOWNSTREAM_ELIGIBILITY` 变 thunk 会把 async 传染进目前同步的 `lib/collections/collection-processing-policy.ts`。
2. **不修 `App.tsx` 的六平台 eager 图**。`entrypoints/app/App.tsx:7` 静态 import `AUTO_SYNC_PLATFORMS`，而 `entrypoints/app/collection-platform-auto-sync.ts:5-10` 静态 import 全部六个 sync adapter，所以 app.html 根加载图带着六个平台的完整领域层。**这是真成本，但它是性能问题，不是接入成本问题**，另开任务。
3. **`capability-marquee.tsx` 不改成派生**。药丸的交错节奏（上行 4 平台 + 3 能力，下行 2 平台 + 7 能力）是刻意设计，只加覆盖断言。
4. **不做物理 co-location**（`platforms/<id>/` 一平台一目录 + glob 派生）。glob 派生会废掉现有基于 AST 的完整性契约，且打破 `lib/` ↛ `entrypoints/` 分层。

### 0.3 阅读方式

新开对话执行某一步时：**只读本文对应 Step 一节 + §1 + §3**。§1 是为了不重新论证已定的事，§3 是不能破的线。不要通读全文。

### 0.4 诚实的成本账

这次改造买的是「**不会静默出错**」，不是「少干活」。接入一个平台的成本构成（youtube 实测，它是最薄的完整平台）：

| 项 | 体量 | 本手册执行后 |
| --- | --- | --- |
| 平台专属代码 `lib/<p>/` + `sections/<p>/` | 15 文件 / **2230 行** | **不变** |
| locale 键 | `<p>.*` 19 + `settings.<p>.*` 19 + `nav.*` + `welcome.picker.hint.*` ≈ **40 键 × 2 语言** | **不变** |
| 注册表手写处 | **13 文件 / 16 条** | → **6 文件**（2 descriptor + 4 重值） |
| 静默失败面（§9） | **7 条** | → **2 条** |

大头是前两项，且不可压缩——那就是真正的平台集成工作。16 处注册表从来不是工作量的主体，**它们是会被忘掉的那部分**。如果目标是"少干活"，本手册解决不了，方向要换。

---

## 1. 决策记录

五条全部**用户决定**（2026-09-06 grill-with-docs 会话），执行时不重新论证：

| # | 决策 | 被否决的方案 | 否决理由 |
| --- | --- | --- | --- |
| **D1** | 削减接入成本本身，走架构改造 | ① 为外部贡献者建 CI + CONTRIBUTING ② 只补守卫 + scaffold 生成器 ③ 只让第 7 个平台快一点 | 用户选架构改造。注：CI 缺失（`.github/` 不存在）仍是真问题，另记 §附录 B |
| **D2** | 只收 **12 项纯数据**；4 项重值原位不动 | 16 项全收，重值一律改 `() => import()` thunk | async 传染 `collection-processing-policy`；且 `wxt.config.ts` 在 Node 侧要靠相对路径引一个含 `entrypoints/` thunk 的模块 |
| **D3** | **双份 descriptor**，按 domain / UI 切 | ① 一份在 lib，`icon` 开 type-only 例外 ② 一份在 lib，`icon: string` + app 侧另立表 ③ `as IconifyName` 断言 | ①要开仓库第一个 `lib/` → `entrypoints/` 依赖边（今天零先例）；②等于 D3 多一层间接；③把"图标未注册"从编译错误降级成运行时空白图标 |
| **D4** | **三步分提交** | ① 单 commit 全做完 ② 只做 descriptor 本体 | ①diff 同时动 lib/collections、entrypoints/app、entrypoints/welcome、wxt.config、theme、两个守卫测试和 spec，出问题无法二分定位；②静默失败面一点没变 |
| **D5** | marquee **不派生，只加覆盖断言** | ① 派生 + 新增插位表保节奏 ② 派生 + 接受视觉变化 ③ 不管它 | ①为首装页装饰引入抽象，成本高于收益；②首装页是产品第一眼，不是技术决定；③第 7 个平台会静默缺席 |

**descriptor 落点**（同次会话定，非用户分支）：

- **lib 侧新建** `lib/collections/platform-descriptor.ts`。必须在 `lib/`，因为 `PLATFORM_SORT_KEYS` / `PLATFORM_DIMENSIONS` / `AUTHOR_DIMENSION` / `SOURCE_DIMENSION` 都是 `lib/collections/` 的消费者，而 **`lib/` 不能依赖 `entrypoints/`**（全仓库零先例，实测 `grep -rn "from '@/entrypoints" lib/` 空结果）。
- **app 侧不新建文件**，扩现有 `entrypoints/app/collection-platform-registry.ts` 的 `PLATFORM_META`。理由：它本来就是 app 侧平台注册表、本来就刻意保持纯净（文件头 `:1-4` 注释写明为什么绕开 `@/lib/collections` barrel）、welcome 本来就在两处 import 它（`components/orbit-core.tsx:10`、`sections/platform-picker.tsx:16`）。

**为什么 `icon` 决定了 descriptor 是两份**：`icon` 的类型 `IconifyName = keyof typeof allIcons` 住在 `entrypoints/app/components/iconify/register-icons.ts`，它是"图标没在 `icon-sets.ts` 注册就编译报错"的唯一来源（离线图标，无 CDN 兜底）。lib 侧引不到它，而放弃这个类型就等于放弃那个编译错误。

---

## 2. 基线速查：16 处注册表现状

按**值的纯度**分类（不是文件重量）。这张表是 Step 2 的工作清单。

### 2.1 12 项纯数据 → 进 descriptor

| # | 现址 | 符号 | 值 | 去向 |
| --- | --- | --- | --- | --- |
| 1 | `entrypoints/app/collection-platform-registry.ts:20-27` | `PLATFORM_META.title` | `LocaleKeys` | app |
| 2 | 同上 | `PLATFORM_META.icon` | `IconifyName` | app |
| 3 | `entrypoints/app/collection-platform-pages.ts:22-29` | `COLLECTION_PAGE_CHILD_ROUTES` | `readonly string[]` | app |
| 4 | `entrypoints/app/hooks/collection-job-platform.ts` | `JOB_PLATFORM_BY_COLLECTION` | `string` | **lib** |
| 5 | `wxt.config.ts:34-52` | `PLATFORM_HOST_PERMISSIONS` | `string[]` | **lib** |
| 6 | `entrypoints/welcome/landing.ts` | `WELCOME_READINESS_BY_PLATFORM` | `'credentials'｜'login'｜'local'` | **lib** |
| 7 | `entrypoints/welcome/sections/platform-picker.tsx` | `HINT_KEYS` | `LocaleKeys` | app |
| 8 | `lib/collections/platform-sort-keys.ts:11-18` | `PLATFORM_SORT_KEYS` | `PlatformSortKey` | **lib** |
| 9 | `lib/collections/collection-analytics.ts:64-74` | `PLATFORM_DIMENSIONS` | `readonly Kind[]` | **lib** |
| 10 | `lib/collections/collection-analytics.ts:76-83` | `AUTHOR_DIMENSION` | `Kind` | **lib** |
| 11 | `lib/collections/collection-analytics.ts:85-92` | `SOURCE_DIMENSION` | `Kind`（`Partial`） | **lib** |
| 12 | `entrypoints/app/theme/theme-config.ts:148-151` + `theme/core/palette.ts:151-167` | `platform.light/dark` + `PLATFORM_PALETTE_*` | hex / ink 标记 | app |

第 9/10/11 条合并成 descriptor 的**一个** `dimensions` 字段（见 Step 2 改法）。第 12 条的 `theme-config.ts` 那半是 palette.ts 的中转站，**整块删除**。

### 2.2 4 项重值 → 原位不动（D2）

| 现址 | 符号 | 值是什么 |
| --- | --- | --- |
| `entrypoints/app/collection-platform-pages.ts:12-19` | `COLLECTION_PAGE_LOADERS` | `lazy(() => import(...))` |
| `entrypoints/app/sections/collections/collection-item-card.tsx` | `CARD_ADAPTERS` | React 组件引用（`:6-11` 六个静态 import） |
| `entrypoints/app/collection-platform-auto-sync.ts` | `AUTO_SYNC_PLATFORM_BY_COLLECTION` | `runSync` 函数 + `probeReady`（`:5-10` 六个静态 import） |
| `lib/collections/platform-eligibility.ts` | `PLATFORM_DOWNSTREAM_ELIGIBILITY` | drizzle `SQL` 对象 |

### 2.3 关键约束速查

| 约束 | 出处 | 影响 |
| --- | --- | --- |
| `lib/` 禁止依赖 `entrypoints/` | 全仓库零先例（实测） | 决定 descriptor 必须两份（D3） |
| `@/lib/collections` barrel 经 `collections-query` 拖 drizzle + `@/lib/database` | `collection-platform-registry.ts:1-4` 注释 | descriptor **不得**进 `lib/collections/index.ts` |
| `wxt.config.ts` 用**相对路径**引 lib（`'./lib/collections/platforms'`），`@/` 别名不可用 | `wxt.config.ts:3-6` | descriptor 必须 Node 可加载、零 JSX、零浏览器全局 |
| `CollectionAnalyticsDimensionKind` 定义在 `collection-analytics.ts:20`，而该文件 import drizzle + `getDb` + 六张表 | 实测 `:1-9` | 类型必须先抽出（Step 1 第 1 件事），否则 descriptor 不纯 |
| `register-icons.ts` 只 import `@iconify/react` + `./icon-sets`，**无 theme 回边** | 实测 | `theme/core/palette.ts` → `collection-platform-registry.ts` **不成环**，安全 |
| Background SW 图上限 2 MiB | `scripts/check-background-bundle.mjs:5` | descriptor 约 3KB，**不是约束**，别拿它当理由 |
| MV3 已安装扩展的 `host_permissions` 集合一变就要用户重新授权 | Chrome 平台行为 | Step 2 必须产出字节相同的 manifest，见判据 |

---

## 3. 跨 Step 铁律

1. **Never Break Userspace**：`host_permissions` 集合、hash 路由、storage key、`data-*` / `aria-*` / heading level / DOM 顺序，任何一处变化都视为破坏。本手册**全程零行为变更**——它是纯重构，任何可观察差异都是 bug，不是"顺手改进"。
2. **manifest 必须字节相同**。`host_permissions` 由 `PLATFORM_HOST_PERMISSION_LIST` 按 `COLLECTION_PLATFORMS` 顺序 flatMap（`wxt.config.ts:53-55` → `:82-85`）。descriptor 化后顺序与内容都必须保持。**不是"应该没问题"，是 diff 验证**（见 Step 2 判据）。
3. **descriptor 保持纯净**：`lib/collections/platform-descriptor.ts` 的**值导入只允许 `./platforms`**，其余一律 `import type`。谁哪天写成值导入，`wxt.config.ts` 会在构建期炸，且错误信息不会指向真凶。这条要写进该文件的文件头注释。
4. **descriptor 不进 barrel**：`lib/collections/index.ts` **不得** re-export descriptor（§2.3 第 2 行）。
5. **测试重写不是绕过**：锁值变了就改成新值并写明理由；禁止 `it.skip`、禁止放宽到 `toBeDefined`。每个 Step 的"测试重写"段列出的是**全部**要动的断言，多一处就回本文补记。
6. **文档即代码**：改到的目录，其 `CLAUDE.md` 同 commit 更新（`lib/collections/CLAUDE.md` 已存在）。
7. **验证顺序**：focused `pnpm vitest run <paths>` → `pnpm compile` → `pnpm test` → `pnpm build`。四步全绿才算 Step 完成。`pnpm test` 偶发超时是 CPU 争用而非回归，空载重跑再判定。
8. **`[UNKNOWN]` 消解**：附录 B 的条目在对应 Step 执行时消解并回写本文，不允许带着 `[UNKNOWN]` 收 Step 3。

---

## 4. 分步手册

### Step 1 — 零依赖前置 ✅ 已落地 2026-09-07

> 执行记录在本节末「执行结果」。下面的正文保留原样，**勘误就地标注**。

**目标**：做完五件互不依赖、也不依赖 descriptor 的事。做完 §9 的第 3、6 条和"marquee"那条死，两处噪音消失，且为 Step 2 让出干净的类型层。

**前置依赖**：无。

**动哪些文件**
- 新建：`lib/collections/analytics-types.ts`
- 新建：`.env.example`（tracked）
- 改：`lib/collections/collection-analytics.ts`（类型移出 + re-export）
- 改：`lib/chat/tools.ts`（**勘误：三处不是两处**）
- 改：`lib/chat/prompts.ts`（**手册原漏**，第四处平台枚举）
- 改：`lib/chat/tools.test.ts`、`tests/agent-bridge-cli-aliases.test.ts`（新增两条派生守卫，见「执行结果」）
- 改：`lib/collections/CLAUDE.md`、`lib/chat/CLAUDE.md`（铁律 6）
- 改：`.gitignore`
- 改：`tests/platform-env-constants-guard.test.ts`（只改注释）
- 改：`tests/platform-completeness-contract.test.ts`（加 marquee 断言）
- 改：`entrypoints/app/sections/overview/overview-view.test.tsx`
- 改：根 `CLAUDE.md`（`lib/env.ts` 行的 `.env.example` 引用变成真的）

**具体改什么**

1. **抽纯类型**。把 `CollectionAnalyticsDimensionKind`（`lib/collections/collection-analytics.ts:20`）移到新建的 `lib/collections/analytics-types.ts`，原文件 `export type { CollectionAnalyticsDimensionKind } from './analytics-types'` 保持向后兼容（铁律 1）。**只搬这一个类型**，其余分析类型留原处——搬多了 Step 2 的 diff 会混进无关改动。
   - 为什么必须先做：`collection-analytics.ts` import 了 drizzle + `getDb` + 六张表实体，Step 2 的 lib descriptor 要引用这个 Kind 类型。虽然 `import type` 会被擦除、`wxt.config.ts` 实际不会拖 drizzle，但那是个陷阱：谁改成值导入就构建期炸。抽出来把陷阱消除。

2. **chat prompt 派生**（§9 第 3 条死）。~~`lib/chat/tools.ts:51` 与 `:116` 各有一处~~ **勘误（2026-09-07 源码复核）：是四处，不是两处。**
   - `tools.ts:42` `searchKnowledgeBase.description`——「覆盖 **B站/GitHub/浏览器书签/X/知乎/YouTube** 的收藏内容」，用**显示名**。手册漏记，spec §9 第 3 条写的「三处」才是对的。
   - `tools.ts:51` / `:116` 两处 `.describe()`——用 id。
   - `lib/chat/prompts.ts:12` `CHAT_SYSTEM_PROMPT`——「各平台（B站、GitHub、浏览器书签、X、知乎、YouTube）」。**手册范围外的第四处**，spec §9 也没登记。
   
   `z.enum(COLLECTION_PLATFORMS)` 是派生的——**schema 接受新平台，prompt 却告诉模型只有六个**。
   - 注意：这两处是**中文 prompt 串**，`tests/i18n-no-hardcoded.test.ts` 只扫 `entrypoints/**/*.tsx` 所以扫不到它们，且 prompt 不进 locale（它是给模型的，不是给用户的）。改的时候保持中文措辞不变，只把枚举部分换成派生值。

3. **去掉硬编码 6**。`entrypoints/app/sections/overview/overview-view.test.tsx` 四处：`:250` `toHaveLength(6)`、`:258` `'0 / 6'`、`:262` `toHaveLength(6)`、`:290` `'1 / 6'`。全部改成从 `COLLECTION_PLATFORMS.length` 派生。
   - 为什么值得做：这四处让第 7 个平台把 **Dashboard 的测试**变红，原因跟 Dashboard 毫无关系。它不是静默失败，是噪音——但对第一次接入的人，噪音和真错长得一样。

4. **marquee 覆盖断言**（我方发现的第 7 条死，D5）。在 `tests/platform-completeness-contract.test.ts` 加一条：AST 读 `entrypoints/welcome/sections/capability-marquee.tsx` 的 `ROW_TOP` / `ROW_BOTTOM`（`:17-38`）两个数组字面量里的 `labelKey` 字符串，必须覆盖 `collectionPlatformRegistry` 全部 `title` 值。
   - **用 AST 读 marquee**；registry 侧**也走 AST**（偏离：手册说直接 import）——该契约测试已经为 'navigation metadata' 解析过 `PLATFORM_META`，复用其返回值即可，零新增 import。marquee 是带 MUI + Iconify 的 React 组件，且 `ROW_TOP` / `ROW_BOTTOM` 是模块私有常量（未导出）——加载它需要 happy-dom + 整个主题，与该契约测试"不加载 DB 或页面 runtime"的立意冲突。registry 是纯数据，直接 import 安全。
   - **零视觉改动**。只断言覆盖，不断言位置。

5. **`.env.example` 转正**（§9 第 6 条死）。
   - 删 `.gitignore:51` 的 `.env.example`（`:31` 的 `.env.local` **保留**）。
   - 新建 tracked `.env.example`，按平台分组写全 30 个 `VITE_*` 键 + 各自默认值 + 一行注释。取值以 `tests/platform-env-constants-guard.test.ts` 的 `EXPECTED_ENV_CONSTANTS` 为准（该表的 fallback 已被测试双向锁死）。
   - 修 `tests/platform-env-constants-guard.test.ts:203-206` 的注释。它现在写「`.env.example` / `.env.local` 都携带真密钥所以被 gitignore」——**这对 `.env.local` 成立，对 `.env.example` 不成立**。example 文件的全部意义就是被跟踪且不含密钥。这句错判断让守卫的文档半边对所有人永久空转（`:209` 的 `if (!existsSync(full)) return`），同时让根 `CLAUDE.md` 指向一个谁都不会有的文件。
   - 改根 `CLAUDE.md` 的 `lib/env.ts` 行：那句「变量注释文档在 `.env.example`/`.env.local` 平台分组块」现在开始为真。
   - **`.env.example` 不含任何密钥值**，只有键名 + 数值默认 + 注释。真密钥只在 gitignored 的 `.env.local`。

**测试重写**
- `tests/platform-completeness-contract.test.ts`：新增 marquee 覆盖断言（并入现有聚合失败列表，不新建测试文件）。
- `lib/chat/tools.test.ts`（**手册原未列，铁律 5 补记**）：新增 `model-facing platform list` 守卫。派生只是「这次修好了」，守卫才让 §9 第 3 条**死**。三处工具文本 + `CHAT_SYSTEM_PROMPT` 四个面在**同一文件**里查——一条规则拆两个文件就是它在被遗忘的那半边里腐掉。
- `tests/agent-bridge-cli-aliases.test.ts`（**Trellis check 阶段发现的第三处，用户 2026-09-07 决定收进 Step 1**）：`skills/favbase/SKILL.md:45` 手写平台清单，是**外部 agent** 的模型可见面（打进 `favbase-cli`，装到 `~/.claude/skills/`）。工具 schema 那半随本 Step 已派生（Agent Bridge 复用 `chatTools`），但 shipped markdown 派生不了，只能对账。落在该文件是因为它自述「扩展之外唯一拼写 Knowledge Tool 与参数名的地方」——同一句话对平台 id 成立。双向集合相等。
- `entrypoints/app/sections/overview/overview-view.test.tsx`：四处 `6` 改派生，断言语义不变。
- `tests/platform-env-constants-guard.test.ts`：只改注释，断言零改动。`.env.example` 存在后其文档半边**首次真正运行**——如果现有平台的 env 文档不全，这一步会红。那正是它该干的事，按红灯补齐 `.env.example`，不要放宽断言。
- `lib/collections/collection-analytics.test.ts`：如仍从 `collection-analytics.ts` 引 Kind 类型则零改动（re-export 保持）。

**验证命令**
```
pnpm vitest run tests/platform-completeness-contract.test.ts tests/platform-env-constants-guard.test.ts entrypoints/app/sections/overview lib/chat lib/collections
pnpm compile && pnpm test && pnpm build
```

**执行结果（2026-09-07）**

四步验证全绿（focused vitest 15 文件 / 87 例 → `pnpm compile` → `pnpm test` 195 文件 / 1425 例 → `pnpm build`）。
`pnpm test` 首跑 `tests/lib-import-smoke.test.ts` 的 bilibili 例 5s 超时，空载重跑绿——已知 CPU 争用抖动，
且本 Step 零改动触及 `lib/bilibili`（§3 铁律 7）。

**用户决定（grill-with-docs，2026-09-07）**

| # | 决策 | 否决的方案 | 理由 |
| --- | --- | --- | --- |
| **D6** | chat 平台枚举**四处全派生成 id 列表** | ① 只改 tools.ts 三处，prompts.ts 不动 ② 严格照手册字面只改 :51/:116 | ①②都让同一个病活着；显示名不可派生（`PLATFORM_META.title` 是 app 侧 `LocaleKeys`，`lib/` 不得 import，Step 2 也不改变这点），放弃显示名换「第 7 个平台自动进模型视野」，B站→bilibili 交给模型常识 |
| **D7** | `.env.example` **完整镜像 `.env.local` 结构**，去密钥去 douyin | ① 只写 30 个平台键（手册字面） ② 30 键 + 两个非密钥数值键 | 该文件的用途是 `cp .env.example .env.local` 就能开工；缺 LLM/Embedding 占位就废了它。守卫只双向锁那 30 键，多写的 13 个非平台键不报错 |

**我方判断（非用户决策）**

- marquee 断言走 AST 读 `PLATFORM_META`，不 import registry（理由见上）。
- `overview-view.test.tsx` 从 `@/lib/collections/platforms` leaf 引 `COLLECTION_PLATFORMS`，不走 barrel（barrel 经 `collections-query` 拖 drizzle + `@/lib/database`）。
- 守卫的 `.env.example` 半边由「文件不存在就早退」改为**必须存在**（`expect(required).toBe(false)`）。文件转正后，早退分支就是在放行「有人把它删了」这个缺陷。
- spec §9 的第 3、6 条**就地标注为已死**（不等 Step 3 重写整节）。Step 3 依赖 Step 2；若 Step 2 未落地，spec 会一直对读者说「nothing catches it」，而实际上已经有守卫了。

**证伪记录**（判据要求，均已还原）

- 把 `CHAT_SYSTEM_PROMPT` 的清单改回手写六个显示名 → `tools.test.ts` 两例红，指名 `CHAT_SYSTEM_PROMPT: missing bilibili, bookmarks, zhihu, youtube`。
- 删掉 `capability-marquee.tsx` 的 `nav.youtubePlaylists` 行 → 契约测试红，指名 `youtube: welcome capability marquee pill`。
- 从 `SKILL.md` 那句里删掉 `` `x` `` → CLI 别名契约红（5 项少 1）。

**回滚点**：`refactor(collections): land the dependency-free platform onboarding fixes`

**完成判据**
- [ ] `lib/collections/analytics-types.ts` 存在，`collection-analytics.ts` re-export 该类型，全仓库零编译错误
- [ ] `lib/chat/tools.ts` 零平台字面量（`grep -n "bilibili" lib/chat/tools.ts` 只剩非枚举用途或空）
- [ ] `overview-view.test.tsx` 零 `6` 字面量（平台数相关的那四处）
- [ ] 契约测试的 marquee 断言：手动删掉 `capability-marquee.tsx` 里 youtube 那行验证它会红，再改回
- [ ] `.env.example` 被 git 跟踪（`git ls-files .env.example` 非空），含 30 个 `VITE_*` 键，零密钥值
- [ ] 根 `CLAUDE.md` 的 `.env.example` 引用不再是幽灵
- [ ] 四步验证全绿

---

### Step 2 — descriptor 双份落地

**目标**：12 项纯数据收进两份 descriptor，12 处消费点改派生，删两张表，重写契约测试。**零行为变更**。

**前置依赖**：Step 1（需要 `analytics-types.ts`）。

**动哪些文件**
- 新建：`lib/collections/platform-descriptor.ts`
- 改：`entrypoints/app/collection-platform-registry.ts`（`PLATFORM_META` 2 字段 → 5 字段）
- 改（改派生）：`lib/collections/platform-sort-keys.ts`、`lib/collections/collection-analytics.ts`、`entrypoints/app/hooks/collection-job-platform.ts`、`entrypoints/welcome/landing.ts`、`entrypoints/welcome/sections/platform-picker.tsx`、`entrypoints/app/collection-platform-pages.ts`、`entrypoints/app/theme/core/palette.ts`、`wxt.config.ts`
- 改（删表）：`entrypoints/app/theme/theme-config.ts`（`platform` 块整删）、`entrypoints/app/layouts/dashboard/background-jobs-indicator.tsx`（`PLATFORM_LABEL` 整删）
- 改：`tests/platform-completeness-contract.test.ts`（重写）
- 改：`lib/collections/CLAUDE.md`、`entrypoints/app/CLAUDE.md`、`entrypoints/app/theme/CLAUDE.md`、`entrypoints/app/layouts/CLAUDE.md`（铁律 6）

**具体改什么**

1. **`lib/collections/platform-descriptor.ts`**——`PLATFORM_DESCRIPTORS: Record<CollectionPlatform, PlatformDescriptor>`，五个领域字段：

   | 字段 | 类型 | 取自 |
   | --- | --- | --- |
   | `jobPlatform` | `string` | `JOB_PLATFORM_BY_COLLECTION` |
   | `readiness` | `'credentials' \| 'login' \| 'local'` | `WELCOME_READINESS_BY_PLATFORM` |
   | `hostPermissions` | `readonly string[]` | `PLATFORM_HOST_PERMISSIONS` |
   | `sortKey` | `PlatformSortKey` | `PLATFORM_SORT_KEYS` |
   | `dimensions` | `{ ranked: readonly Kind[]; author: Kind; source: Kind \| null }` | 合并三张表 |

   - **`dimensions` 一个字段吃掉三张表**。现有数据印证这个形状：`ranked` 是有序展示列表，`author` / `source` 指向其中一项。例：bilibili `ranked: ['uploader','favoriteFolder']`、`author: 'uploader'`、`source: 'favoriteFolder'`；github `ranked: ['language','repositoryOwner']`、`author: 'repositoryOwner'`、`source: null`。
   - **`source: null` 显式声明取代 `Partial<Record<…>>`**（`collection-analytics.ts:85-92`）。§9 第 2 条的空白（"你在 `PLATFORM_DIMENSIONS` 声明了 Source 维度，Dashboard 细分卡却静默不填充"）由此消失——两个事实进了同一个对象，不一致变成写不出来。
   - 文件头注释写清铁律 3（值导入只允许 `./platforms`）和铁律 4（不进 barrel），以及 `wxt.config.ts` 是它的 Node 侧消费者。
   - `PlatformSortKey` 类型留在 `platform-sort-keys.ts`，descriptor `import type` 它；或反向搬进 descriptor 由 `platform-sort-keys.ts` re-export。**二者皆可，选后者更内聚**——执行时定一个并在 CLAUDE.md 记一句。

2. **`entrypoints/app/collection-platform-registry.ts`**——`PLATFORM_META` 从 2 字段扩到 5：

   | 字段 | 类型 | 取自 |
   | --- | --- | --- |
   | `title` | `LocaleKeys` | 原地 |
   | `icon` | `IconifyName` | 原地 |
   | `palette` | `{ light: string; dark: string } \| 'ink'` | `theme-config.ts:148-151` + `palette.ts:151-167` |
   | `hint` | `LocaleKeys` | `platform-picker.tsx` 的 `HINT_KEYS` |
   | `childRoutes` | `readonly string[]` | `collection-platform-pages.ts:22-29` |

   - `palette: 'ink'` 表示黑标品牌（github / x），派生时映射到 `text.light.primary` / `text.dark.primary`。这替换掉现在的双层结构：`theme-config.ts` 的 `Record<BrandColoredPlatform, string>` + `palette.ts` 里六键显式展开。
   - `collectionPlatformRegistry` / `collectionPlatformById` 两个导出**保持不变**（有既有消费者），只是数据源变宽。

3. **12 处消费点改派生**。逐个：
   - `platform-sort-keys.ts`：`PLATFORM_SORT_KEYS` 改 `mapValues(PLATFORM_DESCRIPTORS, d => d.sortKey)` 形状的派生，导出名与类型不变。
   - `collection-analytics.ts`：三张表全部派生自 `d.dimensions`。`:220` 的 `SOURCE_DIMENSION[platform]` 与 `:229` 的 `PLATFORM_DIMENSIONS[platform]` 调用点形状不变。
   - `collection-job-platform.ts`：`JOB_PLATFORM_BY_COLLECTION` 派生自 `d.jobPlatform`。
   - `welcome/landing.ts`：`WELCOME_READINESS_BY_PLATFORM` 派生自 `d.readiness`。
   - `welcome/sections/platform-picker.tsx`：`HINT_KEYS` 派生自 app registry 的 `hint`。welcome 已在 `:16` import registry，无新增依赖边。
   - `collection-platform-pages.ts`：`COLLECTION_PAGE_CHILD_ROUTES` 派生自 registry 的 `childRoutes`。**`COLLECTION_PAGE_LOADERS` 不动**（D2）。
   - `theme/core/palette.ts`：`PLATFORM_PALETTE_LIGHT` / `PLATFORM_PALETTE_DARK` 派生自 registry 的 `palette`，`'ink'` 映射到该 scheme 的 `text.*.primary`。
   - `theme/theme-config.ts:148-151`：`platform` 块 **整块删除**，连 `:48` 的 `platform: Record<'light'|'dark', Record<BrandColoredPlatform, string>>` 类型行和 `BrandColoredPlatform` 类型一起（若无其他消费者——执行时 grep 确认）。它现在只是 palette.ts 的中转站。
   - `wxt.config.ts`：`PLATFORM_HOST_PERMISSIONS` 删除，`PLATFORM_HOST_PERMISSION_LIST`（`:53-55`）改为 `COLLECTION_PLATFORMS.flatMap(p => PLATFORM_DESCRIPTORS[p].hostPermissions)`。**用相对路径 `'./lib/collections/platform-descriptor'`**（`@/` 别名在 wxt.config 不可用，见 §2.3）。**flatMap 顺序不变**（铁律 2）。

4. **删 `PLATFORM_LABEL`**（§9 第 1 条死）。`entrypoints/app/layouts/dashboard/background-jobs-indicator.tsx:15-22` 那张 `Record<string, LocaleKeys>` 整删，改从两份 descriptor join：`jobPlatform`（lib 侧）→ `title`（app 侧）。
   - 现在的失败模式：该表 typed `Record<string, …>` 而非 `Record<CollectionJobPlatform, …>`，`:91-92` 是 `key ? t(key) : platform` 的兜底——第 7 个平台漏登记时，全局"别关页面"提醒会显示原始 job 命名空间（`reddit-saved · syncing`）而不是平台名。改成 join 后漏不掉。
   - `background-jobs-indicator.tsx` 在 app 层，两份 descriptor 都能 import，无分层问题。

5. **契约测试重写**。`tests/platform-completeness-contract.test.ts` 现在用 AST 对账 13 处；重写后：
   - **删掉** 12 项纯数据的 AST 断言——它们进了两个穷举 `Record`，`pnpm compile` 直接给错误，且错误落在对象字面量上并指名缺失属性。AST 再读一遍是重复。
   - 顺带消除一处荒谬：`theme/core/palette.ts:148-150` 的注释明说六键显式展开"是为了让平台完整性契约能从 AST 读到每个属性"——**现有 AST 手法本身在制造重复**。
   - **保留** 4 处重值的断言（`COLLECTION_PAGE_LOADERS` 解析得到东西、`CARD_ADAPTERS` 有组件、auto-sync 每平台显式 `runSync` 且不手写 `jobPlatform`、eligibility 六平台显式键）。
   - **保留** 全部结构规则：`main.tsx` 不含 `collections/<platform>` 字面量、`hooks/` ↛ `sections/`、`collection-processing-policy.ts` 无平台字面量 / `platformMeta` / `->>`、每个收藏页 view 必调 `useCollectionBreadcrumbs`、`COLLECTION_PAGE_CHILD_ROUTES` 与 `hostPermissions` 仍须是显式数组字面量（防止有人算出来）。
   - **新增** 两份 descriptor 的形状断言：`dimensions.author` / `dimensions.source` 必须是 `dimensions.ranked` 的成员或 `null`（这是把三表合一后新得到的、以前无法表达的一致性）。
   - **保留** Step 1 加的 marquee 覆盖断言。
   - 单一聚合失败的输出形式不变。

**测试重写**
- `tests/platform-completeness-contract.test.ts`：按上述重写。
- `entrypoints/app/collection-platform-registry.test.ts`：`PLATFORM_META` 字段变宽，断言跟着扩。
- `entrypoints/app/theme/core/palette.test.ts`：平台色断言的数据来源改了，值必须不变——这是铁律 1 的锁。
- `lib/collections/collection-analytics.test.ts`：三表派生后，现有断言应零改动通过。若不通过，说明派生错了，**不要改断言**。
- `entrypoints/app/hooks/collection-job-platform.test.ts`、`entrypoints/welcome/landing.test.ts`、`entrypoints/app/collection-platform-auto-sync.test.ts`：同上，期望零改动通过。
- `background-jobs-indicator` 的现有测试：`PLATFORM_LABEL` 删除后行为必须相同（六个平台的提醒文案不变），断言零改动。
- **新建** `lib/collections/platform-descriptor.test.ts`：descriptor 形状 + `dimensions` 自一致 + `hostPermissions` 非空。

**验证命令**
```
pnpm vitest run tests/platform-completeness-contract.test.ts lib/collections entrypoints/app/collection-platform-registry.test.ts entrypoints/app/theme entrypoints/app/hooks entrypoints/welcome entrypoints/app/layouts
pnpm compile && pnpm test && pnpm build
```

**manifest 字节相同验证**（铁律 2，**不可省略**）：
```
# Step 2 开始前，在干净工作树上：
pnpm build && cp .output/chrome-mv3/manifest.json /tmp/manifest-before.json
# Step 2 完成后：
pnpm build && diff /tmp/manifest-before.json .output/chrome-mv3/manifest.json
```
`diff` 必须无输出。有输出就是破坏了 userspace——MV3 已安装扩展的 `host_permissions` 集合一变就要用户重新授权。

**回滚点**：`refactor(collections): derive platform registries from two descriptors`

**完成判据**
- [ ] `lib/collections/platform-descriptor.ts` 的值导入只有 `./platforms`（`grep -n "^import " lib/collections/platform-descriptor.ts` 人工判读）
- [ ] descriptor 不在 `lib/collections/index.ts` 的 re-export 里
- [ ] `theme-config.ts` 零 `platform` 块，`BrandColoredPlatform` 若无消费者则一并删除
- [ ] `background-jobs-indicator.tsx` 零 `PLATFORM_LABEL`
- [ ] `wxt.config.ts` 零 `PLATFORM_HOST_PERMISSIONS` 对象，只剩派生的 `PLATFORM_HOST_PERMISSION_LIST`
- [ ] **`diff` manifest 无输出**
- [ ] 契约测试仍是单一聚合失败；手动删 descriptor 里一个平台键，验证 `pnpm compile` 报错落在对象字面量上并指名平台
- [ ] 四个 `CLAUDE.md` 同 commit 更新
- [ ] 四步验证全绿

---

### Step 3 — 文档同步与收口

**目标**：让 spec 与 CLAUDE.md 说的是改造后的事实，并把 D2 / D3 两个决策固化成 ADR。

**前置依赖**：Step 2 已提交。

**动哪些文件**
- 改：`.trellis/spec/frontend/platform-onboarding.md`
- 改：根 `CLAUDE.md`
- 新建：`docs/adr/0004-platform-facts-split-across-two-descriptors.md`
- 改：本文（§7 勾选表 + 附录 B 消解 + 执行记录）

**具体改什么**

1. **`platform-onboarding.md`** 逐节改：
   - **§2**「两个机器检查的半边」：表格里契约测试那行的"What it catches"要去掉已被 `tsc` 接管的部分。
   - **§6**：`6.1` 的 13 行表 + `6.2` 的 3 行表，**合并重写成 2 份 descriptor 的字段表 + 4 处重值表**。这是本文 §2.1 / §2.2 的镜像，但写成"你要填什么"而不是"现状是什么"。
   - **§7.1 / §7.2**：`childRoutes` 不再在 `collection-platform-pages.ts` 填，改到 registry。
   - **§9**：**七条 → 两条**。删掉第 1、2、3、6 行和（本手册 Step 1 新增守卫的）marquee 行，只留"凭据链"与"英文硬编码文案"。表头的"Verified against the code on 2026-09-06"日期更新，并注明哪几条是被 docs/26 杀掉的、由哪个守卫接管。
   - **§11 禁止模式**：加两条——`lib/collections/platform-descriptor.ts` 出现除 `./platforms` 以外的值导入（铁律 3）；descriptor 进 `lib/collections` barrel（铁律 4）。
   - **§12 验证顺序**：加 manifest diff 那一步。
   - **§13 Definition of done**：注册表勾选项从 13+3 改成 2+4。
   - **注意**：§9 剩的两条要写清"为什么 descriptor 救不了"——凭据链那 5 处的值是 zod schema、hook 函数、union 类型、React 卡片、`probeReady` 闭包，全是重物或结构，不是数据；英文硬编码跟注册表无关（`tests/i18n-no-hardcoded.test.ts` 只拦 CJK）。

2. **根 `CLAUDE.md`**：
   - 「目录文档索引」→「平台领域（lib）」段加 `lib/collections/platform-descriptor.ts` 的定位行。
   - `tests/platform-completeness-contract.test.ts` 那行重写（它现在逐条列了 13 处对账内容）。
   - 「关键文档」段加 docs/26 行。

3. **ADR 0004**。三条判据在 2026-09-06 会话已核过，全中：
   - **难以逆转**：12 处派生反向撒回 13 个文件是手工活。
   - **无上下文会困惑**：未来读者一定会问「为什么平台事实分两份而不是一份 manifest」，而 `lib/` ↛ `entrypoints/` + `IconifyName` 住 app 侧 + `wxt.config.ts` 在 Node 加载这三条约束**从代码里看不出来**。
   - **真实权衡**：明确否决了「一份 manifest + 全 thunk」（async 传染）和「type-only 例外」（开仓库第一个 lib→entrypoints 依赖边）。
   - ADR 只写 D2 / D3 两条（形状决策）。D1 / D4 / D5 是过程与范围决策，留在本文 §1 即可，不进 ADR。

4. **CONTEXT.md 不动**。「Platform Descriptor」是实现构件，不是领域专家会用的词；CONTEXT.md 已有的 **Collection Platform** / **Platform Sync** / **Source** / **Collection Item** 没有一个因本次改造改变含义。这条是刻意决定，不是遗漏。

**测试重写**：无（纯文档）。

**验证命令**
```
pnpm test
```
文档步不该改变任何测试结果；跑一次是确认 Step 2 的树仍然是绿的。

**回滚点**：`docs(platform): rewrite the onboarding contract for the descriptor split`

**完成判据**
- [ ] `platform-onboarding.md` §9 只剩两行，且每行注明"为什么守卫救不了"
- [ ] `platform-onboarding.md` §6 与本文 §2.1/§2.2 一致，无残留的 13+3 说法
- [ ] 根 `CLAUDE.md` 三处更新
- [ ] `docs/adr/0004` 写成，只含 D2 / D3
- [ ] 本文 §7 勾选表全勾，附录 B 全部消解
- [ ] `grep -rn "13 " .trellis/spec/frontend/platform-onboarding.md` 无残留的旧计数说法（人工判读，不是硬判据）

---

## 5. 全局验证矩阵

| 检查 | 命令 | 何时跑 |
| --- | --- | --- |
| 平台完整性契约 | `pnpm vitest run tests/platform-completeness-contract.test.ts` | 每步 |
| lib import smoke | `pnpm vitest run tests/lib-import-smoke.test.ts` | Step 2 |
| env 常量守卫 | `pnpm vitest run tests/platform-env-constants-guard.test.ts` | Step 1 |
| UI 依赖边界 | `pnpm vitest run tests/ui-vendor-boundaries.test.ts` | Step 2 |
| 类型 | `pnpm compile` | 每步 |
| 全量 | `pnpm test` | 每步 |
| 构建 + Background 体积契约 | `pnpm build` | 每步 |
| **manifest 字节相同** | `diff` 见 Step 2 | **Step 2** |

---

## 6. 文档同步清单

| 文件 | 哪一步 | 改什么 |
| --- | --- | --- |
| `lib/collections/CLAUDE.md` | 2 | descriptor 的职责与两条铁律 |
| `entrypoints/app/CLAUDE.md` | 2 | `PLATFORM_META` 扩到 5 字段 |
| `entrypoints/app/theme/CLAUDE.md` | 2 | 平台色来源改 registry；`theme-config.platform` 已删 |
| `entrypoints/app/layouts/CLAUDE.md` | 2 | `PLATFORM_LABEL` 已删，改 descriptor join |
| `.trellis/spec/frontend/platform-onboarding.md` | 3 | §2/§6/§7/§9/§11/§12/§13 |
| 根 `CLAUDE.md` | 1, 3 | Step 1 改 `lib/env.ts` 行；Step 3 改索引 + 契约测试行 + 加 docs/26 |
| `docs/adr/0004` | 3 | 新建 |

---

## 7. 进度勾选表

- [x] **Step 1** 零依赖前置 — `refactor(collections): land the dependency-free platform onboarding fixes`（2026-09-07）
- [ ] **Step 2** descriptor 双份落地 — `refactor(collections): derive platform registries from two descriptors`
- [ ] **Step 3** 文档同步与收口 — `docs(platform): rewrite the onboarding contract for the descriptor split`

---

## 附录 A — §9 无守卫清单七条的生死

`platform-onboarding.md` §9 原有 6 条，2026-09-06 复核时发现第 7 条（marquee）。本手册执行后：

| # | 项 | 结局 | 接管者 |
| --- | --- | --- | --- |
| 1 | `background-jobs-indicator.tsx` 的 `PLATFORM_LABEL` | **死** | Step 2 删表，改两份 descriptor join |
| 2 | `collection-analytics.ts` 的 `SOURCE_DIMENSION` 是 `Partial` | **死** | Step 2 合进 `dimensions.source`，`null` 显式 |
| 3 | `lib/chat/tools.ts` 三处 prompt 平台字面量 | **死** ✅ | Step 1 改 `COLLECTION_PLATFORMS` 派生（**并含 `lib/chat/prompts.ts` 的第四处**）+ `tools.test.ts` 的 `model-facing platform list` 守卫 |
| 4 | 凭据链 5 处手写零交叉校验 | **活** | 无。那 5 处的值是 zod schema / hook / union 类型 / React 卡片 / `probeReady` 闭包，全是重物或结构 |
| 5 | 新 view 里的英文硬编码文案 | **活** | 无。`i18n-no-hardcoded.test.ts` 只拦 CJK，与注册表无关 |
| 6 | `.env.local` 平台块无文档 | **死** ✅ | Step 1 让 `.env.example` 转正（tracked，43 键，零密钥），守卫该半边改为**必须存在** |
| 7 | `capability-marquee.tsx` 手工药丸表（本次发现） | **死** ✅ | Step 1 加 AST 覆盖断言（D5：不派生） |

**七条 → 两条。**

---

## 附录 B — `[UNKNOWN]` 清单（执行时消解并回写）

| # | 项 | 在哪一步消解 |
| --- | --- | --- |
| **U-1** | `theme/core/palette.ts` 改为 import `collection-platform-registry.ts` 后，模块初始化顺序是否影响 `createPaletteChannel`。静态分析无环（`register-icons.ts` 无 theme 回边，registry 的 `IconifyName` 是 `import type`），但同 chunk 内的初始化顺序需实测 | Step 2 |
| **U-2** | WXT 的 config 加载器对 `wxt.config.ts` → `./lib/collections/platform-descriptor` → `import type ./analytics-types` 这条链是否干净。高置信度可以，但要 `pnpm build` 证 | Step 2 |
| **U-3** | 契约测试要删/改的断言精确条数。已知是 §2.1 那 12 项对应的 AST 读取，但该测试内部结构未逐行核过 | Step 2 |
| ~~**U-4**~~ | **已消解 2026-09-07**：`.env.local` 已用 `# KEY=` 形式覆盖全部 30 个平台键、值与守卫表 fallback 逐条相同，`.env.example` 直接由它派生（去密钥、去 douyin 死块）。转正后守卫该半边为绿 | ~~Step 1~~ |
| **U-5** | `BrandColoredPlatform`（`theme-config.ts:48` 附近）除 `platform` 块外是否还有消费者。有则不能随块删除 | Step 2 |

---

## 附录 C — 本手册范围外的已知问题

复核时发现、**不属于本手册**、但记下来免得丢：

1. **仓库无 CI**。`.github/` 不存在，而 README:115 写着 "Issues and focused pull requests are welcome"。`platform-onboarding.md` §2 的整个策略是"让编译器和契约测试替你生成 TODO"，但对一个从 issue 走进来的外部开发者，这两个机器检查**只有在他先读完 339 行 spec 再手动敲五条命令时才会发生**。这是那份 spec 最大的未满足前提。D1 的时候用户选了架构改造而非这条，故不在本手册。
2. **Platform Request 到实现之间无路由**。`lib/repo.ts` 的 `PLATFORM_REQUEST_ISSUE_URL` 在收集平台请求（CONTEXT.md 已定义它是外链动作），但从"用户提了 issue"到"有人去实现"之间没有任何指引：README 没提，issue 模板不存在，接入契约藏在 `.trellis/`（一个外人不会翻的开发流程目录）。
3. **`App.tsx` 六平台 eager 图**（§0.2 第 2 条）。`App.tsx:7` → `collection-platform-auto-sync.ts:5-10` 六个静态 sync adapter import，app.html 根加载图带着六个平台完整领域层。性能问题，另开任务。
4. **`.env.local` 的 douyin 死块**（Step 1 执行时发现）。8 个 `VITE_DOUYIN_*` 带完整中文注释，全仓库零代码读取，唯一提及是 `docs/13`。守卫的 orphan 正则由 `COLLECTION_PLATFORMS` 拼前缀，所以抓不到非平台前缀的孤儿键——它已经静默躺在那儿了。未复制进 `.env.example`；用户本地 `.env.local` 未动。若 douyin 确已放弃，该块应删；若仍在计划内，它属于 platform-onboarding 的输入而非残留。
