# app/sections

路由级业务 section 的归属目录。平台页只装配本平台数据、媒体、原生筛选维度、操作和文案；跨平台标题、搜索、状态、标签、卡片、网格、分页与 pipeline 视觉规则归 `components/collection/`。

- `configuration-heading.test.tsx` — GitHub/YouTube 配置门早退的跨平台回归：两页仍必须先渲染共享 `SectionTitleBar`，保持恰好一个 route `h1`，再显示平台配置 `StateBox`。

新跨平台视觉规则不得散落到多个 section；三处以上重复先回到共享 owner。
