# app/components/snackbar

一次性动作结果的唯一出口：Minimal 皮肤 + `sonner`。`App.tsx` 挂一次 `<Snackbar />`，全 app.html 的 `toast.*` 都落到这里。

## 约束

- 本目录是 `sonner` 的唯一入口（守卫 `tests/ui-vendor-boundaries.test.ts` 的 `VENDOR_RULES`）。业务代码 import 本目录的 `toast`，不 import 包本身。
- `Toaster` 故意不导出：第二个未皮肤化的 region 会静默吞掉一半 toast。
- toast 只报一次性动作结果（保存 / 同步 / 清除 / 导出 / 复制）。持续状态——已保存徽标、连接状态 Alert、测试连接结果、拉取进度——留在原位，不进 toast（docs/25 D6）。
- 失败文案具体优先：已有具体键（`settings.sync.err.*`、`export.*`、`settings.agentBridge.copy*`）直接用；`snackbar.*` 只放通用串与兜底串。
- sonner 跑 `unstyled: true`，全部视觉规则挂在 `classes.ts` 的 slot class 上（`styles.tsx`）。别去掉 `unstyled`：sonner 的默认皮肤会叠回来，而 `snackbar.test.tsx` 不断言它，是静默的视觉回归。
- region 与每条 toast 关闭按钮的 aria 名必须走 locale（`snackbar.regionLabel` / `snackbar.closeAria`）：sonner 的默认值是英文。
- 对 Minimal 的两处刻意偏离，别改回去：宽 360 而非 300；toast 表面用 `theme.mixins.paperStyles` 而非扁平 `background.paper`（与菜单 / 弹出层同一种浮层质感）。

## 坑

- sonner 的 CSS 由它自己注入 `document.head`，不要改成 `<link>`。
- sonner 把 store 更新延迟一个宏任务：测试里要 `await` 一个 `setTimeout(0)` 才看得到 toast（`snackbar.test.tsx` 的 `emit()` helper）。
