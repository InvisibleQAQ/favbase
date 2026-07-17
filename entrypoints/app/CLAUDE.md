# Extension Page Dashboard (app.html)

MUI v7 Dashboard，复刻 material-kit-react 视觉风格。使用 `createHashRouter`（Chrome 扩展页面不支持路径路由）。路由结构：`/`(Dashboard), `/collections`(通用命名空间，redirect 到 `/collections/bilibili`), `/collections/bilibili`(B站收藏夹概览), `/collections/bilibili/:mediaId`(B站收藏夹视频列表), `/collections/github`(GitHub Stars 收藏页), `/collections/bookmarks`(浏览器书签「全部」), `/collections/bookmarks/:folderId`(书签按文件夹), `/collections/x`(X/Twitter 书签，扁平单集合无详情路由), `/collections/zhihu`(知乎收藏，收藏夹经 chips 筛选无详情路由), `/settings`。多平台模式：`/collections` 保留给将来跨平台聚合页，每个平台一条 `/collections/<platform>` 路由 + 对应 section。

## 模块结构

- `main.tsx` — 入口：fire-and-forget `initDbProxy()` 建立 DB RPC 连接 + Hash Router + lazy 页面加载 + LoadingFallback
- `App.tsx` — 根组件：ThemeProvider + Outlet
- `global.css` — 全局样式：DM Sans Variable + Barlow 字体导入 + baseline reset + 主题切换 View Transition 的 `::view-transition-*(root)` 伪元素规则（供 `layouts/dashboard/header-actions.tsx` 的圆形揭示动画用）

## 约定

- Extension Page (app.html): MUI v7 + Emotion CSS-in-JS + `createHashRouter`。Chrome 扩展页面 URL 不支持路径路由，必须用 hash router。主题系统复刻 material-kit-react（`minimal-shared` 工具库 + `@iconify/react` 图标）。新增页面：在 `pages/` 添加 lazy 组件 + `main.tsx` 路由配置 + `nav-config.tsx` 导航项
