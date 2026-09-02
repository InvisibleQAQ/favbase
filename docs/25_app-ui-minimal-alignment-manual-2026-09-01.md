# docs/25 — app.html 全面向 Minimal v7.7.0 看齐：分步改造手册

日期：2026-09-01
状态：**Step 0–2 已落地（2026-09-01，各自待用户 commit；Step 2 在 worktree 分支 `feat/docs25-step2-color-presets`），Step 3+ 未开工**。本文是可执行手册，不是设计随笔；每个 Step 都能独立开工、独立验证、独立回滚。
上位文档：`docs/23_favbase-app-minimal-dashboard-v7-adaptation-plan-zh-CN.md`（第一轮"保留自有世界"路线，本文第二轮**推翻**其 §6/§11 的大部分结论，见 §3）。
需求与决策来源：`.trellis/tasks/09-01-refactor-app-ui-adopt-minimal-v7-7-0-full-visual-language-while-keeping-favbase-brand-docs-23-round-2/prd.md`（R1–R14，Open Questions 1–6 已全部关闭）。
事实来源：同目录 `research/favbase-app-ui-current-state.md`（Favbase 现状，433 行）、`research/minimal-v7-ui-catalog.md`（Minimal 目录，299 行）。本文只引用、不复制这两份文件的内容；行号以 2026-09-01 工作树为准。
Minimal 源码根（下文记为 `$MIN`）：`C:\Users\18368\Desktop\00_myCode\35_minimal\minimal-dashboard\minimal-dashboard v7.7.0\Vite.js (JavaScript，TypeScript)\minimal-vite-ts-main\src`。

---

## 0. 一页纸

### 0.1 做什么

把 `entrypoints/app/**`（仅 app.html）的视觉语言整体换成 Minimal Dashboard v7.7.0：MUI 9、Minimal 的 theme/core 全套组件覆盖与 mixins、Card 16px / overlay 分级半径、真实暗色阴影、`softStyles` chip/label、Minimal 侧栏（vertical 300 / mini 88，含 group subheader 与 mini dropdown）、右上角设置抽屉（模式 / 对比度 / 紧凑 / 主色预设六色）、sonner toast、simplebar 滚动条、Dashboard KPI 卡与原生 SVG 图表、Settings 下划线 Tabs、平台页面包屑、Chat shell 完整移植。

保留 Favbase 品牌与产品事实：coral `#FC7E5B` 是默认主色（其余五个 Minimal 预设作为可选项），狐狸 logo，DM Sans + Barlow 字体，六平台品牌色，`text.accent` 语义 token，所有 `data-*` 结构词表与 heading outline，i18n 双语，Chrome 扩展 CSP。

### 0.2 不做什么

- 不动 `entrypoints/welcome/**`、`entrypoints/bilibili-video.content/**`、`entrypoints/popup/**`、`lib/**`（除 §Step 2 新增一个 storage item）、Background SW 图。
- 不引入 ApexCharts / MUI X / motion（app.html）/ 任何 CDN 资源。
- 不改 v1 Agent Bridge 协议、路由表、`COLLECTION_PAGE_CHILD_ROUTES`、平台 registry。
- 不做 RTL、字体切换、nav 布局切换（horizontal）、全屏按钮（PRD 默认，用户未单独表态）。
- 不改 `public/theme-init.js` 的模式预注入逻辑（`favbase-color-mode` key 不变）。

### 0.3 Step 依赖图与推荐顺序

```
Step 0  MUI 9 + Chrome 117 基座          （必须最先）
  └─ Step 1  theme/core 换血 + 测试锁值重写
       ├─ Step 2  color presets + 设置状态 + 抽屉数据层
       ├─ Step 3  共享原语（Label/EmptyContent/Breadcrumbs/Popover/Scrollbar/LoadingScreen）
       │     └─ Step 4  Shell（nav-section + header + settings drawer）   ← 需要 2 和 3
       ├─ Step 5  Snackbar（sonner）+ 六处触发点
       ├─ Step 6  Dashboard（KPI 卡 + 原生 SVG 图表）                      ← 需要 3
       ├─ Step 7  Settings 页（下划线 Tabs + 面包屑）                       ← 需要 3
       ├─ Step 8  六平台收藏页（chip/label/面包屑/卡片复核）                  ← 需要 3
       └─ Step 9  Chat shell 完整移植                                     ← 需要 3
Step 10 收口（截图基线、规范/CLAUDE.md/docs 同步、index.html 契约注释、Step 5–9 复核）← 需要全部
```

推荐**线性**执行 0→1→2→3→4→5→6→7→8→9→10。5–9 之间互不依赖，如需并行开分支，合并顺序不限，但每一步合回 main 前必须过 §6 的完整验证矩阵。

### 0.4 阅读方式

- 每个 Step 固定八段：目标 / 前置依赖 / 动哪些文件 / 具体改什么 / 测试重写 / 验证命令 / 回滚点 / 完成判据。
- 文中"**用户决定**"= 用户 2026-09-01 明确表态；"**PRD 默认**"= 我在 PRD 中写的默认值，用户未单独表态，执行时可推翻但要回写 PRD；"`[UNKNOWN]`"= 执行到那一步才能消解的事实，附录 C 汇总。
- "指出位置，不贴代码"：本文给文件路径 + 行号/符号名 + 目标值；代码由执行者按 Minimal 源文件移植。

---

## 1. 决策记录

| # | 决定 | 来源 | 影响 Step |
|---|------|------|-----------|
| D1 | 全套 Minimal 视觉语言 + 保留 Favbase 品牌（coral 默认、logo、字体） | 用户决定 | 全部 |
| D2 | `minimum_chrome_version` 116 → **117** | 用户决定 | 0 |
| D3 | 图表：**原生 SVG/CSS 零依赖**（不引 ApexCharts） | 用户决定 | 6 |
| D4 | Shell：**方案 A**——完整移植 Minimal nav-section（vertical + mini + dropdown）与 settings drawer，删除 Favbase 自研 header-actions 主题/语言 pill | 用户决定 | 4 |
| D5 | **同时引入** `simplebar-react` 与 `sonner`（我曾建议只引 sonner 或都不引；用户选择两个都引。按此执行，Step 3/5 记录体积与 a11y 代价） | 用户决定 | 3, 5 |
| D6 | Toast 边界：**方案 A**——toast 只用于一次性动作结果；持久状态（已保存徽标、连接状态 Alert、拉取进度）不进 toast | 用户决定 | 5 |
| D7 | Chat：**主线内完整移植 chat shell**（不是只换 token） | 用户决定 | 9 |
| D8 | 保留 Favbase 固定 type scale（不移植 Minimal 的 responsive font sizes） | PRD 默认 | 1 |
| D9 | `shape.borderRadius` 保持 8；Card/Dialog 16、Popover 10、Skeleton rounded 16 通过 Minimal 的 `×2 / ×1.25` 派生（PRD R3 曾误写 16，已勘误） | PRD 默认 | 1 |
| D10 | Button `defaultProps.color='inherit'`（Minimal），但保留 Favbase `outlinedPrimary/textPrimary → text.accent` 覆盖 | PRD 默认 | 1 |
| D11 | 输入框高度随 Minimal `INPUT_PADDING`（outlined medium 56 / small 40），放弃 docs/23 的 48/40 | PRD 默认 | 1 |
| D12 | 暗色 `background.neutral` 采 Minimal `#28323D`；暗色文字 token 采 Minimal（白 / grey500 / grey600） | PRD 默认 | 1 |
| D13 | 设置抽屉状态持久化到 WXT storage `local:themeSettings`（`lib/storage/ui-state.ts`）；mode 仍由 MUI `modeStorageKey` 管 | PRD 默认 | 2 |
| D14 | 预设的 `contrastText` 按亮度派生（coral 用墨色、蓝紫用白），不照抄 Minimal 全白 | PRD 默认 | 2 |
| D15 | Nav：父级 Collections 行仍是**链接**，展开箭头是**同级独立按钮**（Favbase 有 `/collections` 聚合页，Minimal 的"整行点击=折叠"不适用） | PRD 默认 | 4 |
| D16 | Nav 分组：`Collections`（Collections 父项 + 六平台 + Platform Request）/ `General`（Analytics、Chat、Settings） | PRD 默认 | 4 |
| D17 | Dashboard 四张 KPI 卡只用 `CollectionAnalyticsSnapshot` 真实字段：`totalItems`、有条目平台数、`usedTags`、`taggedItems/totalItems`；sparkline 不做（无周序列查询，不造数据） | PRD 默认 | 6 |
| D18 | StateBox/SectionTitleBar 改为 Minimal `EmptyContent`/`CustomBreadcrumbs` 的薄适配层，`data-state-box`/`data-section="title"`/h1 不变 | PRD 默认 | 3, 8 |
| D19 | 每个 Step 一个 commit；用户自行 commit（本任务不主动 commit） | 流程约束 | 全部 |

---

## 2. 基线速查：当前值 → 目标值

只列**会变**的值；不变量见 §4。

### 2.1 依赖与配置

| 项 | 当前 | 目标 | 位置 |
|----|------|------|------|
| `@mui/material` | `^7.3.11`（唯一直接 @mui 依赖） | `^9.4.0`（Step 0 实装；Minimal 用 9.0.1，同 major，minor 差异不影响 theme 移植） | `package.json:33` |
| `minimal-shared` | `^1.1.6` | 不变（Minimal 同版本线） | `package.json` |
| `simplebar-react` | 无 | `^3.3.2` + `simplebar-react/dist/simplebar.min.css` | Step 3 |
| `sonner` | 无 | `^2.0.7` | Step 5 |
| `minimum_chrome_version` | `'116'` | `'117'`（Step 0 已落地；理由是 MUI v9 的浏览器下限 Chrome 117，不是"CSS 特性基线"） | `wxt.config.ts:62`，断言 `wxt.config.test.ts:16` |
| 根 `version` | `0.0.5` | 每次上 Store 前递增（不在本计划内动） | `package.json` |

### 2.2 主题 token

| token | 当前 | 目标 | 说明 |
|-------|------|------|------|
| `shape.borderRadius` | 8 | 8 | 不变 |
| Card radius | 8 | `var(--card-radius, 16px)` | Minimal `card.tsx:8-13` |
| Card shadow | light `var(--customShadows-card)` / dark `'none'` + hairline | 两色 scheme 都是 `var(--card-shadow, var(--customShadows-card))`，dark 用真实阴影 | 推翻 docs/23 §6 |
| Popover paper radius | 8 | 10（`8×1.25`） | `paperStyles(theme,{dropdown:true})` |
| Dialog paper radius | 8 | 16 | `paperStyles(theme,{dialog:true})` |
| Skeleton rounded | 8 | 16 | Minimal `skeleton.tsx` |
| temporary Drawer shadow | dropdown shadow | Minimal 方向性 `… 80px -8px …` | `drawer.tsx` |
| Divider | grey500@0.24 hairline | grey500@0.2 | Minimal `palette.ts` |
| dark `background.neutral` | `#222B34` | `#28323D` | D12 |
| dark text | Favbase 自定 | `#FFFFFF / grey500 / grey600` | D12 |
| `text.accent` | 硬编码 coral darker/light | 由**当前预设**的 `primary.darker`（light）/ `primary.light`（dark）派生 | Step 2 |
| Button default color | `primary` | `inherit` + `disableElevation` | D10 |
| Button variants | contained/outlined/text | + `soft`；sizes + `xLarge`(56) | Minimal `button.tsx` |
| Chip default variant | filled | `soft`；radius 8 / small 10 | Minimal `chip.tsx` |
| Input height（outlined） | medium 48 / small 40 | medium 56 / small 40 | D11 |
| `palette.shared` | 无 | `inputUnderline / inputOutlined .2 / paperOutlined .16 / buttonOutlined .32` | Minimal `extendPalette` |
| `opacity` tokens | 无 | `soft .16 / softHover .32 / commonBg .08 / border .24` | Minimal `palette.ts` |
| mixins | 无 | `softStyles / filledStyles / menuItemStyles / paperStyles / maxLine / hideScrollX/Y / bgBlur / bgGradient`（跳过 `border.ts`） | Minimal `core/mixins/` |

### 2.3 Shell

| 项 | 当前 | 目标 |
|----|------|------|
| nav 宽度 | pinned 300 / compact 88 | vertical 300 / mini 88（不变，语义改名） |
| nav 行高 owner | `dashboard/css-vars.ts`（44/40/44） | `components/nav-section/styles/css-vars.ts`（vertical item 44 / sub 36 / mini root 56） |
| nav 分组 | 无 subheader | 两组 subheader（D16） |
| mini 子项 | 平铺 + Tooltip | Minimal `NavDropdown` hover 弹出 |
| nav 激活态 | `primary.lighter` 底 + coral 图标 | `text.accent` 文字 + `primary.main@0.08` 底（Minimal `nav-item-styles`） |
| 展开/收起按钮 | header 左侧 `custom:menu-duotone` | `NavToggleButton` 悬在 nav 右缘（`eva:arrow-ios-back/forward-fill`） |
| header 右侧 | BackgroundJobs / 主题 pill / 语言 pill / GitHub | BackgroundJobs / `LanguagePopover` / `SettingsButton` / GitHub |
| 主题切换 | header pill + View Transition | 抽屉 Mode 项（View Transition 逻辑搬进去） |
| 设置抽屉 | 无 | 宽 360：Mode / Contrast / Compact / Presets / Reset |

