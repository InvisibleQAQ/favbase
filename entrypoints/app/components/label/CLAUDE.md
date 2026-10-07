# app/components/label

状态药丸（Minimal 移植）。哑组件：零 `t()`、零平台字面量。

## 约束

- children 原样渲染。Minimal 用 `es-toolkit` 的 `upperFirst` 大写首字母，这里不做：文案来自 `t()`，大小写归 locale；也因此不引入 `es-toolkit`。
- `inverted` 变体的 `palette[color].lighter` / `.darker` 是刻意反色（浅底深字，暗色互换），不是该换成 `varAlpha` 洗底的那类「浅底当选中背景」用法。
- `inverted` 目前没有消费者，但变体保留不删（用户决定，docs/25 Step 10）。
- 对比度由 `theme/theme-contract.test.ts` 统一守，不在本目录断言。

## 已知缺口

- `inverted` 的对比度断言只覆盖六个 palette 色 × 六预设。`color="default"`（固定 grey ramp）与 `common` 分支（前景取继承色 `currentColor`，静态算不出）不在断言内——这是覆盖边界，不是漏项。
