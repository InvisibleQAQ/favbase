# docs/25 — app.html 全面向 Minimal v7.7.0 看齐：分步改造手册

日期：2026-09-01
状态：**Step 0–6 已落地（Step 0–2 于 2026-09-01，Step 3 于 2026-09-02 rebase 合入，Step 4–5 于 2026-09-02 在 main 工作树实施并已 commit，Step 6 于 2026-09-03 在 main 工作树实施并已 commit），Step 7+ 未开工**。本文是可执行手册，不是设计随笔；每个 Step 都能独立开工、独立验证、独立回滚。
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
| `sonner` | 无 | `^2.0.8`（Step 5 已实装；`pnpm add sonner@^2.0.7` 解析到 2.0.8），**无需 import 它的 CSS**——sonner 自己向 `document.head` 注入（与 simplebar 不同） | Step 5 |
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

**执行记录（2026-09-01，在 Step 2 之前执行）**

顺序：Step 3 的前置只有 Step 1，与 Step 2 无依赖（§0.3 里两者是并列兄弟）。已核实六原语零 import Minimal settings context、零引用 `primaryColorPresets`，`theme/core/mixins` 与 `opacity` 在 Step 1 已就位。执行顺序 0 → 1 → 3 → 2 → 4。

**移植缺陷修复（重要）**：Minimal 的 `CustomPopover` 靠 `slotProps.paper.ref` 拿 paper 节点算箭头位置。**MUI v9 不再把这个 ref 转发到 DOM**（实测恒为 null），照抄的后果是箭头永不渲染且无任何报错。改为：箭头始终挂载为 paper 的首个子元素，经自身 `parentElement` 反查 paper，两个盒子测量齐之前 styled 早退成 `display: none`。`Arrow` 的 rect 类型因此可空。测试有一条 `display !== 'none'` 断言钉住它。

对 Minimal / 本文的其它偏离（各有理由，详见 `entrypoints/app/components/*/CLAUDE.md`）：

1. 不引 `es-toolkit`，`Label` 不做 `upperFirst`——文案出自 `t()`，大小写归 locale。
2. `EmptyContent` 无默认插图、无默认 title（C-6），新增 `icon` 插图槽承接 `StateBox` 的 48px 字形；文案落 `text.secondary`、title 是 `subtitle1` 的 `<p>`。
3. `BreadcrumbsHeading` 用 `h1` 标签 + `typography.h1`（Minimal 是 `h6` + `h4`）；另加一个 `children` 槽放 `SectionTitleBar` 的状态 caption。
4. simplebar 的 CSS 放 `components/scrollbar/styles.css` 由组件自己 import，**不进 `global.css`**——否则铁律 6 的边界只挡代码不挡样式。守卫是 `tests/ui-vendor-boundaries.test.ts`（Step 5 把 `sonner` 加进同一张表）。
5. `BackLink` 的 hover 选 `& svg`（本仓库 iconify 不导出类名常量）；不移植 `splash-screen`。
6. 新建 `entrypoints/app/theme/create-classes.ts`（`classesPrefix: 'favbase'` Step 1 已有）。`layouts/core/classes.ts` 原有同名局部函数一并删除改 import——共享 helper 落地后再留副本就是 DRY 违规。

**判据偏差**：`grep -l simplebar .output/chrome-mv3/chunks/*.js` 是**空集**——`Scrollbar` 目前无消费者，整个模块被 tree-shake。判据形式上通过，但真正的体积代价要等 Step 4 接入后才量得到。产物里的 `api.iconify` 字符串来自 `@iconify/react` 库自身（基线即有），新增的 5 个图标全部走 `addCollection` 离线注册；「Network 无 iconify 请求」是运行时判据，仍待目测。

四步验证全绿：`pnpm compile` / `pnpm test`（1307 + 55）/ `pnpm build` / `scripts/check-background-bundle.mjs`。`state-box.test.tsx` 3 例与 `section-title-bar.test.tsx` 原 3 例零改动通过。

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
- [x] `layouts/dashboard/header-actions.tsx` 不存在，代码零 import（主题药丸迁至 `welcome/sections/top-bar-actions.tsx`，见执行记录第 1 条）。**判据措辞需修正**：`grep -rn "header-actions" entrypoints/app` 不是零，剩 4 处是刻意保留的来源说明——`layouts/components/language-popover.tsx` 与 `theme/mode-transition.ts` 的注释、`layouts/CLAUDE.md` 与 `theme/CLAUDE.md` 各一行
- [x] 三个旧 nav 行高变量在实现里零出现（剩两处：`layouts/CLAUDE.md` 说明它们已迁走、`dashboard/css-vars.test.ts` 反向断言它们不复活）
- [x] 新 i18n key 双语齐全，`tests/i18n-no-hardcoded.test.ts` 绿
- [x] `layouts/CLAUDE.md` 重写为 vertical/mini/mobile 三形态 + toggle + header 右侧四控件 + 抽屉；`:43` 拒绝行删除

---

**执行记录（2026-09-02）**

前置 Step 2 与 Step 3 均已在 main，直接在 main 工作树实施（未开 worktree）；按 D19 不主动 commit。

**用户决定（2026-09-02）**：子项连接线换 Minimal 的 bullet + 竖脊（12px SVG mask L 角 + `NavCollapse` 2px 竖脊收在末项 bullet 前），Favbase 自研鱼骨线（1px divider 直角肋）删除。手册 §2.3/§3 两处都没点到这条线，是本步唯一需要用户裁决的取舍。颜色**没有**照抄 Minimal 写死的 `#EDEFF2`/`#282F37`，改用 `palette.divider`（grey-500 @ 20%，与两者相差不到一个色阶）——见下方 trellis-check 第 2 条。

**手册未覆盖或与实现冲突处，逐条处置**

