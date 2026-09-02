# app/components/settings

Minimal Dashboard `components/settings` 的移植：数据层 docs/25 Step 2（2026-09-01），抽屉 UI docs/25 Step 4（2026-09-02）。去掉 font / fontSize / direction / navLayout / navColor / **mode**——mode 归 MUI `ThemeProvider` 的 `favbase-color-mode`，不进 `local:themeSettings`（D13）。与 `components/library-gate/` 同档：**智能组件目录**，允许 storage-backed hook 与 `t()`（`components/collection/` 的零 storage / 零 `t()` 铁律不适用）。

## 模块结构

- `types.ts` — re-export `ThemeSettings` / `ThemeColorPreset` / `ThemeContrast`（类型来自 `@/lib/storage`，值形状归 `lib/storage/theme-settings.ts`）；`SettingsContextValue { state, canReset, onReset, setState(partial), setField<K>(name, value), openDrawer, onCloseDrawer, onToggleDrawer }`（字段名照 Minimal，Step 4 抽屉零改名）；`SettingsProviderProps { initialState, children }`
- `context/settings-context.ts` — `createContext<SettingsContextValue | undefined>(undefined)`。**leaf 契约**：只 import `react` 与类型。`theme/theme-provider.tsx` 直接 import 这个文件做可选读取（`use(SettingsContext)`），welcome.html 与 20 个裸渲染 `<ThemeProvider>` 的测试因此不会被拖进 storage
- `context/settings-provider.tsx` — `SettingsProvider({ initialState, children })`：`useState(initialState)` 持内存态；`useEffect` 订阅 `watchThemeSettings`（回声/相同值不 setState）；`setState(partial)` 以 ref 镜像的**最新已应用值**合并（ref 在 React 提交前就更新，连续快速修改两个不同字段不会互相覆盖）——相同值 no-op，否则本地立即更新 + 恰好一次 `setThemeSettings(next)`（失败只 `console.error`）；`setField(name, value)` = 单字段 `setState`；`onReset` = `setState(DEFAULT_THEME_SETTINGS)`；`canReset = !isSameThemeSettings(state, DEFAULT)`；drawer 三件套 `openDrawer / onToggleDrawer / onCloseDrawer` 是纯内存态、不持久化。value 经 `useMemo`，以 React 19 `<SettingsContext value>` 提供
- `context/use-settings-context.ts` — `useSettingsContext()`：无 provider 时抛 `useSettingsContext must be used inside SettingsProvider`。抽屉与其他 app.html 消费者用这个严格版
- `context/index.ts` / `index.ts` — barrel（`export type * from './types'`）
- `use-settings-reset.ts` — `useSettingsReset()` → `{ canReset, onResetAll }`：把 context 的 `canReset`（只知道 `local:themeSettings`）与「mode 不是 `system`」合成一个答案，`onResetAll` = `onReset()` + `setMode('system')`。抽屉的 Reset 与 header `SettingsButton` 的 dot 共用它，避免两处各算一遍
- `drawer/settings-drawer.tsx` — 右侧 temporary Drawer，宽 360、paper 走 `paperStyles` + 90% ground wash、`role="dialog"` + `aria-label`=`settingsDrawer.title`；`Scrollbar` 包内容。头部 = 标题（`h6`/`component="h2"`）+ Reset（`solar:restart-bold` + `Badge` dot）+ 关闭。选项自上而下：Mode（`LargeBlock` + 三选）→ Contrast / Compact（两列 `BaseOption` 开关卡）→ Presets（`LargeBlock` + 六色）。**没有 Minimal 的 `defaultSettings` 可见性映射**：选项集是固定的。开合状态是 context 内存态，不持久化
- `drawer/mode-options.tsx` — Light / Dark / System **三选**（Minimal 是二态开关，无法表达 `system`，而 `system` 正是 `ThemeProvider` 的默认）。读 `useColorScheme()` 而非 settings context；点击经 `theme/mode-transition.ts` 的 `setModeWithReveal` 做圆形揭示，选中项再点为 no-op
- `drawer/presets-options.tsx` — 六个色板 tile：`solar:siderbar-bold-duotone` 字形染预设色（Minimal 的做法——让颜色演示它真正要干的活；手册写的「圆点」未采用），选中额外加 8% 同色底。`aria-label` 走 `settingsDrawer.preset*`（六色里有两个蓝，必须有名字而不是序号）
- `drawer/base-option.tsx` — 开关卡：整张卡是控件（`role="switch"` + `aria-checked` + `aria-label`），里面的 MUI `Switch` 是装饰（`aria-hidden` + `tabIndex={-1}` + `pointerEvents: none`），保证一个 tab stop 一个可读名
- `drawer/styles.tsx` — `LargeBlock`（浮动标签兼 per-block reset）+ `OptionButton`（Mode/Presets 共用 tile）。不移植 `SmallBlock`（无嵌套选项组）、`font-options`/`nav-layout-option`/`fullscreen-button`/`icons.tsx`（改用 `components/iconify` 离线图标，见铁律 4）

