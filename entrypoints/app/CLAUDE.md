# Extension Page Dashboard (app.html)

MUI v7 Dashboard，复刻 material-kit-react 视觉风格。使用 `createHashRouter`（Chrome 扩展页面不支持路径路由）。路由结构：`/`(只读 Collection Analytics Dashboard), `/collections`(跨平台聚合页，支持 `?tag=<uuid>` 单标签深链), `/collections/bilibili`(B站收藏夹概览), `/collections/bilibili/:mediaId`(B站收藏夹视频列表), `/collections/github`(GitHub Stars 收藏页), `/collections/bookmarks`(浏览器书签「全部」), `/collections/bookmarks/:folderId`(书签按文件夹), `/collections/x`(X/Twitter 书签，扁平单集合无详情路由), `/collections/zhihu`(知乎收藏，收藏夹经 chips 筛选无详情路由), `/collections/youtube`(YouTube 公开播放列表，播放列表经 chips 筛选无详情路由), `/settings`。多平台模式：`/collections` 聚合所有平台注册条目；每个平台保留独立 `/collections/<platform>` 路由 + 对应 section。

## 模块结构

- `main.tsx` — 入口：fire-and-forget `initDbProxy()` 建立 DB RPC 连接；首次 React render 前 await `loadNavigationData()`，再创建 Hash Router；lazy 页面加载 + LoadingFallback
- `load-navigation.ts` — app 启动时读取一次 `onboardingStorage`，校验持久化平台判别符并调用 `createNavData`；读取失败记录错误并回退 canonical 导航，保证 app 继续启动。偏好由 welcome 写一次，故不 watch
- `collection-platform-registry.ts` — app 侧 canonical 平台 UI 元数据（label/path/icon），导航 factory 与聚合页 platform chips 的唯一事实源；用户偏好不得重排本 registry。判别符顺序来自 `@/lib/collections/platforms`（**必须走这个纯模块，不走 `@/lib/collections` barrel**——barrel 经 `collections-query` 把 drizzle + `@/lib/database` 拖进静态图，welcome.html 复用本 registry 但根本不碰数据库）
- `App.tsx` — 根组件：ThemeProvider + Outlet；顶层调用 `useDailyAutoSync()`（`hooks/use-daily-auto-sync.ts`）——每日首次打开 app.html（mount + tab 切回可见）自动同步所有「就绪」平台，闸门复用 `sources.lastFetchedAt`（per-platform，当天含手动拉过即跳过）
- `global.css` — 全局样式：DM Sans Variable + Barlow 字体导入 + baseline reset + 主题切换 View Transition 的 `::view-transition-*(root)` 伪元素规则（供 `layouts/dashboard/header-actions.tsx` 的圆形揭示动画用）

## 约定

- Extension Page (app.html): MUI v7 + Emotion CSS-in-JS + `createHashRouter`。Chrome 扩展页面 URL 不支持路径路由，必须用 hash router。主题系统复刻 material-kit-react（`minimal-shared` 工具库 + `@iconify/react` 图标）。新增页面：在 `pages/` 添加 lazy 组件 + `main.tsx` 路由配置 + `nav-config.tsx` 导航项
