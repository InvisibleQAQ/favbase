# app/layouts

仪表盘布局系统。docs/25 Step 4（2026-09-02）把侧栏换成移植后的 Minimal `nav-section`（vertical / mini / mobile 三形态）、把 Header 右侧换成四控件、把主题控制搬进外观抽屉；2026-09-05 把其中的 light/dark 二态又收回 Header（`theme-mode-button.tsx`，第五个控件）；2026-09-06 `system` 整个从产品移除，抽屉的 Mode 块随之删除，那个按钮成为唯一模式入口。

## Shell 几何契约

CSS 变量是 shell 的唯一 owner，页面只消费变量名，不复制数值：

| 变量 | 值 | owner |
| --- | --- | --- |
| `--layout-header-mobile-height` / `-desktop-height` | 64px / 72px（`layoutQuery`=md 切换） | `core/css-vars.ts` |
| `--layout-header-blur` | 8px，仅滚动后启用 | `core/css-vars.ts` |
| `--layout-nav-mobile-width` | 288px | `core/css-vars.ts` |
| `--layout-nav-vertical-width` | 300px vertical / 88px mini（`NAV_VERTICAL_WIDTH`） | `dashboard/css-vars.ts` |
| `--layout-dashboard-content-pt` / `-pb` / `-px` | 1 / 8 / 5 spacing 单位（8/64/40px） | `dashboard/css-vars.ts` |
| `--layout-transition-easing` / `-duration` | linear / 120ms | `dashboard/css-vars.ts` |

- **nav 行几何不在这里**：`--nav-item-*`（root 44 / sub 36 / mini root 56 等）归 `components/nav-section/styles/css-vars.ts`。`--layout-nav-item-height` / `-child-item-height` / `-compact-item-size` 三个旧变量已删除，`dashboard/css-vars.test.ts` 反向断言它们不复活。
- `--layout-nav-vertical-width` 是**当前**宽度（单变量在 300/88 间切换），不是 Minimal 那种「两个常量 + 选一个」。`sections/chat/chat-view.tsx` 与 `NavToggleButton` 都靠它定位，语义属契约。
- 变量挂在 `:root`（非 `body`），因此 `html { scroll-padding-top: var(--layout-header-*-height) }` 能读到 Header 高度：焦点/锚点滚动不会被 sticky Header 遮挡。
- Scroll owner 唯一：document 滚动页面；侧栏 `position: fixed` 自己滚（vertical 用 `Scrollbar`，mini 用 `hideScrollY` 列）；Header `position: sticky`；`<main>` 只是流式布局。`LayoutSidebarContainer` 设 `minWidth: 0`，宽内容缩容器而不是撑出水平滚动。
- Content gutter：`DASHBOARD_CONTENT_QUERY`（`lg`）起 40px；以下走 MUI Container 默认 24px（sm+）/16px（xs）。Header 容器经 `slotProps.container` 在同一断点用同一变量。

## 模块结构

### core（骨架，未变）

- `core/layout-section.tsx` — sidebar + sidebarContainer(header+main+footer)，经 GlobalStyles 把 CSS vars 注入 `:root` 并设 `html` scroll-padding
- `core/header-section.tsx` — 粘性 AppBar，静止透明；滚动后 `::before` 淡入 8px blur + 80% ground wash + `divider` hairline。slots: leftArea/rightArea/centerArea
- `core/main-section.tsx` — flex column 主内容区
- `core/css-vars.ts` — header/mobile drawer 变量（见上表）
- `core/classes.ts` — `layoutClasses`，Step 4 新增 `nav.root` / `nav.vertical`（rail 与 mobile Drawer paper 共用，镜像 Minimal）

### dashboard

