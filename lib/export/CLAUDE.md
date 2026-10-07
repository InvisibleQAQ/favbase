# lib/export

两条互不相干的导出管线，只在 app.html 侧运行：数据库备份（JSON / CSV+ZIP 全表 dump）与 Obsidian vault（`obsidian/`，一个 item 一个 `.md`）。

## 约束

- 两条管线不共用 format 枚举、不共用 handler：数据形状、查询、可用选项都不同（`includeEmbedding` 对 Obsidian 没意义）。共用的只有 `download.ts` 与 fflate `zipSync`。
- 备份的表清单从 `lib/database/schema.ts` 派生（`EXPORT_TABLES`），schema 加表自动纳入；不要在本目录手写表名或列清单。守卫：`tests/export-schema-sync.test.ts`。
- lib 层零 `t()`：Obsidian 正文回链的 label 由 UI 传入 `originalLinkLabel`。
- 打包用主线程 `zipSync`，不上 Web Worker：MV3 扩展页 CSP 默认 `script-src 'self'`，fflate 的异步 API 依赖 blob: worker，会被拦。

## Obsidian vault 的不变量

- 是一次性导出、不是插件同步，所以幂等责任落在文件名与 frontmatter `id` 上。查询按 `(created_at, id)` 排序是去重后缀可复现的前提，别改排序。
- 一 item 一文件：属于多个收藏夹的 item 只产出一个 `.md`，目录归排序第一的收藏夹，其余写进 frontmatter `sources`。复制成多份在 Obsidian 里就是多条独立笔记（搜索双份命中、tag 计数翻倍、编辑不同步）。
- 收藏夹排序用码位序，不用 `localeCompare`：目录归属由该序第一个决定，locale 敏感排序会让导出结构随 UI 语言变。
- 没有 source 的 item 落 `_unsorted/`：不能假设每个 item 都有 link（`lib/ingest` 会丢 link）。
- 不按 platform 过滤，主查询 LEFT JOIN `item_contents`：静默丢行比多出一个意外目录更糟，没有正文的 item 也要导出。
- tags / sources 走独立侧表查询再装配，不做宽 join（会把 item 行乘以 tags×sources）；侧表查询不带 `WHERE item_id IN (...)`，避开 bind-param 上限。
- frontmatter 标量一律加双引号，只有两类裸写：日期（Obsidian 只把未加引号的 ISO 解析为日期）和已过白名单的 tag。不要加 per-field 例外。
- `aliases` 只在清洗真的改了标题时写；dedupe 后缀不算，否则 alias 会与同名兄弟笔记的文件名相撞。
- `platform_meta` 不进 frontmatter：各平台字段不统一，进了 schema 就散。代价是 Dataview 查不到播放量 / star 数。

## 坑

- `obsidian/sanitize.ts` 的禁用字符集与 tag 规则是 Obsidian 实测结论，不是防御性猜测；放宽会产出被静默忽略的文件或断掉的内部链接。
- 导出卡组件在 `entrypoints/app/sections/overview/export-card.tsx`，渲染位置却是设置页的存储 tab。
