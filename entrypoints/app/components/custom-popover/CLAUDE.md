# app/components/custom-popover

带指向箭头的 Popover（Minimal `components/custom-popover/` 移植，docs/25 Step 3）。Step 4 的语言弹层与 Step 9 的 chat 菜单会消费它。

## 模块结构

- `custom-popover.tsx` — `CustomPopover`：包 MUI `Popover`，`slotProps.arrow.placement` 是唯一位置事实源。
- `utils.ts` — `getPopoverOrigin`（12 个 placement → anchor/transform origin 对，RTL 时镜像水平方向）+ `getArrowOffset`（箭头对准锚点中心并夹在 paper 内）。纯函数，直接单测。
- `hooks.ts` — `useElementRect`：开启期间跟踪锚点与 paper 的盒子。paper 走 computed style 而非 `getBoundingClientRect`，因为 MUI 首帧仍在过渡缩放中。
- `styles.tsx` — `Arrow`（12 位摆放 + 角落渐变配色）+ `getPaperOffsetStyles`。

## 关键：箭头如何找到 paper（与 Minimal 不同）

Minimal 靠 `slotProps.paper.ref` 拿 paper 节点。**MUI v9 不再把这个 ref 转发到 DOM**（实测 ref 恒为 null），照抄的结果是箭头永远不渲染，而且没有任何报错——纯静默视觉缺失。

这里改为：箭头**始终挂载**，作为 paper 的第一个子元素，通过自己的 `parentElement` 反查 paper；两个盒子测量齐之前，`Arrow` 的 styled 早退成 `display: none`。所以 `Arrow` 的 `paperRect`/`anchorRect` 类型是可空的。

`custom-popover.test.tsx` 里那条 `display !== 'none'` 断言就是钉住这件事的——去掉它，下次 MUI 改 ref 行为时又会静默失效。

## 其它

- RTL 分支照抄保留。app.html 只有 zh-CN / en，`theme.direction` 恒为 `ltr`，分支恒不触发；照抄比裁剪少 bug 面，也便于后续 Step 与 Minimal 对账。
- happy-dom 无 `ResizeObserver`，由 `tests/setup/app-dom.ts` 提供 stub。

## 测试

`custom-popover.test.tsx` — placement 推导双 origin、RTL 镜像、箭头居中与夹取（纯函数）；开合渲染、箭头挂载且可见、`arrow.hide`、backdrop 关闭（DOM）。
