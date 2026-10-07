# app/sections

路由级业务 section 的归属目录，一个平台或一级页面一个子目录，各自有 `CLAUDE.md`。

- 平台页只装配本平台的数据、媒体、原生筛选维度、操作和文案；跨平台的标题、搜索、状态、标签、卡片、网格、分页与 pipeline 视觉规则归 `components/collection/`（需要 `t()` 的那一半在 `components/collection-states/`）。
- 新的跨平台视觉规则不得散落到多个 section：三处以上重复先回到共享 owner。
- 平台页的列表与 facet 只从 PGlite 读，走 `lib/<platform>` sync-service 导出的查询函数，不直读平台 API：`sections/**` 零 `drizzle-orm` import，view 与数据 hook 不 import 平台的 `*-api` 模块。
- 上一条的两个例外：bilibili 的夹列表与夹内浏览走远端 API（仍经 `bili-sync-service`，见 `bilibili/CLAUDE.md`）；设置页连接卡为测试凭据直接调 `github-api` / `youtube-api`。
- 链到设置页不手写 `/settings/...` 字符串：配置门与凭据被拒两态用 `NeedsConfigState settings="connections/<platform>"`，目标是 `settings/settings-nav.ts` 的 `SettingsLeaf`，由 `tsc` 校验。
- 配置门早退的分支也必须先渲染共享 `SectionTitleBar`（页面恰好一个 `h1`），再显示配置状态；「打开设置」落到该平台自己的 Connections 叶，不是 `/settings`。守卫：`configuration-heading.test.tsx`。
