# app/components/nav-section

Minimal `components/nav-section` 的移植：vertical + mini 两形态，不移植 horizontal。哑组件目录。

## 约束

- 零 `t()`、零 storage、零平台 registry、不读路由表。`title` / `caption` / `toggleLabel` 收到时已翻译，i18n seam 在 `layouts/dashboard/use-translated-nav.ts`；数据归 `layouts/nav-config.tsx`。
- `styles/css-vars.ts` 是 nav 行几何、激活态与连接线颜色的唯一 owner；`layouts/dashboard/css-vars.ts` 不放行级变量。
- 链接与 disclosure 同级（D15，`vertical/nav-item.tsx` 顶部注释）：有 `path` 就永远渲染 `<a>`，有子项时行尾另渲染一个 disclosure 按钮。Minimal 是整行点击 = 折叠，会吞掉 `/collections` 聚合页的链接，别改回去。mini 形态不适用：tile 是单个链接 + flyout。
- 激活态照 Minimal 两级分色（用户决定 2026-10-14，docs/31 Step 7）：root 整行 `primary.main` + 8% 主色洗底（hover 16%），唯一偏离是标题文字降一阶到 `primary.dark`（coral `main` 作文字只有 2.4:1），暗色两者都是 `primary.light`；sub 是 `text.primary` + 灰底，主题色只留在父级。别改回 `text.accent`，那是用户否掉的暗红褐。
- 暗色覆盖写在 `css-vars.ts` 里（`applyStyles('dark')` 改变量值），组件不各自判断 scheme。
- 平台身份色只上图标，激活时也保留（sub 激活是中性墨，没有主色要让位）；文字、背景、连接线一律不用平台色。
- 连接线颜色取 `palette.divider`，不抄 Minimal 写死的两个中性 hex：`divider` 会跟随 scheme 与高对比度选项。
- 展开状态不随路由收起：进入 `/collections/*` 自动展开，离开后保持（Minimal 一离开就折叠）。
- 分组 subheader 不可点击折叠：Minimal 的是没有键盘路径的 `div + onClick`，而且这里折叠分组没有产品价值。
- mini 形态键盘可达：hover 或 `ArrowRight` 开 flyout（后者把焦点移到首个子链接），`Escape` 关闭并把焦点还给 tile。Popover 带 `disableAutoFocus` / `disableEnforceFocus` / `disableRestoreFocus`，指针经过时不抢焦点。
- `isNavItemActive` 按段边界匹配，`/` 即使 `deepMatch` 也只精确匹配。`deepMatch` 默认「有子项才开」，平台叶在 `nav-config.tsx` 显式 `true`，详情子路由才会高亮平台叶。
- `navSectionClasses` 的 `state.active` / `open` / `disabled` 是结构测试与父层 `sx` 的公共 API，别改名。

## 指针

- 行为测试在 `layouts/dashboard/nav-vertical.test.tsx`；本目录只有 `nav-active` 与 `css-vars` 两个单测。
