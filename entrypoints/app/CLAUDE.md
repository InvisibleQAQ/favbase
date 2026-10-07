# Extension Page Dashboard（app.html）

MUI v9 Dashboard，视觉语言是 Minimal Dashboard v7.7.0 + Favbase 品牌 token。主题规则在 `theme/CLAUDE.md`，条目外壳在 `components/collection/CLAUDE.md`，shell 在 `layouts/CLAUDE.md`。

## 路由与启动

- 只能用 `createHashRouter`：Chrome 扩展页面的 URL 不支持路径路由。
- 平台路由（`/collections/<platform>` 与详情子路由）只由 `collection-platform-pages.ts` 的 `collectionPlatformRoutes` 展开，子路由段来自 `PLATFORM_META.childRoutes`。`main.tsx` 不得出现 `collections/<platform>` 字面量或平台专属路由行。守卫：`tests/platform-completeness-contract.test.ts`。
- 新增非平台页面：`pages/` 加 lazy 组件 + `main.tsx` 路由 + `layouts/nav-config.tsx` 导航项。新增平台走 `.trellis/spec/frontend/platform-onboarding.md`，不手改 `main.tsx`。
- 设置页两级导航全部是路由（`/settings/:tab?/:section?`），段名就是 section id，穷举表在 `sections/settings/settings-nav.ts`；`/settings` 与裸 tab 由视图 `replace` 重定向到该 tab 首项。
- `/collections` 支持 `?tag=<uuid>` 单标签深链（Dashboard 的热门标签链到它）。
- `main.tsx` 在首次 render 前 await 导航数据与主题设置（否则先闪一下默认预设）；两者读取失败都回退默认值，app 必须照常启动。`initDbProxy()` 是 fire-and-forget。
- `SettingsProvider` 包在 router 外：`App` 是 router `Component`，没有 props 通道传预读的初始状态。
- `SettingsDrawer` 与 `Snackbar` 挂在 router root（`App.tsx`）：跨路由不卸载，切路由不会删掉未读的 toast。
- `App.tsx` 首次 mount 发一次 `AGENT_BRIDGE_CONNECT_NOW`，只是让 Background scheduler 跳过下一次轮询，失败只记诊断。WebSocket、开关、重试都归 Background，不要在 app 里开 Agent Bridge 连接。
- onboarding 平台偏好由 welcome 写一次、启动时读一次，不 watch。

## 平台注册表

- `collection-platform-registry.ts` 的 `PLATFORM_META` 是 Platform Descriptor 的 app 半边，领域半边在 `lib/collections/platform-descriptor.ts`。分两份是因为 `LocaleKeys` / `IconifyName` 是 app 侧类型，而 `lib/` 不得依赖 `entrypoints/`（`docs/adr/0004`）。
- 它必须从纯模块 `@/lib/collections/platforms` 取判别符，不走 `@/lib/collections` barrel：barrel 会把 drizzle 与 `@/lib/database` 拖进静态图，而 welcome.html 复用本 registry、根本没有数据库。
- 按判别符取单个平台用导出的 `collectionPlatformById`，不要各自 `new Map(collectionPlatformRegistry.map(...))`。
- registry 顺序是导航与聚合页平台 chips 的事实源，用户偏好不得重排它。
- 重值不进 descriptor：lazy page（`collection-platform-pages.ts` 的 `COLLECTION_PAGE_LOADERS`）与 Sync Adapter（`collection-platform-auto-sync.ts`）各自是穷举的 `Record<CollectionPlatform, …>`。
- daily auto-sync 聚合表放在 app 根而不是 `hooks/`，因为 `hooks/` 不得 import `sections/`。表内 `jobPlatform` 经 `jobPlatformForCollection` 派生、不手写；声明顺序 = 协调器评估顺序。

## UI 约定

- MUI v9 无 system props：`Box` / `Stack` / `Typography` / `Grid` / `Link` 上的布局与颜色一律进 `sx`。`Typography color="text.secondary"` 类型通过但不产生样式，同样禁止。
- slot 类名不要手打字符串，用 `tabsClasses.list` 这类 `*Classes` 常量：`MuiTabs-flexContainer` 早已改名，手写得到的是不报错的死 CSS。
- 色板、字号、半径、阴影、组件 defaults 归 `theme/` 单一 owner，页面只消费 `theme.vars.*`；页面局部半径只用 0.5 / 0.75 / 1 单位。
- 重量级 UI 依赖各有唯一入口（`sonner` → `components/snackbar/`，`simplebar-react` → `components/scrollbar/`），app.html 不引入 `motion`。守卫：`tests/ui-vendor-boundaries.test.ts`。
- docs/19 的视觉结论已被 docs/25 §3.1 推翻；仍生效的保留项（`data-*` 结构词表、heading outline、焦点恢复契约、平台色 ≥ 3:1、固定 type scale、零 CDN）在 docs/25 §3.2。
- `global.css` 的 `ul` reset（去项目符号与缩进）不能删：`components/nav-section/` 的列表自己不设 `list-style`，靠它。
- `index.html` `<body>` 首子节点的 HTML 注释是视觉方向契约，改视觉语言时同步它。