### 2.4 结构测试锁值（要改写的）

| 文件:行 | 现锁值 | 改为 |
|---------|--------|------|
| `entrypoints/app/theme/theme-contract.test.ts:50-51` | contained 对 = `light ? '#FFFFFF' : grey['900']` / `light ? grey['900'] : grey['100']` | 从 `scheme.text.primary`（底）/ `scheme.background.paper`（字）派生，WCAG ≥ 4.5 断言保留 |
| `:100` Card root radius `toBe(8)` | 8 | `toContain('16px')`（值是 `var(--card-radius, 16px)`） |
| `:102` Popover paper radius | 8 | 10 |
| `:103` Dialog paper radius | 8 | 16 |
| `:113` Skeleton rounded | 8 | 16 |
| `:119` card boxShadow 含 `--customShadows-card` | 保留 | 保留（现值 `var(--card-shadow, var(--customShadows-card))`） |
| `:121` dark card styles 含 `'none'` | 删除 | 改为 `customShadows.dark.card` `not.toBe('none')` |
| `:125-128` temporary Drawer 含 dropdown shadow / permanent undefined | dropdown | `toContain('80px -8px')`；permanent undefined 保留 |
| `:129-130` light card 非 none / dark card 是 none | | 两者都 `not.toBe('none')` |
| `theme/core/palette.test.ts:35` dark neutral | `#222B34` | `#28323D` |
| `:77` 六平台色在 default + neutral 上 ≥ 3:1 | 保留 | 保留（换 neutral 后重跑，失败则回退 `#222B34`，见附录 C-2） |
| `layouts/dashboard/css-vars.test.ts:27` "content gutters, nav row heights, 120ms" | 含 nav 行高 | 去掉 nav 行高断言（owner 迁移），新增 `components/nav-section/css-vars.test.ts` 锁 44/36/56 |
| `layouts/dashboard/nav.test.tsx`（7 例） | 见 Step 4 | 见 Step 4 |
| `layouts/dashboard/layout.test.tsx`（2 例） | 见 Step 4 | 见 Step 4 |
| `sections/overview/overview-view.test.tsx`（6 例） | 见 Step 6 | 见 Step 6 |
| `sections/chat/chat-view.test.tsx` `ChatWorkspace`（7 例） | 见 Step 9 | 见 Step 9 |

### 2.5 体积基线（供 Step 0/3/5 对照）

现状 `research/favbase-app-ui-current-state.md` §LOC/chunk 段记录了 app.html 各 chunk 体积。执行 Step 0、3、5 后各记一次 `pnpm build` 的 `.output/chrome-mv3/chunks/` 体积到 §8 进度表，不设硬上限（Background SW 契约 `scripts/check-background-bundle.mjs` 不涉及 app chunk）。

---

## 3. 适配矩阵 v2：对 docs/23 的推翻与保留

docs/23 §6（20 行矩阵）与 §11（12 条拒绝清单）是"保留自有世界、只借 Minimal 结构"的路线；本轮改为"借全套视觉语言、只保品牌"。逐条处置如下，完工后 docs/23 顶部加一行状态注记指向本文（Step 10）。

### 3.1 推翻

| docs/23 结论 | 本文处置 | Step |
|--------------|----------|------|
| 8px 半径贯穿 Card/Popover/Dialog/Skeleton | Card/Dialog 16、Popover 10、Skeleton 16（base 仍 8） | 1 |
| 暗色 Card 无阴影 + hairline | 暗色真实阴影（Minimal `customShadows.dark`） | 1 |
| Chip 默认 filled、Button 默认 primary | Chip 默认 soft、Button 默认 inherit | 1 |
| 输入框 48/40 | 56/40（D11） | 1 |
| 不引入 color presets、不做设置抽屉 | 六色预设 + 抽屉 | 2, 4 |
| header 内 iOS 风格主题/语言 pill | 删除；主题进抽屉，语言用 `CustomPopover` | 4 |
| nav 激活底色 `primary.lighter`、行高 44/40/44 由 layout 变量管 | `primary.main@0.08` + `text.accent`；行高归 nav-section 变量 44/36/56 | 4 |
| compact 侧栏子项平铺 + Tooltip | Minimal mini dropdown | 4 |
| StateBox 自绘虚线面 | `EmptyContent` filled 变体（tinted + dashed）薄适配 | 3 |
| Dashboard "no floating metric cards"、hairline band | 四张真实 KPI 卡 + 图表 Card（禁止的是**编造**指标，不是卡片形态） | 6 |
| Settings segmented Tabs、Chat outlined Paper 264 rail | 下划线 Tabs；Chat `NAV_WIDTH 320 / COLLAPSE 96` | 7, 9 |
| 不引 sonner/simplebar | 两者都引（D5） | 3, 5 |
| 不引 Minimal Label/Breadcrumbs/CustomPopover | 三者都移植 | 3 |

### 3.2 保留

- `data-*` 结构词表、heading outline、`role=status`、焦点恢复契约（全部结构测试的公共 API）。
- `text.accent` 语义 token（改为派生，不删）。
- 六平台品牌色 + ≥3:1 对比度断言。
- Nested Cards 禁止、Demo/编造 KPI 禁止（`ui-design-system.md` §15）。
- Link 与 disclosure 是同级控件（D15）。
- 固定 type scale（D8）、DM Sans + Barlow、tabular-nums、focus ring、`::selection` 色（CssBaseline 覆盖）。
- `variantMapping`（h1–h6 语义与视觉解耦）。
- 扩展 CSP：零 CDN、零 inline script、图标离线注册。

---

## 4. 跨 Step 铁律

1. **Never Break Userspace**：任何 `data-*`、`aria-*`、heading level、DOM 顺序、hash 路由、storage key（`favbase-color-mode`、`local:sidebarPinned`、`local:locale`）的变更都视为破坏，必须在 PRD 里有对应 R 条目。没有的，不改。
2. **测试重写不是绕过**：锁值变了就把断言改成新值并写明理由；禁止 `it.skip`、禁止放宽到 `toBeDefined`。每个 Step 的"测试重写"段列出的是**全部**要动的断言，多一处都要回到本文补记。
3. **i18n**：新增文案必须走 `t()`，`lib/i18n/locales/{zh-CN,en}.ts` 同步；`tests/i18n-no-hardcoded.test.ts` 会拦 CJK 硬编码；英文硬编码靠 review。
4. **CSP**：`script-src 'self' 'wasm-unsafe-eval'`；`@iconify/react` 图标只能经 `entrypoints/app/components/iconify/` 离线注册；sonner/simplebar 的 CSS 只能 import 进 bundle，不能 `<link>`。
5. **目录归属**（`.trellis/spec/frontend/directory-structure.md`）：`components/` 放哑组件（`library-gate`、`settings/context` 这类自带订阅的智能组件是已有先例，允许）；`sections/` 放业务；`entrypoints/app/hooks/` 禁止 import `sections/`（`tests/platform-completeness-contract.test.ts` 会拦）。
6. **依赖面**：`sonner` 只允许 `entrypoints/app/components/snackbar/**` import（Step 5 加守卫测试）；`simplebar-react` 只允许 `entrypoints/app/components/scrollbar/**` import（同一守卫测试第二条）。`lib/**` 与 `entrypoints/app/hooks/**` 禁止出现这两个包。
7. **Background SW 图**：`scripts/check-background-bundle.mjs` 与 `tests/bundle-contract` 不能因本计划任何一步失败；app.html 的依赖不得被 SW 引用。
8. **验证顺序**（`.trellis/spec/frontend/quality-guidelines.md`）：focused `pnpm vitest run <paths>` → `pnpm compile` → `pnpm test` → `pnpm build`。四步全绿才算 Step 完成。
9. **文档即代码**：每个 Step 改到的目录，其 `CLAUDE.md` 同 commit 更新（见 §7）。
10. **[UNKNOWN] 消解**：附录 C 的条目在对应 Step 执行时消解并回写本文；不允许带着 `[UNKNOWN]` 收口 Step 10。

---

## 5. 分步手册

### Step 0 — MUI 9 + Chrome 117 基座

> **2026-09-01 已落地**（未 commit，用户自行提交）。实际与手册的偏差记录在本节末"执行记录"。

**目标**：把唯一直接依赖 `@mui/material` 升到 9.x，manifest 最低版本提到 117，system props 全部迁到 `sx`，视觉零变化。

**前置依赖**：无。必须最先做——Minimal 的 theme/core 文件是按 MUI 9 API 写的（`theme.vars`、`colorSchemes`、`slotProps`、`variants` 数组），在 v7 上移植会到处打补丁。

**动哪些文件**
- `package.json:33`（`@mui/material`）
- `wxt.config.ts:62`（`minimum_chrome_version`）、`wxt.config.test.ts:16`
- 使用 system props 的 `.tsx`：以 codemod 结果为准；执行前先 `grep -rnE "<(Box|Stack|Typography|Grid|Link)\b[^>]*\b(sx|mt|mb|ml|mr|mx|my|p|px|py|pt|pb|pl|pr|gap|display|flex|width|height|color|bgcolor|justifyContent|alignItems)=" entrypoints/app entrypoints/welcome` 列出候选
- 文档：根 `CLAUDE.md:9`（"MUI v7"）、`:19`（"Chrome 116"）、`:33`、`:61`；`entrypoints/app/CLAUDE.md:3`、`:17`；`entrypoints/app/theme/CLAUDE.md:3`；`.trellis/spec/frontend/ui-design-system.md:35`、`:472`；`.trellis/spec/frontend/i18n-conventions.md:580`；`.trellis/spec/frontend/index.md:30`；`docs/21` 与 `docs/adr/0002` 中提到 Chrome 116 的行（`grep -rn "116" docs/21_agent-bridge-analysis-2026-08-22.md docs/adr/0002-*.md`）

**具体改什么**
1. `pnpm add @mui/material@^9.0.1`。emotion 两包版本与 Minimal 一致（`research/minimal-v7-ui-catalog.md` §MUI 9 事实段），不用动。
2. `npx @mui/codemod@latest v9.0.0/system-props entrypoints/app`，再对 `entrypoints/welcome` 跑一次。codemod 把 `<Box mt={2}>` 改成 `<Box sx={{ mt: 2 }}>`；已有 `sx` 的会合并。人工复核 diff：welcome.html 的 `MotionBox` 是 `motion.create(Box)`，codemod 可能漏，手工改。
3. `Typography color="text.secondary"` 有 8 处（`research/favbase-app-ui-current-state.md` §MUI 9 迁移段）。`[UNKNOWN C-1]` v9 是否仍接受 `color` 作为 Typography 自有 prop：`pnpm compile` 报错则改成 `sx={{ color: 'text.secondary' }}`，不报错就留。
4. `wxt.config.ts:62` `'116'` → `'117'`；`wxt.config.test.ts:16` 同步。
5. 文档里所有 "MUI v7 / MUI 7 / Chrome 116" 改成 "MUI v9 / Chrome 117"；根 `CLAUDE.md:19` 的理由句补一句"117 起为 Minimal 主题所需的 CSS 特性基线（PRD D2）"。

**测试重写**
- `wxt.config.test.ts:16` 116 → 117。
- 其余测试**不应**需要改。如果 happy-dom 下 v9 的 class 名或 DOM 结构变了导致某结构测试失败，先读 MUI 9 迁移指南对应组件条目（context7 `@mui/material` v9 migration），确认是 API 变更而非回归后再改断言，并在本文 §8 备注。

**验证命令**
```
pnpm vitest run wxt.config.test.ts entrypoints/app/theme
pnpm compile
pnpm test
pnpm build
```
`pnpm build` 后手动加载 `.output/chrome-mv3`，走一遍 `/`、`/collections`、`/collections/bilibili`、`/settings`、`/chat`，与 `docs/ui-baseline/2026-08-31/phase7-validation/` 截图肉眼对照：**允许零差异以外的任何差异吗？不允许。** 有差异就是 codemod 漏改或 v9 默认值变了，修到无差异。

**回滚点**：一个 commit `build(app): upgrade @mui/material to 9 and raise minimum Chrome to 117`。如 codemod diff 太大可拆两个（依赖+配置 / codemod）。

**完成判据**
- [x] `pnpm ls @mui/material` 只有一个 9.x 版本（`@mui/material@9.4.0`）
- [x] 全仓无 system props（TypeScript AST 扫 `entrypoints/**/*.tsx` 160 文件，Box/Stack/Typography/Grid/Link/Container/DialogContentText/MotionBox 上零 system prop）
- [x] 四步验证全绿（focused 3 文件 20 用例；`pnpm compile`；`pnpm test` 176 文件 1265 用例 + CLI 10 文件 55 用例；`pnpm build` manifest `minimum_chrome_version: "117"`）
- [ ] 五个路由截图无视觉差异——**待用户加载 `.output/chrome-mv3` 对照**（AI 无法独立完成；可用 `docs/ui-baseline/app-runtime-check.mjs` 附着已开 Chrome 抓图）
- [x] 文档里"MUI v7 / Chrome 116"全部消失（例外：docs/19/23/24 历史文档；docs/21 与 ADR 0002 保留原 `'116'` 字样并加"现为 117"注记，不改写历史决策；`Chrome 116–119` alarm clamp 是 Chrome 行为事实，见执行记录）