- `dashboard/css-vars.ts` — rail 宽度 + content padding + transition；`NAV_VERTICAL_WIDTH = { vertical: '300px', mini: '88px' }`
- `dashboard/content.tsx` — DashboardContent：Container maxWidth + padding 变量；导出 `DASHBOARD_CONTENT_QUERY`。**Step 4 起消费 `compactLayout`**：经 leaf `SettingsContext` 可选读取（无 provider 时视为 off），on 时把内容列收窄到 `lg`，off 时用调用方自己传的 cap。Minimal 是 `compact ? 'lg' : false`，但本仓库每个页面都显式传了 `maxWidth`（多为 `xl`），照抄既会推翻页面的决定、又因为是默认参数值而永不生效
- `dashboard/layout.tsx` — DashboardLayout：必填 `navigation: NavGroup[]`（app composition root 解析好的不可变导航），经 `useTranslatedNav` 翻一次后同一份数据给 `NavVertical` + `NavMobile`；读 `sidebarPinnedStorage` 得 `pinned`，`isNavMini = !pinned`。Header 左侧**只有移动端汉堡**（`header.menuAria` + Tooltip，其 ref 作为 `NavMobile.onExited` 的焦点归位目标）——桌面 toggle 已搬到 rail 边缘。Header `rightArea` = `BackgroundJobsIndicator` → `ThemeModeButton` → `LanguagePopover` → `SettingsButton` → `GithubButton`（一个 `minWidth: 0` 的 flex Box，390px 下 chip 先收缩；不做窄屏特判）。**常驻挂载 `useJobsBadge()`**。`layout.test.tsx` 锁：toggle 的 aria 翻转 + storage 写入 + toggle 不在 header 内、五控件顺序（header 内的 DOM 序，jobs 指示器由 stub 渲染成 `data-testid` 标记参与断言——它是 Chip，只扫 `MuiIconButton-root` 会漏；light 下主题按钮是 `header.themeToDark`）、移动 Drawer 路由关闭 + 焦点回菜单按钮
- `dashboard/use-translated-nav.ts` — **i18n seam**：`NavGroup[]`（locale key）→ `NavSectionData[]`（显示串），`useMemo` 依赖 `[data, locale]`（`t` 读模块级消息表，所以依赖是 locale）。顺手合成 disclosure 的 `toggleLabel`（`nav.toggleSubmenuAria`）。因此 `components/nav-section/**` 一个 `t()` 都没有
- `dashboard/nav-vertical.tsx` — 桌面 rail：`position: fixed` + `overflow: hidden` + 宽度变量 + 120ms width transition；顶部品牌行（`/icon/128.png` 36px，vertical 时 `pl: 2.75` 让 logo 中心落在行图标竖轴 40px 上，mini 时居中且不出 wordmark）；`isNavMini` 决定 `NavSectionMini`（`hideScrollY`，flyout 不能被裁）还是 `Scrollbar fillContent` 包 `NavSectionVertical`（`px: 2`）。`NavToggleButton` 是它的**兄弟节点**而非子节点：rail 保留 `overflow: hidden`（88→300 展开时不闪出内容），子节点会被裁掉
- `dashboard/nav-mobile.tsx` — `layoutQuery` 以下的 temporary Drawer，始终 vertical 形态。**焦点契约与 Chat history drawer 相同且未变**：`disableRestoreFocus` + `ModalProps.onTransitionExited` 先 blur 抽屉内焦点 + `slotProps.transition.onExited` 把焦点交还触发按钮——绝不手动改 `aria-hidden`
- `dashboard/background-jobs-indicator.tsx` — 全局未完成任务提醒（未变）：running/pausing/paused 都留在 Header，全部 paused 显示 Pause 图标否则 spinner；Chip label 只给任务数，Tooltip 逐条列平台/类型/进度。**常驻 Header 跨路由不卸载**是关键
- `nav-config.tsx` — `createNavData(preferredPlatforms)` 返回 **`NavGroup[]`**（docs/25 D16 两组）：`nav.groupCollections` 组 = Collections 父项（六平台叶 + Platform Request 外链），`nav.groupGeneral` 组 = Analytics（`/`）、Chat、Settings。平台叶从 `collection-platform-registry.ts` 稳定分区（选中在前、未选在后，各自保持 registry 顺序、每个平台恰好一次），带 `platform`（图标身份色）与 `deepMatch: true`（详情路由归属）。Platform Request 是**动作不是平台**：`external: true` + `caption: 'nav.externalCaption'` + `info` 槽放外链箭头，`path` 是 `lib/repo.ts` 的预填 new-issue URL，active 匹配对 https 永不命中。模块不导出可变/静态 nav 单例
- **nav active 判定**已随 nav 移到 `components/nav-section/nav-active.ts`（`isNavItemActive`）；`layouts/nav-active.ts` 与其测试删除

### components（Header / rail 控件）

