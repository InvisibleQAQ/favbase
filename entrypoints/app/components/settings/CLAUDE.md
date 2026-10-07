# app/components/settings

外观设置（对比度 / 紧凑 / 六色预设）的 context 与抽屉，Minimal `components/settings` 的移植。智能组件目录：允许 storage-backed hook 与 `t()`。

## 约束

- 配色模式不归这里：mode 归 MUI `ThemeProvider`（`favbase-color-mode`），不进 `local:themeSettings`。产品只有 light / dark 两态、默认亮色，`system` 已移除；唯一开关是 header 的 `layouts/components/theme-mode-button.tsx`。抽屉里不要加 Mode 块（同一功能两个入口）。
- Reset 与红点只管本目录的设置：重置不得改配色模式，红点直接读 context 的 `canReset`。
- `context/settings-context.ts` 是 leaf：只 import `react` 与类型。`theme/theme-provider.tsx` 直接 import 它，用 `use(SettingsContext)` 可选读取。
- 不要把 `theme-provider.tsx` 改成会抛错的 `useSettingsContext()`：welcome.html 刻意不挂 `SettingsProvider`，许多测试也裸渲染 `ThemeProvider`。welcome 不得 import 本目录（守卫 `tests/ui-vendor-boundaries.test.ts` 的 `IMPORT_BOUNDARY_RULES`）。
- app.html 内的其他消费者用严格版 `useSettingsContext()`（无 provider 抛错）。
- `SettingsProvider` 在 `main.tsx` 包在 `RouterProvider` 外，并注入启动时读好的 `initialState`：`App` 是 router `Component`，没有 props 通道；首帧即已保存的预设，不闪默认色。
- 一次用户动作 = 一次 storage 写。`setState` 以 ref 镜像的最新值合并并判等（连续改两个字段不互相覆盖）；storage `watch` 的回声与其他标签页的重复值被 `isSameThemeSettings` 吞掉，不重渲染、不回写。
- 抽屉开合是 context 内存态，不持久化；抽屉挂在 `App.tsx`（router root），跨路由不卸载。
- `compactLayout` 的语义归 `layouts/dashboard/content.tsx`（on = 内容列收窄到 `lg`，off = 用页面自己的 cap）；`contrast` / `primaryColor` 由 `theme/with-settings/update-core.ts` 消费。
- `BaseOption` 整张卡是控件（`role="switch"`），里面的 MUI `Switch` 是装饰（`aria-hidden`、无 tab stop）：一个 tab stop 一个可读名。
- 预设色板的 `aria-label` 用颜色名不用序号：六色里有两个蓝。
- 抽屉图标一律走 `components/iconify` 离线图标，不移植 Minimal 的 `icons.tsx`。

## 坑

- 触发器（header 的 `SettingsButton`）与抽屉不在同一组件、不共享 ref，焦点归还交给 MUI Modal 默认的 restore-focus。`.trellis/spec/frontend/ui-design-system.md` §12 的「显式 ref + `disableRestoreFocus`」只适用于触发器与抽屉同组件的情形，别套过来。