**执行记录（2026-09-01）**
- `pnpm add @mui/material@^9.0.1` 解析并写入 `^9.4.0`；emotion 11.14.x、`minimal-shared@1.1.6` 不变。
- codemod 输出被整体 revert：124 文件 "ok" 中 118 个只是 CRLF/缩进噪音，9 个真实改动被 recast 重排（双引号、单属性拆行、两文件整段重缩进）。改为手工应用等价的 18 处编辑（`background-jobs-bar` / `settings-view` / `chat-view` ×5 / `webdav-sync-card` ×5 / `export-card` ×2 / `agent-bridge-card` ×2 / welcome `bilibili-showcase`、`chat-showcase`、`hero`）。**后续 Step 不要再跑 codemod**，仓库工作树是 CRLF + `core.autocrlf=true`，jscodeshift 会制造整仓噪音。
- 手册第 2 条的 grep 候选式（`\b(sx|mt|…)=`）把已经写 `sx=` 的合法用法也算进去，实际用 AST 扫描代替（脚本一次性，未入库）。
- **手册没预料到的 v9 破坏**：`styleOverrides` 的组合 key（`containedPrimary`/`containedInherit`/`outlinedPrimary`/`textPrimary`、Chip `filledPrimary`）在 v9 类型中删除（`ButtonClasses` 只剩 `contained/outlined/text` + `color*` + `size*`），`pnpm compile` 报 TS2353。按 upgrade-to-v9 指南迁到 `root.variants`（`props: { variant, color }`），`entrypoints/app/theme/core/components.tsx` `MuiButton`/`MuiChip`。这直接影响 Step 1 D10："保留 `outlinedPrimary/textPrimary → text.accent` 覆盖"要以 variants 形态保留。
- 测试零改动即全绿（除 `wxt.config.test.ts` 断言本身）；happy-dom 下 v9 class/DOM 无破坏。
- 体积（`pnpm build`，与 `research/favbase-app-ui-current-state.md` §8 的 v7 基线对比）：`app-*.js` 223,992 B（基线 225,464，−1.5 KB）；`Container-*.js`（共享 MUI）358,636 B（基线 347,924，**+10.7 KB / +3.1%**，gz 119,158）；`settings` 106,705（+1.0 KB）；`chat`/`welcome`/`jsx-runtime` 持平；chunks 总计 61 文件 3,903,221 B（基线 3.9 MB）。

---

### Step 1 — theme/core 换血

> **2026-09-01 已落地**（未 commit，用户自行提交）。实际与手册的偏差记录在本节末"执行记录"。

**目标**：把 `entrypoints/app/theme/core/` 换成 Minimal 的 palette/shadows/custom-shadows/mixins/components 全套，保留 Favbase 品牌 token 与 a11y 覆盖；所有主题契约测试改到新锁值。

**前置依赖**：Step 0。

**动哪些文件**
- 重写：`theme/core/palette.ts`、`theme/core/custom-shadows.ts`、`theme/core/shadows.ts`、`theme/core/components.tsx`（拆成 `theme/core/components/*.tsx` 一文件一组件，镜像 `$MIN/theme/core/components/` 去掉 `date-picker.tsx`、`data-grid.tsx`、`tree-view.tsx`、`upload.tsx`）
- 新建：`theme/core/mixins/`（镜像 `$MIN/theme/core/mixins/`，跳过 `border.ts`）、`theme/core/opacity.ts`（如 Minimal 把 opacity 放在 palette 内则跟随）、`theme/extend-theme-types.ts`（仅增强 Button/Chip/Pagination/IconButton/Label 的 `variant`/`color`/`size` 类型）
- 改：`theme/create-theme.ts`、`theme/theme-config.ts`、`theme/core/typography.ts`（只补 Minimal 的 `fontSecondaryFamily` 等字段名对齐，字号不动 D8）、`theme/theme-provider.tsx`（`createTheme()` 挪出 render 或 `useMemo`，为 Step 2 做准备）
- 测试：`theme/theme-contract.test.ts`、`theme/core/palette.test.ts`、`theme/core/*.test.ts`
- 文档：`theme/CLAUDE.md`

**具体改什么**
1. **palette**：以 `$MIN/theme/core/palette.ts` 为骨架，把 `primary` 换成 Favbase coral 五阶（`theme-config.ts` 现值）；`text.accent` 暂保留为 coral darker/light 常量（Step 2 改派生）；dark `background.neutral` `#28323D`、dark 文字采 Minimal（D12）；`error` 保留 Favbase 现值（PRD R3 表）；`divider` 改 `grey500Channel@0.2`；补 `shared`（`extendPalette` 段）与 `opacity`。六平台色 `platform.*` 原位保留。
2. **shadows / custom-shadows**：整文件照搬 Minimal；**删除** Favbase dark `card: 'none'` 特判——Minimal 的 `createShadowColor` 对 dark 用 `common.blackChannel`，是真实阴影。
3. **mixins**：照搬 Minimal `softStyles / filledStyles / menuItemStyles / paperStyles / maxLine / hideScrollX / hideScrollY / bgBlur / bgGradient`，挂到 `theme.mixins`；`create-theme.ts` 里 `mixins` 与 `components` 的组装顺序照 `$MIN/theme/create-theme.ts`。
4. **components**：逐文件移植。Favbase 保留的覆盖点（写在对应文件顶部注释 `// favbase override:`）：
   - `css-baseline.tsx`：保留 tabular-nums、`:focus-visible` ring、`::selection`、`prefers-reduced-motion`。
   - `button.tsx`：Minimal 默认 `inherit` + `disableElevation` + soft/xLarge/black/white；**删除** Favbase `containedPrimary` 墨色特判（app 内无 `<Button color="primary">`，用 grep 确认）；**保留** `outlinedPrimary/textPrimary` 字色 `text.accent`。
   - `chip.tsx`：Minimal soft 默认；`[UNKNOWN C-3]` soft primary 文字（`primary.dark`）在 16% coral 底上是否 ≥ 4.5，不够则 primary 的 soft 文字改 `primary.darker`。
   - `text-field.tsx`：`INPUT_TYPOGRAPHY`（15/16 + lh 24）与 `INPUT_PADDING` 照搬（D11）；`components/collection/search-field.tsx` 注释里的"48px from theme"改 56。
   - `card.tsx`、`paper.tsx`、`popover.tsx`、`dialog.tsx`、`drawer.tsx`、`menu.tsx`、`skeleton.tsx`、`tabs.tsx`、`tooltip.tsx`、`list.tsx`、`table.tsx`、`pagination.tsx`、`alert.tsx`、`badge.tsx`、`avatar.tsx`、`link.tsx`、`typography.tsx`（`variantMapping` 保留 Favbase 版）、`progress.tsx`、`slider.tsx`、`switch.tsx`、`checkbox.tsx`、`radio.tsx`、`select.tsx`、`autocomplete.tsx`、`accordion.tsx`、`breadcrumbs.tsx`、`stepper.tsx`、`timeline.tsx`、`toggle-button.tsx`、`fab.tsx`、`rating.tsx`、`app-bar.tsx`、`backdrop.tsx`、`button-group.tsx`、`form.tsx`、`stack.tsx`、`svg-icon.tsx`：照搬。Favbase 现有 `components.tsx` 里没有对应的组件覆盖，一律以 Minimal 为准。
   - Tabs/Tab 高 48、Button 30/36/48 与 Minimal 一致，不需要覆盖。
5. **`theme-provider.tsx`**：`const theme = useMemo(() => createTheme(), [])`；`modeStorageKey={COLOR_MODE_STORAGE_KEY}` 与 `defaultMode="system"` 不动。
6. **`primary.lighter` 的五个消费者**先不动（`layouts/dashboard/nav.tsx:56`、`sections/bilibili/bilibili-view.tsx:107/112`、`sections/chat/chat-view.tsx:505`、`sections/overview/overview-view.tsx:392`）——Step 1 dark scheme 的 `primary.lighter` 仍是 Favbase 自定深色值，视觉不变；Step 2 一起改 alpha。

**测试重写**（全部在 §2.4 表中，这里给理由）
- `theme-contract.test.ts:50-51` contained 对：Button 默认 inherit 后，"主按钮"是 `inherit` contained = `text.primary` 底 + `background.paper` 字。断言改为从 scheme token 取这两个值再算对比度 ≥ 4.5。
- `:100/:102/:103/:113` 半径：改 16/10/16/16，注释写"Minimal card ×2 / dropdown ×1.25"。
- `:121/:129/:130`：dark card 有阴影，全部 `not.toBe('none')`；`:121` 原断言删除。
- `:125-128`：temporary Drawer 阴影 `toContain('80px -8px')`（Minimal `drawer.tsx` 的方向性值；执行时以移植后的实际字符串为准）。
- `:138 defaultColorScheme 'light'`、`:61 borderRadius 8`、`:119 card 含 --customShadows-card`：保留。
- Menu list padding 断言（现 `spacing(0.5)`）：Minimal `popover.tsx:13-14` 把 list padding 设 0，Menu 继承 Popover paper → `[UNKNOWN C-4]` 以移植后的实际值改断言。
- 新增：soft primary Chip 文字 vs 混合底色 ≥ 4.5（两 scheme）；`theme.mixins.softStyles` 存在且返回含 `backgroundColor` 的对象；`palette.shared.inputOutlined` 存在。
- `palette.test.ts:35` `#28323D`；`:77` 重跑，`[UNKNOWN C-2]` 六平台色在新 neutral 上是否仍 ≥ 3:1，不够则该平台色微调或 neutral 回退 `#222B34`（品牌优先，回退合法）。
- 输入高度断言（`theme-contract.test.ts` 中锁 48/40 的行，执行时 grep `48`）：改 56/40。

**验证命令**
```
pnpm vitest run entrypoints/app/theme
pnpm vitest run entrypoints/app        # 组件默认变了，所有 app 结构测试跑一遍
pnpm compile
pnpm test
pnpm build
```
肉眼：五个路由 light/dark 各截一次，确认 Card 圆角 16、dark 有阴影、chip 变 soft、按钮默认灰。**这一步视觉必然变化**，对照对象是 Minimal 官方 demo 而不是旧截图。

**回滚点**：`refactor(theme): port Minimal v7.7.0 core palette/shadows/mixins/components`。

**完成判据**
- [x] `theme/core/components.tsx` 不存在，`theme/core/components/` 下每文件只覆盖一个 MUI 组件族（41 个 `.tsx` + `index.ts`；`css-baseline.tsx`/`typography.tsx` 为 Favbase 独有）
- [x] `grep -rn "'none'" entrypoints/app/theme/core/custom-shadows.ts` 零结果
- [x] 四步验证全绿（`pnpm vitest run entrypoints/app/theme` 2 文件 28 用例；`pnpm vitest run entrypoints/app entrypoints/welcome` 70 文件 389 用例**零改动**通过；`pnpm compile`；`pnpm test` 176 文件 1275 用例 + CLI 10 文件 55 用例；`pnpm build` + bundle contract 绿），§2.4 表中 theme 相关行全部改完并注明理由（见执行记录的断言清单）
- [x] `theme/CLAUDE.md` 重写：owner 表、Favbase override 清单、token 表、组件默认值、测试说明
- [ ] 五路由 light/dark 截图目测——**待用户加载 `.output/chrome-mv3`**（对照对象是 Minimal 官方 demo：Card 16 圆角、dark 有阴影、chip soft、按钮默认灰墨）

**执行记录（2026-09-01）**
- **`[UNKNOWN]` 消解**：C-2 youtube dark `#D94040` 在 `#28323D` 上 = **2.95:1**，不达 3:1 → dark `background.neutral` 保持 `#222B34`（D12 的 neutral 半句作废，文字部分照做）；C-3 `primary.dark` 在 16% coral 底上 light ≈ **3.99:1**，不达 4.5 → `softStyles(theme,'primary')` 文字改 `text.accent`（light `primary.darker` ≈ 8.5 / dark `primary.light` ≈ 6.2，scheme-aware，Step 2 派生后自动跟随预设），其余颜色仍 `dark`/暗色 `light`；C-4 Minimal 无 `MuiMenu` 覆盖，Menu paper 继承 `MuiPopover.paper` 的 `paperStyles(dropdown)`（padding 4px、list 上下 padding 0）。
- **不能照搬的三处**：`text-field.tsx` 去掉 `@mui/x-date-pickers` 的 picker context（Favbase 无 MUI X）；`timeline.tsx` 依赖 `@mui/lab` 主题增强，跳过（手册组件清单里的 `timeline.tsx` 作废）；`mixins/border.ts` 按手册跳过。`extend-theme-types` 沿用现有 `.d.ts`，未另建 `.ts`。
- **手册测试清单之外的必改断言**（铁律 2 补记）：Button 尺寸 30/36/48 与 Input 高度改为 variants 解析（Minimal 全写在 `root.variants`，旧 `resolveStyle` 直读 slot 会得 `undefined`，测试新增 variants-aware resolver）；Tabs/Tab `minHeight 48` 断言删除（MUI 默认即 48，主题不再覆盖）；CardHeader subheader `toEqual` 加 `sx: { mt: 0.5 }`；DialogTitle/Content/Actions padding 改 Minimal `spacing(3)` / `spacing(0,3)` / `spacing(3)`；Dialog paper 断言需传 `{ fullScreen: false }`；Drawer 断言需传 `anchor: 'left'`；Menu list padding 改为 Popover paper padding + list 0；新增 `shared`/`opacity` var、soft primary 对比度、mixins 注册、Skeleton/Stack 默认断言。
- **Favbase 功能性覆盖保留**（非视觉语言，源码标 `favbase override:`）：Dialog `fullWidth/maxWidth='sm'` + paper 视口边界（两个 Dialog 调用点都依赖默认）+ actions `flexWrap`；Tooltip `arrow/enterDelay` 且不套 Minimal 的 `-4px` popper offset；Link/outlined primary/text primary 字色 `text.accent`；CssBaseline 全文件；Typography `variantMapping`；dark `primary.lighter` `#3A2A24`（第 6 条五个消费者未动）。**删除**：contained primary 墨色特判（grep 确认 app 内零 `<Button color="primary">`）、Popover 1px divider 边与冗余 max 尺寸（MUI 默认已 `calc(100% - 32px)`）、Favbase 自定 Tooltip 亮底反色。
- **默认值变化的下游影响（本 Step 不改消费者，交给 Step 8/9）**：Chip 默认 `soft`（app 内仅 `agent-bridge-card.tsx` 状态 chip 用默认 variant）；LinearProgress/CircularProgress 默认 `color="inherit"`（原 primary 珊瑚）；Tabs 默认 `scrollable`/`textColor inherit`（settings/overview 三处都显式传 variant，结构测试通过）；Stack `useFlexGap`；Skeleton 默认 `rounded` 16（消费者基本显式传 variant）；Backdrop grey800@0.48。
- **体积**（`pnpm build`，对比 Step 0）：主题 + `collection-platform-registry` 共用 chunk `collection-platform-registry-*.js` 62,658 B（gz 16,395）；`app-*.js` 221,580（−2.4 KB）；`Container-*.js` 348,434（−10.2 KB，gz 117,602）；`settings` 106,055；chunks 总计 62 文件 3,951,111 B（**+47.9 KB / +1.2%**，即全套 35 个组件覆盖 + mixins 的净成本）。