- `components/nav-toggle-button.tsx` — 悬在 rail 右缘的收展按钮：`position: fixed`、`left: var(--layout-nav-vertical-width)`、`translate(-50%,-50%)`、`top: calc(header-desktop-height / 2)`，`left` 用与 rail 同一组 easing/duration；`eva:arrow-ios-back-fill` ↔ `forward-fill`；`aria-label` = `nav.collapseAria`/`nav.expandAria` + `aria-expanded={!isNavMini}` + Tooltip。`display: none`，`layoutQuery` 以上才 `inline-flex`
- `components/language-popover.tsx` — 语言切换（原 `header-actions.tsx` 的语言部分，MUI `Menu` 换成 Step 3 的 `CustomPopover`）。触发按钮显示**解析后 locale** 的国旗（`flagpack:cn`/`flagpack:gb`，24×18 保 4:3），弹出两项「国旗 + 语言名」，当前项 `Mui-selected`（去掉了原先额外的 `primary.main` 小圆点，选中态交给 `menuItemStyles`）。header 不含 auto 项——auto 留在「设置 > 通用」。国旗必须是离线多色 SVG（Windows Chrome 不把 emoji 国旗渲染成国旗）
- `components/settings-button.tsx` — 打开外观抽屉（`solar:settings-bold-duotone` + `header.settingsAria`）；`Badge` dot 由 `useSettingsContext().canReset` 驱动 = 「抽屉里有任何一项不是默认」。**不含配色模式**——它不是抽屉选项（2026-09-06 起 `useSettingsReset` 已删；留着折叠会让红点亮起却在抽屉里找不到对应项，且「全部重置」会顺手改掉配色）。不移植 Minimal 的 framer-motion 旋转
- `components/github-button.tsx` — 仓库外链（`mdi:github` + `header.githubAria`），app Header 与 welcome 顶栏共用
- `components/theme-mode-button.tsx` — light↔dark 一键切换（2026-09-05；原 welcome 私有的 `styled(Switch)` 旋钮已删）。图标显示**目标模式**（亮色 → `custom:moon-color`，暗色 → `custom:sun-color`，配色论证见 `components/iconify/icon-sets.ts` 那两个图标上方的注释），Tooltip 与 `aria-label` 同一条动态文案（`header.themeToDark`/`header.themeToLight`），点击走 `theme/mode-transition.ts` 的圆形揭示。解析值：`mode` 是 `light`/`dark` 就用它，否则回退读 `<html data-color-scheme>`（覆盖 mount 前的 `undefined`，也吸收残留的 `system`——`public/theme-init.js` 已把存值归一化）。与 `github-button`/`language-popover` 同为 **leaf**：只依赖 react / MUI / `theme/mode-transition` / `components/iconify` / `lib/i18n`，零 `components/settings`（`lib/i18n` 自带 `localeStorage`，那是三个叶共同的底座，不是本条要挡的东西）。`theme-mode-button.test.tsx` 锁两态图标 + 标签、无存值时默认亮色、二次点击回摆
- `components/index.ts` 是 barrel，但**welcome 必须按叶文件 import**（`github-button` / `language-popover` / `theme-mode-button`）：barrel 会连带 `settings-button` → `components/settings` → storage，把 provider 层拖进 welcome 包。**不再只是约定，有守卫**：`tests/ui-vendor-boundaries.test.ts` 的 `IMPORT_BOUNDARY_RULES` 禁 welcome 碰 barrel 与 `components/settings`，并反向断言 welcome 确实还按叶消费着控件

## 约定

- 侧边栏 Pin/Unpin: `sidebarPinnedStorage`（`lib/storage/ui-state.ts`，`local:sidebarPinned`，默认 true）。`pinned` → vertical 300px（图标+文字+分组 subheader），`!pinned` → mini 88px（图标 tile + hover/ArrowRight flyout）。Mobile（md 以下）不受影响，始终 Drawer。**存储键与语义不变**，只是 UI 词表由 compact 改叫 mini
- 配色模式只有 light/dark 两态，默认亮色，**唯一控件是 Header 的 `components/theme-mode-button.tsx`**（用户 2026-09-06 决定，推翻 2026-09-05 的「二态在 Header / `system` 在抽屉」拆分）。`system` 不再是可选值：抽屉的 Mode 块已删，`ColorModeValue` 缩成二态，`public/theme-init.js` 把存值里非 `light`/`dark` 的一切（含老用户的 `system`）归一化成 `light` 并写回——不写回，MUI 会从 storage 读到 `system` 并绕过 `defaultMode`。View Transition 圆形揭示逻辑在 `theme/mode-transition.ts`，Header 按钮与 welcome 顶栏共用（自此只剩这一个调用方）
- 拒绝清单（docs/23 §11 仍生效的部分）：Header 不加页面搜索、账号、workspace、通知中心；nav 不做 horizontal 模式、不加 upgrade 卡；app.html 不引入 `motion`
- nav 嵌套只做**一级**（Collections 父项 → 平台叶），止于平台名，不展开收藏夹；收藏夹列表留在平台页内的过滤器。`Onboarding Platform Preference` 只决定叶子优先级，禁止隐藏平台或反向重排 registry
