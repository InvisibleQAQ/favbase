# app/components/iconify

离线 Iconify 图标系统（`@iconify/react`）。

## 约束

- 零 CDN：图标 body 从 Iconify 公共 API 取来后写死进 `icon-sets.ts`，运行时不联网。要用新图标，先在这里注册。
- `IconifyName` 是 `keyof typeof allIcons`，未注册的名字是 `tsc` 错误（运行时另有 `console.warn`）。
- 删掉某个图标的最后一个消费者时，把它也从 `icon-sets.ts` 删掉：没有消费者的离线 SVG 是净重。

## 坑

- 单色图标吃 `currentColor`；多色图标（`flagpack:*` 国旗、`custom:sun-color` / `custom:moon-color`）写的是真实色值，不随 `color` 变。要靠 `color` 染选中态的位置必须用单色字形。
- 注册时非 `carbon` 前缀默认方形 24。`flagpack:cn` / `flagpack:gb` 是 32×24，靠 per-icon `width` / `height` 覆盖；新增非方形图标同样要带尺寸。