1. **`header-actions.tsx` 是 welcome 的依赖**：`welcome/sections/top-bar.tsx` 直接复用它（其测试还 mock 了这个路径）。手册 §0.2「不动 welcome」与本步判据「删除 `header-actions.tsx`」互相冲突。处置：主题药丸迁到新建 `welcome/sections/top-bar-actions.tsx`（welcome 自己拥有），`LanguagePopover`/`GithubButton` 成为 `layouts/components/` 的共享叶（welcome **按叶 import**，不走 barrel——barrel 带 `settings-button` → settings context → storage），View Transition 逻辑提到 `theme/mode-transition.ts` 供抽屉与 welcome 共用。welcome 的控件形态、`header.themeAria`、`favbase-color-mode` 一律未变（铁律 1）。
2. **`compactLayout` 语义**（第 9 点）：手册写 `maxWidth = compact ? 'lg' : false`。实测六个页面**全都显式传 `maxWidth`**（多为 `xl`，settings 是 `lg`），所以这个默认参数值永不生效，而 `false` 又会推翻页面自己的决定。改为 `compact ? 'lg' : 调用方的 cap`，`DashboardContent` 经 leaf `SettingsContext` 可选读取（无 provider = off，welcome 与裸组件测试不受影响）。`DEFAULT_THEME_SETTINGS.compactLayout` 保持 `false`，默认视觉零变化。
3. **激活态**：第 4 点要求 sub 级用 `text.primary` + `action.selected`，但同节测试重写第 7 条要求「激活行 color 解析为 `text.accent`」——两条互斥。取可观测的那条：root 与 sub 统一 `text.accent` 文字 + 8% 品牌洗底（hover 16%），与 Step 2 起的选中洗底一致，也少一处特殊情况。
4. **nav 变量名**：手册写 vertical root 为 `--nav-item-height`；实现沿用 Minimal 原名 `--nav-item-root-height`（mini 同名不同值），避免同一语义两个名字。44/36/56 锁在新 `components/nav-section/css-vars.test.ts`。
5. **`nav-active.ts` 归属**（第 10 点要求原位保留）：移植后每行自己判定 active，`components/` 反向 import `layouts/` 是依赖倒置。函数移到 `components/nav-section/nav-active.ts`，并从 `findActiveChildPath`（兄弟集合 + 最长者胜）改为 `isNavItemActive(pathname, path, deepMatch)`——叶路径互不为前缀后，最长者胜没有消费者；`layouts/nav-active.ts` 与其 7 例测试删除，等价重写为 8 例。平台叶显式 `deepMatch: true` 保住 `/collections/bilibili/:mediaId` 的高亮。
6. **目录形状**：保留 Minimal 的 `vertical/` + `mini/` 子目录（各自 `nav-list`/`nav-item`），而不是手册列的扁平 `components/{nav-list,nav-item}`——两形态行几何差异太大，合并只能靠条件分支。`nav-ul`/`nav-li` 合在 `nav-elements.tsx`、`large-block`/`small-block` 合在 `drawer/styles.tsx`（都照 Minimal 原样）；`SmallBlock` 未移植（无嵌套选项组）。
7. **subheader 不可点**：Minimal 的分组标签是带 `onClick` 的 `div`（无键盘路径）。Favbase 两组分别 1 项与 3 项，折叠没有产品价值，只保留 overline 外观。
8. **mini flyout 键盘**：hover 之外补 `ArrowRight` 打开并移焦首个子链接、`Escape` 关闭并归还焦点；Popover 关掉 auto/enforce/restore focus——Minimal 是纯 hover 且指针经过就抢焦点。
9. **`NavToggleButton` 定位**：rail 保留 `overflow: hidden`（88→300 展开时不闪出整行内容），所以按钮是 rail 的**兄弟**、用 `position: fixed` + `left: var(--layout-nav-vertical-width)` + 同一 easing 跟随（手册第 6 点同款），不是 Minimal 那样的子节点。
10. **抽屉**：Mode 是 Light/Dark/System **三选**（Minimal 的二态开关无法表达 `system`，而它正是 `defaultMode`）；Presets 用 Minimal 的 sidebar 字形色板而非手册措辞里的「圆点」——顺带让颜色演示它真正要染的东西，六色各有 i18n 名（两个蓝，序号不可读）；标题叫「外观 / Appearance」而非「设置」（设置页已占这个词）；`useSettingsReset()` 把「mode ≠ system」折进 `canReset`，抽屉 Reset 与 header dot 共用一个答案。
11. **图标**：新增 5 个离线图标 `solar:sun-bold-duotone`/`solar:moon-bold-duotone`/`solar:monitor-bold-duotone`/`mdi:contrast-circle`/`mdi:arrow-collapse-horizontal`（Mode 用单色 duotone：`OptionButton` 选中要把字形染 `primary.main`，多色 `custom:*` 不吃 `currentColor`）。`custom:sun-color`/`custom:moon-color` 保留给 welcome 药丸。
12. **手册测试清单漏了两处**，已一并改：`collection-platform-registry.test.ts`（5 例改读 `NavGroup[]`，首例改为断言两组顺序与组内路径）、`load-navigation.test.ts`（`platformPaths` 改 flatMap）。另外 `App.test.tsx` 因为 App 现在挂 `SettingsDrawer`，要 mock 掉（否则 storage 进图产生未处理 rejection），顺手加了「抽屉挂在 router root」的断言。
13. **Step 3 遗留的 `Label` `inverted` 对比度复核仍悬空**：本步没有引入任何 `Label` 消费者（抽屉 Mode 用 `OptionButton`，不是 Minimal 的 System 药丸），顺延到首个真实消费者（Step 6/8 最可能）。

**i18n**：新增 `nav.groupCollections/groupGeneral/externalCaption/expandAria/collapseAria/toggleSubmenuAria`、`header.settingsAria`、`settingsDrawer.title/mode/modeLight/modeDark/modeSystem/contrast/contrastHint/compact/compactHint/presets/presetDefault/preset1..preset5/reset/close`（双语）；删除 `header.sidebarToggleAria`（被 `nav.collapseAria`/`expandAria` 取代）。`nav.toggleSubmenuAria` 用 `{{title}}` 插值，由 `use-translated-nav.ts` 合成 disclosure 的可读名。

**四步验证全绿**：`tsc --noEmit` 零错；`vitest run` 190 文件 / 1374 例（本步新增 26 例——nav-active 8、nav-section css-vars 3、nav-vertical 8、settings-drawer 5、language-popover 2；删除旧 `nav.test.tsx` 7 例与旧 `nav-active.test.ts` 7 例）；`pnpm build` 成功 + `scripts/check-background-bundle.mjs` 绿（background 11 模块 / 939,265 B）；`grep -l simplebar .output/chrome-mv3/chunks/*.js` **只命中 app chunk**（Step 3 的空集判据在本步兑现，代价见 §8 体积列）。

**判据核对**：`header-actions.tsx` 与 `nav.tsx` 已删、代码零 import ✓（两条 grep 判据的字面「零结果」不成立，剩下的是注释/文档里的来源说明与测试的反向断言，逐处列在完成判据下）；新 key 双语齐全、`tests/i18n-no-hardcoded.test.ts` 绿 ✓；`layouts/CLAUDE.md` 已按 vertical/mini/mobile + toggle + 四控件 + 抽屉重写，原 `:43` 拒绝行删除 ✓。

**trellis-check（2026-09-02，事后补跑）**：Step 4 的实现没走 Trellis 流程（未建 task、未跑 `trellis-before-dev`），补跑 `trellis-check` 后发现并修掉 3 处：

