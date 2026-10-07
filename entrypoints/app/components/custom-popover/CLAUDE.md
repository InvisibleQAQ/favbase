# app/components/custom-popover

带指向箭头的 Popover（Minimal 移植）。

## 坑

- MUI v9 不把 `slotProps.paper.ref` 转发到 DOM（ref 恒为 null）。照抄 Minimal 的 ref 写法，箭头永远不渲染，而且没有任何报错。
- 所以箭头始终挂载为 paper 的第一个子元素，经自己的 `parentElement` 反查 paper；锚点与 paper 两个盒子量齐之前 `Arrow` 是 `display: none`，`paperRect` / `anchorRect` 因此可空。
- `custom-popover.test.tsx` 的 `display !== 'none'` 断言钉住上一条，别删：MUI 再改 ref 行为时它是唯一的信号。
- paper 的盒子读 computed style，不用 `getBoundingClientRect`：MUI 首帧仍在过渡缩放中。
- happy-dom 没有 `ResizeObserver`，stub 在 `tests/setup/app-dom.ts`。

## 约束

- RTL 分支照抄保留（`theme.direction` 恒为 `ltr`，分支不触发）：别当死代码裁掉，留着便于与 Minimal 对账。
