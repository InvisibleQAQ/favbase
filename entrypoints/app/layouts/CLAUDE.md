# app/layouts

仪表盘布局系统。

## 模块结构

- `core/layout-section.tsx` — 布局骨架：sidebar + sidebarContainer(header+main+footer)，注入 CSS vars via GlobalStyles
- `core/header-section.tsx` — 粘性 AppBar + 滚动毛玻璃效果（backdrop-filter blur(6px)），slots: leftArea/rightArea/centerArea
- `core/main-section.tsx` — flex column 主内容区
- `core/css-vars.ts` — 布局 CSS 变量（nav-zIndex/header-height/nav-width）
- `dashboard/layout.tsx` — DashboardLayout：组合 NavDesktop + NavMobile + HeaderSection + MainSection。读取 `sidebarPinnedStorage` 控制侧边栏 pinned/unpinned 状态，Header 左侧 toggle 按钮（lg+ 可见）切换，CSS 变量 `--layout-nav-vertical-width` 动态切换 280px/72px。Header `rightArea` slot 挂 `HeaderActions`
- `dashboard/header-actions.tsx` — HeaderActions：Header 右侧控件（语言切换 + GitHub 入口）。语言按钮（`solar:global-bold-duotone`）点开 MUI `Menu` 三项（`settings.languageAuto/ZhCN/En`），当前 `preference` 项显 `eva:checkmark-fill` 勾，点选 `setLocale` 并关闭；`useTranslation()` 订阅使切换后 aria-label/tooltip re-render。GitHub 按钮 `IconButton component="a"`（`mdi:github`）新标签打开 `REPO_URL`。i18n key `header.githubAria`/`header.languageAria`
- `dashboard/nav.tsx` — NavDesktop（固定左侧栏，pinned=280px/unpinned=72px，md 断点(900px)显示）+ NavMobile（Drawer 抽屉，pathname 变化自动关闭，始终 pinned 模式）+ NavContent（顶层项：`item.children` 走 `CollectionsBranch`，否则走 `NavLeafButton`）。**一级嵌套**：`CollectionsBranch`（Collections 父项）pinned 时可折叠（chevron + MUI `Collapse`），`/collections*` 路由下 active 高亮 + 自动展开；unpinned(72px) 退化为纯图标 + Tooltip，点击 `navigate('/collections')` 不展开树。展开后子项经 `NavChildLeaf` 渲染为**缩进的叶子链接**（`component={RouterLink}` 指向 `child.path`，小圆点代替大图标，`pathname.startsWith(child.path)` 判 active，primary 高亮）。目前唯一子项是 Bilibili Favorites（→ `/collections`），**不再往下展开收藏夹**——收藏夹列表回到 collections 页内层 `FolderSidebar`。nav 不消费收藏夹数据，无全局 provider
- `dashboard/content.tsx` — DashboardContent：Container maxWidth + dashboard padding CSS vars
- `nav-config.tsx` — 导航项：Dashboard/Collections/Settings，Iconify solar 图标。`NavItem` 支持可选 `children?: NavItem[]`（一级静态嵌套，为多平台预留）+ 可选 `icon?`（顶层项带图标，子项省略由 `NavChildLeaf` 渲染小圆点）。Collections 项挂一个静态子项 Bilibili Favorites（`path: '/collections'`，无 icon）

## 约定

- 侧边栏 Pin/Unpin: `sidebarPinnedStorage`（`lib/storage/ui-state.ts`），布尔值存储在 `local:sidebarPinned`（默认 true）。DashboardLayout 读取并通过 toggle 按钮切换。Pinned=280px 展开（图标+文字），Unpinned=72px 图标栏（MUI Tooltip 显示菜单名）。Mobile（md 以下，<900px）不受影响，始终 Drawer 模式
- nav 嵌套：主 sidebar 只做**一级嵌套**（Collections 父项 → Bilibili Favorites 叶子链接），止于平台名，不展开收藏夹。收藏夹数据仍由 collections 页本地 `useBiliFavFolders` 拥有（见 `sections/collections/CLAUDE.md`），nav 不读取，故无全局 `FavFoldersProvider`。未来新增平台：在 `nav-config.tsx` 的 Collections `children` 加叶子即可