1. **spec §8 Shell 整节失真**（`.trellis/spec/frontend/ui-design-system.md`）。三个 `--layout-nav-*item*` 变量、"platform leaves 40px / compact 44x44 + Tooltip"、"Fishbone connectors use `palette.divider`"、"longest-prefix platform child selection"、Preserve 里的"theme and language controls"全部与代码不符；**其中激活态代码块（`primary.lighter` 底 + 0.24 hover）早在 Step 2 就已经漂移**，上一轮漏改。已整节重写：shell 变量与 nav 变量分表、三形态、Header 四控件顺序 + toggle 不在 Header、单一激活态（accent + 8%/16%）、连接线、D15。§7 清单同步补上这两份 spec。
2. **连接线颜色违反 §15**（"Raw neutral hex in component"）。移植时照抄了 Minimal 的 `bulletColor = {#EDEFF2, #282F37}`。改为单个 `--nav-bullet-color: palette.divider`：色差不到一个色阶，却回到设计系统给连接线保留的语义角色，并且跟随 scheme 与高对比度选项（写死的两个中性色不会）；`applyStyles('dark')` 分支与 `bulletColor` 导出一并删除，`css-vars.test.ts` 加断言钉住。
3. **§12 temporary Drawer 退出焦点契约**在外观抽屉上没有实现（触发器在 Header、抽屉挂 router root，没有共享 ref）。没有硬套那五步，而是给 §12 加了 scope 说明并**把结果写成断言**：`settings-drawer.test.tsx` 现在断言关闭后焦点回触发器、容器无 `aria-hidden` 残留——实测 MUI 默认 restore-focus 在这条路径上成立。

同时按 §15 给抽屉 option tile 的「hairline + 抬升阴影」记了一条限定例外（Minimal 原样），按 i18n spec §2 给 `nav.*`/`header.*` 与 `settingsDrawer.*` 补了 key 命名行。`git diff --check` 干净。§16 第 8 项「Impeccable detector」本会话无此 skill/脚本可用，未跑。

**待目测（未做，留给用户）**：8 张截图（light/dark × vertical/mini × 桌面/移动）存 `docs/ui-baseline/2026-09-xx/step4/`；mini flyout、抽屉六色、Mode 的 View Transition、Tab 顺序（nav → toggle → header 四控件 → 抽屉内闭环）。

**第二轮复核（2026-09-02，另一会话）**：四步验证独立重跑一遍——`tsc --noEmit` 零错、`vitest run` 190 文件 / 1374 例（唯一失败是 `lib/database/proxy-db.test.ts` 5s 超时，单独重跑 3/3 通过，属满载下的 CPU 争用抖动，非回归）、`wxt build` 成功、`check-background-bundle.mjs` 绿（11 模块 / 939,265 B）；i18n 双语各 658 key 无缺口，`i18n-no-hardcoded` / `ui-vendor-boundaries` / `platform-completeness-contract` 三个守卫绿。**上一轮的调用点同步漏了 8 处，本轮补齐**：

1. **六处活文档仍指向已删除模块**（首轮只改了 §7 清单里列到的目录）。`sections/{bookmarks,github-stars,x,youtube,zhihu}/CLAUDE.md` 的「路由/导航」行都还写着 `layouts/nav-active.ts`（最长前缀匹配）——文件和语义都随本步删除了；`theme/CLAUDE.md` 的 brand wash 消费者清单还挂着 `layouts/dashboard/nav.tsx` (`navActiveSx`)。改为 `components/nav-section/nav-active.ts`（`isNavItemActive` 段边界匹配，平台叶 `deepMatch: true`）与 `components/nav-section/styles/css-vars.ts`。`docs/19`/`docs/23`/`docs/target-ui-baseline.md`/`.impeccable/critique/*` 里的同类引用是有日期的历史快照，按 §0.2 不动。
2. **`docs/ui-baseline/app-runtime-check.mjs` 被本步打断，两处死选择器**——本步的文件清单从没提到这个脚本，而它正是「待目测」要用的工具，等于验证手段和被验证对象一起漂了：
   - `header button[aria-expanded]`（rail 收展）：toggle 已移出 header，header 里现在没有任何带 `aria-expanded` 的控件（`LanguagePopover`/`SettingsButton`/`GithubButton` 都不带）。原写法是 `?.click()`，静默空转后由下游的 300px→88px 断言背锅。改为 `button[aria-expanded]:not(header button):not(nav button)`（行 disclosure 在 `<nav>` 内，故两个排除项），抽成 `clickNavToggle()` 并**断言恰好命中一个**——死选择器不允许再退化成 no-op。
   - `header input[type="checkbox"]`（reduced-motion 下切主题不得触发 View Transition）：这是被删掉的 header 主题药丸的 Switch。改走抽屉同一条 `theme/mode-transition.ts` seam：找 header 里 `aria-label` 含 appearance 的按钮 → `role="dialog"` → 文案为 `Dark` 的 `button[aria-pressed]` 磁贴，每一步 miss 即 throw，收尾点 Close 还原页面状态（否则残留 modal 会污染后续 audit）。注入的页面侧 JS 已单独抽出 `node --check` 通过。

**trellis-check（2026-09-02，第二轮，事后补跑）**：本轮同样未建 Trellis task、未跑 `trellis-before-dev`（用户询问后补跑 check）。除上面两条外另修 2 处、报告 1 处：

3. **验证工具的漂移没有测试兜底**（Spec Sync）。`app-runtime-check.mjs` 的死选择器之所以能活到现在，是因为它只在人工运行时才暴露。`layouts/dashboard/layout.test.tsx` 新增一例，把脚本依赖的那条契约钉进快测：**`header` 与 `nav` 之外恰好存在一个 `aria-expanded` 控件，且其 `aria-label` 是 `nav.collapseAria`**。happy-dom 不支持带后代组合子的 `:not()`，所以单测用 JS 过滤表达同一条件而非复用选择器串（两处都写了注释要求同步）。fixture 加了一组带 children 的导航，确保 `nav` 那个排除项真的被行使——否则断言会因为「压根没有 disclosure」而假通过。`renderShell(root, navigation?)` 加可选第二参，其余三例零改动。
4. **`ui-design-system.md` §16 三处失真**。(a) 整节只讲 `chrome-devtools` MCP 的运行时路径，而该 server 不在当前 agent 环境里——顺带说明浏览器自动化 skill 也替代不了它（Chrome 禁止扩展给另一个扩展的 `chrome-extension://` 页面注入脚本）；改为「两种 transport，只有 `app-runtime-check.mjs` 可用」，并记下它需要 `--remote-debugging-port`、陈旧 `DevToolsActivePort` 会挂握手、矩阵缺 vertical/mini 维度（`configure()` 收 `pinned` 但 `runGroup()` 不转发）。(b) 补一段「运行时验证工具属于 shell 契约的一部分」，把本次两处死选择器作为反面案例写进去。(c) hand-off 第 2 条把 `C:	mpavbase-minimal-v7-phase2` 说成「当前 worktree」，本步在 main 上做，改为「改动所在的工作树」。§16 中 2026-08-29 的那段复核数字是有日期的记录，不改。

**报告未修**：`.trellis/spec/frontend/index.md` 的 Guidelines Index 列了 14 份指南，实际只存在 `i18n-conventions.md` / `ui-design-system.md` 两份，其余 12 份（含被 docs/25 铁律 5 引为规范来源的 `directory-structure.md`、铁律 8 引用的 `quality-guidelines.md`）文件不存在却标着 Active。规则本身在 docs/25 里有内联复述，不影响本步；但补写还是把索引改诚实，是 spec 架构层面的决定，不在 Step 4 收口范围内，留给用户裁决。

