# app/components/custom-breadcrumbs

页面标题 + 祖先路径 + 右侧动作（Minimal 移植）。`components/collection/section-title-bar.tsx` 在传了 `links` 时委托给本组件。

## 约束

- `BreadcrumbsHeading` 是页面唯一的 `h1`（标签与字号都是 h1）。Minimal 是 `h6` 标签套 `h4` 字号，别改回去。
- 末项默认渲染成 `aria-current="page"` 的非链接。
- 多一个 Minimal 没有的 `children` 槽（路径下方、标题列内）：标题块的状态 caption 必须和它描述的标题同列，`SectionTitleBar` 用它放 `data-slot="caption"`。
- 收藏路由的祖先由 `entrypoints/app/hooks/use-collection-breadcrumbs.ts` 派生，页面不手写 crumb。

## 坑

- crumb 的 `href` 写路由相对路径（`'/'`、`'/collections'`），不写 `'#/'`：链接是 `RouterLink`，hash 由 router 自己补，手写 `#` 会被当成路径段。
- `BackLink` 的 hover 规则选 `& svg`：`components/iconify/` 不导出类名常量，不要为一条 hover 规则去扩它。
