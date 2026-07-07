# app/theme

MUI v7 主题系统（palette/typography/shadows/custom-shadows/components），配色和排版完全对齐 material-kit-react。支持 light + dark 双 colorScheme。

## 模块结构

- `theme-config.ts` — 调色板常量 + 字体配置（classesPrefix: 'favbase'）+ `cssVariables.colorSchemeSelector: 'data-color-scheme'`（MUI 在 `<html>` 上切换 `data-color-scheme="light|dark"`）
- `create-theme.ts` — 主题工厂，合并 colorSchemes.{light,dark} + components + typography + shape
- `theme-provider.tsx` — ThemeVarsProvider + CssBaseline 包装。`defaultMode="system"`（首次跟随 OS）+ `modeStorageKey=COLOR_MODE_STORAGE_KEY`（`'favbase-color-mode'`，localStorage 持久化）。导出 `COLOR_MODE_STORAGE_KEY` 常量，**必须与 `public/theme-init.js` 的 FOUC 脚本 key 保持一致**
- `extend-theme-types.d.ts` — MUI 类型扩展（customShadows, fontSecondaryFamily, palette 扩展）
- `core/palette.ts` — 完整色彩系统，使用 `minimal-shared` 的 `createPaletteChannel` + `varAlpha`。`text`/`background`/`action`/`palette` 均含 `.light` + `.dark`（dark 取 Minimal 标准：`background.dark` paper=grey800/default=grey900/neutral=#28323D，`text.dark` primary=#FFF/secondary=grey500，`action.dark` active=grey500）
- `core/typography.ts` — 排版比例，h1-h6 响应式 + body/caption/overline/button
- `core/shadows.ts` — 25 级 MUI 标准阴影。`shadows.light` 用 `grey['500Channel']`，`shadows.dark` 用 `common.blackChannel`
- `core/custom-shadows.ts` — card/dialog/dropdown + z1-z24 + 各色彩阴影。`.light`/`.dark` 同上（dark 用 `common.blackChannel`）
- `core/components.tsx` — MUI 组件样式覆盖（Card 圆角 16px，Button 无 elevation，Paper 无 backgroundImage 等）

## 约定

- **暗色模式切换（app.html only）**：二态旋钮在 `layouts/dashboard/header-actions.tsx` 的 `ThemeToggleButton`，用 MUI `useColorScheme()` 读 `mode`/`systemMode`、`setMode()` 写显式 light/dark。**范围仅 app.html**；B站 Content Script 面板是独立 Shadow DOM + `--fb-*` token 体系，不受此主题影响
- **FOUC 防闪**：MUI 的 `InitColorSchemeScript` 是 React 组件，CSR（Vite/WXT）下客户端注入的 `<script>` **不会执行**。且 MV3 `extension_pages` CSP 禁止内联脚本（不接受 hash/nonce/unsafe-inline），故改用外部经典脚本 `public/theme-init.js`（WXT 复制到扩展根），`index.html` `<head>` 以 `<script src="/theme-init.js">` 同步引用（早于 defer 的 main.tsx 执行）：读 `localStorage['favbase-color-mode']`（默认 system → `matchMedia` 解析）→ 首帧设 `data-color-scheme`。改 key/attribute/默认模式时三处同步：`public/theme-init.js`、theme-provider、theme-config
