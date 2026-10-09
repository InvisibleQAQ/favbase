# favbase

把社交平台的收藏夹变成可检索知识库的 local-first 浏览器扩展（Chrome MV3），MVP 阶段。
已接入 7 个 Collection Platform：bilibili / github / bookmarks / x / zhihu / youtube / douyin，判别符的唯一事实源是 `lib/collections/platforms.ts` 的 `COLLECTION_PLATFORMS`。

领域术语见 `CONTEXT.md`，产品事实见 `PRODUCT.md`，架构决策见 `docs/adr/`。

## 命令

- `pnpm dev` / `pnpm build`（build 之后自动跑 Background SW 的 bundle 检查）
- `pnpm compile`：`tsc --noEmit`，依次覆盖扩展与 `packages/*`
- `pnpm test`：vitest，同样覆盖两者；单跑一个文件用 `pnpm vitest run <path>`
- 项目没有 linter，所有守卫都是 vitest 测试。
- 全量测试偶发 5 s / 10 s 超时（并发的 `PGlite.create` 与冷 import 互相挤压，最常见于 `tests/lib-import-smoke.test.ts` 和 PGlite 套件的 `beforeAll`），失败集合每次不同。先单跑该文件，单跑是绿的就不是你的改动。
- `vitest.config.ts` 的 `exclude` 必须同时排 `packages/**` 与 `.claude/**`（worktree 住在那里，漏了会把测试收两遍）；`maxWorkers: 8` 是为压住上面的超时，别删。

## 发布

- 扩展：根 `package.json` 的 `version` 是扩展版本的唯一事实源，每次提交 Chrome Web Store 前必须递增，且不能全为零。依次 `pnpm compile`、`pnpm test`、`pnpm zip`，上传 `.output/*-chrome.zip`。
- `minimum_chrome_version` 是 117：MUI v9 的下限，同时满足 Agent Bridge 需要的 116（WebSocket 流量延长 SW 生命周期）。
- manifest 的 `host_permissions` 由 `lib/collections/platform-descriptor.ts` 派生，顺序是契约。重构之后产物必须逐字节不变：已装扩展的权限一变，用户就要重新授权。
- npm 包 `favbase`（CLI）：流程在 `packages/favbase/CLAUDE.md` 的 Release 一节。`main` 上的 `skills/favbase/SKILL.md` 必须始终等于 npm 最新版捆绑的那份，所以改它就等于一次发版。

## 架构速览

- WXT 0.20（Vite）+ React 19 + TypeScript 5.9。改 WXT 的配置或 API 之前，先用 context7 查 WXT 文档。
- 运行时与入口：
  - Background SW：`entrypoints/background.ts` → `lib/background/`
  - Offscreen Document（PGlite 的持有者，兼 FFmpeg）：`entrypoints/offscreen.html` → `lib/offscreen/`
  - Extension Page `app.html`：`entrypoints/app/`；首装引导 `welcome.html`：`entrypoints/welcome/`；Popup 只是打开 app.html 的跳板
  - B站视频页：Content Script（Shadow DOM）`entrypoints/bilibili-video.content/`，Main World 注入 `entrypoints/bilibili-inject.content.ts` → `lib/bilibili/inject/`
- 存储：WXT `storage.defineItem`（设置、缓存）+ PGlite / Drizzle / pgvector（知识库）。
- Agent Bridge：扩展主动出站 WebSocket（ADR 0002），Node 侧是 `favbase` CLI 加常驻 daemon（`packages/favbase`，ADR 0003）。不提供 MCP server。

## 规则

这些从代码里看不出来，或者看起来可以「顺手改掉」。

### UI

- app.html 用 MUI v9，主题是 Minimal Dashboard v7.7.0 的移植（`entrypoints/app/theme/`）。system props 一律走 `sx`；`<Typography color="text.secondary">` 这种点号写法类型能过但不产生样式，禁用。
- Content Script 用原生 CSS 和 `--fb-*` design tokens，不用 MUI。
- 重依赖各有唯一的 import 入口：`sonner` 只在 `entrypoints/app/components/snackbar/**`，`simplebar-react` 只在 `entrypoints/app/components/scrollbar/**`，`motion` 只在 `entrypoints/welcome/**`。守卫是 `tests/ui-vendor-boundaries.test.ts`，新的同类边界规则加进这个文件，不另起测试。
- toast 只报一次性动作的结果。持续状态（已保存徽标、连接状态、拉取进度）不进 toast。
- welcome.html 不挂 `SettingsProvider`，所以不得 import `app/layouts/components` 的 barrel 或 `app/components/settings`（同一个守卫）。
- 移植 Minimal 组件时 `m` 改成 `motion`，不引入 `LazyMotion`（docs/28 §3.2）。

