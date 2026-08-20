# app/theme

MUI v7 主题系统（palette/typography/shadows/custom-shadows/components）。视觉语言 = 「目录卡片库」方向（`docs/19_app-design-critique-2026-08-20.md` §7.0.1，PRD `.trellis/tasks/08-20-app-catalog-card-visual-language-p0/prd.md` §3）：暖纸面地 + 暖墨字 + 暖灰细线，条目零阴影；珊瑚 `#FC7E5B` 只做色块（印章/选中/计数），从不做文字。绑定不动：珊瑚色相、DM Sans Variable + Barlow、狐狸 logo、小写 `favbase`（`PRODUCT.md`）。支持 light + dark 双 colorScheme。**token 名与组件 API 全部保留，只换值**——调用点仍写 `color="primary"` / `customShadows.card` / `variant="contained"`。

## 模块结构

- `theme-config.ts` — 调色板常量（primary/secondary/info/success/warning/error 五阶 + 暖灰 grey 50→900 + common）+ `scheme.{light,dark}`（**唯一**按模式分裂的品牌值：`primaryLighter` 淡洗、`accentText` 文字安全阶）+ 字体配置（classesPrefix: 'favbase'）+ `cssVariables.colorSchemeSelector: 'data-color-scheme'`。`primary.contrastText` 是深墨 `#1F1B17`（印章上的字 ≈6.7:1），不是白
- `create-theme.ts` — 主题工厂，合并 colorSchemes.{light,dark} + components + typography + `shape.borderRadius = 4`（圆角一套：×1=4 给 chip/印章/输入/菜单项，×2=8 给 popover，×3=12 给条目/dialog/面板；不再有 16px Card）
- `theme-provider.tsx` — ThemeVarsProvider + CssBaseline 包装。`defaultMode="system"` + `modeStorageKey=COLOR_MODE_STORAGE_KEY`（`'favbase-color-mode'`）。**必须与 `public/theme-init.js` 的 FOUC 脚本 key 一致**
- `extend-theme-types.d.ts` — MUI 类型扩展（customShadows, fontSecondaryFamily, palette 扩展：`TypeTextExtend` 含 `accent`/`accentChannel`）
- `core/palette.ts` — `createPaletteChannel` + `varAlpha`。`text`/`background`/`action` 分 `.light`/`.dark`：亮 paper `#FFFFFF` / default `#F8F4EE` / neutral `#F1ECE4`，暗 `#221E1B` / `#1A1715` / `#2A2521`；text 亮 `#1F1B17` / `#6B635A` / disabled `#8F867B`，暗 `#F3EEE7` / `#A89F94` / `#7A7168`。**`text.accent`**：品牌色相里唯一允许做文字的阶（亮 `primary.darker` `#7A2714`，暗 `primary.light` `#FDA48A`）——链接、强调、outlined/text 按钮全走它，禁止 `primary.main` 做文字。`primary` 按 scheme 分两份（`primary` / `primaryDark`）只为让 `lighter` 在暗色变成 `#3A2A24` 墨洗。`divider = varAlpha(grey500, 0.24)` 是表面唯一的立体感
- `core/typography.ts` — 无响应式缩放。`h1` Barlow 700 28（页标题）、`h2` Barlow 700 24、`h3` Barlow 600 20（大数字，调用方传 `component="p"`）；`h4-h6` DM Sans 600 16/14/14；subtitle1/2 600 16/14；body1/2 16/14；caption 12；button 600 14 `textTransform: unset`。UI 只有 12/14/16 三档，层级靠字重与颜色；组件内禁止主题外 `fontSize` 字面量（用 `typography: 'caption'` 或 `theme.typography.caption.fontSize`）
- `core/shadows.ts` — MUI 25 级阴影换到暖墨通道（亮 `grey['800Channel']`，暗 `common.blackChannel` 更高 alpha）
- `core/custom-shadows.ts` — **`card: 'none'`**（条目用 1px divider 细线，禁止边+阴影同现的「幽灵卡」）；`dropdown`/`dialog` = `0 8px 24px -8px`（亮墨 0.18 / 暗黑 0.5），z1-z24 同通道按比例缩放；彩色阴影 token 保留名
- `core/components.tsx` — 组件覆盖：`MuiCssBaseline`（`body` 全局 `tabular-nums`——所有会变的数字不跳动；8px 暖灰滚动条；`::selection` = `primary.lighter` 底 + `text.primary`；caret = `text.primary`；焦点环亮 `2px solid primary.darker` / 暗 `primary.main`，`theme.applyStyles('dark')` 分支，`outline-offset: 2`）；`MuiTypography.variantMapping` subtitle1/2 → `p`（卡片标题不是 heading，一页一个 h1）；`MuiButton.containedPrimary` 亮 `grey900` 底白字 / 暗 `grey100` 底 `grey900` 字（每屏唯一反色元素，**禁止珊瑚底白字**），`outlinedPrimary`/`textPrimary` 用 `text.accent` + hover `primary.lighter`；`MuiCard` 无阴影 + 1px divider + 圆角 ×3；`MuiChip.filledPrimary` 印章 hover 升 `primary.light`，outlined default 边 = divider；`MuiTooltip` 亮 `grey800` 底白字 / 暗 `grey200` 底 `grey900` 字（灰阶 scheme 不变量必须显式分支）；`MuiPopover` 圆角 ×2 + dropdown 阴影 + 1px divider；`MuiDialog` 圆角 ×3；`MuiMenuItem` 圆角 ×1；`MuiLink` 颜色 `text.accent`；`MuiOutlinedInput`/`MuiPaper outlined` 边 = divider

## 约定

- **暗色模式切换（app.html only）**：二态旋钮在 `layouts/dashboard/header-actions.tsx` 的 `ThemeToggleSwitch`，用 MUI `useColorScheme()` 读 `mode`/`systemMode`、`setMode()` 写显式 light/dark。**范围仅 app.html**；B站 Content Script 面板是独立 Shadow DOM + `--fb-*` token 体系，不受此主题影响
- **FOUC 防闪**：MV3 `extension_pages` CSP 禁止内联脚本，故用外部经典脚本 `public/theme-init.js`（`index.html` `<head>` 同步引用）读 `localStorage['favbase-color-mode']` 首帧设 `data-color-scheme`。改 key/attribute/默认模式时三处同步：`public/theme-init.js`、theme-provider、theme-config
- **颜色用法铁律**：文字只用 `text.primary/secondary/accent`（disabled 只给 disabled 控件，不给卡片日期）；`primary.main` 只做色块；语义色作文字用 `.dark`（亮）/ `.light`（暗）并 `applyStyles('dark')` 分支；六平台品牌色只出现在图标字形与数据图形。硬编码十六进制只允许在 `theme-config.ts`、`icon-sets.ts`（多色 SVG）、`language-colors.ts`（GitHub linguist 数据色）；`hooks/use-jobs-badge.ts` 经 `themeConfig.palette.warning.main` 读取（浏览器 API 不在 React 树内）
- 方向契约以 HTML 注释写在 `entrypoints/app/index.html` `<body>` 首子节点（seed key `30995f23`），构建后 `grep 30995f23 .output/chrome-mv3/app.html` 必须命中
