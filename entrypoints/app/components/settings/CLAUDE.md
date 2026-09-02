# app/components/settings

Minimal Dashboard `components/settings` 的移植（docs/25 Step 2，2026-09-01），去掉 font / fontSize / direction / navLayout / navColor / **mode**——mode 归 MUI `ThemeProvider` 的 `favbase-color-mode`，不进这里。当前只落**数据层**（context + provider）；抽屉 UI（`drawer/`）在 docs/25 Step 4。与 `components/library-gate/` 同档：**智能组件目录**，允许 storage-backed hook（`components/collection/` 的零 storage / 零 `t()` 铁律不适用）。

## 模块结构

- `types.ts` — re-export `ThemeSettings` / `ThemeColorPreset` / `ThemeContrast`（类型来自 `@/lib/storage`，值形状归 `lib/storage/theme-settings.ts`）；`SettingsContextValue { state, canReset, onReset, setState(partial), setField<K>(name, value), openDrawer, onCloseDrawer, onToggleDrawer }`（字段名照 Minimal，Step 4 抽屉零改名）；`SettingsProviderProps { initialState, children }`
- `context/settings-context.ts` — `createContext<SettingsContextValue | undefined>(undefined)`。**leaf 契约**：只 import `react` 与类型。`theme/theme-provider.tsx` 直接 import 这个文件做可选读取（`use(SettingsContext)`），welcome.html 与 20 个裸渲染 `<ThemeProvider>` 的测试因此不会被拖进 storage
- `context/settings-provider.tsx` — `SettingsProvider({ initialState, children })`：`useState(initialState)` 持内存态；`useEffect` 订阅 `watchThemeSettings`（回声/相同值不 setState）；`setState(partial)` 以 ref 镜像的**最新已应用值**合并（ref 在 React 提交前就更新，连续快速修改两个不同字段不会互相覆盖）——相同值 no-op，否则本地立即更新 + 恰好一次 `setThemeSettings(next)`（失败只 `console.error`）；`setField(name, value)` = 单字段 `setState`；`onReset` = `setState(DEFAULT_THEME_SETTINGS)`；`canReset = !isSameThemeSettings(state, DEFAULT)`；drawer 三件套 `openDrawer / onToggleDrawer / onCloseDrawer` 是纯内存态、不持久化。value 经 `useMemo`，以 React 19 `<SettingsContext value>` 提供
- `context/use-settings-context.ts` — `useSettingsContext()`：无 provider 时抛 `useSettingsContext must be used inside SettingsProvider`。抽屉与其他 app.html 消费者用这个严格版
- `context/index.ts` / `index.ts` — barrel（`export type * from './types'`）

## 契约

- **初值由 `main.tsx` 注入**：bootstrap 时 `Promise.all([loadNavigationData(), getThemeSettings()])`，`SettingsProvider` 包在 `RouterProvider` 外（`App.tsx` 是 router `Component`，无 props 通道；`ThemeProvider` 仍在 `App.tsx` 内，语义 = Minimal 的 Settings 外层 / Theme 内层）。首帧即已保存的预设，不闪默认色
- **一次用户动作 = 一次 storage 写**：`setState` 基于 ref 镜像判等，storage `watch` 回声与另一 app.html tab 的重复值都被 `isSameThemeSettings` 吞掉，不重渲染、不回写
- `ThemeProvider` 通过 leaf context 可选读取；抽屉等消费者用会抛错的 `useSettingsContext()`。不要把 `theme-provider.tsx` 改成抛错版——welcome 复用它
- `compactLayout` 只落数据层，`maxWidth` 语义 Step 4 决定；`contrast` / `primaryColor` 已由 `theme/with-settings/update-core.ts` 消费

## 测试

`context/settings-provider.test.tsx`（happy-dom，`createRoot` + `act`，全部渲染包在 `<StrictMode>` 内与 `main.tsx` 一致——写入/渲染计数在双调用 effect 下同样成立；只 mock `wxt/utils/storage`，真实 `lib/storage/theme-settings.ts` facade 参与）：初值不写 storage / `setField` 恰好一次写 / 相同值 no-op 不渲染 / `onReset` 回默认并持久化 / 外部 watch 变更被采纳并 canonicalize 且不回写 / 回声不重渲染 / drawer 三件套 / 裸 `ThemeProvider` = coral 而 preset2 provider 内 = `#7635dc` 且 `text.accent` 派生 / `useSettingsContext` 无 provider 抛错。