**仍待目测**：8 张截图与键盘顺序仍未做。本轮无法代跑——`DevToolsActivePort` 停留在 2026-09-01，对该 WS 端点握手超时，`/json` 也空，即当前 Chrome 未以 `--remote-debugging-port` 启动；且脚本现有矩阵只有 theme × viewport × locale，**没有 vertical/mini 这一维**，要覆盖手册要求的 8 张还需给 `runGroup` 接上已存在但未被调用的 `configure({ pinned })` 参数，并补 mini flyout 与抽屉两张交互截图。

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

#### Step 5 执行记录（2026-09-02，main 工作树）

**做了什么**：`pnpm add sonner`（解析到 2.0.8）；新建 `entrypoints/app/components/snackbar/`（`classes.ts` / `styles.tsx` / `snackbar.tsx` / `index.ts` / `snackbar.test.tsx` / `CLAUDE.md`）；`App.tsx` 在 `SettingsDrawer` 之后挂 `<Snackbar />`；六处触发点改 toast；`tests/ui-vendor-boundaries.test.ts` 加第二条 `VENDOR_RULES`；新增 `snackbar.*` 八个双语键、删孤儿键 `settings.agentBridge.copied`。

**三处偏离手册**（都在开工前向用户摊开，其中第三条由用户 2026-09-02 拍板）：

1. **`handleSave` 不改返回 `boolean`**。手册第 2 点要求 `Promise<void>` 改 `Promise<boolean>`，但 toast 就发在 `useConfigDraft` 内部，返回值没有任何消费者——加了就是死重量。改法是补 try/catch：这顺带修掉一个真 bug——`handleSave` 原先不 catch，`save` reject 会顺着 `SaveActions` 的裸 `onClick={onSave}` 变成未处理 rejection，而屏幕上什么都不显示。现在 `handleSave` 永不 reject。
2. **守卫并入 `tests/ui-vendor-boundaries.test.ts`，不新建 `tests/snackbar-import-boundary.test.ts`**。该文件是 Step 3 建的，文件头注释本就写着「Step 5 adds sonner here」，`VENDOR_RULES` 是为此预留的表。两个文件执行同一条规则，就是规则在其中一个里慢慢腐烂。§6 验证矩阵的「依赖边界」行已同步改指。判据要求的「确实拦得住」已用临时 `lib/__guard-probe.ts`（一行 `import 'sonner'`）实证：断言给出 `[ 'lib/__guard-probe.ts' ]` 后删除探针。
3. **失败文案具体优先，`snackbar.*` 只做通用与兜底**（用户决定）。手册列的十个键里只建七个通用串 + 一个 region 标签；`snackbar.exportFailed` / `copied` / `copyFailed` 不建——`settings.sync.err.*`（auth/locked/permission…）、`export.emptyDb|dbNotReady|failed`、`settings.agentBridge.copySuccess|copyFailed` 都已存在且信息量更大，另起一套同义串等于让两套文案互相漂移。WebDAV 两个 handler 只在**没有 errorCode** 时回退 `snackbar.syncFailed`/`clearFailed`。

**手册未覆盖、按 D6 自行判定的两处**：

- **webdav-sync-card 的 `localError` 整体删除**。手册只说两个 handler「结果 toast」，没提 Alert。但三处 `setLocalError` 全在 `handleSyncNow`/`handleClearRemote` 内，留着就是同一件事报两遍。`status.state === 'error'` 的 Alert 是持久状态，按 D6 保留。
- **agent-bridge-card 的 `localError` 不动**。手册未点名，且它的来源含挂载期 `loadFailed`——不是一次性动作。本步只删 `copyFeedback`。副作用：两个按钮不再把文案切成「已复制」，`settings.agentBridge.copied` 因此成为孤儿键并删除。

**对 Minimal 源的两处有意偏离**（写进 `components/snackbar/CLAUDE.md`）：宽 360 而非 300、toast 表面走 `theme.mixins.paperStyles` 而非扁平 `background.paper`（手册第 1 点要求，也让 toast 与菜单/弹出层同一种浮层质感——`default` 无 `data-type` 那支同时覆盖 `backgroundImage: 'none'`，否则墨色底上会浮着两块角落洗色）；severity 图标底保留 Minimal 的单条 `varAlpha('currentColor', 0.08)`，不按手册拆成四条 per-severity 规则——`varAlpha` 对 `currentColor` 走 `color-mix()`，像素完全相同而规则少三条。

**手册没写、但必须做的两处 i18n**：sonner 的 region `aria-label` 默认是英文 `Notifications`，会被读屏播报，所以经 `containerAriaLabel={t('snackbar.regionLabel')}` 跟随界面语言（第八个新键）；`closeButton` 打开后每条 toast 还带一个 `aria-label` 默认为英文 `Close toast` 的 icon-only 关闭按钮，同样经 `toastOptions.closeButtonAriaLabel={t('snackbar.closeAria')}` 跟随语言（第九个新键，trellis-check 补）。

**测试**：`snackbar.test.tsx`（8 例）、`export-card.test.tsx`（5 例，新文件）、`use-config-draft.test.ts` 增 2 例保存结果、`agent-bridge-card.test.tsx` 两处断言从「卡内文本」改为「toast mock 被调 + 卡内不再残留」、`App.test.tsx` 补 `Snackbar` stub 与挂载断言。两处踩坑记在这里：

- sonner 把每次 store 更新延后一个**宏任务**（`useSonner` 里注释为 “Prevent batching, temp solution”），`await act(async () => toast.success(...))` 只刷微任务，看不到任何 toast。测试里的 `emit()` helper 负责 `await setTimeout(0)`。
- `useConfigDraft` 的 `derive` 喂着一个 `[derive]` effect，测试探针里每次 render 新建闭包 = 无限重渲染，vitest 直接报 “Worker exited unexpectedly”。探针把 `derive`/`runTest` 提到组件外。

**验证**：`pnpm compile` 零错；`vitest run` 192 文件 / 1391 例全绿；`pnpm -r test` 10 文件 / 55 例全绿；`wxt build` 成功且 `scripts/check-background-bundle.mjs` 绿（背景图 11 模块 / 939,265 B，app.html 依赖未被 SW 引用）。

**trellis-check（2026-09-02，事后补跑）**：六个触发点逐条核对无遗漏也无越界（`toast.*` 的调用点恰好只有那六处，测试连接 / `handleToggleEnabled` / 拉取进度 / 主题语言切换都未被动）；A2（webdav `localError` 全删）与 A3（agent-bridge `localError` 保留）经源码复核成立——前者三处 `setLocalError` 全在两个一次性 handler 内，后者的产出含挂载期 `loadFailed` 与 `persistConfig` 的回滚说明，都不是一次性动作结果；A1 的「不返回 boolean」不影响 `settings-view.tsx` 的 `resume` 派发，因为那段逻辑在 `save` 内部而不是 `handleSave` 的调用者一侧。另发现并修掉 1 处缺陷 + 4 处文档漂移：