### 平台

- 接入新平台照 `.trellis/spec/frontend/platform-onboarding.md` 做。它的 §2 守卫表写明哪些活儿 `tsc` 和契约测试会替你列出来，哪些仍要手写。
- 平台事实只写在两份穷举 descriptor 里：领域半边 `lib/collections/platform-descriptor.ts`，UI 半边 `entrypoints/app/collection-platform-registry.ts`。其余注册表从它们派生；为什么是两份见 ADR 0004。
- 共享模块零平台知识：`lib/tagging`、`lib/embedding`、`lib/chat`、`lib/export` 和 `lib/collections` 的共享查询里，不得出现平台 id 字面量或写死的 `platform_meta` key。守卫是 `tests/platform-completeness-contract.test.ts`。
- `lib/` 不得 import `entrypoints/`（没有守卫测试，依据是 ADR 0004）。
- 各平台的 sync-service 和 `tests/lib-import-smoke.test.ts` 清单里的 lib 模块，必须能在没有 `chrome` 全局、零 mock 的环境下被 import。不要靠加防御性的 storage mock 让它变绿。
- `lib/` 禁止裸 `fetch(`，用 `lib/http` 的 `fetchWithDeadline`；`lib/<platform>/` 禁止手写 `setTimeout` 等待，用 `sleep`；平台的数值常量一律写成 `envNumber('VITE_<PLATFORM>_<NAME>', 默认值)`（`lib/env.ts`），并在 `.env.example` 对应的平台块登记。三条各有守卫测试。
- 收录是 insert-only：重新同步不更新、不删除已入库的条目（`sources` 行除外）。规则的 owner 是 `lib/ingest/CLAUDE.md`。
- Chat 与 Agent Bridge 共用同一套只读 Knowledge Tool（`lib/chat/tools.ts`），两边的工具集必须完全相同。
- Platform Request 是指向 GitHub issue 的动作外链，不是平台，不得进 `collectionPlatformRegistry`。
- 文案、注释、测试名、文档不写平台数量（「六个平台」「7 platforms」）：平台随时新增，数字必过期（用户决定 2026-10-07）。要列平台就指向 `COLLECTION_PLATFORMS`。没有守卫，靠 review。

### 对外契约

- `lib/repo.ts` 的 `AGENT_SETUP_GUIDE_URL` 指向 `main` 上 `skills/favbase/INSTALL.md` 的 raw 地址。用户会把它贴进自己的 prompt，路径和分支名都不能再动（ADR 0005）。

## 跨 runtime 协议

- Bilibili 页面桥、Background runtime、Offscreen runtime 各自维护自己的协议 Module。不要建一个横跨页面、Background、Offscreen 与 Database RPC 的全知协议。
- runtime 边界上的 `unknown` 必须先过所属的 decoder。调用方用 typed client，禁止对 `sendMessage` 的响应做裸类型断言。
- 新消息要同时注册请求 / 响应 schema、路由和 contract test。
- 浏览器内部协议 envelope 的 `channel` / `protocolVersion` 是可选的兼容元数据：新发送方发 v1，旧消息仍可接收。未知 type、非法 payload、错误 sender 静默拒绝；非法响应在本地抛协议错误。
- 外部 Agent Bridge 没有 legacy 用户，用 `lib/agent-bridge/protocol.ts` 的严格 v1 envelope。
- Background → tab 的 status push 同样要过 encoder / decoder。Database Port RPC 归 `lib/database/bridges/`，不并入上面这些协议。

## i18n

自研的 `lib/i18n/`，无外部依赖，机制细节见 `lib/i18n/CLAUDE.md`。写代码时要守的：

