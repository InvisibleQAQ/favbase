# app/components/empty-content

空态/错误态/无匹配态的共享外壳（Minimal `components/empty-content/` 移植，docs/25 Step 3）。

`components/collection/state-box.tsx` 的 `StateBox` 是本组件的薄适配层——页面不直接用 `EmptyContent`，用 `StateBox`（它持有 `data-state-box`、`minHeight`、纵向留白）。

## 模块结构

- `empty-content.tsx` — `EmptyContent`：`icon` / `imgUrl` / `title` / `description` / `action` / `filled` + `slotProps`（img/title/description）。`filled` 时是 tinted 底 + 1px dashed 边 + `shape.borderRadius × 2` 圆角。

## 约定（三处对 Minimal 的偏离，都有理由）

- **无默认插图、无默认标题**。Minimal 回落到打包的 SVG 和字面量 "No data"；本仓库既没有那份资产目录，也没有通用空态 i18n key（`lib/i18n/locales/zh-CN.ts` 只有平台专用的 `dashboard.platformEmpty`）。调用方一律自带文案，`NoMatchesState` 更是依赖「盒子里只有调用方那句话」。新增默认文案前先想清楚它归哪个 key。
- **`icon` 插图槽优先于 `imgUrl`**。承接 `StateBox` 既有的 48px Iconify 字形；`imgUrl` 保留但无默认值。
- **文案落 `text.secondary`，标题是 `subtitle1` 的 `<p>`**。Minimal 用 `h6` + `text.disabled`：前者会给页面加第二个 heading，后者对比度不过线。

所有槽都是根的**直接子元素**（不包 wrapper），调用方可以直接断言视觉顺序——`state-box.test.tsx` 就是这么锁的。

## 测试

`empty-content.test.tsx` — 默认零内容零插图、标题是 `<p>` 且页面无 heading、`filled` 才有 dashed 边、四槽顺序、icon 优先于 imgUrl。