---

### Step 2 — color presets + 设置状态数据层

> **2026-09-01 已落地**（worktree 分支 `feat/docs25-step2-color-presets`，未 commit，用户自行提交）。实际与手册的偏差记录在本节末"执行记录"。

**目标**：六色主色预设（coral 默认 + Minimal 五色）、`contrast`、`compactLayout` 三个设置项的**数据层与主题应用**落地，抽屉 UI 留到 Step 4。

**前置依赖**：Step 1。

**动哪些文件**
- 新建：`theme/with-settings/color-presets.ts`、`theme/with-settings/update-core.ts`、`theme/with-settings/update-components.ts`、`theme/with-settings/index.ts`（镜像 `$MIN/theme/with-settings/`）
- 新建：`entrypoints/app/components/settings/types.ts`、`components/settings/context/settings-provider.tsx`、`components/settings/context/use-settings-context.ts`、`components/settings/context/index.ts`（镜像 `$MIN/components/settings/context/`，去掉 fontFamily/fontSize/direction/navLayout/navColor）
- 改：`lib/storage/ui-state.ts`（新增 `themeSettingsStorage`）、`lib/storage/CLAUDE.md`
- 改：`theme/create-theme.ts`（签名加 `settingsState`）、`theme/theme-provider.tsx`（读 context + `useMemo` 依赖 settings）、`theme/core/palette.ts`（`text.accent` 改派生）
- 改：`entrypoints/app/main.tsx`（pre-render 并行读取）、`entrypoints/app/App.tsx`（挂 `SettingsProvider`——放在 `ThemeProvider` 外层）
- 改：`primary.lighter` 五个消费者（§Step 1 第 6 点列出的行）
- 测试：新建 `theme/with-settings/update-core.test.ts`、`components/settings/context/settings-provider.test.tsx`、`lib/storage/ui-state.test.ts`（目前不存在）；改 `theme/theme-contract.test.ts`

**具体改什么**
1. **`color-presets.ts`**：`primaryColorPresets = { default: <Favbase coral 五阶 + contrastText>, preset1: #078DEE…, preset2: #7635dc…, preset3: #0C68E9…, preset4: #fda92d…, preset5: #FF3030… }`，五阶值照 `$MIN/theme/with-settings/color-presets.ts`；`contrastText` **不**照抄——用一个 `pickContrastText(main)` 按 WCAG 选 `#FFFFFF` 或 Favbase 墨色（`theme-config.ts` 现 coral contrastText），D14。
2. **`update-core.ts`**：照 Minimal `updateCoreWithSettings`：`contrast === 'high'` → light `background.default = grey.200`；`primaryColor !== 'default'` → 两 scheme 的 `primary` 替换 + `customShadows.primary` 重算。**Favbase 扩展**：同一函数内派生 `text.accent`（light = `primary.darker`，dark = `primary.light`）。
3. **`update-components.ts`**：照 Minimal（当前只处理 `MuiCssBaseline` 的 fontSize/fontFamily；Favbase 不做字体设置，可只留空壳或省略——省略则 `index.ts` 不导出，避免死代码）。
4. **`types.ts`**：`ThemeSettings = { version: string; primaryColor: 'default'|'preset1'…'preset5'; contrast: 'default'|'high'; compactLayout: boolean }`；`SettingsContextValue` 照 Minimal 字段名（`state/canReset/onReset/setState/setField/openDrawer/onCloseDrawer/onToggleDrawer`）。mode **不**进这里。
5. **`lib/storage/ui-state.ts`**：`themeSettingsStorage = storage.defineItem<ThemeSettings>('local:themeSettings', { fallback: { version: '1', primaryColor: 'default', contrast: 'default', compactLayout: false } })`。类型定义放 `lib/storage/ui-state.ts` 旁（lib 不能 import `entrypoints/`）；`components/settings/types.ts` re-export。
6. **`settings-provider.tsx`**：用 `useSyncExternalStore` 或 `useState + storage.watch`（对齐 `lib/i18n` 现有模式），初值由 `main.tsx` 注入，避免首帧闪默认色；`setField` 写 storage；`canReset` = 与 fallback 不等。
7. **`main.tsx`**：`const [navigation, themeSettings] = await Promise.all([loadNavigationData(), themeSettingsStorage.getValue()])`，传给 `SettingsProvider initialState`。
8. **`theme-provider.tsx`**：`const { state } = useSettingsContext(); const theme = useMemo(() => createTheme({ settingsState: state }), [state])`。
9. **`primary.lighter` 五处**：改 `varAlpha(theme.vars.palette.primary.mainChannel, 0.08)`（选中底）/ `0.16`（chip/hover）。否则切到蓝色预设时暗色模式会出现浅色底块。

**测试重写**
- `theme-contract.test.ts` 的 WCAG 断言改成 `it.each(Object.keys(primaryColorPresets))`：每个预设 light `text.accent` vs `background.default` ≥ 4.5；dark `text.accent` vs `background.default` ≥ 4.5；`primary.contrastText` vs `primary.main` ≥ 4.5（D14 保证）。`[UNKNOWN C-5]` 哪个预设的 `light`/`darker` 阶不过线——过不了就在 `update-core.ts` 派生时改用 `dark`/`lighter` 阶并记录。
- 新 `update-core.test.ts`：contrast high 改 default 底色；preset 替换后 `customShadows.primary` 含新主色 channel；`text.accent` 随预设变化；`default` 预设 = Favbase coral。
- 新 `settings-provider.test.tsx`：`setField` 写 storage、`onReset` 回 fallback、`canReset` 正确。
- 新 `lib/storage/ui-state.test.ts`：`themeSettingsStorage` fallback 形状。

**验证命令**
```
pnpm vitest run entrypoints/app/theme entrypoints/app/components/settings lib/storage
pnpm compile && pnpm test && pnpm build
```
肉眼：DevTools 里手改 `chrome.storage.local` 的 `local:themeSettings.primaryColor = 'preset2'`，确认页面主色、`text.accent`、导航激活色同步变紫，dark 模式无浅色底块。

**回滚点**：`feat(theme): add Minimal color presets and persisted theme settings state`。

**完成判据**
- [x] `grep -rn "primary.lighter" entrypoints/app --include=*.tsx | grep -v test` 零结果（theme 目录除外——唯一剩余是 `theme/core/components/avatar.tsx`，Minimal 原样的 `dark` 字 + `lighter` 底）
- [x] 六个预设 × 两 scheme 的 WCAG 断言全绿（`theme-contract.test.ts` 四组 `it.each(PRESETS)`：accent 对两 scheme 底 + high-contrast 底、`contrastText` 对 `main`、accent 对 16% soft 洗底；另锁 high-contrast 底上的 `text.primary/secondary`）
- [x] `lib/storage/CLAUDE.md` 增加 `local:themeSettings` 行；`theme/CLAUDE.md` 增加 with-settings 段；`components/settings/CLAUDE.md` 新建
- [x] 四步验证全绿：`pnpm vitest run entrypoints/app/theme entrypoints/app/components/settings lib/storage` 10 文件 99 用例；`pnpm vitest run entrypoints/app entrypoints/welcome` 73 文件 432 用例（既有结构测试**零改动**通过）；`pnpm compile`；`pnpm test` 180 文件 1329 用例 + CLI 10 文件 55 用例；`pnpm build` + bundle contract 绿
- [ ] 肉眼验证——**待用户加载 worktree 的 `.output/chrome-mv3`**：DevTools 改 `local:themeSettings` 为 `{ primaryColor: 'preset2', contrast: 'default', compactLayout: false }`，主色 / `text.accent` / 导航激活洗底同步变紫，dark 无浅色底块；再试 `contrast: 'high'`（light 底变 grey 200、Card 阴影降为 z1）

**执行记录（2026-09-01）**
- **`[UNKNOWN]` 消解**：C-5 六预设的派生阶**全部过线**，不需要回退到 `dark`/`lighter`：`darker` 对白底最低 8.74（preset4）、对 high-contrast 底 `#F4F6F8` 最低 8.07；`light` 对 `#141A21` 最低 6.44（preset2）；对 16% soft 洗底最低 5.15（preset2 dark）。D14 派生结果：default 6.74 墨 `#1F1B17`、preset1 4.93 墨（Minimal 白只有 3.47）、preset2 6.34 白、preset3 5.03 白、preset4 8.87 墨、preset5 4.66 墨（Minimal 白只有 3.67）。high-contrast 底上 `text.secondary` = **4.508**，全主题最紧的一对，已锁进测试。
- **对本节"PRD 默认"的推翻（理由见任务 PRD Grill 段）**：
  1. **不建 `update-components.ts`**（第 3 点允许省略）：Favbase 自有 `MuiCssBaseline` 函数覆盖，`createMuiTheme` 对两个 `styleOverrides` **函数**是覆盖不是合并，照搬会抹掉 tabular-nums/selection/focus ring。high contrast 的卡片阴影改为 token 级：`applySettingsToTheme` 把两 scheme 的 `customShadows.card` 置为该 scheme 的 `z1`（`card.tsx` 的 `var(--card-shadow, customShadows.card)` 没有其他 setter，等价）。
  2. **值本体不带 `version` 字段**（第 4/5 点）：WXT `defineItem` 原生 `version` + `migrations` 可事后追加（未版本化 = 隐式 v1），且 lib 层 `canonicalizeThemeSettings` 逐字段回退（zod `.catch()`，永不 throw），比 Minimal 的"版本不符整体重置"更好。类型与 storage item 在**新文件** `lib/storage/theme-settings.ts`（`ui-state.ts` 旁），六个预设 id `THEME_COLOR_PRESETS` 也在这里作单源，`color-presets.ts` 以 `Record<ThemeColorPreset, …>` 承接。
  3. **`SettingsProvider` 挂在 `main.tsx` 包 `RouterProvider`**（第 7 点写 `App.tsx`）：`App` 是 router `Component`，没有 props 通道；仍在 `ThemeProvider` 外层，`App.tsx`/`App.test.tsx` 零改动。
  4. **`theme-provider.tsx` 用 `use(SettingsContext)` 可选读取**（第 8 点写抛错版 `useSettingsContext()`）：welcome.html 复用 `ThemeProvider`（R3a）且 20 个测试裸渲染它；无 provider → coral 默认。leaf import `components/settings/context/settings-context.ts`（只 import react），不走 barrel，避免把 storage 拖进 welcome/测试。抛错版留给 Step 4 抽屉。
  5. **`update-core.ts` 对 `default` 预设不分支**（第 2 点写 `primaryColor !== 'default'` 才替换）：default = coral，走同一路径，`update-core.test.ts` 用"default 预设 = base"锁等价。