1. **每条 toast 的关闭按钮是硬编码英文**（本步唯一功能缺陷）。`closeButton` 打开后 sonner 给每条 toast 挂一个 `aria-label` 默认为 `Close toast` 的 icon-only 控件——与已经修掉的 region 标签是同一类问题，只是漏了。实测（happy-dom 探针）确认渲染出 `aria-label="Close toast"`。改为 `toastOptions.closeButtonAriaLabel={t('snackbar.closeAria')}`，双语新增第九个键，`snackbar.test.tsx` 增一例钉住。
2. **spec 层没有这条新契约**。`ui-design-system.md` 通篇不提 Alert/toast，Step 5 引入的「按存续期分流」规则若等到 Step 10 才写，Step 6-9 会继续给一次性结果加内联 Alert，而守卫测试拦不住这种漂移。§11 新增「One-shot Action Results」小节，§7 清单同步（理由同 Step 4：spec 不是只在收口时才算文档）。
3. **i18n spec 的 key 命名表缺 `snackbar.*` 行**，且 A5 的「具体优先」是本步确立的通用规则而非一次性裁决，补进 §2。
4. **§8 进度表第 4 行仍写「待用户 commit」**，但本次改动的状态行已声明 Step 4 已 commit；补上 `c6a9476`。同行第 5 行「三处偷离手册」错字改「偏离」。
5. 根 `CLAUDE.md` 的「Minimal 共享原语（docs/25 Step 3 移植）」小标题下多了一条 Step 5 条目，标题改为「Step 3 移植，Step 5 追加 snackbar」。

`git diff --check` 干净。§16 第 8 项「Impeccable detector」本会话无此 skill/脚本可用，未跑。

**仍待目测**（判据第 3 项的运行时半边）：设置页保存 → 右上 toast 与已保存徽标同时出现；导出失败 → 只有 toast；Agent Bridge 复制 → toast、原位无 Alert；WebDAV 同步失败 → toast 文案是具体的 `settings.sync.err.*`；dark 模式 toast 底为 paper 而非透明。本轮无法代跑（同 Step 4：当前 Chrome 未以 `--remote-debugging-port` 启动）。

---

### Step 6 — Dashboard：KPI 卡 + 原生 SVG 图表

> **2026-09-03 已落地**（未 commit，用户自行提交）。实际与手册的偏差记录在本节末"执行记录"。

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
- [x] `overview-view.tsx` 164 行；子组件 `analytics-widget-summary` 71 / `analytics-platform-composition` 131 / `analytics-platform-detail` 112 / `analytics-dimension-ranking` 104 / `analytics-top-tags` 55 / `analytics-loading` 68 行（**六个而非四个**，见执行记录第 3 条）
- [x] `grep -rn "apexcharts\|recharts" entrypoints package.json` 唯一命中是 `components/chart/CLAUDE.md` 里那条禁令本身；**判据措辞需修正**为"零代码命中"（同 Step 4 的 `header-actions` 先例）
- [x] `ui-design-system.md` §10 全节改写（含新增 §2 owner 行与 §15 两条禁令行）
- [x] `sections/overview/CLAUDE.md` 更新为六子组件 owner 表 + `components/chart/CLAUDE.md`（新）

---

#### Step 6 执行记录（2026-09-03，main 工作树）

**做了什么**：新建 `entrypoints/app/components/chart/`（`donut-chart.tsx` / `chart-legends.tsx` / `index.ts` / `donut-chart.test.tsx` / `CLAUDE.md`，零依赖）；`sections/overview/overview-view.tsx` 630 行拆成编排 164 行 + 六个子组件 + `analytics-format.ts`；`overview-view.test.tsx` 六例按新 DOM 重写；新增双语 `dashboard.usedTags`、删孤儿键 `dashboard.tagCount(.one)`；`docs/ui-baseline/app-runtime-check.mjs` 的 dashboard 实况探针从 `[data-section="summary"]` 改读 `[data-slot="kpi-value"]`。

**一处向用户请示、由用户拍板（2026-09-03）**：

1. **构成卡内部上下堆叠，而非手册写的「左环图 / 右图例」**。同一节把该卡定成 `lg: 4`——1200 视口 + 300px 侧栏下内容区 852px，4/12 ≈ 268px，`Card p:3` 后卡内只剩 ~220px（`md` 的 6/12 更窄，~216px），左右并排必然把六行平台名截成两三个字。Minimal 自己的 `AnalyticsCurrentVisits` 本来就是环图 → dashed Divider → 图例的堆叠。Grid 比例仍照手册 4/8。

**其余偏离手册（都是手册未覆盖或与源码/实测冲突，逐条判定）**：

