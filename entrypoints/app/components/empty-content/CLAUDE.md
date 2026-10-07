# app/components/empty-content

空态 / 错误态 / 无匹配态的共享外壳（Minimal 移植）。收藏页不直接用它，用 `components/collection/state-box.tsx` 的 `StateBox`（本组件的薄适配层）。

## 约束（对 Minimal 的刻意偏离）

- 无默认插图、无默认标题：Minimal 回落到打包 SVG 与字面量 "No data"，本仓库没有那份资产，也没有通用空态 i18n key。调用方一律自带文案（`NoMatchesState` 依赖盒子里只有它传的那一句）。
- 文案落 `text.secondary`，标题是 `subtitle1` 的 `<p>`：Minimal 的 `h6` 会给页面加第二个 heading，`text.disabled` 对比度不过线。
- `icon` 槽优先于 `imgUrl`。
- 所有槽都是根的直接子元素，不要包 wrapper：`state-box.test.tsx` 按直接子元素断言视觉顺序。
