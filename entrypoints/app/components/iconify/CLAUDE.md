# app/components/iconify

Iconify 图标系统（与 material-kit-react 同源 `@iconify/react`）。

## 模块结构

- `icon-sets.ts` — 30+ 离线注册图标（solar/eva/mingcute/custom 集），含 favbase 专用图标（含 `solar:siderbar-bold-duotone` 用于侧边栏 toggle、`solar:bookmark-bold-duotone` + `solar:folder-with-files-bold-duotone` 用于书签页 nav/卡片/文件夹 chip、`mdi:twitter` + `mdi:heart-outline`/`mdi:repeat-variant`/`mdi:comment-outline` 用于 X 书签页作者 chip/推文卡片头像回退与点赞/转推/回复计数、`simple-icons:zhihu` 用于知乎收藏页收藏夹 chip/卡片头像回退/空态）。**例外：`flagpack:cn`/`flagpack:gb` 是多色非方形国旗**（用于 header 语言切换器），带 per-icon `width:32,height:24`（覆盖 `register-icons.ts` 对非 carbon 前缀的方形 24 默认），保留 flagpack 原生 32×24 viewBox；单色图标沿用 `currentColor`，国旗用真实色值。iconify v5 渲染时对 body 内 `<mask id>` 自动去重（`replaceIDs` + `useId()`），同屏多实例国旗安全
- `register-icons.ts` — addCollection 离线注册 + `IconifyName` 类型安全
- `iconify.tsx` — styled(Icon) 包装，未注册图标 console.warn 提醒