2. **Card 标题 `component="h2" variant="h4"`（16px）**。手册只写「CardHeader 标题 h2」，没区分层级与字号。主题的 `MuiCardHeader.defaultProps.slotProps.title.variant = 'h6'` 在 Favbase 固定字阶（D8）下只有 14px（Minimal 的 h6 是 17→18px），当卡标题太小；旧页面的 `variant="h2"`（24px）在 `p:3` 的卡头里又过重。仓库已有先例是 `sections/settings/settings-panel.tsx` 的 `h2 + variant h4`，照用不另发明一档。heading level 仍是 h2，`[1,2,2,3,2]` 锁值不变；层级变成 KPI 数值 20px > 卡标题 16px > 图例行 14px。顺带证实 MUI v9 的 `resolveProps` 对 `slotProps` 是**按 slot 深合并**，所以调用点只写 `title` 不会打掉主题给 `subheader` 的默认值。
3. **子组件是六个而非手册列的四个**。`analytics-dimension-ranking.tsx` 从详情卡里再拆一层（两张 `Record<kind,…>` 表 + 榜单 ~104 行，塞进详情卡会破 150 行判据）；`analytics-loading.tsx` 单独成文（手册只说 `AnalyticsLoading`「保留」，未指定落点；68 行的骨架留在编排文件里会顶穿「≤200 行」）。选择器契约（`role="status"` / `aria-busy` / `aria-label`）不变，几何跟着新布局重画。
4. **图例行用 12px 圆点，不用 36px `PlatformTile`**。手册原文就是「色块」，且 220px 卡宽放不下 tile；圆点还能与自己那段弧同色，这才是图例的本分。平台字形 tile 保留在详情卡 48px 头部（`CardHeader avatar`）。**`data-slot="share-bar"` 随 shelf 消失**（不再有比例条），`data-slot="share-label"`（百分比）保留——空态六个 `0%` 与它们的 `text.primary` 色仍被测试钉着。选中态只洗行底（8% 主色），圆点不翻色，否则它就和弧对不上了。
5. **环图段用 `data-segment`，不用手册测试段写的 `data-platform`**。`components/chart/` 是平台无关哑组件（spec §15 禁平台分支、§5 目录归属），段 id 恰好是平台判别符，由 `analytics-platform-composition.tsx` 注入；chart 原语不认识「平台」这个词。
6. **平台数 KPI 保留 `1 / 6` 形态**。D17 给的字段是「有条目平台数」，但裸「1」缺参照系；`x / y` 两端都是快照真实字段（`filter(itemCount>0).length` / `platforms.length`），不是编造，且沿用旧 summary band 已有的读法。
7. **覆盖率卡带一行 caption，且不再重复标签总数**。手册说 KPI 卡「无 sparkline、无趋势箭头」——caption 不是趋势，而旧 band 的零标签解释句必须有落点（`dashboard.noTags` 是诚实性断言，测试锁着）：`usedTags === 0` → `dashboard.noTags`，否则 → `dashboard.taggedCount`。旧 caption 里的 `dashboard.tagCount` 因为「已用标签」自己成了一张卡而重复，删该键及其 `.one` 变体（沿用 Step 5 A4 的孤儿键处置）。
8. **KPI 卡底色保留 Minimal 的 `common.white` + 两个 48% 品牌色渐变**（两 scheme 同值）。这正是手册验证项「dark 模式渐变不发灰」的成因：去掉白底、让 48% alpha 直接压在暗色 paper 上才会发灰。文字用 `<color>.darker` 而不是 `text.secondary`（后者是给纸底的墨，不是给这张彩卡的）。**caption 不加 `opacity`**（trellis-check 2026-09-03 实测纠正）：满墨时四色在渐变两端是 6.37–11.40:1（最低是 success 的 `light` 端 6.37，不是初稿写的「同族 ≥ 8:1」——C-5 测的是 `text.accent` 在纸底上的派生阶，不是 `darker` 在这张彩卡上），但叠 `opacity .72` 后掉到 3.48–5.12:1，四色里 success（覆盖率卡本人）3.48、primary 3.91、warning 3.66 全部低于 12px 文字的 4.5:1 底线；六个色彩预设的 primary 同样有 preset4 3.88 不过线。字号本身已经把 caption 压成次级信息，静默 alpha 只是把它压成读不清。
9. **维度榜单双列断点从 `md` 改到 `lg`**。详情卡在 `md` 只有 6/12（~264px），双列会把两个榜单挤成 120px；`lg` 起卡宽 8/12（~550px）才够。这是第 1 条堆叠决定的连带后果。
10. **`formatNumber`/`formatShare` 抽到 `sections/overview/analytics-format.ts`**（三个以上子组件共用）。不放 `app/utils/`（那份 CLAUDE.md 明确「非 locale 依赖，locale 相关格式化在 `lib/i18n`」），也不加进 `lib/i18n`（§0.2：本轮不动 `lib/**`）；locale 显式入参保持纯函数。

**附录 C-7 消解（Step 6 的唯一 `[UNKNOWN]`）**：Export 卡**不在** `/`。`grep` 证实 `ExportCard` 只被 `sections/settings/settings-view.tsx` 消费（Step 5 已改），Dashboard 从不渲染它；四张 KPI 卡的标题是 `<p>`（指标名不是区块），所以 heading outline 仍是 `[1, 2, 2, 3, 2]`（h1 → 构成卡 h2 → 详情卡平台名 h2 → 榜单 h3 → Top tags h2），不是手册预留的六元组。

**测试**：`donut-chart.test.tsx` 新增 3 例（六段 dasharray 之和 = 周长且偏移逐段累加 / 零份额段不渲染但底环仍在 / 整块 `aria-hidden` 且中心数字照常打印）；`overview-view.test.tsx` 六例按手册重写——空态断言从「零 `share-bar`」改成「零 `[data-segment]` 弧 + 六个 `0%` 图例」并加 `kpiValues` 四值 `['0','0 / 6','0','—']`，有数据例加 `['3','1 / 6','1','66.7%']` 与唯一 `data-segment="github"`，caption 断言从 `1 tags · 2 tagged items` 改成 `2 tagged items`（第 7 条），大纲例注明 C-7 理由。零 `it.skip`、零放宽。

**验证**：`npx vitest run entrypoints/app/sections/overview entrypoints/app/components/chart` 4 文件 18 例全绿；`tsc --noEmit` 与 `pnpm -r compile` 零错；`vitest run` 193 文件 1395 例——`lib/database/proxy-db.test.ts` 1 例超时，单跑立即通过，属已知满载 flake（memory: `favbase-vitest-load-flake`）；`pnpm -r test` 10 文件 55 例全绿；`wxt build` 成功且 `scripts/check-background-bundle.mjs` 绿（背景图 11 模块 / 939,265 B 不变，app.html 依赖未被 SW 引用）。

**体积**：app **91,433 B**（−438）、Container（共享 MUI）**122,166 B**（−577）、jsx-runtime **56,424 B**（−270）。零依赖图表 + 拆掉 hairline band 与两族比例条后，Dashboard 净变小；Card/CardHeader/CardContent 早已在 Container chunk 里。

**trellis-check（2026-09-03）**：十处偏离逐条复核，`data-segment`（测试等价覆盖 `[data-segment]` 计数 + `data-segment="github"`）、`common.white` 底（暗色下 `darker` 墨 6.37–13.94:1，Minimal 原样）、上下堆叠（用户裁决，不动）、`1 / 6`（两端都是快照字段）、C-7（`ExportCard` 只有设置页一个消费者）全部成立；死选择器 `data-section="summary"` / `data-slot="share-bar"` 除 `app-runtime-check.mjs`（已改）外全仓库无其它活引用（docs/19/23 与归档 task 是历史文档）；`dashboard.tagCount(.one)` 零消费者，`dashboard.usedTags` 双语齐备，新增 tsx 零 CJK。修掉 6 处：

