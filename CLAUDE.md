# favbase

Turn your social media Favorites into a searchable knowledge base just with a local-first browser extension

## 技术栈

- **框架**: WXT 0.20.26 (Vite) + React 19 + TypeScript 5.9
- **架构**: Chrome MV3 (Service Worker + Content Script + Shadow DOM UI + Extension Page)
- **UI 框架**: MUI v9（`@mui/material` 9.4，Extension Page；主题层是 Minimal Dashboard `theme/core` 的移植 + Favbase 品牌 token，见 `entrypoints/app/theme/CLAUDE.md`；system props 已全部走 `sx`，v9 的 `Typography color="text.secondary"` 点号形式类型通过但不产生样式，禁用）+ 原生 CSS + `--fb-*` design tokens (Content Script Shadow DOM)；Chat 回答用 `react-markdown` + `remark-gfm` 渲染（无 rehype-raw，XSS 安全）
- **动画**: `motion` 12（framer-motion 现名），**仅 welcome.html 用**（单独 code-split 进 welcome chunk）。app.html / Content Script 保持纯 MUI + CSS，不要因为装了这个包就往其他入口加动画依赖
- **AI SDK**: Vercel AI SDK v6（`ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic` + `@ai-sdk/google` + `@ai-sdk/openai-compatible`）
- **存储**: WXT `storage.defineItem`（设置/缓存） + PGlite 0.5 + Drizzle ORM 0.45 + pgvector（知识库）
- **Agent Bridge 外部面**: `packages/favbase-cli`（npm `favbase-cli`，bin `favbase`；Node 20+，仅 `ws` + `zod`，tsup ESM）= 薄 CLI + 常驻 Bridge Daemon；agent 经 `skills/favbase/SKILL.md` 学会调 CLI。**不提供 MCP server**（ADR 0003）
- **包管理**: pnpm workspace；根 `compile` / `test` 依次覆盖扩展与 `packages/*`

## Chrome 发布

- 根 `package.json` 的 `version` 是扩展版本的单一事实源；每次提交 Chrome Web Store 前必须递增，且不能全为零。
- Manifest 最低版本为 Chrome 117：MUI v9 最低支持 Chrome 117（docs/25 D2，2026-09-01）；同时覆盖 Agent Bridge 的 116 下限（自 116 起 WebSocket 流量可延长 MV3 Service Worker 生命周期）。
- 依次运行 `pnpm compile`、`pnpm test`、`pnpm zip`；上传 `.output/*-chrome.zip`，无需手工生成 CRX。

## 当前状态

MVP 阶段，首个功能：B站视频收藏夹知识库。未来会支持多个平台收藏夹, 集成更多知识库. 

## 入口点

