# app/components/nav-section

Minimal Dashboard `components/nav-section` 的移植（docs/25 Step 4，2026-09-02）：**vertical + mini 两形态**，不移植 horizontal。取代原 `layouts/dashboard/nav.tsx`（560 行自研树）。

**哑组件目录**：零 `t()`、零 storage、零平台 registry。收到的 `title`/`caption`/`toggleLabel` 都是**已翻译的字符串**——i18n seam 在 `layouts/dashboard/use-translated-nav.ts`。

## 模块结构

- `types.ts` — `NavItemDataProps`（`path/title/icon/info/caption/toggleLabel/platform/external/deepMatch/children/disabled`）、`NavSectionData`（`subheader` + `items`）、slot props。相比 Minimal 去掉 `render.navIcon/navInfo` 间接层（`nav-config.tsx` 直接给元素）与 `allowedRoles/checkPermissions`（无角色系统）
- `nav-active.ts` — `isNavItemActive(pathname, path, deepMatch?)` 纯函数：段边界匹配（`===` 或 `${path}/` 前缀）、外链与 `#` 恒 false、`/` 即使 `deepMatch` 也只精确匹配。**取代** `layouts/nav-active.ts` 的 `findActiveChildPath`（兄弟集合 + 最长者胜）：移植后每行自己判定，而叶路径互不为前缀时最长者胜没有消费者。`deepMatch` 默认 `!!children`，平台叶在 `nav-config.tsx` 显式 `true`（`/collections/bilibili/:mediaId` 仍高亮 bilibili 叶）
- `nav-link-props.ts` — `navLinkProps({path, external})` → RouterLink `to` 或 `<a target="_blank">`。Minimal 的 `createNavItem` 在有 children 时返回 `component: 'div'`（整行=折叠按钮），Favbase 永不这样（见 D15）
- `styles/css-vars.ts` — `navSectionCssVars.vertical/mini`。**本文件是 nav 行几何与连接线颜色的唯一 owner**（vertical root 44 / sub 36 / icon 24；mini root 56 / sub 34 / icon 22），`layouts/dashboard/css-vars.ts` 不再有 `--layout-nav-*item*`
- `styles/classes.ts` — `navSectionClasses`（`favbase__nav__*`，经 `theme/create-classes.ts`）；`state.active/open/disabled` 是结构测试与父层 `sx` 的公共 API
- `styles/nav-item-styles.tsx` — 跨形态共享的 slot 几何（icon/texts/title/caption/info/arrow/disabled）
- `components/nav-elements.tsx` — `Nav`/`NavLi`/`NavUl` 裸元素（`global.css` 已 reset `ul`）
- `components/nav-subheader.tsx` — 分组标签。**去掉 Minimal 的点击折叠**：Favbase 两组分别 1 项与 3 项，折叠没有产品价值，而 Minimal 那个 `div + onClick` 无键盘可达性；这里只保留 overline/11px/`text.disabled` 的外观
- `components/nav-collapse.tsx` — 子列表容器 + **连接线竖脊**（2px，`bottom` 收在末项 bullet 前半个 bullet，于是最后一行的 bullet 自然收成 L 角）。颜色走 `--nav-bullet-color` = `palette.divider`：Minimal 在这里写死 `#EDEFF2`/`#282F37`，而 `divider`（grey-500 @ 20%）与两者相差不到一个色阶，是设计系统给连接线保留的语义角色（`ui-design-system.md` §8），且会跟随 scheme 与高对比度选项——写死的两个中性色不会
- `components/nav-dropdown.tsx` — mini 悬浮层（透明 Popover paper + `NavDropdownPaper` 承 `paperStyles(dropdown)`）
- `vertical/` — `nav-section-vertical.tsx`（分组 → `NavUl`/`NavLi`/`NavSubheader`）、`nav-list.tsx`（open 状态 + `NavCollapse`）、`nav-item.tsx`（行）
- `mini/` — `nav-section-mini.tsx`（无 subheader）、`nav-list.tsx`（hover/键盘开合 + dropdown）、`nav-item.tsx`（图标在上、10px 标题在下的 tile）

## 契约

- **D15 链接与 disclosure 同级**（`vertical/nav-item.tsx` 顶部注释）：有 `path` 就永远渲染 `<a>`；`hasChild` 时行尾**另**渲染一个 `ItemDisclosure` 按钮（`aria-expanded` + `aria-controls` + `aria-label`=`toggleLabel`）。因此 `ItemRoot` 是 styled `div`（画状态色/圆角/行高/bullet），padding 归 `ItemLink`——叶子与分支同一条代码路径，区别只是有没有那颗按钮。Minimal 的 `ItemRoot` 是唯一 ButtonBase，整行点击=折叠，与 `/collections` 聚合页冲突
- **激活态一视同仁**（`styles/css-vars.ts`）：root 与 sub 都是 `text.accent` 文字 + `varAlpha(primary.mainChannel, 0.08)` 洗底，hover 加深到 0.16。偏离 Minimal（root `primary.main`、sub 灰 `action.selected`）与 docs/25 Step 4 第 4 点的两级分色：手册第 4 点与其测试重写第 7 条（"激活行 color 解析为 text.accent"）互相矛盾，取可观测的那条；`primary.main` 对纸面 2.5:1，不做文字色
- **平台身份色只上图标**：`ItemIcon` 在 `platform && !active` 时取 `theme.vars.palette.platform[platform]`，active 时继承行的 accent 墨色。文字/背景/连接线一律不用平台色
- **mini 键盘可达**：tile 是链接 + `aria-haspopup`/`aria-expanded`；hover 或 `ArrowRight` 开 dropdown（`ArrowRight` 额外把焦点移到首个子链接），`Escape` 关闭并把焦点还给 tile。Popover 带 `disableAutoFocus/disableEnforceFocus/disableRestoreFocus`——Minimal 是纯 hover 且会在指针经过时抢焦点
- **展开状态不随路由收起**：进入 `/collections/*` 自动展开，离开后保持用户/路由打开的树（Minimal 一离开就折叠）
- 组件不读路由表也不读平台 registry；`nav-config.tsx` 负责数据，`layouts/dashboard/` 负责壳与翻译

## 测试

- `nav-active.test.ts`（8 例）— 精确/深匹配/无深匹配/兄弟互斥/段边界/根路由/外链/尾斜杠
- `css-vars.test.ts`（3 例）— 44/36/56 与 24/22 图标尺寸、两级共用的 accent + 8%/16% 洗底、连接线用 `divider` 且 bullet 变量只给 vertical
- 行为测试在 `layouts/dashboard/nav-vertical.test.tsx`（8 例，含 subheader 顺序、disclosure、平台色、外链 caption、active class + accent、mini `ArrowRight` 开 dropdown 并移焦）