1. **KPI caption 的 `opacity .72` 不过 WCAG**（见上第 8 条，已删 opacity 并把实测数字写进第 8 条、`sections/overview/CLAUDE.md` 与 spec §10）。
2. **`'& .MuiTabs-flexContainer'` 是死 CSS**——MUI 6 起该 slot 改名 `list`，v9 已无 `flexContainer` 类，图例行的 `gap: 0.5` 从未生效（旧 `PlatformShelf` 抄的就是这条死规则，所以「行为不变」掩盖了它一直没生效）。改用 `tabsClasses.list` / `tabsClasses.indicator` 常量，改名时编译期就炸。**`sections/settings/segmented-tabs-sx.ts:23` 同一条死规则仍在**，不在本步动它：改了会无审阅地改变设置页间距，而 Step 7 计划里那个文件本来就要删。同时把这条 v9 陷阱写进 `entrypoints/app/CLAUDE.md` 约定。
3. **`app-runtime-check.mjs` 的对比度审计对 `opacity` 是瞎的**——`getComputedStyle().color` 不含 `opacity`，而旧代码还在 `Number(style.opacity) < 0.5` 处直接 `continue`：两条加起来正好让第 1 条这类缺陷完整绕过本该抓住它的工具（KPI 卡的渐变是 `background-image`，`backgroundFor` 只读 `background-color`，于是又按最亮的白底算，双重乐观）。新增 `cumulativeOpacity(element)`，把祖先链的 opacity 折进前景 alpha，删掉 0.5 提前退出。**下次运行可能浮出此前被藏住的低透明度文案——那是真违规，不是 Step 6 的回归。**（该 block 是模板字符串，注释里不能出现反引号，已在原地留 NOTE。）
4. **dashboard 实况探针没有断言**——`report.liveDataSummary` 只被写入、无人 `check`，选择器一旦再漂就静默产出 `''` 并让下一组重试，正是 Step 4 的老毛病。改成先等 4 个 `[data-slot="kpi-value"]`（快照是异步 DB 读）再 `check` 四值 + 六 tab，字段名由 `summary` 改 `kpis`。
5. **`new Map(collectionPlatformRegistry.map(...))` 复制到了三处**（chat 来源卡 + 本步两个新文件）。registry owner 新增 `collectionPlatformById: ReadonlyMap`，三处全部改读它；`source-card.test.tsx` 的 registry fake 同步只造那张 map。DRY 红线，不是风格问题。
6. **`buildKpis` 的 `t: typeof translate` 与 `locale: string`**——前者靠 `import type { t as translate }` 把值当类型使，仓库自己的写法是 `UseTranslationReturn['t']`；后者更要紧：`useTranslation()` 同时给 `locale`（已解析）与 `preference`（可能是 `'auto'`），传错一个字符就是渲染期 `Intl.NumberFormat('auto')` 抛 `RangeError`。`analytics-format.ts` 与 `buildKpis` 的 locale 参数收紧为 `SupportedLocale`（纯类型导入，运行时零成本）。

**判定不是问题**（复核后驳回）：`DonutChart` 的 share 之和 > 1 —— `share = itemCount / totalItems` 且 `totalItems` 是**全部** platform 行的和（含未注册平台），六个之和恒 ≤ 1，逐段 clamp 已是防御性余量，不加全局归一化；主题默认 `variant: 'scrollable'` 不会给竖向 Tabs 塞两个 40px 滚动按钮（v9 的 `showScrollButtons` 还要求 `scrollButtonsActive`，无溢出即不渲染）；`StateBox` 的 `minHeight` 220/200 覆写沿用旧页面同值，不是本步新增；spec §15 六类禁用模式（嵌套 Card、平台 if、裸 hex、`rgba()`、`theme.palette.*`、Tab/Button 内块级后代、图形独自承载信息）逐条无命中。

**仍待目测**：空库（新 profile）四张卡 `0 / 0 / 6 / 0 / —`；有数据时环图弧色与图例圆点逐平台一致；dark 模式四张渐变卡不发灰、`<color>.darker` 文字可读；六个色彩预设下第一张卡（primary）与其余三张语义色卡并排不打架；`lg`/`md`/`sm` 三档下构成卡图例不截断。本轮无法代跑（当前 Chrome 未以 `--remote-debugging-port` 启动，同 Step 4/5）。

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
| 依赖边界 | `tests/ui-vendor-boundaries.test.ts`（Step 5 把 `sonner` 并入该表，不新建 `snackbar-import-boundary`）、`tests/platform-completeness-contract.test.ts`、`tests/lib-import-smoke.test.ts` 绿 | vitest |
| 存储 | `favbase-color-mode`、`local:sidebarPinned`、`local:locale` 旧值仍被读取；`local:themeSettings` 缺省回退 | 手动（清 storage 再开） |

## 7. 文档同步清单

| Step | 必改文档 |
|------|----------|
| 0 | 根 `CLAUDE.md`（技术栈/Chrome 117）、`entrypoints/app/CLAUDE.md`、`theme/CLAUDE.md`、`.trellis/spec/frontend/{ui-design-system,i18n-conventions,index}.md`、`docs/21`、`docs/adr/0002` 的 116 引用 |
| 1 | `theme/CLAUDE.md`（重写） |
| 2 | `theme/CLAUDE.md`、`lib/storage/CLAUDE.md`、`components/settings/CLAUDE.md`（新） |
| 3 | 六个新 `components/*/CLAUDE.md`、`components/collection/CLAUDE.md`、`components/iconify/CLAUDE.md`（图标清单） |
| 4 | `layouts/CLAUDE.md`（重写）、`components/nav-section/CLAUDE.md`、`components/settings/CLAUDE.md`、`entrypoints/app/CLAUDE.md`（App.tsx 挂载）、`theme/CLAUDE.md`（`mode-transition.ts`）、`components/iconify/CLAUDE.md`（5 图标）、`welcome/CLAUDE.md`（顶栏控件）、**`.trellis/spec/frontend/{ui-design-system,i18n-conventions}.md`**（§8 shell 全节重写 + §12 scope + §15 例外 + 两条 key 命名行；原清单把 spec 全推到 Step 10，但 §8 逐条都已失真，见 trellis-check）、**`sections/{bookmarks,github-stars,x,youtube,zhihu}/CLAUDE.md`**（路由/导航行的 active 判定来源）、**`docs/ui-baseline/app-runtime-check.mjs`**（shell DOM 变了，验证脚本的选择器必须同步——首轮遗漏，见第二轮复核）、`.trellis/spec/frontend/ui-design-system.md` §16（运行时验证 transport 与「验证工具属 shell 契约」，见第二轮 trellis-check） |
| 5 | `components/snackbar/CLAUDE.md`、`sections/settings/CLAUDE.md`、`sections/overview/CLAUDE.md`、`entrypoints/app/CLAUDE.md`、根 `CLAUDE.md`、**`.trellis/spec/frontend/{ui-design-system,i18n-conventions}.md`**（§11 新增「One-shot Action Results」——toast 与内联状态按**存续期**而非严重度划分、一件事只报一次、region 与关闭按钮都要译名；i18n §2 补 `snackbar.*` 命名行与「具体文案优先」规则。原清单把 spec 全推到 Step 10，但这是本步**新引入**的 UI 契约，不写进去下一步就会有人再加内联 Alert，见 trellis-check） |
| 6 | `sections/overview/CLAUDE.md`、`components/chart/CLAUDE.md`、`ui-design-system.md` §10（全节改写）+ §2 owner 行 + §15 两条禁令行 + §16（对比度审计现在把 opacity 折进前景，见 trellis-check 第 3 条）、**`docs/ui-baseline/app-runtime-check.mjs`**（dashboard 实况探针的 `[data-section="summary"]` 变成死选择器，同 Step 4 的教训）、根 `CLAUDE.md`、**`entrypoints/app/pages/CLAUDE.md`**（dashboard 行还写着「hairline SummaryBand + 无 KPI 卡片」，是当前有效文档里唯一的漂移）、**`entrypoints/app/CLAUDE.md`**（`collectionPlatformById` + v9 slot 类名陷阱）、`components/iconify/icon-sets.ts` 的「summary-band glyphs」注释；`i18n-conventions.md` 不需改（无新命名族，只增删一个 `dashboard.*` 键） |
| 7 | `sections/settings/CLAUDE.md` |
| 8 | `components/collection/CLAUDE.md`、`hooks/CLAUDE.md`、六个 `sections/<platform>/CLAUDE.md` |
| 9 | `sections/chat/CLAUDE.md` |
| 10 | `index.html` 契约注释、`ui-design-system.md` 全量、`directory-structure.md`、`docs/23` 注记、根 `CLAUDE.md` 索引状态 |

