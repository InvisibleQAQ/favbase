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
- 颜色对比度不在本目录断言，由 `theme/theme-contract.test.ts` 统一守。

## 测试

`label.test.tsx` — 前缀类名与 children 原样、双 icon 槽顺序、四变体各自命中样式分支（emotion 类名互异 + outlined 的 2px 边）、同色稳定/异色分离、disabled 的 0.48 + `pointer-events: none`。
