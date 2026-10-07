# app/layouts

仪表盘 shell：Header、侧栏三形态（vertical / mini / mobile Drawer）、内容容器与 Header 右侧控件。侧栏本体是移植自 Minimal 的 `components/nav-section/`。

## Shell 几何

- shell CSS 变量只有一个 owner：`core/css-vars.ts`（Header、mobile drawer）与 `dashboard/css-vars.ts`（rail 宽度、content padding、transition）。页面只消费变量名，不复制数值。守卫：`dashboard/css-vars.test.ts`。
- nav 行几何（`--nav-item-*`）不在这里，归 `components/nav-section/styles/css-vars.ts`。
- 变量挂在 `:root` 而不是 `body`：`html` 的 `scroll-padding-top` 要读 Header 高度，焦点与锚点滚动才不会被 sticky Header 遮住。
- `--layout-nav-vertical-width` 是**当前**宽度（一个变量在 vertical / mini 两个值之间切换），不是 Minimal 的「两个常量选一个」；`NavToggleButton` 靠它定位。
- scroll owner 唯一：document 滚动页面，侧栏 `position: fixed` 自己滚，Header sticky，`<main>` 不滚。sidebar container 的 `minWidth: 0` 不能去掉：宽内容应当缩容器，而不是撑出水平滚动。

## 断点

- `DASHBOARD_LAYOUT_QUERY`（shell：rail ↔ 汉堡、Header 高度）与 `DASHBOARD_CONTENT_QUERY`（内容 gutter）今天都是 `lg`，但它们是两个概念（Minimal 里也是两个独立默认值），不要合并。
- 按 Header 高度算尺寸的页面（`sections/chat/chat-view.tsx`）必须 import `DASHBOARD_LAYOUT_QUERY`，不写断点字面量，否则与 Header 在不同宽度切换。
- `HeaderSection` / `LayoutSection` / `NavVertical` 三个原语自己的默认值是 `md`（welcome 的 layout 也用 `md`），不要改原语默认值；`DashboardLayout` 经 prop 传 `lg`。`dashboard/layout.test.tsx` 锁的是 `DashboardLayout` 的切换点（`lg`），原语的 `md` 没有守卫。

## 侧栏

- `NavToggleButton` 必须是 rail 的**兄弟节点**且排在 rail **之后**：rail 要保留 `overflow: hidden`（按钮做成子节点会被裁）；两者都是 `position: fixed` 且同 z-index，绘制顺序由 DOM 顺序决定，排在前面的按钮左半会被 rail 盖住。
- mini 形态的列用 `hideScrollY`，不能换成会裁剪的滚动容器：flyout 会被裁掉。
- `NavMobile` 的焦点契约（与 Chat history drawer 相同）：`disableRestoreFocus` + `onTransitionExited` 里先 blur 抽屉内焦点 + transition 的 `onExited` 把焦点交还触发按钮。绝不手动改 `aria-hidden`。
- i18n seam 在 `dashboard/use-translated-nav.ts`，所以 `components/nav-section/**` 一个 `t()` 都没有。它的 `useMemo` 依赖是 `locale` 而不是 `t`：`t` 读模块级消息表，引用不随语言变。
- `nav-config.tsx` 不导出静态或可变的 nav 单例；导航由 `createNavData(preferredPlatforms)` 在 app 启动时算一次，平台叶从 `collection-platform-registry.ts` 派生。
- Onboarding Platform Preference 只决定平台叶的先后（选中在前，各自保持 registry 顺序），禁止隐藏平台或重排 registry。
- nav 嵌套只做一级（Collections → 平台叶）：不展开收藏夹，收藏夹留在平台页内的过滤器。
- Platform Request 是动作不是平台：它是外链叶（`external: true`），不进 `collectionPlatformRegistry`。
- 侧栏 pin 状态存 `sidebarPinnedStorage`（`local:sidebarPinned`）：`pinned` = vertical，否则 mini；存储键与语义不能变。`lg` 以下始终是 Drawer，不受 pin 影响。

## Header 控件

- 配色模式只有 light / dark 两态、默认亮色，唯一控件是 Header 的 `components/theme-mode-button.tsx`（welcome 顶栏共用）。`system` 已不存在，外观抽屉没有 Mode 块，不要加回去。
- `SettingsButton` 的红点 = 外观抽屉里有非默认项（`canReset`），不含配色模式：模式不是抽屉选项，算进去红点会亮起却在抽屉里找不到对应项，「全部重置」还会顺手改掉配色。
- `components/index.ts` 是 barrel，但 welcome 必须按叶文件 import（`github-button` / `language-popover` / `theme-mode-button`）：barrel 会连带 `settings-button` → `components/settings` → storage，把 provider 层拖进 welcome 包。这三个叶因此不得 import `components/settings`。守卫：`tests/ui-vendor-boundaries.test.ts`。
- `ThemeModeButton` 的图标与 `aria-label` 表示的是**目标**模式，不是当前模式。
- 语言按钮的国旗必须是离线多色 SVG：Windows Chrome 不把 emoji 国旗渲染成国旗。Header 的语言菜单不含 auto 项（auto 留在设置页）。
- `BackgroundJobsIndicator` 与 `useJobsBadge()` 必须常驻 `DashboardLayout`（跨路由不卸载），否则切路由就丢掉未完成任务的提醒。
- Header 右侧控件的顺序由 `dashboard/layout.test.tsx` 锁住；窄屏靠容器的 `minWidth: 0` 让任务 chip 先收缩，不做窄屏特判。
- job 的平台名经 `backgroundJobPlatformLabel` 从两份 Platform Descriptor join 得到，不要加本地 label 表。

## 内容容器

- `DashboardContent` 的 `compactLayout` 语义是「on = 收窄到 `lg`，off = 用页面自己传的 `maxWidth`」，与 Minimal 的 `compact ? 'lg' : false` 不同：每个页面都显式传了 cap，照抄会推翻页面的决定。它经 leaf `SettingsContext` 可选读取，没有 provider 时视为 off。

## 拒绝清单

- Header 不加页面搜索、账号、workspace、通知中心；nav 不做 horizontal 模式、不加 upgrade 卡；app.html 不引入 `motion`。
