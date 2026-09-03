# app/components/snackbar

一次性动作结果的唯一出口（Minimal `components/snackbar/` 移植 + `sonner`，docs/25 Step 5）。

`App.tsx` 在 `ThemeProvider` 内挂一次 `<Snackbar />`，全 app.html 的 `toast.*` 都落到这里。

## 模块结构

- `snackbar.tsx` — `Snackbar`：`Portal` 包裹的 `SnackbarRoot`，`top-right` / `expand` / `closeButton` / `gap 12` / `offset 16` / `visibleToasts 4`；四个 severity 图标经 `../iconify` 离线注册（`solar:check-circle-bold` / `danger-bold` / `danger-triangle-bold` / `info-circle-bold`），两个 aria 名都走 locale——`containerAriaLabel` = `t('snackbar.regionLabel')`、`toastOptions.closeButtonAriaLabel` = `t('snackbar.closeAria')`（sonner 自带默认是英文 `Notifications` / `Close toast`，前者被读屏播报、后者是每条 toast 上的 icon-only 控件，都必须跟随界面语言）
- `styles.tsx` — `SnackbarRoot = styled(Toaster)`：sonner 跑 `unstyled`，全部视觉规则挂在 `classes.ts` 的 slot class 上
- `classes.ts` — `snackbarClasses`：经 `theme/create-classes.ts` 生成的 `favbase__snackbar__*` 前缀类名，是 emotion 抓住非自有 DOM 的唯一把手
- `index.ts` — 对外只导出 `Snackbar` / `snackbarClasses` / `toast`

## 约定

- **本目录是 `sonner` 的唯一入口**，守卫 `tests/ui-vendor-boundaries.test.ts`（与 `simplebar-react` 同一张 `VENDOR_RULES` 表）。业务代码 import 的是 `@/entrypoints/app/components/snackbar` 的 `toast`，不是包本身。
- **`Toaster` 故意不再导出**。第二个未皮肤化的 region 会静默吞掉一半 toast。
- **toast 只报一次性动作结果**（docs/25 D6 方案 A）：保存/同步/清除/导出/复制。持久状态——已保存徽标、连接状态 Alert、测试连接结果、拉取进度——留在原位，不进 toast。
- **失败文案具体优先**：已有具体键（`settings.sync.err.*`、`export.*`、`settings.agentBridge.copy*`）直接用；`snackbar.*` 只放没有现成文案的通用串与兜底串。
- 两处对 Minimal 的有意偏离（docs/25 Step 5 执行记录）：宽 360 而非 300、toast 表面用 `theme.mixins.paperStyles` 而非扁平 `background.paper`（与菜单/弹出层同一种浮层质感）；severity 图标底保留 Minimal 的单条 `varAlpha('currentColor', 0.08)` 规则，不拆成四条 per-severity 规则。
- sonner 的 CSS 由它自己注入 `document.head`，**不能**改成 `<link>`（铁律 4）。

## 测试

`snackbar.test.tsx` — region 与每条 toast 关闭按钮的 `aria-label` 都跟随界面语言、Portal 确实渲染到挂载点之外、四种 severity 各自的离线图标与 severity class、title/icon slot 的皮肤钩子。

sonner 的 store 更新被它自己延迟一个宏任务（`useSonner` 里的 “Prevent batching, temp solution”），测试里必须 `await` 一个 `setTimeout(0)` 才看得到 toast——测试内的 `emit()` helper 负责这件事。
