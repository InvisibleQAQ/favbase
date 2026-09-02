# app/components/iconify

Iconify 图标系统（与 material-kit-react 同源 `@iconify/react`）。

## 模块结构

- `icon-sets.ts` — 30+ 离线注册图标（solar/eva/mingcute/lucide/custom 集），含 favbase 专用图标（含 `lucide:copy` 用于 Agent Bridge token/命令复制、`solar:pause-bold`/`solar:play-bold` 用于 Collection pipeline 单按钮暂停/继续、`solar:siderbar-bold-duotone` 用于侧边栏 toggle、`solar:bookmark-bold-duotone` + `solar:folder-with-files-bold-duotone` 用于书签页 nav/卡片/文件夹 chip、`simple-icons:bilibili` 用于 Collections 子菜单 Bilibili 叶子、`mdi:twitter` + `mdi:heart-outline`/`mdi:repeat-variant`/`mdi:comment-outline` 用于 X 书签页作者 chip/推文卡片头像回退与点赞/转推/回复计数、`simple-icons:zhihu` 用于知乎收藏页收藏夹 chip/卡片头像回退/空态、`mdi:youtube` 用于 YouTube 播放列表页 chip/缩略图回退/空态、`eva:diagonal-arrow-right-up-fill` 外链箭头用于 nav Platform Request 叶子与 welcome 尾节按钮、Analytics 平台账本（`sections/overview`）用 `solar:layers-bold-duotone`（在用平台）+ `solar:tag-bold-duotone`（标签覆盖率）做摘要带字形，`solar:user-bold-duotone`（UP 主/作者/仓库作者/频道）+ `solar:code-bold-duotone`（语言）+ `solar:playlist-bold-duotone`（播放列表）连同已有 `solar:folder-with-files-bold-duotone`/`solar:global-bold-duotone` 做维度榜单字形）。**例外：`flagpack:cn`/`flagpack:gb` 是多色非方形国旗**（用于 header 语言切换器），带 per-icon `width:32,height:24`（覆盖 `register-icons.ts` 对非 carbon 前缀的方形 24 默认），保留 flagpack 原生 32×24 viewBox；单色图标沿用 `currentColor`，国旗用真实色值。iconify v5 渲染时对 body 内 `<mask id>` 自动去重（`replaceIDs` + `useId()`），同屏多实例国旗安全。**docs/25 Step 3 追加 5 个**（文件末尾一组，注释标明用途）：`eva:arrow-ios-back-fill`（`components/custom-breadcrumbs/` 的 `BackLink` 回退箭头）+ `eva:info-outline`、`solar:info-circle-bold`、`solar:danger-bold`、`solar:danger-triangle-bold`（`Label`/`EmptyContent` 调用方的状态字形）。图标 body 取自 Iconify 公共 API 后写死进本文件，运行时不联网
- `register-icons.ts` — addCollection 离线注册 + `IconifyName` 类型安全
- `iconify.tsx` — styled(Icon) 包装，未注册图标 console.warn 提醒