- **手册之外的必改（铁律 2 补记）**：删除 dark scheme 的 `primary.lighter` 再着墨特判（`primaryDark` / `themeConfig.scheme.dark.primaryLighter = #3A2A24`）——Step 1 记录写明它只因"五个消费者未动"而保留，本步五处改 `varAlpha(primary.mainChannel, 0.08)`（选中）/ `0.16`（选中态 hover）后特判失去理由，两 scheme 共用同一 `primary` 五阶，预设亦然。同步：`themeConfig.scheme.*.accentText` 常量删除，`text.accent` 由 `core/palette.ts` 的 `accentTextFor`/`createTextPalette` 派生（light `darker` / dark `light`），`update-core.ts` 复用同一函数；`css-baseline.tsx` 的 `::selection` 底从 `primary.lighter` 改 `varAlpha(primary.mainChannel, 0.16)`（否则蓝色预设 dark 模式下选中文本是白字压浅蓝块）。副作用：welcome `sections/chat-showcase.tsx:150` 在 dark 用 `primary.lighter` 作**文字**色，此前 `#3A2A24` 在深底上不可读，现恢复可读（未改 welcome 源码）。`theme-contract.test.ts` 新增断言锁"dark `primary.lighter` = coral `lighter`、两 scheme `primary` 相等"。
- **§Step 1 第 6 点的"五个消费者"**：`layouts/dashboard/nav.tsx`（选中 0.08 / hover 0.24→0.16）、`sections/overview/overview-view.tsx`（0.08）、`sections/chat/chat-view.tsx`（0.08）、`sections/bilibili/bilibili-view.tsx`（两处：选中 0.08 / 选中 hover 0.16）。
- **体积**（`pnpm build`，对比 Step 1）：`app-*.js` 222,475 B（gz 69,717，+895）；`Container-*.js` 348,347 B（gz 118,269，−87）；theme + registry 共用 chunk 63,920 B（gz 17,057，+1,262 = `getContrastRatio` + 六预设 + update-core）；chunks 合计 62 文件 3,953,290 B（**+2,179 B**）。
- **并行 worktree 提示**：Step 3 在 `docs25-step3-shared-primitives` worktree 同期进行，两边都改 `entrypoints/app/main.tsx`（本步改 bootstrap 与渲染树，Step 3 改 `LoadingFallback`）与本文状态行，合并时有两处小冲突。

---

### Step 3 — 共享原语移植

**目标**：把 Minimal 的 `Label / EmptyContent / CustomBreadcrumbs / CustomPopover / Scrollbar / LoadingScreen` 六个原语搬进 `entrypoints/app/components/`，并让 `StateBox`、`SectionTitleBar`、`main.tsx LoadingFallback` 变成它们的薄适配层。图标补齐。

**前置依赖**：Step 1（依赖 mixins 与 opacity token）。

**动哪些文件**
- 新建目录（每个含 `index.ts` + 组件 + `classes.ts`/`styles.tsx` 视 Minimal 而定 + 一个结构测试）：`components/label/`、`components/empty-content/`、`components/custom-breadcrumbs/`、`components/custom-popover/`、`components/scrollbar/`、`components/loading-screen/`
- 改：`components/collection/state-box.tsx`、`components/collection/section-title-bar.tsx`、`components/collection/index.ts`、`components/collection/CLAUDE.md`
- 改：`entrypoints/app/main.tsx:26 LoadingFallback` → 用 `LoadingScreen`
- 改：`entrypoints/app/components/iconify/` 注册表：新增 `solar:danger-bold`、`solar:info-circle-bold`、`solar:danger-triangle-bold`、`eva:info-outline`、`eva:arrow-ios-back-fill`（`eva:arrow-ios-forward-fill`、`mingcute:close-line`、`solar:check-circle-bold` 已有）
- 改：`entrypoints/app/global.css`（import `simplebar-react/dist/simplebar.min.css`）
- 改：vitest setup（`vitest.config.ts:11` 只配了 `environment: 'happy-dom'`，无 `setupFiles`——新建 `tests/setup/app-dom.ts` 提供 `ResizeObserver` stub 并在 config 里注册；只为 simplebar）
- `package.json`：`simplebar-react ^3.3.2`
- 文档：`components/CLAUDE.md` 若存在则更新索引，否则各新目录各建 `CLAUDE.md`（可合并为 `components/shared-primitives/CLAUDE.md`？不要——按现有惯例一目录一文件）

**具体改什么**
1. **Label**（`$MIN/components/label/`）：soft/filled/outlined/inverted 四变体，颜色含 `default|primary|secondary|info|success|warning|error`；`startIcon/endIcon`。类型增强放 Step 1 的 `extend-theme-types.ts`。
2. **EmptyContent**（`$MIN/components/empty-content/`）：`filled` 变体 = tinted 底 + dashed 边；`imgUrl` 可选。**Favbase 覆盖**：title `Typography variant="subtitle1" component="p"` 色 `text.secondary`（Minimal 用 `h6 text.disabled`，对比度不过线）。
3. **StateBox 适配**：保留 props（`icon/title/description/action/…`）与 `data-state-box`，内部渲染 `EmptyContent filled`；48px glyph 图标继续走 `icon` prop 放在 `EmptyContent` 的插图槽。`state-box.test.tsx` 3 例不改就应过。
4. **CustomBreadcrumbs**（`$MIN/components/custom-breadcrumbs/`）：`heading/links/action/backHref`；分隔符 `BreadcrumbsSeparator` 圆点。**Favbase 覆盖**：heading 渲染 `component="h1" variant="h1"`（Minimal 是 `h4`）。
5. **SectionTitleBar 适配**：新增 `links?: BreadcrumbLink[]`；有 `links` 时渲染 `CustomBreadcrumbs`，否则维持现有 h1 + caption 结构；`data-section="title"`、`data-slot="caption"`、action 槽（三态同步按钮）不变。`section-title-bar.test.tsx` 3 例保留，新增一例断言 `links` 渲染为 `<nav aria-label>` + 末项 `aria-current="page"`。
6. **CustomPopover**（`$MIN/components/custom-popover/`）：arrow + 12 个 placement；Step 4 语言弹出与 Step 9 chat 菜单用。
7. **Scrollbar**（`$MIN/components/scrollbar/`）：`simplebar-react` 包装，`fillContent` 支持；`slotProps.wrapper/contentWrapper/content`。happy-dom 下需 `ResizeObserver` stub。**D5 记录**：simplebar 带 ~14KB gz、一个额外 DOM 包裹层与自绘滚动条（键盘/读屏可达性依赖原生滚动容器仍在——simplebar 保留原生 `overflow` 元素，只隐藏原生条）。
8. **LoadingScreen**（`$MIN/components/loading-screen/`）：`portal` 可选 + `LinearProgress` 360px。`main.tsx` 的 `LoadingFallback` 删掉换它；`sections/overview` 的 `AnalyticsLoading`（几何感知骨架）**保留**。
9. **图标**：按 `components/iconify/` 现有注册方式（离线 JSON）加五个图标；不得引入运行时网络加载。

**测试重写**
- 无既有断言变更（StateBox/SectionTitleBar 是适配层）。
- 新增六个结构测试：Label 变体 class 与颜色 token；EmptyContent filled 有 dashed 边 + title 是 `<p>`；Breadcrumbs `nav`/`aria-current`；Popover arrow 存在；Scrollbar 渲染 children 且 `data-simplebar` 存在；LoadingScreen 有 `role="progressbar"`。
- `tests/i18n-no-hardcoded.test.ts`：新组件无 CJK；EmptyContent 默认 title 用 `t('state.empty')`（复用现有 key，`[UNKNOWN C-6]` 现有 key 名以 `lib/i18n/locales/zh-CN.ts` 为准）。

**验证命令**
```
pnpm vitest run entrypoints/app/components
pnpm compile && pnpm test && pnpm build
```
`pnpm build` 后确认 `simplebar` 只出现在 app chunk：`grep -l "simplebar" .output/chrome-mv3/chunks/*.js` 不得含 background 相关 chunk；`node scripts/check-background-bundle.mjs` 绿。

**回滚点**：`feat(app-components): port Minimal Label/EmptyContent/Breadcrumbs/Popover/Scrollbar/LoadingScreen`。

**完成判据**
- [ ] 六个新目录各有 `index.ts` + 结构测试 + `CLAUDE.md`
- [ ] `StateBox`/`SectionTitleBar` 现有测试零改动通过
- [ ] 五个新图标离线注册，`pnpm build` 产物无 iconify 网络请求（DevTools Network 过滤 `api.iconify`）
- [ ] §2.5 记录本步后 app chunk 体积

---

### Step 4 — Shell：nav-section + header + settings drawer

**目标**：侧栏换成 Minimal `nav-section`（vertical/mini/dropdown + 分组 subheader + `NavToggleButton`），header 右侧换成 `LanguagePopover / SettingsButton`，设置抽屉（360）落地；`sidebarPinned` 语义映射为 vertical/mini。

**前置依赖**：Step 2（抽屉数据层）、Step 3（Scrollbar/CustomPopover）。

**动哪些文件**
- 新建 `components/nav-section/`：`nav-section-vertical.tsx`、`nav-section-mini.tsx`、`components/{nav-list.tsx, nav-item.tsx, nav-ul.tsx, nav-li.tsx, nav-subheader.tsx, nav-collapse.tsx, nav-dropdown.tsx}`、`styles/{css-vars.ts, classes.ts, nav-item-styles.tsx}`、`types.ts`、`index.ts`（镜像 `$MIN/components/nav-section/`，**不移植** horizontal）
- 新建 `components/settings/drawer/`：`settings-drawer.tsx`、`base-option.tsx`、`presets-options.tsx`、`large-block.tsx`、`small-block.tsx`、`styles.tsx`（镜像 `$MIN/components/settings/drawer/`，去掉 nav/font/rtl/fullscreen 选项）
- 新建 `layouts/components/`：`nav-toggle-button.tsx`、`settings-button.tsx`、`language-popover.tsx`（从 `layouts/dashboard/header-actions.tsx` 拆出语言部分）
- 改：`layouts/dashboard/nav.tsx`（560 行）→ 拆 `nav-vertical.tsx`（含 mini 分支，Minimal 是同一组件按 `isNavMini` 切）+ `nav-mobile.tsx`（保留现 `NavMobile` 焦点契约）
- 改：`layouts/dashboard/nav-config.tsx`（`createNavData` 返回分组数组）、`layouts/dashboard/layout.tsx`、`layouts/dashboard/css-vars.ts`、`layouts/dashboard/header.tsx`（如存在，否则 `layout.tsx` 内 header 段）
- 删：`layouts/dashboard/header-actions.tsx`（主题 pill 逻辑搬进抽屉 Mode 项后删除）
- 改：`entrypoints/app/App.tsx`（挂 `<SettingsDrawer />`）
- i18n：`lib/i18n/locales/{zh-CN,en}.ts` 新 key：`nav.groupCollections`、`nav.groupGeneral`、`nav.expandAria`、`nav.collapseAria`、`header.settingsAria`、`settingsDrawer.title/mode/modeLight/modeDark/modeSystem/contrast/compact/presets/reset/close`
- 测试：`layouts/dashboard/nav.test.tsx`、`layout.test.tsx`、`css-vars.test.ts`、`layouts/nav-active.test.ts`；新建 `components/nav-section/css-vars.test.ts`、`components/settings/drawer/settings-drawer.test.tsx`、`layouts/components/language-popover.test.tsx`
- 文档：`layouts/CLAUDE.md`（`:43` 拒绝 Minimal shell 的那行删掉）、`components/nav-section/CLAUDE.md`、`components/settings/CLAUDE.md`

**具体改什么**
1. **nav-section CSS 变量**（`styles/css-vars.ts`）：`--nav-item-height 44 / --nav-item-sub-height 36 / --nav-item-root-height(mini) 56` 等照 Minimal `navSectionCssVars`；`dashboard/css-vars.ts` 删除 `--layout-nav-item-height / --layout-nav-child-item-height / --layout-nav-compact-item-size`，保留 `--layout-nav-vertical-width 300 / --layout-nav-mini-width 88`（现名若是 `compact` 改 `mini`，`dashboardLayoutVars(theme, pinned: boolean)` 签名不变）。
2. **nav 数据**（`nav-config.tsx`）：`NavSectionData[] = [{ subheader: t('nav.groupCollections'), items: [Collections{ path:'/collections', children:[六平台, Platform Request(external)] }] }, { subheader: t('nav.groupGeneral'), items: [Analytics '/', Chat '/chat', Settings '/settings'] }]`。`NavItem` 加 `caption?`（Platform Request 用 caption 显示 "external"）。
3. **D15 父行链接 + 独立箭头**：Minimal `nav-item.tsx` 在有 children 时把整行当折叠按钮。Favbase 改 `NavItem`：有 `path` 就永远渲染 `<a>`；`hasChild` 时在行尾**额外**渲染一个 `IconButton`（`aria-expanded` + `aria-controls`）负责折叠。写在文件顶部 `// favbase override: link and disclosure are sibling controls (ui-design-system §8)`。
4. **激活态**（`nav-item-styles.tsx`）：root active `color: text.accent`（Minimal 是 `primary.main`——Favbase 用 accent 保证对比度）+ `bgcolor: varAlpha(primary.mainChannel, 0.08)`；sub active `text.primary` + `action.selected`；图标继承文字色。
5. **mini**：宽 88，root 项 56 高、图标 22 + 10px 标题；有 children 的项 hover/focus 弹 `NavDropdown`（Popover paper，`paperStyles dropdown`）。键盘：focus 进入 root 项后 `ArrowRight` 打开 dropdown（Minimal 只有 hover，Favbase 补键盘——PRD 默认，a11y 底线）。
6. **`NavToggleButton`**：悬在 nav 右缘（`position: fixed; left: var(--layout-nav-vertical-width) - 12`），`eva:arrow-ios-back-fill` / `forward` 随状态切；点击写 `sidebarPinnedStorage`；`aria-label` 用 `nav.collapseAria`/`nav.expandAria`；`aria-expanded`。header 左侧的桌面 toggle 删除，移动端汉堡（`custom:menu-duotone`）保留。
7. **header 右侧**：`BackgroundJobsIndicator`（不动）→ `LanguagePopover`（`CustomPopover` + 两项 + 当前项 `Mui-selected`）→ `SettingsButton`（`solar:settings-bold-duotone`，打开抽屉）→ GitHub 链接。
8. **SettingsDrawer**：宽 360、右侧 temporary Drawer、`Scrollbar` 包裹；顶部标题 + Reset（`solar:restart-bold`，带 `Badge` dot 表示 canReset）+ 关闭；选项：Mode（Light/Dark/System 三选，调用 `useColorScheme().setMode`，**View Transition 包裹**从 `header-actions.tsx` 原样搬入）、Contrast（default/high）、Compact（switch）、Presets（六色圆点，coral 第一）。抽屉打开状态是 context 内存态，不持久化。
9. **`layout.tsx`**：`navLayout = pinned ? 'vertical' : 'mini'` 传给 `NavVertical`；`DashboardContent` 读 `compactLayout` → `maxWidth = compact ? 'lg' : false`（Minimal 语义）。移动端 Drawer 不变。
10. **`nav-active.test.ts`** 所依赖的 `isNavActive` 纯函数保留原位。

