# app/layouts

仪表盘布局系统。

## 模块结构

- `core/layout-section.tsx` — 布局骨架：sidebar + sidebarContainer(header+main+footer)，注入 CSS vars via GlobalStyles
- `core/header-section.tsx` — 粘性 AppBar + 滚动毛玻璃效果（backdrop-filter blur(6px)），slots: leftArea/rightArea/centerArea
- `core/main-section.tsx` — flex column 主内容区
- `core/css-vars.ts` — 布局 CSS 变量（nav-zIndex/header-height/nav-width）
- `dashboard/layout.tsx` — DashboardLayout：组合 NavDesktop + NavMobile + HeaderSection + MainSection。读取 `sidebarPinnedStorage` 控制侧边栏 pinned/unpinned 状态，Header 左侧 toggle 按钮（lg+ 可见）切换，CSS 变量 `--layout-nav-vertical-width` 动态切换 280px/72px。Header `rightArea` slot 挂 `HeaderActions`
- `dashboard/header-actions.tsx` — HeaderActions：Header 右侧控件（语言切换 + GitHub 入口）。语言按钮（`solar:global-bold-duotone`）点开 MUI `Menu` 三项（`settings.languageAuto/ZhCN/En`），当前 `preference` 项显 `eva:checkmark-fill` 勾，点选 `setLocale` 并关闭；`useTranslation()` 订阅使切换后 aria-label/tooltip re-render。GitHub 按钮 `IconButton component="a"`（`mdi:github`）新标签打开 `REPO_URL`。i18n key `header.githubAria`/`header.languageAria`
- `dashboard/nav.tsx` — NavDesktop（固定左侧栏，pinned=280px/unpinned=72px，md 断点(900px)显示）+ NavMobile（Drawer 抽屉，pathname 变化自动关闭，始终 pinned 模式）+ NavContent（路由激活高亮，varAlpha primary channel，unpinned 时仅图标 + MUI Tooltip，Logo 区隐藏 "favbase" 文字）
- `dashboard/content.tsx` — DashboardContent：Container maxWidth + dashboard padding CSS vars
- `nav-config.tsx` — 导航项：Dashboard/Collections/Settings，Iconify solar 图标

## 约定

- 侧边栏 Pin/Unpin: `sidebarPinnedStorage`（`lib/storage/ui-state.ts`），布尔值存储在 `local:sidebarPinned`（默认 true）。DashboardLayout 读取并通过 toggle 按钮切换。Pinned=280px 展开（图标+文字），Unpinned=72px 图标栏（MUI Tooltip 显示菜单名）。Mobile（md 以下，<900px）不受影响，始终 Drawer 模式