WXT 入口点及运行时角色总览，详细结构见对应目录 `CLAUDE.md`（见下方[目录文档索引](#目录文档索引)）。

- `entrypoints/background.ts` — Background Service Worker（→ `lib/background/`）
- `entrypoints/bilibili-inject.content.ts` — B站视频页 Main World 脚本（`world:'MAIN'` → `lib/bilibili/inject/`）
- `entrypoints/bilibili-video.content/` — B站视频页 Content Script（Shadow DOM React UI，Isolated World）
- `entrypoints/app/` — Extension Page 主界面（`app.html`，MUI v9 Dashboard）
- `entrypoints/welcome/` — 首装引导页（`welcome.html`，滚动叙事 + 平台多选 → app.html；由 background `onInstalled` 弹出）
- `entrypoints/popup/` — Popup 跳板：打开/聚焦 app.html 标签页

## 关键文档
- 使用wxt框架进行开发, 必须使用 `context7 mcp`查询 wxt文档.
- `docs/03_favbase-prd.md` — 完整 PRD（知识库全功能）
- `docs/04_bilibili-transcription-spec.md` — B站视频转录功能实现规格
- `docs/19_app-design-critique-2026-08-20.md` — app.html 设计审查与分阶段整改计划（Phase 0 token 层 + P0 已落地：`theme/`、`components/collection/collection-card.tsx`；P0-1 的三行 scaffold 被用户否决并于 2026-08-20 恢复原堆叠，仅保留 `role=status` 与色彩；Phase 2-4 待做）；产品事实见 `PRODUCT.md`
- `docs/20_multi-platform-architecture-deepening-audit-2026-08-21.md` — 多平台架构深化审计（2026-08-22 修正版：9 条发现逐条源码复核 + 无 mock import 冒烟实证；修订后主线是中-5→高-4/中-8 收回 Bilibili 平台事实、高-1 用 import-smoke contract 取代注释规则；offscreen 不加载任何平台 sync。**高-1 已落地 2026-08-22**（`tests/lib-import-smoke.test.ts` + zhihu/youtube/bilibili 改 leaf + 六处防御性 storage mock 删除）；**中-5 已全部落地 2026-08-22**：`persistContent`/`startProcessingDirectly` 删除，`startProcessing` seam 改必填（coordinator 构造器 `(startProcessing, trackRun?)`），`lib/bilibili` 零 `@/lib/embedding`/`@/lib/tagging` value import，`transcribe-utils` 进 import-smoke 清单；`auto-transcribe-adapter.test.ts` 的 storage mock 是功能性的，保留。**中-6 已落地 2026-08-22**：`useCollectionLibrary` 加唯一受控 seam `controlledFilter?: string | null`（render 期回页 1，`setFilter` no-op），`use-bookmarks.ts` 改薄 adapter（路由 folderId 受控注入 + 挂载 `sync()` 留 adapter）；`autoSyncOnMount`/metaLoading 延后经复核不需要（phase 阶梯 `syncingEmpty` 已锁 skeleton）。**高-2（嵌套路由登记）已落地 2026-08-22**：`COLLECTION_PAGE_CHILD_ROUTES` 穷举表 + `main.tsx` 零平台路由行；**高-3（修订为中）已落地 2026-08-22**：daily auto-sync registry 搬至 app 根 `entrypoints/app/collection-platform-auto-sync.ts`，`jobPlatform` 派生，六 adapter 导出 `<p>AutoSyncPolicy`，`hooks/` 零 `sections/` import；**高-4 已落地 2026-08-22**：失效视频规则收回 `lib/bilibili/video-eligibility.ts`（常量 + 内存判定 + SQL predicate + parity test），共享 policy 按穷举 registry `lib/collections/platform-eligibility.ts` 注入、零平台字面量；**中-7（修订为低）已落地 2026-08-22**：实际重复点是 6 处（github/x/zhihu/youtube/bookmarks + bilibili 两页）而非 4 处，`useCollectionPipeline`（`entrypoints/app/hooks/use-collection-pipeline.ts`）+ `collectionPipelineStages`/`fetchedCountProgress` 收编 stages 数组、`pipeline.*` 标签翻译与 coverage refresh key，view 只注入 Fetch runtime 与 content 段；中-8 的 `narrow*Meta` 待做）
- `docs/21_agent-bridge-analysis-2026-08-22.md` — Agent Bridge 分析/决策/设计/路线（Phase 0–4 已完成）；**2026-08-28 起外部面改为 Skill-first（`docs/adr/0003`）**：检索仍在 SW 内复用 `chatTools`、传输仍是扩展出站 WS（ADR 0002），但 Node 侧是 `favbase` CLI + 自启 daemon 而非 MCP；docs/21 的 Q5/Q9/Q10 与 §6.6 已被 ADR 0003 取代；术语 Agent Bridge / Knowledge Tool / Bridge Token / Bridge Daemon / favbase CLI 在 `CONTEXT.md`
- `docs/24_agent-bridge-reconnect-latency-remediation-2026-09-01.md` — Agent Bridge 重连延迟整改方案。Step 0 已用 bad-token 黑盒实验定因；Step 1-4 已于 2026-09-01 落地：显式 connect-now 穿透自动退避、已认证 peer 阻止 daemon idle 自灭、75 秒 hello wait 覆盖旧 Chrome 的 60 秒 alarm、daemon/扩展双视角保留认证失败痕迹并由 doctor/设置页诚实呈现。v1 wire protocol 未改，Step 5 默认常连策略与 Step 6 Offscreen 迁移仍待评估。
- `docs/22_ai-ui-reference-adaptation-best-practices.md` — AI 借用参考 UI 模板的方法论（冻结产品契约 → 采证 → 提炼设计语言 → 适配矩阵 → 目标规范 → 垂直切片 → 分层迁移）；docs/23 与 docs/25 按此流程产出
- `docs/23_favbase-app-minimal-dashboard-v7-adaptation-plan-zh-CN.md` — app.html 向 Minimal v7 借鉴的第一轮方案（2026-08-26，"保留自有世界、只借结构"路线，自述 Phase 0-4 已完成、Phase 5 已实施待审阅，`docs/ui-baseline/2026-08-31/phase7-validation/` 是其运行时验证截图；其 §6 适配矩阵与 §11 拒绝清单已被 docs/25 §3 推翻，仅存历史）
- `docs/25_app-ui-minimal-alignment-manual-2026-09-01.md` — app.html **全面向 Minimal v7.7.0 看齐**的分步改造手册（**Step 0–4 已落地（Step 0–2 于 2026-09-01，Step 3 于 2026-09-02 rebase 合入，Step 4 于 2026-09-02），Step 5+ 未开工**；Step 1 = `theme/core` 换血：Minimal palette/shadows/mixins/一文件一组件覆盖 + `text.accent`/coral/platform 品牌 token 保留，C-2/C-3/C-4 已消解——dark neutral 回退 `#222B34`、soft primary 文字 `text.accent`、Menu 继承 Popover paper；Step 2 = 六色预设 + 设置状态数据层：`lib/storage/theme-settings.ts`（`local:themeSettings`，无 `version` 字段，逐字段 canonicalize）→ `theme/with-settings/`（`primaryColorPresets` + D14 WCAG 派生 `contrastText`、`applySettingsToTheme` 换 primary/派生 `text.accent`/high-contrast grey-200 底 + z1 卡片阴影）→ `components/settings/` context（`SettingsProvider` 挂 `main.tsx`，`ThemeProvider` 可选读 leaf context，welcome 不受影响）；dark `primary.lighter` 再着墨特判删除，选中洗底统一 `varAlpha(primary.mainChannel, 0.08)`；C-5 全过线；抽屉 UI 留 Step 4；Step 3 = 六个共享原语（Label/EmptyContent/CustomBreadcrumbs/CustomPopover/Scrollbar/LoadingScreen）+ `theme/create-classes.ts`：其前置只有 Step 1，与 Step 2 是并列兄弟（只有 Step 4 同时需要两者），因此并列开发后再 rebase 到 Step 2 之上；C-6 已消解（EmptyContent 不设默认 title），并修掉 Minimal 在 MUI v9 下的移植缺陷（`slotProps.paper.ref` 不再转发，CustomPopover 箭头改经 `parentElement` 反查 paper）。**跨 Step 遗留复核项**：Label 的 `inverted` 变体以动态索引引用 `palette[color].darker` 文字 on `lighter` 底（dark 反向），是刻意反色，不属于 Step 2 第 9 点要替换的那五处浅底；但 Step 2 的 C-5 只验了 `text.accent` 派生阶、`color-presets.test.ts` 只验 `contrastText` on `main`，**六预设下这个 `darker`-on-`lighter` 组合的对比度无人验证**，Step 4 未接入任何 `Label` 消费者（抽屉 Mode 用 `OptionButton` 而非 Minimal 的 System 药丸），该项仍悬空，顺延到首个真实消费者（Step 6/8 最可能）；Step 4 = shell：`components/nav-section/`（vertical + mini + flyout，行几何/激活态/连接线 owner）+ `layouts/dashboard/{nav-vertical,nav-mobile,use-translated-nav}` + `layouts/components/` 四控件 + `components/settings/drawer/` 外观抽屉 + `theme/mode-transition.ts`；`nav-config.tsx` 改 `NavGroup[]` 两组；删 `nav.tsx`/`header-actions.tsx`/`layouts/nav-active.ts`；**手册未覆盖的三处按 Minimal 优先解决**——鱼骨线换 Minimal bullet + 竖脊（用户 2026-09-02 决定）、welcome 顶栏主题药丸迁到 `welcome/sections/top-bar-actions.tsx`（否则删 `header-actions.tsx` 会打断 welcome）、`compactLayout` 语义改「on = 收窄到 lg / off = 用页面自己的 cap」（每页都显式传 `maxWidth`，Minimal 的默认参数映射永不生效））：Step 0 MUI 9 + Chrome 117 → Step 1 theme/core 换血 → Step 2 六色预设 + 设置状态 → Step 3 共享原语 → Step 4 nav-section/header/设置抽屉 → Step 5 sonner → Step 6 Dashboard KPI + 原生 SVG 图表 → Step 7 Settings → Step 8 六平台页 → Step 9 Chat shell → Step 10 收口；每步八段（目标/依赖/文件/改法/测试重写/验证/回滚/判据），决策来源逐条标"用户决定 / PRD 默认"，`[UNKNOWN]` 与 PRD 勘误集中在附录 C/D。执行任一 Step 前先读该文对应节
- `.trellis/` — Trellis 开发工作流配置
- `tests/platform-completeness-contract.test.ts` — 单一聚合失败的跨层平台接入契约；以 TypeScript AST 对账 app/welcome/build/test 各层 Adapter（含 `COLLECTION_PAGE_CHILD_ROUTES` 子路由表须为显式数组字面量，且 `main.tsx` 不得出现 `collections/<platform>` 字面量），避免加载 DB 或页面 runtime；daily auto-sync registry（`entrypoints/app/collection-platform-auto-sync.ts`）须每平台显式 `runSync` 且不得手写 `jobPlatform`；`entrypoints/app/hooks/` 非测试模块不得 import `sections/`；downstream eligibility registry（`lib/collections/platform-eligibility.ts`）六平台显式键（`null` 合法），且 `lib/collections/collection-processing-policy.ts` 不得含平台字面量/`platformMeta`/`->>`
- `tests/lib-import-smoke.test.ts` — lib 层 import-smoke 契约（docs/20 高-1 + 中-5）：Agent Bridge 协议/registry、六个平台 sync-service（由 `COLLECTION_PLATFORMS` 派生、自动发现 `lib/<platform>/*-sync-service.ts`）+ `embedding/chunker`/`char-split`、`collections/platforms`、`ingest/ingest`、`database`、`bilibili/transcribe-utils`（转录 seam）在无 `chrome` 全局、零 `vi.mock` 下 `import()` 零未处理 rejection；取代注释与散落的防御性 storage mock
- `tests/ui-vendor-boundaries.test.ts` — 重量级 UI 依赖的归属守卫（docs/25 跨 Step 铁律 6）：`simplebar-react` 只允许 `entrypoints/app/components/scrollbar/**` import（含其 CSS），`entrypoints/**` 与 `lib/**` 其余位置一律禁止；同时反向断言 owner 目录确实用了它，避免规则空转。Step 5 把 `sonner`（owner `components/snackbar/**`）加进同一张 `VENDOR_RULES` 表
- `tests/setup/app-dom.ts` — vitest `setupFiles`（`vitest.config.ts` 注册）：happy-dom 缺失的 `ResizeObserver` stub，仅为 `components/scrollbar/`（simplebar）与 `components/custom-popover/`（箭头测量）
- `vitest.config.ts` — 主仓库 vitest：`exclude` 必须同时排 `packages/**`（各自 `pnpm -r test`）与 `.claude/**`（git worktree 所在地；漏了它，worktree 的测试文件会被叠加收进主仓库这一跑，文件数翻倍并加剧超时抖动）
- `wxt.config.ts` — built-in platform host permissions 由 `PLATFORM_HOST_PERMISSIONS` keyed map 声明，`PLATFORM_HOST_PERMISSION_LIST` 负责 manifest spread；Bookmark `<all_urls>` 仍是显式平台 Adapter

## 参考项目

- `C:\Users\18368\Desktop\00_myCode\24_cyberSquirrel\02_Bilitato` — Bilitato 开源项目，B站视频 AI 助手，是视频转录功能的主要参考实现
- `C:\Users\18368\Desktop\00_myCode\24_cyberSquirrel\06_material-kit-react` — Material Kit React，MUI Dashboard 模板，app.html 布局骨架与主题机制参考（视觉 token 值已按 `docs/19` 换成目录卡片库方向，不再沿用其配色）

## 目录文档索引

各模块的详细结构与约定已下沉到对应代码目录的 `CLAUDE.md`。改动某模块时，同步维护该目录的 `CLAUDE.md`（没有就建）。i18n 是唯一横切全局的例外，保留在本文件（见下方 [i18n](#i18n)）。

### Extension Page（app.html）
- `entrypoints/app/CLAUDE.md` — 主界面入口、Hash Router、路由结构
- `entrypoints/app/theme/CLAUDE.md` — MUI v9 主题系统（palette/typography/shadows/components）
- `entrypoints/app/layouts/CLAUDE.md` — 仪表盘布局系统（shell CSS 变量 owner）+ 侧栏 vertical/mini/mobile 三形态 + Header 右侧四控件 + `layouts/components/` 控件（`NavToggleButton`/`LanguagePopover`/`SettingsButton`/`GithubButton`）
- `entrypoints/app/components/nav-section/CLAUDE.md` — 移植后的 Minimal 侧栏（vertical + mini + flyout；行几何/激活态/连接线的唯一 owner，i18n seam 在 `layouts/dashboard/use-translated-nav.ts`）
- `entrypoints/app/components/iconify/CLAUDE.md` — Iconify 离线图标系统
- Minimal 共享原语（docs/25 Step 3 移植，一目录一 CLAUDE.md）：
  - `entrypoints/app/components/label/CLAUDE.md` — 状态药丸（soft/filled/outlined/inverted × palette+common 色；children 不做 upperFirst）
  - `entrypoints/app/components/empty-content/CLAUDE.md` — 空态/错误态外壳（`StateBox` 的底座；无默认插图与默认 title，文案落 `text.secondary`）
  - `entrypoints/app/components/custom-breadcrumbs/CLAUDE.md` — 标题 + 祖先路径 + 动作（heading 是页面唯一 h1；`SectionTitleBar` 传 `links` 时委托它）
  - `entrypoints/app/components/custom-popover/CLAUDE.md` — 带箭头 Popover（**MUI v9 不转发 `slotProps.paper.ref`**，箭头改经 `parentElement` 反查 paper）
  - `entrypoints/app/components/scrollbar/CLAUDE.md` — simplebar 自绘滚动条；**本目录是 `simplebar-react` 的唯一入口**，守卫 `tests/ui-vendor-boundaries.test.ts`
  - `entrypoints/app/components/loading-screen/CLAUDE.md` — 路由 Suspense fallback（不移植 splash-screen；`sections/overview` 的 `AnalyticsLoading` 保留）
- `entrypoints/app/components/collection/CLAUDE.md` — 平台 section 共享展示哑组件（StateBox（现为 `EmptyContent` 薄适配层）/标题栏 h1（可选 `links` 走面包屑）/搜索框/卡片网格 24px gap+分页/chip 行外壳/**`CollectionCard` 六平台条目外壳** + `CollectionCardRow` 链接外行内边距 owner + `CollectionCardSkeleton` 同轨道骨架）+ `CollectionPageScaffold` 页面编排
- `entrypoints/app/components/configuration-blocker/CLAUDE.md` — Collection provider 配置阻塞提醒（resolver + coverage + Settings 深链）
- `entrypoints/app/components/library-gate/CLAUDE.md` — 知识库闸门智能组件（自带 i18n + `useLibraryGate` 订阅；⏸暂停/▶继续构建知识库按钮，scaffold pipeline 行尾常驻）
- `entrypoints/app/components/settings/CLAUDE.md` — 主题设置 context（docs/25 Step 2；Minimal `components/settings` 去掉 font/direction/nav/mode 的数据层：`SettingsProvider`（`main.tsx` 注入 `initialState`，WXT storage 镜像 + 回声去重）/ `useSettingsContext`（无 provider 抛错）/ leaf `SettingsContext` 供 `ThemeProvider` 可选读取；**docs/25 Step 4 追加 `drawer/` 外观抽屉**——360 宽右侧 Drawer，Mode 三选（Light/Dark/System，走 `theme/mode-transition.ts`）/ Contrast / Compact / 六色预设 / 全部重置，挂载点 `App.tsx`，`useSettingsReset()` 把 mode 折进 `canReset`）
- `entrypoints/app/components/tags/CLAUDE.md` — 平台无关标签 UI 子系统（hooks + popover + 筛选 chips + render-prop 网格）
- `entrypoints/app/hooks/CLAUDE.md` — app.html 共享 hooks（useCollectionLibrary 平台无关收藏页状态机，github/x/zhihu/youtube 数据 hook 的底座；useCollectionPipeline 六平台收藏页 pipeline 编排——coverage key + `pipeline.*` 标签 + Fetch→content?→Embedding→Tagging 段声明的唯一 owner）
- `entrypoints/app/utils/CLAUDE.md` — app.html 共享纯函数工具（formatDuration 时长格式化）
- `entrypoints/app/pages/CLAUDE.md` — 页面组件（lazy loaded）
- `entrypoints/app/sections/overview/CLAUDE.md` — 只读 Collection Analytics Dashboard（六平台构成、标签与平台原生维度）；数据导出工具仅由设置页消费
- `entrypoints/app/sections/settings/CLAUDE.md` — 设置页（AI 配置/账号连接/通用/存储 Tab）
- `entrypoints/app/sections/bilibili/CLAUDE.md` — B站收藏夹页（sidebar+grid）
- `entrypoints/app/sections/github-stars/CLAUDE.md` — GitHub Stars 收藏页（语言 chips + 仓库卡片 grid + 一键全量同步）
- `entrypoints/app/sections/bookmarks/CLAUDE.md` — 浏览器书签收藏页（文件夹 chips + 书签卡片 grid + 挂载自动同步 + 统一「立即获取」按钮；同步成功后自动链式正文提取（暂停/继续归 per-platform 闸门）——单例 worker 路由切换不中断 + 进度 caption + 逐条 auto-embed/auto-tag）
- `entrypoints/app/sections/x/CLAUDE.md` — X（Twitter）书签收藏页（作者 chips + 推文卡片 grid + 手动获取按钮 + 未登录空态，凭据无 UI 半 D6）
- `entrypoints/app/sections/zhihu/CLAUDE.md` — 知乎收藏页（收藏夹 chips + 4 类型卡片 grid + 手动获取按钮 + 未登录空态，cookie 直读无 Connections 卡）
- `entrypoints/app/sections/youtube/CLAUDE.md` — YouTube 公开播放列表收藏页（播放列表 chips + 视频卡片 grid + 手动获取按钮 + 未配置空态，API key + 频道经 Connections 卡配置）
- `entrypoints/app/sections/chat/CLAUDE.md` — Chat 一级页面（Agentic RAG 知识库助手，只读 PGlite）：多步 tool-calling agent + 流式回答 + hybrid 检索 + 可点来源卡片 + 工具四态 + 多会话持久化（WXT storage）+ markdown 渲染

### 首装引导页（welcome.html）
- `entrypoints/welcome/CLAUDE.md` — 安装触发与 onboarding 闸门、平台选择驱动落地路由与侧栏优先级但不做 gating、motion 动画原语（MotionBox/FadeIn/AnimatedText/Magnet/OrbitCore）与六个段落

### B站视频页 Content Script
- `entrypoints/bilibili-video.content/CLAUDE.md` — 右侧栏面板 UI 挂载 + Shadow DOM 约定
- `entrypoints/bilibili-video.content/components/CLAUDE.md` — 面板子组件（字幕 / AI 总结 / 设置三 Tab + Markdown 渲染器）
- `entrypoints/bilibili-video.content/hooks/CLAUDE.md` — 字幕检测/获取/转录 hooks

### 平台领域（lib）
- `lib/ingest/CLAUDE.md` — 共享收藏收录管线（`ingestCollection` 五阶段 insert-only 事务骨架 + 两段式 content 写入，github/bookmarks/x/zhihu/youtube 五平台 sync-service 共用）
- `lib/bilibili/CLAUDE.md` — B站 API、字幕获取、领域同步服务
- `lib/bilibili/inject/CLAUDE.md` — Main World 注入状态机 + SPA 路由监控
- `lib/github/CLAUDE.md` — GitHub Star 收录领域（REST API + 新仓库差集串行拉 README + 同步/查询服务，insert-only，README markdown chunk）
- `lib/bookmarks/CLAUDE.md` — 浏览器书签收录领域（`chrome.bookmarks` 本地读取 + normalizeUrl 去重 + 同步/查询，insert-only，无远程凭证；内容提取管线：串行 fetch 书签网页（`<all_urls>` + `credentials:'omit'`）→ defuddle 转 Markdown → chunk 入库，pending→chunked/no_content）
- `lib/x/CLAUDE.md` — X（Twitter）书签收录领域（私有 GraphQL `Bookmarks` 操作 + webRequest 捕获认证 header + 防风控游标分页 + 同步/查询，insert-only，tweet 文本 chunk）
- `lib/zhihu/CLAUDE.md` — 知乎收藏收录领域（公开收藏夹 v4 API + cookie 直读认证 + 串行防限流分页 + 4 类型归一化 + turndown 转 Markdown + 同步/查询，insert-only，Markdown chunk）
- `lib/youtube/CLAUDE.md` — YouTube 公开播放列表收录领域（官方 Data API v3 `playlists.list?channelId=` + API key（无 OAuth，`@handle`/`UC...` ID 经 `channels.list` 解析）+ 全量重拉（位置序无增量游标）+ 多列表 membership（1 item + N link，镜像 zhihu）+ 同步/查询，insert-only，description chunk）

### 转录 / 后台
- `entrypoints/CLAUDE.md` — WXT 入口层薄接线约束；Background 同步注册 listener/scheduler，异步启动显式处理 rejection
- `lib/subtitle/CLAUDE.md` — 通用字幕共享类型（平台无关）
- `lib/summary/CLAUDE.md` — AI 视频总结领域（字幕 → 一次流式 LLM 调用 → Markdown 总结 + 章节分段/广告标记；合并输出协议 + 行号映射时间戳，结果落 `local:vs:` storage 不入 DB；LLM 调用只能在 Background SW）
- `lib/transcription/CLAUDE.md` — 转录核心管线（cache → 官方字幕 → ASR）
- `lib/offscreen/CLAUDE.md` — Offscreen Document + FFmpeg 分块 + PGlite 持有者
- `lib/cache/CLAUDE.md` — 视频字幕缓存（平台感知）
- `lib/auto-transcribe/CLAUDE.md` — 自动转录状态机（平台无关）
- `lib/background/CLAUDE.md` — Background SW dispatcher + 消息桥 + CDN 请求头
- `lib/runtime-message/CLAUDE.md` — 跨 runtime 协议共享 primitive（只复用 schema 片段，不注册具体消息）

### 数据库
- `lib/database/CLAUDE.md` — PGlite + Drizzle RPC Proxy 架构
- `lib/database/entities/CLAUDE.md` — Per-table Drizzle schema
- `lib/database/bridges/CLAUDE.md` — RPC 桥接层
- `lib/database/migrations/CLAUDE.md` — 自定义迁移系统

### 跨 runtime 协议

- Bilibili 页面桥、Background runtime、Offscreen runtime 各自维护协议 Module；不要创建横跨页面、Background、Offscreen 与 Database RPC 的全知协议。
- runtime 边界的 `unknown` 必须先经所属 decoder；调用方使用 typed client，禁止对 `sendMessage` 响应做裸类型断言。新消息须同时注册请求/响应 schema、路由和 contract test。
- 浏览器内部协议 envelope 的 `channel`/`protocolVersion` 是可选兼容元数据：新发送方发送 v1，旧消息仍可接收；未知 type、非法 payload、错误 sender 静默拒绝，非法响应在本地抛协议错误。外部 Agent Bridge 没有 legacy userspace，使用 `lib/agent-bridge/protocol.ts` 的严格 v1 envelope。
- Background → tab 的 status push 也必须经 encoder/decoder；Database Port RPC 仍由 `lib/database/bridges/` 自己负责，不并入这些 browser runtime 协议。

### 基础设施
- `spikes/agent-bridge/CLAUDE.md` — Agent Bridge Phase 0 可复现实机探针：SW→Offscreen DB proxy/hybridRetrieve、Knowledge Tool JSON Schema/execute、出站 loopback WebSocket 20s 心跳与派生 manifest 无 host permission 验证；非正式实现
- `scripts/CLAUDE.md` — 离线构建产物检查；Chrome build 后锁定 Background SW 体积并拒绝 PGlite runtime marker
- `lib/agent-bridge/CLAUDE.md` — Agent Bridge 正式层：严格 v1 协议、三工具 registry、Background WebSocket client、持久认证退避与 30 秒 alarm scheduler；Node CLI 只打包协议 leaf
- `packages/favbase-cli/CLAUDE.md` — Agent Bridge Node 包：`favbase` CLI（`search`/`tags`/`get` 别名 + 零知识 `call`/`tools`）、自启/空闲自灭 Bridge Daemon（同端口 `/bridge` WS + `/rpc` HTTP，Bearer 鉴权 + Origin 拒绝）、`~/.favbase/config.json`、skill 安装、进程级集成测试；`skills/favbase/SKILL.md` 是 Skill 单源并打进 CLI；`tests/agent-bridge-cli-aliases.test.ts` 用 `describeTools()` 对账别名表
- `lib/ai/CLAUDE.md` — Vercel AI SDK 集成（LLM + Embedding provider/client）+ Provider 定义（`lib/providers.ts`）
- `lib/chat/CLAUDE.md` — Chat（Agentic RAG 助手）平台无关 lib：`config.ts`（`resolveChatModel` 复用主 LLM）+ `retrieval.ts`/`rrf.ts`（hybrid：语义 `semanticSearchChunks` + trigram 关键词 word_similarity + RRF）+ `tools.ts`（3 只读工具）+ `agent.ts`（`streamText`+`stepCountIs(8)`）+ `prompts.ts` + `history.ts`（WXT storage 多会话），全程只读 PGlite
- `lib/permissions/CLAUDE.md` — host access 检查与恢复：静态 `<all_urls>` 覆盖书签、API 与 WebDAV；用户拒绝/收回必选站点权限后由设置页恢复 HTTPS origin
- `lib/sync/CLAUDE.md` — WebDAV 双向同步领域（第一期：配置整体 LWW 同步）：`webdav` 包客户端 + 跨设备锁（sys.json 超时夺锁）+ 内容哈希防 ping-pong + AES-GCM 凭据混淆 + `chrome.alarms` 后台三触发（周期/防抖/启动补偿），引擎只在 Background SW。数据（PGlite 主键并集）留第二/三期
- `lib/embedding/CLAUDE.md` — Embedding 领域层：pgvector 向量存储 + 语义检索 + chunker（字幕/文本）+ 配置解析（转录管线 + x/zhihu/youtube/github 同步收尾自动 embed + bookmarks 提取逐条自动 embed 已接线，语义搜索 UI 待接）
- `lib/events/CLAUDE.md` — 领域事件总线（DB 数据变更 → UI 实时刷新，app.html 单 context）
- `lib/tagging/CLAUDE.md` — AI 标签（转录/收藏同步后自动打标 + 标签 CRUD）
- `lib/export/CLAUDE.md` — PGlite 全量导出（JSON/CSV）
- `lib/hooks/CLAUDE.md` — 共享 Hooks（useSettings/useRetryCountdown）
- `lib/http/CLAUDE.md` — HTTP 执行 seam：`fetchWithDeadline` 统一全平台请求 deadline（`.env.local` 的 `VITE_HTTP_DEADLINE_SECONDS`，单位秒，默认 30s；守卫测试禁止 lib 层裸 `fetch(`，新平台自动强制）+ `backoff.ts` 共享节流/退避原语（`sleep`/`jitteredDelayMs`/`backoffDelayMs`，注入 random 可测；只共享机制，数值留各平台）
- `lib/storage/CLAUDE.md` — 存储命名空间统一管理
- `lib/env.ts` — 平台数值策略参数 env 覆盖 helper（`envNumber('VITE_<PLATFORM>_<NAME>', default)`：有限非负数才覆盖、缺省/非法静默回退、默认值留平台常量定义原位），六平台全部数值标量常量经此可配置（变量注释文档在 `.env.example`/`.env.local` 平台分组块；守卫 `tests/platform-env-constants-guard.test.ts` 禁平台目录裸数值 const/手写 `import.meta.env`，并锁 fallback=默认值 + 三方同步），无 CLAUDE.md（单文件）
- `lib/format.ts` — 跨 context 纯格式化（`formatClock`：秒 → `m:ss`/`h:mm:ss`），app.html 时长角标 / X 与 Agent Bridge 倒计时适配 / CS 面板时间戳 / summary prompt 共用，无 CLAUDE.md（单文件）
- `lib/repo.ts` — 仓库链接单一事实源（`REPO_URL` + `PLATFORM_REQUEST_ISSUE_URL` 预填 new-issue），header GitHub 按钮 / nav Platform Request 叶子 / welcome 尾节共用，无 CLAUDE.md（单文件）。Platform Request 领域定义见 `CONTEXT.md`：动作外链，不是平台，禁止进 `collectionPlatformRegistry`

## i18n

- i18n 架构: `lib/i18n/` 自研轻量方案（无外部依赖），observable locale + `useSyncExternalStore`。`localeStorage`（`local:locale`，`lib/storage/ui-state.ts`）持久化用户偏好 `'auto' | 'zh-CN' | 'en'`（默认 `'auto'` 跟随 `navigator.language`）。`t()` 读可变 `currentMessages` 引用，DEV 模式对 missing key 输出 `console.warn`。React 消费者通过 `useTranslation()`（`lib/i18n/use-translation.ts`）订阅 locale 变化驱动 re-render，返回 `{ t, locale, preference, setLocale }`。`storage.watch()` 跨 context 同步（Content Script ↔ app.html）。有模块级 helper 的组件保留 `import { t } from '@/lib/i18n'` + 在组件内 `useTranslation()` 订阅；纯 JSX 组件用 `const { t } = useTranslation()`。locale 文件在 `lib/i18n/locales/{zh-CN,en}.ts`，`LocaleKeys` 类型从 zh-CN 推导。**seam 在 UI 边界**：lib 层只传结构化数据（TranscribeErrorCode + params / TranscribeStage + stageParams），UI 层通过 `t()` 翻译。新增 error/stage locale key 时需同时更新 zh-CN.ts 和 en.ts
- i18n 复数: `t(key, { count })` 传入 `count` 时用 `Intl.PluralRules(currentLocale).select(count)` 选变体 key `{key}.{category}`（如 `.one`/`.other`），缺失回退 `{key}.other`，再回退 base key。非 count 调用行为不变（向后兼容）。需单复数区分的 key 同时定义 base（=other 语义）+ `{key}.one` 变体，**zh 与 en 都要有 `.one`**（zh `.one` 与 base 同值，保持 parity 与类型安全）。已用：`collections.videoCount`、`autoTranscribe.pendingCount`、`bookmarks.count`
- i18n 数字格式化: `formatCompactNumber(n)`（`lib/i18n/index.ts`）用 `Intl.NumberFormat(currentLocale, { notation: 'compact', maximumFractionDigits: 1 })`，zh → `1.2万/1.2亿`，en → `1.2K/1.2M`。消费者须通过 `useTranslation()` 订阅以在切换语言时 re-render（如 `video-card.tsx` 播放量）
- i18n 日期格式化: `formatDateTime(ts)`（`lib/i18n/index.ts`）用 `Intl.DateTimeFormat(currentLocale, { dateStyle: 'short', timeStyle: 'short' })`。消费者同样须经 `useTranslation()` 订阅（如设置页 `save-actions.tsx` 已保存徽标）
- i18n 硬编码守卫: `tests/i18n-no-hardcoded.test.ts`（vitest，非 ESLint——项目零 linter）。扫描全部 `entrypoints/**/*.tsx`，剥离行/块注释后若含 CJK（`[一-鿿]`）即 fail 并列出 file:line。行内 `// i18n-ignore` 可豁免单行。**仅拦 CJK**（英文展示文案靠 review）。`pnpm test`（`vitest run`）跑全部测试
- Collection pipeline 的共享短标签统一放在 `pipeline.*`；视图翻译后传给零 `t()` 的共享 strip。
