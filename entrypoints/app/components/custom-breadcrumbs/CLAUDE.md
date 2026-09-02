# app/components/custom-breadcrumbs

页面标题 + 祖先路径 + 右侧动作（Minimal `components/custom-breadcrumbs/` 移植，docs/25 Step 3）。

`components/collection/section-title-bar.tsx` 的 `SectionTitleBar` 在传了 `links` 时委托给本组件；不传 `links` 时保持原有的「h1 + caption」堆叠。六平台页当前都走后者，前者留给 Step 8。

## 模块结构

- `custom-breadcrumbs.tsx` — `CustomBreadcrumbs`：`heading` / `links` / `action` / `backHref` / `moreLinks` / `activeLast` + `slots.breadcrumbs` 整体替换 + `slotProps`（breadcrumbs/heading/content/container/moreLinks）。
- `styles.tsx` — 五个 styled 原语。`BreadcrumbsSeparator` 是 4px 圆点。
- `breadcrumb-link.tsx` — 单个 crumb。末项默认 `disabled`，渲染成 `aria-current="page"` 的非链接。
- `back-link.tsx` — `backHref` 时的标题形态：左侧回退箭头 + 标题文字，整体是链接。
- `more-links.tsx` — 路径下方的外链清单。

## 约定（对 Minimal 的偏离）

- **`BreadcrumbsHeading` 是 `h1` 标签 + `typography.h1`**。Minimal 是 `h6` 标签套 `h4` 字号；Favbase 一个页面只有一个 h1，就是它。
- **多一个 `children` 槽**，渲染在路径下方、标题列内。Minimal 没有——Favbase 的标题块带状态 caption（条目数 / 上次同步），必须和它描述的标题同列。`SectionTitleBar` 用它放 `data-slot="caption"`。
- **`BackLink` 的 hover 规则选 `& svg`**。Minimal 用 `iconifyClasses.root`，本仓库的 `components/iconify/` 不导出类名常量，不为一条 hover 规则去扩它。
- 链接走 `react-router-dom` 的 `Link`（hash router），crumb 的 `href` 直接传 `to`。

## 测试

`custom-breadcrumbs.test.tsx` — 单 h1、路径在 `nav` 内且末项 `aria-current="page"` 且非链接、`activeLast` 让末项变链接、`backHref` 把标题变回退链接、action 在 `nav` 之外。