**测试重写**
- `layout.test.tsx`
  - "labels the desktop sidebar toggle and persists pin/unpin"：目标元素从 header 按钮改为 `NavToggleButton`；断言 `aria-label` 在 collapse/expand 两文案间切换、`aria-expanded` 翻转、`sidebarPinnedStorage` 被写。
  - 移动端 Drawer 关闭 + 焦点归还：不改。
- `nav.test.tsx`（7 例）
  1. Collections 父行是聚合页链接 → 保留（D15）。
  2. logo → 保留。
  3. chevron 切换子菜单不导航 → 保留，选择器改成 `button[aria-expanded]`。
  4. 平台色图标非激活 → 保留。
  5. Platform Request 可读文本 → 保留；新增断言 caption 存在。
  6. compact 行 icon-only 可达名 → **改写**：mini 行渲染图标 + 标题文本；有 children 的 root 项 `aria-haspopup="true"`；`ArrowRight` 打开 dropdown 且子链接可 tab。
  7. 激活图标 coral → **改写**：激活行有 `--active` class（Minimal `navSectionClasses.state.active`）且 `color` 解析为 `text.accent` var。
  - 新增：两组 subheader 渲染为 `<li>` 内 `ListSubheader`，顺序 Collections → General。
- `css-vars.test.ts:27`：删除 nav 行高断言；描述改 "locks content gutters and the 120ms layout transition"。`:23-24` 300/88 保留（变量名若改 mini 同步）。
- 新 `components/nav-section/css-vars.test.ts`：44/36/56。
- 新 `settings-drawer.test.tsx`：打开后 `role="dialog"`/`aria-label`；点 preset 写 `themeSettingsStorage.primaryColor`；Mode 项调用 `setMode`；Reset 后 `canReset=false` 且 mode 回 `system`。
- 新 `language-popover.test.tsx`：两项、当前项 selected、选择后 `localeStorage` 写入。
- `header-actions.test.tsx` 不存在（已核实），无需删。

**验证命令**
```
pnpm vitest run entrypoints/app/layouts entrypoints/app/components/nav-section entrypoints/app/components/settings
pnpm compile && pnpm test && pnpm build
```
肉眼（light/dark × vertical/mini × 桌面/移动 = 8 张截图，存 `docs/ui-baseline/2026-09-xx/step4/`）：subheader、激活态、mini dropdown、toggle 按钮位置、抽屉六色、Mode 切换有 View Transition。键盘：Tab 走完 nav → toggle → header 四控件 → 抽屉内闭环。

**回滚点**：`refactor(app-shell): port Minimal nav-section, header actions and settings drawer`。这一步 diff 最大，建议在功能分支完成后 squash 成一个 commit。

**完成判据**
- [ ] `layouts/dashboard/header-actions.tsx` 不存在；`grep -rn "header-actions" entrypoints/app` 零结果
- [ ] `grep -rn "layout-nav-item-height\|layout-nav-child-item-height\|layout-nav-compact-item-size" entrypoints/app` 零结果
- [ ] 新 i18n key 双语齐全，`tests/i18n-no-hardcoded.test.ts` 绿
- [ ] `layouts/CLAUDE.md` 重写为 vertical/mini/mobile 三形态 + toggle + header 右侧四控件 + 抽屉；`:43` 拒绝行删除

---

### Step 5 — Snackbar（sonner）+ 六处触发点

**目标**：引入 `sonner`，按 Minimal `components/snackbar/` 皮肤化，挂到 `App.tsx`；六个一次性动作结果改 toast（D6 方案 A）；加 import 边界守卫。

**前置依赖**：Step 1（Minimal `paperStyles`/`varAlpha` 与 `customShadows.z8`）。

**动哪些文件**
- 新建 `components/snackbar/`：`snackbar.tsx`、`styles.tsx`、`classes.ts`、`index.ts`（镜像 `$MIN/components/snackbar/`）；`snackbar.test.tsx`
- 改：`entrypoints/app/App.tsx`（`<ThemeProvider>` 内挂 `<Snackbar />`）
- 触发点：
  - `sections/settings/use-config-draft.ts:150 handleSave`（五张配置卡共用）——成功 `toast.success(t('snackbar.saved'))`、失败 `toast.error`；**已保存徽标保留**（`save-actions.tsx` 不动）
  - `sections/settings/webdav-sync-card.tsx:73 handleSyncNow`、`:94 handleClearRemote`——结果 toast；`:64 handleToggleEnabled` 不 toast（状态切换非一次性动作）
  - `sections/overview/export-card.tsx:44` 的 `error` state 与 `:87-90` 的内联 `Alert` **删除**，成功 `toast.success`、失败 `toast.error`
  - `sections/settings/agent-bridge-card.tsx:119` `copyFeedback` state 及 `:459/:485/:493-496` 的 `Alert` **删除**，复制结果 toast
  - 测试连接（各配置卡）——**不改**，保留内联 Alert（结果需要持续可读）
  - 收藏拉取、主题/语言切换——**不 toast**
- 新建守卫：`tests/snackbar-import-boundary.test.ts`
- i18n：`snackbar.saved / saveFailed / synced / syncFailed / remoteCleared / clearFailed / exported / exportFailed / copied / copyFailed`
- `package.json`：`sonner ^2.0.7`
- 文档：`components/snackbar/CLAUDE.md`、`sections/settings/CLAUDE.md`、`sections/overview/CLAUDE.md`、`entrypoints/app/CLAUDE.md`（App.tsx 挂载点）

**具体改什么**
1. `snackbar.tsx`：`<Toaster expand gap={12} closeButton offset={16} visibleToasts={4} position="top-right" className={snackbarClasses.root} toastOptions={{ unstyled: true, classNames: … }} icons={{ loading: <Iconify solar:… />, success: solar:check-circle-bold, warning: solar:danger-triangle-bold, error: solar:danger-bold, info: solar:info-circle-bold }} />`，照 Minimal。`styles.tsx` 的 `StyledToaster` 用 `theme.mixins.paperStyles`，宽 360，各 severity 用 `varAlpha(<color>.mainChannel, 0.08)` 图标底。
2. `use-config-draft.ts`：`handleSave` 现在返回 `boolean`（`:62` 类型），在 `true/false` 分支加 toast；toast 文案通过 `t()`，`use-config-draft.ts` 已在 UI 层（`sections/`），允许 import `@/entrypoints/app/components/snackbar`——**不是** `sonner` 本身。
3. 边界：`components/snackbar/index.ts` 导出 `toast`（re-export sonner 的 `toast`）与 `Snackbar`。所有业务只 import 这个 index。
4. 守卫测试：扫描 `lib/**`、`entrypoints/**`（排除 `entrypoints/app/components/snackbar/**` 与 `components/scrollbar/**`）的 `.ts/.tsx`，出现 `from 'sonner'` 或 `from 'simplebar-react'` 即 fail 并列出 file:line（写法照 `tests/i18n-no-hardcoded.test.ts`）。

**测试重写**
- `use-config-draft.test.ts`：`vi.mock('@/entrypoints/app/components/snackbar', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))`；保存成功/失败各断言一次调用。
- `agent-bridge-card.test.tsx`：删除对 `copyFeedback` Alert 的断言（执行时 grep `severity` 定位），改为 toast mock 断言。
- `export-card` 目前无测试文件（`sections/overview/` 只有 `overview-view.test.tsx`、`use-collection-analytics.test.tsx`）——新增 `export-card.test.tsx`：失败路径不渲染 `Alert`，`toast.error` 被调。
- 新 `snackbar.test.tsx`：`Toaster` 渲染 `section[aria-label]`（sonner 默认 region），五种图标注册。
- 新 `tests/snackbar-import-boundary.test.ts`。

**验证命令**
```
pnpm vitest run entrypoints/app/components/snackbar entrypoints/app/sections/settings entrypoints/app/sections/overview tests/snackbar-import-boundary.test.ts
pnpm compile && pnpm test && pnpm build
```
肉眼：设置页保存 → 右上 toast + 已保存徽标同时出现；导出失败 → 只有 toast；Agent Bridge 复制 → toast，原位无 Alert。dark 模式 toast 底色为 paper 而非透明。

**回滚点**：`feat(app): add sonner snackbar and route one-shot action results through it`。

**完成判据**
- [ ] `grep -rn "copyFeedback" entrypoints/app` 零结果；`export-card.tsx` 无 `Alert` import
- [ ] `tests/snackbar-import-boundary.test.ts` 绿且确实拦截（临时在 `lib/` 加一行 `import 'sonner'` 验证会 fail，再删）
- [ ] PRD 触发表六项逐条核对完毕
- [ ] §2.5 记录本步后 app chunk 体积（sonner ~7KB gz）

---

### Step 6 — Dashboard：KPI 卡 + 原生 SVG 图表

**目标**：`/` 改成 Minimal analytics 形态：四张 `AnalyticsWidgetSummary` 风格 KPI 卡 + 平台构成 Card（原生 SVG 环图 + 图例即 Tabs）+ 平台细分 Card + Top tags Card；数据全部来自 `CollectionAnalyticsSnapshot` 真实字段（D17）。

**前置依赖**：Step 3。

**动哪些文件**
- 新建 `components/chart/`：`donut-chart.tsx`、`chart-legends.tsx`、`index.ts`、`donut-chart.test.tsx`（零依赖 SVG；`sparkline.tsx` **不建**，D17）
- 拆：`sections/overview/overview-view.tsx`（628 行）→ `overview-view.tsx`（编排）+ `analytics-widget-summary.tsx` + `analytics-platform-composition.tsx` + `analytics-platform-detail.tsx` + `analytics-top-tags.tsx`
- 保留：`sections/overview/use-collection-analytics.ts`、`export-card.tsx`（Step 5 已改）、`AnalyticsLoading`
- 测试：`sections/overview/overview-view.test.tsx`
- 文档：`sections/overview/CLAUDE.md`、`components/chart/CLAUDE.md`、`.trellis/spec/frontend/ui-design-system.md` §10

**具体改什么**
1. **KPI 卡**（照 `$MIN/sections/overview/analytics/analytics-widget-summary.tsx` 去掉 ApexCharts 与百分比趋势）：`Card` `p: 3`，135° 渐变 `varAlpha(<color>.lighterChannel, .48) → varAlpha(<color>.lightChannel, .48)`，文字 `<color>.darker`，右上 48px 图标 `absolute`，标题 `subtitle2` `component="p"`，数值 `h3` `component="p"` tabular-nums。四张：总条目（`totalItems`，primary）、有条目平台数（`platforms.filter(p => p.itemCount > 0).length`，info）、已用标签（`usedTags`，warning）、打标覆盖率（`taggedItems/totalItems` 百分比，`totalItems===0` 显示 `—`，success）。**无 sparkline、无趟势箭头**。
2. **平台构成 Card**：`CardHeader` 标题 h2；左 `DonutChart`（SVG `circle` 六段 `stroke-dasharray`，`aria-hidden`，中心显示 `totalItems`）；右 `ChartLegends` 六行，每行是 `Tab`（保留现有六 tabs 语义与 `role="tablist"`），色块用 `platform.*` 色，数值与百分比用文本打印（读屏可读，图不承担信息）。`share===0` 的段不画弧，图例仍显示 0。
3. **平台细分 Card**：`role="tabpanel"`，现有 `dimensions` 排行列表照搬，`Mui-selected` 底色改 `primary.main@0.08`（Step 2 已改）。
4. **Top tags Card**：现有 chip 链接列表，chip 变体随 Step 1 soft。
5. **Grid**：`spacing={3}`；KPI `size={{ xs:12, sm:6, md:3 }}`；构成 `{ xs:12, md:6, lg:4 }`；细分 `{ xs:12, md:6, lg:8 }`；Top tags `{ xs:12 }`。
6. 标题栏：`SectionTitleBar` 不传 `links`（`/` 是根，无面包屑）。