- 新增 key 同时改 `lib/i18n/locales/zh-CN.ts` 与 `en.ts`（`LocaleKeys` 从 zh-CN 推导）。
- React 组件经 `useTranslation()` 订阅 locale。用了模块级 `t`、`formatCompactNumber`、`formatDateTime` 的组件也要在组件内调一次 `useTranslation()`，否则切换语言不重渲染。
- 翻译的 seam 在 UI 边界：`lib/` 只传结构化数据（错误码或阶段，加参数），由 UI 层调 `t()`。
- 复数用 `t(key, { count })`，按 `{key}.one` / `{key}.other` 选变体。需要区分单复数的 key，zh 与 en 都要定义 `.one`（zh 的 `.one` 与 base 同值）。
- `entrypoints/**/*.tsx` 不得硬编码中文。守卫是 `tests/i18n-no-hardcoded.test.ts`，单行豁免写 `// i18n-ignore`。英文硬编码没有守卫，靠 review。
- 收藏页 pipeline 的共享短标签放在 `pipeline.*`，由 view 翻译后传给零 `t()` 的共享组件。

## 文档地图

动下列区域之前先读对应文档。落地状态和决策经过写在各文档自己的状态行与落地记录里，不在这里。

| 要动的东西 | 先读 |
|---|---|
| 产品范围、功能定义 | `docs/03_favbase-prd.md` |
| B站转录管线 | `docs/04_bilibili-transcription-spec.md` |
| B站字幕接口、收藏夹请求；让书签提取改用 defuddle 的异步入口 | `docs/29_bilibili-transcript-mismatch-diagnosis-and-remediation-2026-09-21.md` |
| 新收藏平台 | `.trellis/spec/frontend/platform-onboarding.md` |
| Platform Descriptor、平台注册表 | `docs/26_platform-descriptor-consolidation-manual-2026-09-06.md` §1、§3；`docs/adr/0004` |
| 同步 funnel、平台错误模型、重试、收藏页 hook、查询片段 | `docs/32_platform-flow-unification-audit-2026-09-29.md` §2（已否决清单，不得重提）和对应 Step 的落地记录 |
| 平台分层、lib 的 import 边界 | `docs/20_multi-platform-architecture-deepening-audit-2026-08-21.md` |
| 抖音 | `docs/33_douyin-collection-platform-manual-2026-10-03.md` §1–§3 |
| 抖音的字幕 / 转录 / 打标签接入（内容模型翻转） | `docs/37_douyin-transcription-manual-2026-10-08.md` §1 决策、§2 否决清单、§3 铁律 |
| app.html 的主题、shell、共享原语、Dashboard、Settings、Chat 外壳 | `docs/25_app-ui-minimal-alignment-manual-2026-09-01.md` 对应 Step 的偏离与勘误，附录 C、D |
| app.html / welcome.html 对照 Minimal 的视觉保真度；截扩展页的方法 | `docs/31_minimal-ui-polish-2026-09-27.md`（§1 截图步骤，§3 未定项） |
| welcome.html 的外壳与动画 | `docs/28_welcome-minimal-alignment-2026-09-08.md` §3 拒绝清单 |
| welcome 截图画廊（`product-tour.tsx`、`public/assets/images/welcome/`） | `docs/35_welcome-real-screenshots-2026-10-03.md` |
| Agent Bridge 的扩展侧、CLI、Skill | `docs/30_agent-bridge-architecture-review-2026-09-27.md` 的「待决策汇总」与「执行顺序」；`docs/adr/0002`、`0003`、`0005` |
| Agent Bridge 的本地测试、doctor、安装指引 | `docs/27_agent-bridge-local-testing-and-improvements-2026-09-07.md` |
| Agent Bridge 的重连与认证失败 | `docs/24_agent-bridge-reconnect-latency-remediation-2026-09-01.md`（其中的 bad-token 退避已被 docs/30 #1 删除） |
| 借用参考 UI 模板的方法 | `docs/22_ai-ui-reference-adaptation-best-practices.md` |
| 任何 `CLAUDE.md` 的结构或维护规则 | `docs/36_claude-md-best-practices-2026-10-04.md` |

仅存历史，不要照着做：`docs/19`（app 设计审查，其中的三行 scaffold 方案已被否决）、`docs/21`（Agent Bridge 的最初方案，MCP 相关部分被 ADR 0003 取代）、`docs/23`（第一轮 Minimal 适配，被 docs/25 §3 推翻）。

本机的参考实现：

