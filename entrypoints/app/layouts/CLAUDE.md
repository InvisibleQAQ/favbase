# app/layouts

仪表盘布局系统。

## 模块结构

- `core/layout-section.tsx` — 布局骨架：sidebar + sidebarContainer(header+main+footer)，注入 CSS vars via GlobalStyles
- `core/header-section.tsx` — 粘性 AppBar + 滚动毛玻璃效果（backdrop-filter blur(6px)），slots: leftArea/rightArea/centerArea
- `core/main-section.tsx` — flex column 主内容区
- `core/css-vars.ts` — 布局 CSS 变量（nav-zIndex/header-height/nav-width）
- `dashboard/layout.tsx` — DashboardLayout：组合 NavDesktop + NavMobile + HeaderSection + MainSection。读取 `sidebarPinnedStorage` 控制侧边栏 pinned/unpinned 状态，Header 左侧 toggle 按钮（lg+ 可见）切换，CSS 变量 `--layout-nav-vertical-width` 动态切换 280px/72px。Header `rightArea` slot 挂 `HeaderActions`
- `dashboard/header-actions.tsx` — HeaderActions：Header 右侧控件（暗色旋钮 + 语言切换 + GitHub 入口）。**`ThemeToggleButton`**（最左）二态旋钮：`useColorScheme()` 读 `mode`/`systemMode`，`resolved = mode==='system'?systemMode:mode`（mounted 前 `mode` 为 undefined，回退读 `<html data-color-scheme>`——即 index.html FOUC 脚本已设的值，避免图标翻转），点击 `setMode(resolved==='dark'?'light':'dark')`，图标 `solar:sun-bold-duotone`(暗态,点→亮)/`solar:moon-bold-duotone`(亮态,点→暗)，i18n key `header.themeAria`。**语言按钮为国旗样式**：触发按钮显示**当前生效语言**（`useTranslation()` 的 `locale`）的国旗（`flagpack:cn`/`flagpack:gb`，`FLAG_WIDTH×FLAG_HEIGHT=24×18` 保 4:3 + `borderRadius:0.5`），点开 MUI `Menu` 两项（`settings.languageZhCN/En`，各「国旗 + 语言名」），当前项尾部一个 `primary.main` 小圆点。**选中态与触发国旗均按解析后 `locale` 判定（非 `preference`）**，故 `preference='auto'` 时也正确高亮/显旗；点选 `setLocale(value)` 写入显式偏好（`SupportedLocale`）并关闭。**header 不含 auto 项**——auto 保留在「设置>通用」。国旗是多色 SVG 离线注册（`icon-sets.ts` 的 `flagpack:*`，Windows Chrome 不把 emoji 国旗渲染成国旗，故必须 SVG）。`useTranslation()` 订阅使切换后 flag/aria-label/tooltip re-render。GitHub 按钮 `IconButton component="a"`（`mdi:github`）新标签打开 `REPO_URL`。i18n key `header.githubAria`/`header.languageAria`/`header.themeAria`
- `dashboard/nav.tsx` — NavDesktop（固定左侧栏，pinned=280px/unpinned=72px，md 断点(900px)显示）+ NavMobile（Drawer 抽屉，pathname 变化自动关闭，始终 pinned 模式）+ NavContent（顶层项：`item.children` 走 `CollectionsBranch`，否则走 `NavLeafButton`）。**一级嵌套**：`CollectionsBranch`（Collections 父项）pinned 时可折叠（chevron + MUI `Collapse`），`/collections*` 路由下 active 高亮 + 自动展开；unpinned(72px) 退化为纯图标 + Tooltip，点击 `navigate('/collections')` 不展开树。展开后子项经 `NavChildLeaf` 渲染为**缩进的叶子链接**（`component={RouterLink}` 指向 `child.path`，`pathname.startsWith(child.path)` 判 active，primary 高亮）。**鱼骨连接线**：每个叶子自己用 `::before`（竖脊段）+ `::after`（横肋 `FISHBONE_RIB=14px`）画出与父项的连接，最后一个叶子竖脊只到横肋中点收成 L 形拐角（避免竖线拖尾）；竖脊对齐父项图标竖轴（子容器 `ml: 3.5` = 父图标中心 28px），叶子按钮 `ml` 让高亮 pill 让开横肋区。目前唯一子项是 Bilibili Favorites（→ `/collections`），**不再往下展开收藏夹**——收藏夹列表回到 collections 页内层 `FolderSidebar`。nav 不消费收藏夹数据，无全局 provider
- `dashboard/content.tsx` — DashboardContent：Container maxWidth + dashboard padding CSS vars
- `nav-config.tsx` — 导航项：Dashboard/Collections/Settings，Iconify solar 图标。`NavItem` 支持可选 `children?: NavItem[]`（一级静态嵌套，为多平台预留）+ 可选 `icon?`（顶层项带图标，子项省略由 `NavChildLeaf` 渲染小圆点）。Collections 项挂一个静态子项 Bilibili Favorites（`path: '/collections'`，无 icon）

## 约定

- 侧边栏 Pin/Unpin: `sidebarPinnedStorage`（`lib/storage/ui-state.ts`），布尔值存储在 `local:sidebarPinned`（默认 true）。DashboardLayout 读取并通过 toggle 按钮切换。Pinned=280px 展开（图标+文字），Unpinned=72px 图标栏（MUI Tooltip 显示菜单名）。Mobile（md 以下，<900px）不受影响，始终 Drawer 模式
- nav 嵌套：主 sidebar 只做**一级嵌套**（Collections 父项 → Bilibili Favorites 叶子链接），止于平台名，不展开收藏夹。收藏夹数据仍由 collections 页本地 `useBiliFavFolders` 拥有（见 `sections/collections/CLAUDE.md`），nav 不读取，故无全局 `FavFoldersProvider`。未来新增平台：在 `nav-config.tsx` 的 Collections `children` 加叶子即可