**测试重写**（`overview-view.test.tsx` 6 例）
1. loading + error：`AnalyticsLoading` 选择器不变；error 走 `StateBox`（Step 3 适配层）——不改。
2. 标题经 `SectionTitleBar` → 不改。
3. 空态六个 tabs 诚实显示零 → 保留 `role="tab"` ×6；"zero-share bars" 断言改为"环图无 `<circle data-platform>` 段且图例文本为 0"。
4. 真实指标 + top-tag 链接 → 新增 `data-slot="kpi-value"` ×4 值断言（`totalItems`、平台数、`usedTags`、百分比）。
5. heading outline `[1,2,2,3,2]` → **重算**：h1 标题；四张 KPI 卡标题是 `<p>` 不计；构成 Card h2、细分 Card h2（其内 dimension 标题 h3）、Top tags h2、Export Card h2 → 若 Export 卡仍在页内则 `[1,2,2,3,2,2]`，执行时以实际 DOM 定，写清理由。
6. 无维度文案 → 不改。
- 新 `donut-chart.test.tsx`：六段 `stroke-dasharray` 之和 = 周长；零份额段不渲染；`aria-hidden`。

**验证命令**
```
pnpm vitest run entrypoints/app/sections/overview entrypoints/app/components/chart
pnpm compile && pnpm test && pnpm build
```
肉眼：空库（新 profile）四张卡显示 0/0/0/—；有数据时环图颜色与图例平台色一致；dark 模式渐变不发灰。

**回滚点**：`refactor(overview): rebuild dashboard with Minimal KPI cards and native SVG composition chart`。

**完成判据**
- [ ] `overview-view.tsx` ≤ 200 行，四个子组件各 ≤ 150 行
- [ ] `grep -rn "apexcharts\|recharts" entrypoints package.json` 零结果
- [ ] `ui-design-system.md` §10 改写："KPI 卡只允许绑定 `CollectionAnalyticsSnapshot` 字段；禁止编造/演示数据；无数据显示 `—` 而非 0 假象"
- [ ] `sections/overview/CLAUDE.md` 更新四子组件 owner 表

---

### Step 7 — Settings 页

**目标**：设置页 Tabs 改 Minimal 下划线默认形态，左侧 section rail 改 Minimal 垂直 Tabs 默认，删除 `segmented-tabs-sx.ts`，标题改面包屑。

**前置依赖**：Step 3。

**动哪些文件**
- 改：`sections/settings/settings-tabs.tsx`、`sections/settings/section-rail.tsx`、`sections/settings/settings-view.tsx`
- 删：`sections/settings/segmented-tabs-sx.ts`
- 保留：`settings-panel.tsx`（Card 半径随 Step 1 变 16）、`save-actions.tsx`、五张配置卡、`settings-navigation.test.tsx`
- i18n：`breadcrumbs.home`（若 Step 8 先做则复用）
- 文档：`sections/settings/CLAUDE.md`

**具体改什么**
1. `settings-tabs.tsx`：去掉 `segmentedTabsSx`，用 theme 默认（Minimal `tabs.tsx`：下划线 indicator、`textColor inherit`、min-height 48）；每个 Tab 加 `icon` 24px + `iconPosition="start"`（照 `$MIN/sections/account/view/account-view.tsx` 的 `NAV_ITEMS` 形态）；`sx={{ mb: { xs: 3, md: 5 } }}`。
2. `section-rail.tsx`：`Tabs orientation="vertical"` 去 segmented sx；选中项字色 `text.primary`、指示条 `primary.main`（Minimal 默认）。
3. `settings-view.tsx`：`SectionTitleBar links={[{ name: t('breadcrumbs.home'), href: '#/' }, { name: t('settings.title') }]}`。
4. `segmented-tabs-sx.ts` 删除；`grep -rn "segmented" entrypoints/app` 必须零结果（已核实无测试引用 `segmented`）。

**测试重写**
- `settings-navigation.test.tsx`（scrollable tracks）：不改。
- `settings-panel.test.tsx`：不改。
- `settings-view.test.tsx`（深链）：不改；新增一例断言面包屑 `nav` 存在且末项 `aria-current="page"` 为设置标题。

**验证命令**
```
pnpm vitest run entrypoints/app/sections/settings
pnpm compile && pnpm test && pnpm build
```
肉眼：Tabs 下划线；窄屏 Tabs 可横滑；面包屑 Home 可点回 `/`。

**回滚点**：`refactor(settings): adopt Minimal underline tabs and breadcrumbs`。

**完成判据**
- [ ] `segmented-tabs-sx.ts` 不存在
- [ ] `sections/settings/CLAUDE.md` 删除 segmented 描述，补面包屑

---

### Step 8 — 六平台收藏页

**目标**：平台页几乎全部继承 Step 1/3；本步只处理 chip 变体、`Label`、面包屑、`CollectionCard` 复核。

**前置依赖**：Step 3。

**动哪些文件**
- 改：`components/collection/chip-row.tsx`（`FilterChip`）、`components/tags/tag-row.tsx`（或 tag chip 所在文件，执行时 grep `Chip` in `components/tags/`）、`components/collection/collection-page-scaffold.tsx:30 CollectionPageCopy`（加 `breadcrumbs?`）
- 新建：`entrypoints/app/hooks/use-collection-breadcrumbs.ts`（`(platform: CollectionPlatform | null) => BreadcrumbLink[]`，由 `collectionPlatformRegistry` 取平台名，Home → Collections → 平台；`hooks/` 禁 import `sections/`，只依赖 `lib/collections/platforms`）
- 改：六个 `sections/<platform>/*-view.tsx` + `sections/collections/collections-view.tsx`（聚合页）传 `breadcrumbs`
- 改：`sections/zhihu/` 的类型戳 Chip → `Label` soft
- 复核：`components/collection/collection-card.tsx`（16px 半径下 focus ring `inset -2` 仍可见；`CardActionArea` hover wash；`CoverBadge` 半径改 `0.75` 单位以匹配 16 卡）
- 测试：`components/collection/chip-row.test.tsx`、六个 `*-view.test.tsx` 的 copy fixture、`collection-page-scaffold.test.tsx`（9 槽顺序不变）
- 文档：`components/collection/CLAUDE.md`、`entrypoints/app/hooks/CLAUDE.md`、六个 `sections/<platform>/CLAUDE.md` 各加一行"面包屑经 `useCollectionBreadcrumbs`"

**具体改什么**
1. `FilterChip`：选中 `variant="filled" color="primary"`（`contrastText` 由 D14 保证）、未选 `variant="soft" color="default"`；`data-*` 不变。
2. Tag chips：`soft` + `size="small"`（Minimal 10px 半径）。
3. zhihu 类型戳：`<Label variant="soft" color=…>`，保留原 `data-slot`。
4. `CollectionPageCopy.breadcrumbs?: BreadcrumbLink[]`；scaffold 把它传给 `SectionTitleBar links`。六视图 `copy` 里加 `breadcrumbs: useCollectionBreadcrumbs('<platform>')`；bilibili 详情页（`/collections/bilibili/:mediaId`）多一级收藏夹名。
5. `CollectionCard`：不改结构；核对 16px 圆角下 `CardMedia` 顶部圆角裁切（`overflow: hidden` 已在 Card）。

**测试重写**
- `chip-row.test.tsx`：icon 槽保留；新增 selected/unselected 变体 class 断言。
- 六个 `*-view.test.tsx` 与 `collections-view.test.tsx`：fixture 加 `breadcrumbs`（类型变更强制），各新增一例断言面包屑末项为平台名。
- `collection-card.test.tsx`（10+1 例）：不改。
- `tests/platform-completeness-contract.test.ts`：`hooks/` 新文件不 import `sections/` 即绿。

**验证命令**
```
pnpm vitest run entrypoints/app/components/collection entrypoints/app/components/tags entrypoints/app/sections entrypoints/app/hooks tests/platform-completeness-contract.test.ts
pnpm compile && pnpm test && pnpm build
```
肉眼：六平台页 + 聚合页 + bilibili 详情页，light/dark，检查 chip、面包屑、卡片圆角与 focus ring。

**回滚点**：`refactor(collections): soft chips, Label stamps and breadcrumbs across six platform pages`。

**完成判据**
- [ ] 七个页面面包屑末项正确，Home/Collections 可点
- [ ] `grep -rn 'variant="filled"' entrypoints/app/components/tags` 零结果
- [ ] 文档同步七个 `CLAUDE.md`

---

### Step 9 — Chat shell 完整移植

**目标**：`sections/chat/chat-view.tsx` 拆成 Minimal chat 形态（`chat-layout / chat-nav / chat-header / chat-message-list / chat-message-item / chat-message-input / styles`），`NAV_WIDTH 320 / NAV_COLLAPSE_WIDTH 96`、header 72、input 56、气泡 `p 1.5 maxWidth 320`；保留 `ChatWorkspace` 7 个结构契约。

**前置依赖**：Step 3（Scrollbar、CustomPopover）。

**动哪些文件**
- 拆：`sections/chat/chat-view.tsx` → `chat-view.tsx`（编排 + 数据）+ `layout.tsx`（Minimal `chat-layout`）+ `chat-nav.tsx` + `chat-nav-item.tsx` + `chat-header-compose.tsx`（Favbase 只有"新会话"，无 compose 联系人选择）+ `chat-message-list.tsx` + `chat-message-item.tsx` + `chat-message-input.tsx` + `styles.tsx`
- 保留：`sections/chat/` 内 markdown 渲染、来源卡片、工具四态组件、`use-chat-*` hooks
- 测试：`sections/chat/chat-view.test.tsx`（`ChatWorkspace` 7 例）
- i18n：`chat.newConversation`、`chat.collapseNav`、`chat.expandNav`（现有 key 复用优先，执行时 grep `chat.` in `zh-CN.ts`）
- 文档：`sections/chat/CLAUDE.md`

**具体改什么**
1. `layout.tsx`：照 `$MIN/sections/chat/layout.tsx`——外层 Card（16 半径，`display:flex`，高 `calc(100vh - header - gutters)`），三槽 `nav / header / main(messages + input)`；`sx` 变量 `--nav-width 320 / --nav-collapse-width 96`。
2. `chat-nav.tsx`：会话列表用 `Scrollbar`；桌面可折叠到 96（只显头像/首字母）；移动端 Drawer（**保留** Favbase 现有焦点归还与 Escape 关闭契约）；顶部"新会话"按钮 + 折叠按钮（`eva:arrow-ios-back-fill`）。
3. `chat-nav-item.tsx`：`ListItemButton` 高 72（Minimal），右侧删除按钮是**同级** `IconButton`（不嵌套在 button 内，契约 6）。
4. `chat-header-compose.tsx` → 实际是 Favbase 的会话标题栏：标题 + 会话操作（`CustomPopover` 菜单：重命名/删除）。
5. `chat-message-item.tsx`：气泡 `p: 1.5, minWidth: 48, maxWidth: 320, borderRadius: 1`；助手气泡 `background.neutral`；用户气泡 `varAlpha(primary.mainChannel, 0.16)` + `text.primary`（Minimal 用 `primary.lighter`+`grey.800`，Favbase 换 alpha 以兼容预设，见 Step 2 第 9 点）。来源卡片、工具四态、markdown 渲染原组件挂进气泡下方槽。
6. `chat-message-input.tsx`：`InputBase` 高 56 + 顶部 divider；**保留** Enter 发送 / Shift+Enter 换行 / IME composing 不发送（契约 7）；去掉 Minimal 的附件/表情/麦克风按钮（无功能，不做假按钮）。
7. `chat-message-list.tsx`：`Scrollbar` + 自动滚底 + loading 骨架（契约 3）。

**测试重写**（`ChatWorkspace` 7 例）
1. 分离 nav/log/composer → `data-slot` 改 `chat-nav / chat-messages / chat-input`，其余断言不变。
2. 工具活动 live status → 保留 `data-slot="tool-activity"` + `role="status"`。
3. loading 状态 → 保留。
4. 移动端历史抽屉关闭后焦点归还 → 保留；触发按钮选择器改新 aria-label。
5. Escape 关闭移动端历史 → 保留。
6. 激活会话无嵌套删除按钮 → 保留（`chat-nav-item` 结构保证）。
7. composer Enter/换行/IME → 保留，目标元素改 `InputBase` 的 `textarea`。
- 新增：桌面折叠后 nav 宽度 var 为 96px；`Scrollbar` 存在于消息列表。

**验证命令**
```
pnpm vitest run entrypoints/app/sections/chat
pnpm compile && pnpm test && pnpm build
```
肉眼：桌面 320/96 切换；移动端 Drawer；长回答滚动；dark 模式气泡对比；预设切蓝后用户气泡随主色。

**回滚点**：`refactor(chat): port Minimal chat shell layout, nav, message list and input`。

**完成判据**
- [ ] `chat-view.tsx` ≤ 250 行；七个子文件各 ≤ 200 行
- [ ] 7 个既有契约全部通过（允许选择器变更，不允许删除用例）
- [ ] `sections/chat/CLAUDE.md` 重写文件 owner 表

---

### Step 10 — 收口

**目标**：截图基线、规范与文档全量同步、契约注释更新、遗留 `[UNKNOWN]` 清零。

**前置依赖**：Step 0–9 全部合入。