## 契约

- **初值由 `main.tsx` 注入**：bootstrap 时 `Promise.all([loadNavigationData(), getThemeSettings()])`，`SettingsProvider` 包在 `RouterProvider` 外（`App.tsx` 是 router `Component`，无 props 通道；`ThemeProvider` 仍在 `App.tsx` 内，语义 = Minimal 的 Settings 外层 / Theme 内层）。首帧即已保存的预设，不闪默认色
- **一次用户动作 = 一次 storage 写**：`setState` 基于 ref 镜像判等，storage `watch` 回声与另一 app.html tab 的重复值都被 `isSameThemeSettings` 吞掉，不重渲染、不回写
- `ThemeProvider` 通过 leaf context 可选读取；抽屉等消费者用会抛错的 `useSettingsContext()`。不要把 `theme-provider.tsx` 改成抛错版——welcome 复用它
- `compactLayout` 的语义由 `layouts/dashboard/content.tsx` 决定：on → 内容列收窄到 `lg`，off → 用页面自己传的 cap（默认 `false`，即视觉与 Step 4 之前一致）；`contrast` / `primaryColor` 由 `theme/with-settings/update-core.ts` 消费
- 抽屉挂载点是 `App.tsx`（router root，跨路由不卸载），`SettingsButton` 在 header 里经 context 的 `onToggleDrawer` 开合；两者不共享 ref，焦点归还交给 MUI Modal 默认的 restore-focus——`ui-design-system.md` §12 那套「显式 ref + `disableRestoreFocus` + 手动 blur」只适用于触发器与抽屉同组件的情形（`NavMobile`、chat history），这里改为**断言结果**：关闭后焦点回触发器、容器无 `aria-hidden` 残留

## 测试

`drawer/settings-drawer.test.tsx`（5 例，与下面同一个 `wxt/utils/storage` seam + identity `t()`）：开合与 `role="dialog"`/`aria-label` + 关闭后的焦点归还与 `aria-hidden` 清理（§12 scope）、preset 落一次真实写入、contrast/compact 各落一次写入、Mode 只动 `favbase-color-mode`（零 themeSettings 写入）+ `data-color-scheme` 翻转、Reset 同时回默认设置与 `system` 并让 dot 消失。

`context/settings-provider.test.tsx`（happy-dom，`createRoot` + `act`，全部渲染包在 `<StrictMode>` 内与 `main.tsx` 一致——写入/渲染计数在双调用 effect 下同样成立；只 mock `wxt/utils/storage`，真实 `lib/storage/theme-settings.ts` facade 参与）：初值不写 storage / `setField` 恰好一次写 / 相同值 no-op 不渲染 / `onReset` 回默认并持久化 / 外部 watch 变更被采纳并 canonicalize 且不回写 / 回声不重渲染 / drawer 三件套 / 裸 `ThemeProvider` = coral 而 preset2 provider 内 = `#7635dc` 且 `text.accent` 派生 / `useSettingsContext` 无 provider 抛错。