## 8. 进度勾选表

| Step | 状态 | commit | app chunk 体积（gz） | 备注 |
|------|------|--------|----------------------|------|
| 0 | 已落地 2026-09-01，已合入 main（待五路由目测） | `56198c8` | app 69,832 B；Container（共享 MUI）119,158 B；jsx-runtime 56,424 B | `@mui/material@9.4.0`；Button/Chip 组合 styleOverrides key 迁 `root.variants`（v9 删除）；codemod 弃用改手工；详见 Step 0 执行记录 |
| 1 | 已落地 2026-09-01，已合入 main（待五路由 light/dark 目测） | `c17625c` | app 69,266 B；Container 117,602 B；theme+registry 共用 chunk 16,395 B；jsx-runtime 56,544 B | C-2 回退 `#222B34`、C-3 soft primary → `text.accent`、C-4 Menu 继承 Popover paper；timeline（@mui/lab）未移植；详见 Step 1 执行记录 |
| 2 | 已落地 2026-09-01，已合入 main（待预设/高对比目测） | `21323ec` | app 69,717 B；Container 118,269 B；theme+registry 共用 chunk 17,057 B | C-5 全过线无回退；D14 墨/白派生表；无 `update-components.ts`、无 `version` 字段、Provider 挂 main.tsx、ThemeProvider 可选读 context、删 dark `lighter` 再着墨；详见 Step 2 执行记录 |
| 3 | 已落地 2026-09-01（与 Step 2 并列开发，前置只有 Step 1），2026-09-02 rebase 到 Step 2 之上后合入 main（待目测） | `6830293` | app 69,645 B；Container（共享 MUI）118,133 B；jsx-runtime 56,424 B（rebase 到 Step 2 之上后重测；并列分支上单独测得 app 69,294 / Container 118,157） | 六原语 + `theme/create-classes.ts` + `tests/setup/app-dom.ts`；C-6 消解（EmptyContent 不设默认 title）；**修 Minimal 移植缺陷**：MUI v9 不转发 `slotProps.paper.ref`，CustomPopover 箭头改为经自身 `parentElement` 反查 paper；simplebar 因暂无消费者被 tree-shake，未进任何 chunk（体积代价待 Step 4 接入后再记）；详见 Step 3 执行记录 |
| 4 | 已落地 2026-09-02（待 8 张截图与键盘目测） | `c6a9476` | app 81,516 B；Container（共享 MUI）122,177 B；jsx-runtime 56,544 B | nav-section（vertical+mini+flyout）+ 四控件 + 外观抽屉 + `theme/mode-transition.ts`；simplebar 首次进产物（只在 app chunk）；鱼骨线换 Minimal bullet（用户决定）；`compactLayout` 语义、`nav-active` 归属、激活态两级同色三处偏离手册；第二轮复核补齐 8 处漏掉的调用点同步（六处 CLAUDE.md + `app-runtime-check.mjs` 两处死选择器），详见 Step 4 执行记录 |
| 5 | 已落地 2026-09-02（待五处 toast 目测） | `a584cd1` | app 91,871 B（+10,355）；Container（共享 MUI）122,743 B（+566）；jsx-runtime 56,694 B（+150）——trellis-check 补完 `closeButtonAriaLabel` 后重测 | sonner 2.0.8 实测 +10.1 KB gz，高于手册估的 ~7 KB（它把自己的 CSS 字符串也打进 JS）；三处偏离手册（`handleSave` 不返回 boolean、守卫并入 `ui-vendor-boundaries`、失败文案具体优先）；详见 Step 5 执行记录 |
| 6 | 已落地 2026-09-03，已 commit（待六项目测） | `6737714` | app 91,443 B（−428）；Container（共享 MUI）122,166 B（−577）；jsx-runtime 56,424 B（−270）——trellis-check 六处修完后重测（较首测 +10 B，`tabsClasses` 常量与共享 registry map 的净差） | 零依赖 SVG 环图 + 四张 KPI 卡；构成卡改上下堆叠（用户决定）；六个子组件而非四个；Card 标题取 `h2 + variant h4`（对齐 `SettingsPanel`）；`data-segment` 取代 `data-platform`；C-7 消解（Export 卡不在 `/`，大纲仍 `[1,2,2,3,2]`）；`app-runtime-check.mjs` 探针同步改读 `kpi-value` 且新增断言；KPI caption 去掉 `opacity`（WCAG）；详见 Step 6 执行记录 |
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
| C-6 | EmptyContent 默认文案复用的现有 i18n key 名 | 3 | **已消解（2026-09-01）**：没有可复用的 key——`zh-CN.ts` 只有平台专用的 `dashboard.platformEmpty`，无通用空态文案。结论是 `EmptyContent` **不设默认 title**（也不设默认插图），既不新增 key 也不硬编码英文；`StateBox` 契约里 title 本就可选，且 `NoMatchesState` 依赖「盒子里只有调用方那一句」（`state-box.test.tsx` 断言 `textContent` 精确相等） |
| C-7 | Step 6 heading outline 实际序列（Export 卡是否仍在 `/`） | 6 | **已消解（2026-09-03）**：Export 卡不在 `/`——`ExportCard` 只被 `sections/settings/settings-view.tsx` 消费（Step 5 已改）。四张 KPI 卡标题是 `<p>`（指标名不是区块），故大纲仍是 `[1, 2, 2, 3, 2]`（h1 → 构成卡 h2 → 详情卡平台名 h2 → 榜单 h3 → Top tags h2），不是预留的六元组 |

## 附录 D — 勘误

- **D-1** PRD "DESIGN.md（根）需同步"：根目录不存在 `DESIGN.md`（`git ls-files` 无匹配）。`entrypoints/app/index.html` 契约注释里对它的引用是悬空的，Step 10 改指 docs/25。
- **D-2** PRD R3 曾写 `shape.borderRadius → 16`：错误。base 仍 8，Card/Dialog 16 是 Minimal `×2` 派生（D9）。
- **D-3** 我在早期讨论中说 chat 有"26 个结构测试"：实际 `sections/chat/` 3 个测试文件共 16 例，`ChatWorkspace` 受影响 7 例（Step 9）。
- **D-4** D5 的 simplebar/sonner 是用户决定，我的原建议（只引 sonner）被否；本文按用户决定执行，不再重议。