**动哪些文件**
- 新建：`docs/ui-baseline/2026-09-xx/minimal-alignment/`（用 `docs/ui-baseline/app-runtime-check.mjs <outdir>` 跑 ROUTES 矩阵；脚本经 CDP 附着到已加载扩展的 Chrome）
- 改：`entrypoints/app/index.html:11-18` 设计契约注释——OWN-WORLD 段"8px base radius … low-strength light card shadow"改为"Minimal v7.7.0 visual language, Favbase brand tokens"；FINISH 段对 `DESIGN.md` 的引用改指 `docs/25`（**DESIGN.md 不存在**，附录 D-1）
- 改：`.trellis/spec/frontend/ui-design-system.md` §6/§7/§8/§9/§10/§11/§12 按 §3.1 逐条改写；§15 保留
- 改：`.trellis/spec/frontend/directory-structure.md`（新目录：`components/{label,empty-content,custom-breadcrumbs,custom-popover,scrollbar,loading-screen,nav-section,settings,snackbar,chart}`、`layouts/components/`）
- 改：`docs/23_favbase-app-minimal-dashboard-v7-adaptation-plan-zh-CN.md` 顶部加状态注记："2026-09 起由 docs/25 取代 §6/§11 结论"
- 改：根 `CLAUDE.md` 技术栈段与 docs/25 索引行（索引行本任务已加，状态从"计划"改"已落地"）
- 全量核对 `entrypoints/app/**/CLAUDE.md`：`grep -rn "segmented\|header-actions\|primary.lighter\|48px\|hairline\|no floating" entrypoints/app --include=CLAUDE.md`

**具体改什么**
1. 跑截图矩阵（light/dark × 全路由），与 `docs/ui-baseline/2026-08-31/phase7-validation/` 并列存档；不做像素 diff，做人工核对清单（§6 验证矩阵）。
2. 规范改写时每条注明"来源 docs/25 Step N"。
3. 附录 C 每条 `[UNKNOWN]` 改成实际结论。
4. 最后一次四步验证 + `pnpm zip` 试打包（不上传）。

**测试重写**：无新断言；跑全量。

**验证命令**
```
pnpm compile && pnpm test && pnpm build && pnpm zip
grep -rn "MUI v7\|Chrome 116\|segmented\|header-actions" CLAUDE.md entrypoints .trellis/spec   # 零结果
```

**回滚点**：`docs(app-ui): sync specs, CLAUDE.md and ui baseline after Minimal alignment`。

**完成判据**
- [ ] 附录 C 零 `[UNKNOWN]`
- [ ] `ui-design-system.md` 无 docs/23 时代残留值
- [ ] 截图目录存在且 README 列出核对结论

---

## 6. 全局验证矩阵

每个 Step 完成前跑一遍；Step 10 全量。

| 维度 | 检查项 | 工具 |
|------|--------|------|
| 类型 | `pnpm compile` 零错 | tsc |
| 单测 | `pnpm test` 零失败、零 skip 新增 | vitest |
| 构建 | `pnpm build` 成功；`scripts/check-background-bundle.mjs` 绿 | wxt |
| CSP | DevTools Console 无 CSP 违规；Network 无 `api.iconify`/CDN | 手动 |
| 主题 | light/dark 各路由截图；六预设各一张 `/` | `app-runtime-check.mjs` |
| a11y | Tab 顺序：nav → toggle → header 四控件 → 内容；抽屉/Drawer 焦点闭环与归还；`aria-current`/`aria-expanded` 正确 | 手动 + 结构测试 |
| 对比度 | 契约测试（accent/contained/soft/platform）全绿 | vitest |
| i18n | `tests/i18n-no-hardcoded.test.ts` 绿；zh/en 切换无 missing key warn | vitest + DEV console |
| 依赖边界 | `tests/snackbar-import-boundary.test.ts`、`tests/platform-completeness-contract.test.ts`、`tests/lib-import-smoke.test.ts` 绿 | vitest |
| 存储 | `favbase-color-mode`、`local:sidebarPinned`、`local:locale` 旧值仍被读取；`local:themeSettings` 缺省回退 | 手动（清 storage 再开） |

## 7. 文档同步清单

| Step | 必改文档 |
|------|----------|
| 0 | 根 `CLAUDE.md`（技术栈/Chrome 117）、`entrypoints/app/CLAUDE.md`、`theme/CLAUDE.md`、`.trellis/spec/frontend/{ui-design-system,i18n-conventions,index}.md`、`docs/21`、`docs/adr/0002` 的 116 引用 |
| 1 | `theme/CLAUDE.md`（重写） |
| 2 | `theme/CLAUDE.md`、`lib/storage/CLAUDE.md`、`components/settings/CLAUDE.md`（新） |
| 3 | 六个新 `components/*/CLAUDE.md`、`components/collection/CLAUDE.md`、`components/iconify/CLAUDE.md`（图标清单） |
| 4 | `layouts/CLAUDE.md`（重写）、`components/nav-section/CLAUDE.md`、`components/settings/CLAUDE.md`、`entrypoints/app/CLAUDE.md`（App.tsx 挂载） |
| 5 | `components/snackbar/CLAUDE.md`、`sections/settings/CLAUDE.md`、`sections/overview/CLAUDE.md`、`entrypoints/app/CLAUDE.md` |
| 6 | `sections/overview/CLAUDE.md`、`components/chart/CLAUDE.md`、`ui-design-system.md` §10 |
| 7 | `sections/settings/CLAUDE.md` |
| 8 | `components/collection/CLAUDE.md`、`hooks/CLAUDE.md`、六个 `sections/<platform>/CLAUDE.md` |
| 9 | `sections/chat/CLAUDE.md` |
| 10 | `index.html` 契约注释、`ui-design-system.md` 全量、`directory-structure.md`、`docs/23` 注记、根 `CLAUDE.md` 索引状态 |

## 8. 进度勾选表

| Step | 状态 | commit | app chunk 体积（gz） | 备注 |
|------|------|--------|----------------------|------|
| 0 | 已落地 2026-09-01，待用户 commit + 五路由目测 | （用户提交） | app 69,832 B；Container（共享 MUI）119,158 B；jsx-runtime 56,424 B | `@mui/material@9.4.0`；Button/Chip 组合 styleOverrides key 迁 `root.variants`（v9 删除）；codemod 弃用改手工；详见 Step 0 执行记录 |
| 1 | 已落地 2026-09-01，待用户 commit + 五路由 light/dark 目测 | （用户提交） | app 69,266 B；Container 117,602 B；theme+registry 共用 chunk 16,395 B；jsx-runtime 56,544 B | C-2 回退 `#222B34`、C-3 soft primary → `text.accent`、C-4 Menu 继承 Popover paper；timeline（@mui/lab）未移植；详见 Step 1 执行记录 |
| 2 | 已落地 2026-09-01（worktree 分支 `feat/docs25-step2-color-presets`），待用户 commit + 预设/高对比目测 | （用户提交） | app 69,717 B；Container 118,269 B；theme+registry 共用 chunk 17,057 B | C-5 全过线无回退；D14 墨/白派生表；无 `update-components.ts`、无 `version` 字段、Provider 挂 main.tsx、ThemeProvider 可选读 context、删 dark `lighter` 再着墨；详见 Step 2 执行记录 |
| 3 | 未开始 | | | |
| 4 | 未开始 | | | |
| 5 | 未开始 | | | |
| 6 | 未开始 | | | |
| 7 | 未开始 | | | |
| 8 | 未开始 | | | |
| 9 | 未开始 | | | |
| 10 | 未开始 | | | |

---

## 附录 A — MUI v9 迁移速查（本仓库相关子集）

- system props（`mt/p/gap/display/…` 直接作为 prop）在 Box/Stack/Typography/Grid/Link/DialogContentText/Timeline 上移除 → `sx`。codemod：`npx @mui/codemod@latest v9.0.0/system-props <path>`。
- `Typography paragraph` 移除（仓库 0 处）。`Typography color="text.secondary"` 点号形式类型通过但无样式（附录 C-1），只能走 `sx`。
- `styleOverrides` 组合 key 移除：Button `containedPrimary/outlinedPrimary/textPrimary/containedSizeSmall…`、Chip `filledPrimary/outlinedPrimary/clickableColorPrimary/avatarSmall…` → 写进 `root.variants`（`{ props: { variant, color }, style }`）；子 slot 用 `'& .MuiChip-avatar'` 子选择器。codemod `v9.0.0/button-classes` / `chip-classes` 只处理 `&.${classes.x}` 选择器形态，不处理作为 override key 的写法。Step 1 移植 Minimal `button.tsx`/`chip.tsx` 时天然是 variants 形态，不再撞到。
- `Grid` 已是 v7 的 `size={{}}` API，不变。
- `theme.vars`、`colorSchemes`、`cssVarPrefix`、`colorSchemeSelector` API 不变；`ThemeProvider` 的 `modeStorageKey/defaultMode` 不变。
- emotion 版本与 Minimal 一致，无需升级。
- 详细以 context7 `@mui/material` v9 migration 页为准；本文不复制。

## 附录 B — Minimal 源路径索引（相对 `$MIN`）

| Step | 路径 |
|------|------|
| 1 | `theme/core/{palette,shadows,custom-shadows,typography}.ts`、`theme/core/components/*.tsx`、`theme/core/mixins/*.ts`、`theme/create-theme.ts`、`theme/theme-config.ts`、`theme/extend-theme-types.ts` |
| 2 | `theme/with-settings/{color-presets,update-core,update-components,index}.ts`、`components/settings/{types.ts,context/*}` |
| 3 | `components/{label,empty-content,custom-breadcrumbs,custom-popover,scrollbar,loading-screen}/` |
| 4 | `components/nav-section/`（vertical/mini/dropdown + styles）、`components/settings/drawer/`、`layouts/components/{nav-toggle-button,settings-button}.tsx`、`layouts/dashboard/{layout,nav-vertical,nav-mobile,css-vars}.tsx`、`layouts/nav-config-dashboard.tsx` |
| 5 | `components/snackbar/{snackbar,styles,classes}.tsx` |
| 6 | `sections/overview/analytics/{analytics-widget-summary,analytics-current-visits}.tsx`（只借布局与色板，不借 ApexCharts） |
| 7 | `sections/account/view/account-view.tsx`（Tabs 形态） |
| 9 | `sections/chat/{layout,chat-nav,chat-nav-item,chat-header-compose,chat-message-list,chat-message-item,chat-message-input,styles}.tsx` |

## 附录 C — `[UNKNOWN]` 清单（执行时消解并回写）

| # | 问题 | 消解 Step | 消解方式 |
|---|------|-----------|----------|
| C-1 | MUI 9 是否仍接受 `Typography color=`（8 处） | 0 | **已消解（2026-09-01）**：`pnpm compile` 判据本身失效——v9 `Typography` 的 `color` 类型是 `string & {}`，`color="text.secondary"` 编译通过，但源码只对 palette key（`primary`… → `palette[color].main`）和 `textPrimary/textSecondary/textDisabled` 生效，点号形式**不产生任何样式**（静默视觉回归）。8 处全部改为 `sx={{ color: 'text.secondary' }}`；规则已写入根 `CLAUDE.md` 与 `ui-design-system.md` §3 |
| C-2 | 六平台色在 dark neutral `#28323D` 上是否全部 ≥ 3:1 | 1 | **已消解（2026-09-01）**：否——youtube dark `#D94040` 对 `#28323D` = 2.95:1。回退 `#222B34`（D12 仅文字部分生效），`palette.test.ts` 注释锁定原因 |
| C-3 | soft primary Chip 文字 `primary.dark` 在 16% coral 底上是否 ≥ 4.5 | 1 | **已消解（2026-09-01）**：否——light ≈ 3.99:1。改为 `text.accent`（非 `primary.darker` 常量，因 Step 2 后要跟预设派生）：light 8.5 / dark 6.2；`theme-contract.test.ts` 用混色底 `it.each` 两 scheme 锁 ≥ 4.5 |
| C-4 | Menu list padding 移植后实际值（Favbase 现锁 `spacing(0.5)`，Minimal popover list padding 0） | 1 | **已消解（2026-09-01）**：Minimal 无 `MuiMenu` 覆盖；Menu paper 继承 `MuiPopover.paper` = `paperStyles(dropdown)` padding `spacing(0.5)`，`& .MuiList-root` 上下 padding 0。断言改为 `theme.components.MuiMenu` 为 undefined + Popover paper 两值 |
| C-5 | 六预设的 `text.accent` 派生阶（darker/light）是否全部过 WCAG 4.5 | 2 | **已消解（2026-09-01）**：是——light `darker` 对白底 ≥ 8.74、对 high-contrast 底 ≥ 8.07；dark `light` 对 `#141A21` ≥ 6.44；对 16% soft 洗底 ≥ 5.15（最低均为 preset2/preset4）。无预设需要回退阶；`theme-contract.test.ts` 四组 `it.each(PRESETS)` 锁定 |
| C-6 | EmptyContent 默认文案复用的现有 i18n key 名 | 3 | grep `zh-CN.ts` |
| C-7 | Step 6 heading outline 实际序列（Export 卡是否仍在 `/`） | 6 | 以 DOM 为准 |

## 附录 D — 勘误

- **D-1** PRD "DESIGN.md（根）需同步"：根目录不存在 `DESIGN.md`（`git ls-files` 无匹配）。`entrypoints/app/index.html` 契约注释里对它的引用是悬空的，Step 10 改指 docs/25。
- **D-2** PRD R3 曾写 `shape.borderRadius → 16`：错误。base 仍 8，Card/Dialog 16 是 Minimal `×2` 派生（D9）。
- **D-3** 我在早期讨论中说 chat 有"26 个结构测试"：实际 `sections/chat/` 3 个测试文件共 16 例，`ChatWorkspace` 受影响 7 例（Step 9）。
- **D-4** D5 的 simplebar/sonner 是用户决定，我的原建议（只引 sonner）被否；本文按用户决定执行，不再重议。