- Minimal Dashboard v7.7.0，app.html 唯一的 UI 参考源，文档里记作 `$MIN`：`C:\Users\18368\Desktop\00_myCode\35_minimal\minimal-dashboard\minimal-dashboard v7.7.0\Vite.js (JavaScript，TypeScript)\minimal-vite-ts-main\src`
- Bilitato，B站转录的参考实现：`C:\Users\18368\Desktop\00_myCode\24_cyberSquirrel\02_Bilitato`

## 目录 CLAUDE.md

子系统的约束写在各自目录的 `CLAUDE.md` 里，读写该目录的文件时自动加载。下面只列从目录名猜不到的 owner：

- 平台判别符、descriptor、eligibility、平台错误基类：`lib/collections/`
- 收录管线、insert-only、幽灵自愈：`lib/ingest/`
- 请求 deadline、重试、sleep 与退避：`lib/http/`
- PGlite RPC proxy、表结构、迁移：`lib/database/` 及其 `entities/`、`bridges/`、`migrations/`
- storage key 与命名空间：`lib/storage/`
- 收藏页状态机、job store、Platform Sync funnel、pipeline、面包屑：`entrypoints/app/hooks/`
- 收藏页骨架与卡片（零 `t()`）：`entrypoints/app/components/collection/`；它的翻译半边：`entrypoints/app/components/collection-states/`
- tagged card 工厂与标签 UI：`entrypoints/app/components/tags/`
- 侧栏行几何与激活态：`entrypoints/app/components/nav-section/`；shell 的 CSS 变量：`entrypoints/app/layouts/`
- 主题 token 与组件覆盖：`entrypoints/app/theme/`
- Knowledge Tool、检索、会话持久化：`lib/chat/`；Agent Bridge 的协议与 WS client：`lib/agent-bridge/`；CLI 与 daemon：`packages/favbase/`；Skill 与 Agent Setup Guide：`skills/favbase/`
- SW 的消息分发：`lib/background/`；跨 runtime 共享的 schema 片段：`lib/runtime-message/`
- 转录：`lib/transcription/`（管线，兼 app 侧落库 seam `transcribe-and-persist.ts`）、`lib/auto-transcribe/`（状态机）、`lib/cache/`（字幕缓存）、`lib/subtitle/`（共享类型）

其余按名字找：

- 每个平台两份：`lib/<platform>/` 与 `entrypoints/app/sections/<platform>/`（github 的 section 目录叫 `github-stars`；bilibili 另有 `lib/bilibili/inject/`）
- `lib/{ai,embedding,tagging,summary,sync,export,permissions,events,hooks,i18n,offscreen}/`
- `entrypoints/`、`entrypoints/app/`、`entrypoints/app/{pages,utils,sections}/`、`entrypoints/app/sections/{overview,settings,settings/embedding,chat,collections}/`
- `entrypoints/app/components/{label,empty-content,custom-breadcrumbs,custom-popover,scrollbar,snackbar,loading-screen,chart,iconify,settings,library-gate,configuration-blocker,auto-transcribe}/`
- `entrypoints/welcome/`、`entrypoints/bilibili-video.content/` 及其 `components/`、`hooks/`
- `scripts/`

## 维护 CLAUDE.md

本节是全局规则「文档即代码」在本仓库的执行口径，依据是 docs/36。

- 只写「删掉这一行，Claude 就会犯错」的内容：代码里看不出来的约束、坑、看起来能顺手改掉的刻意决定（附半句原因和 `docs/NN §X` 或 ADR 指针）、已知缺口、规则由哪个守卫测试守着。
- 不写：改了什么、哪天落地、谁决定的经过（这些进对应 `docs/NN` 的落地记录或 commit message）；逐文件描述、导出清单、函数签名；测试断言了什么；代码里读得到的数值。
- 改代码时，只有出现了新约束、新坑，或已有条目不再成立，才改对应目录的 `CLAUDE.md`。「这次改了什么」不是更新它的理由。
- 新目录有代码里看不出来的约束才建 `CLAUDE.md`，没有就不建。新平台的 `lib/<platform>/` 与 `sections/<platform>/` 例外，spec 要求它们有。
- 每个文件 200 行以内，一条 bullet 一个事实。
- 根文件每个会话都全量加载，只放处处适用的规则和指针。往这里加一行之前，先问它是不是每个会话都用得上；只和一个子系统有关的，写进那个目录的文件。
