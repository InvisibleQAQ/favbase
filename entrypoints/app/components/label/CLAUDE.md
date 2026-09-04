# app/components/label

状态药丸（Minimal `components/label/` 移植，docs/25 Step 3）。app.html 内共享哑组件。

## 模块结构

- `label.tsx` — `Label`：`variant`（`soft` 默认 / `filled` / `outlined` / `inverted`）× `color`（`default` + 六个 palette 色 + `black`/`white`）+ `startIcon`/`endIcon`/`disabled`。
- `styles.tsx` — `LabelRoot`（24px 高、12px 粗体、`borderRadius = shape.borderRadius × 0.75`）+ `LabelIcon`（16px 槽）。四变体全部走 `theme.mixins.filledStyles`/`softStyles`，颜色分支由 `colorKeys` 派生，无逐色硬编码。
- `classes.ts` — `labelClasses.root` / `.icon`（`favbase__label__*`，经 `theme/create-classes.ts`）。
- `types.ts` — `LabelColor` / `LabelVariant` / `LabelProps`，色域从 `theme/core/palette.ts` 的 `PaletteColorKey` + `CommonColorsKeys` 推导。

## 约定

- **children 原样渲染**。Minimal 用 `es-toolkit` 的 `upperFirst` 大写首字母；这里不做——文案来自 `t()`，大小写由 locale 决定，组件不得改写。也因此不引入 `es-toolkit`。
- `inverted` 变体用 `palette[color].lighter/.darker` 是**刻意反色**（浅底深字，暗色互换），不是 docs/25 Step 2 第 9 点要替换成 `varAlpha` 的「浅底当选中背景」那类用法。Step 2 换预设时这里无需改动，五阶随预设走。
- 零 `t()`、零平台字面量，与 `components/collection/` 同一档哑组件纪律。
- 颜色对比度不在本目录断言，由 `theme/theme-contract.test.ts` 统一守。**`inverted` 的 `darker`-on-`lighter` 已在 docs/25 Step 10 补断言**（六预设 × 六色 `it.each`）：实测全局最低 6.89:1（success），primary 自己最低 7.95:1（preset4），全部过 4.5，无需回退任何配色。变体保留（用户 2026-09-04 决定不删）；仍无消费者，但不再是未验证项，docs/25 的跨 Step 遗留复核项由此清零。两 scheme 只跑一轮：dark 把这对色前后景互换（`styles.tsx` 的 `applyStyles('dark')` 换的就是同一对 `lighter`/`darker`，不是别的阶），对比度比值对称。断言覆盖的是 `colorKeys.palette` 六色；`inverted color="default"` 是 grey 800 on grey 300（12.04:1，固定 ramp、不随预设动，故不入 `it.each`），`inverted` 的 `common` 分支用 `varAlpha('currentColor', …)`，前景取自继承色，静态算不出来，两者都不在断言内——这是覆盖边界，不是漏项。

## 消费方

- `sections/zhihu/zhihu-card.tsx` — 条目类型戳（answer/article/pin/zvideo），`variant="soft"` + 默认 `color`，落在 `CollectionCard` 的 `stamp` 槽（docs/25 Step 8，此前是 outlined Chip）。这是本组件的首个真实消费者。

## 测试

`label.test.tsx` — 前缀类名与 children 原样、双 icon 槽顺序、四变体各自命中样式分支（emotion 类名互异 + outlined 的 2px 边）、同色稳定/异色分离、disabled 的 0.48 + `pointer-events: none`。
