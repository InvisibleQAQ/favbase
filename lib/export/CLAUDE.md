# 数据导出模块

两条互不纠缠的导出管线，纯 app.html 侧运行：

1. **数据库备份**（JSON / CSV+ZIP）— 表 → 行的全表 dump，用于备份/迁移
2. **Obsidian vault**（`obsidian/`）— item → 一个 `.md` 文件的知识笔记导出

两者数据形状、查询方式、可用选项都不同（`includeEmbedding` 对 Obsidian 无意义），因此**不共用 format 枚举**：UI 在同一张卡内分两区，各自独立 handler。共用的只有 `download.ts` 与 `fflate zipSync`。

## 数据库备份

表清单唯一真相源是 `lib/database/schema.ts`：`EXPORT_TABLES` 与 `TableData`（mapped type，key 取自 `Tables[K]['_']['name']`）均从 `typeof schema` 派生，schema 加表后导出自动纳入，本模块零改动。守卫测试 `tests/export-schema-sync.test.ts` 断言 CSV/JSON 输出与 schema 表集一致。

- `query.ts` — `EXPORT_TABLES`/`TableData` 派生定义；`queryAllTables(db, includeEmbedding)` 并发查询全部表，Date→ISO 序列化，含 `embedding` 列的表可选剥离该列。`isTableDataEmpty()` 判空
- `serialize-json.ts` — `toExportJson(data)` 纯函数，输出 `{ exported_at, version:1, tables }` JSON string
- `serialize-csv.ts` — `toExportCsvZip(data)` 纯函数，RFC 4180 CSV + fflate ZIP 打包，返回 Uint8Array；空表兜底表头由 `getTableColumns()` 派生（无硬编码列清单）

## 共用

- `download.ts` — `triggerDownload(blob, filename)` 浏览器下载 + `buildExportFilename(kind)`。`ExportFileKind = 'json' | 'csv' | 'obsidian'`，文件名 stem/ext 由 `EXPORT_FILE_SPECS` 表驱动（无 format 条件分支）
- 导出 UI 组件 `entrypoints/app/sections/overview/export-card.tsx` 消费本模块（渲染位置在 settings 页面"存储管理" tab）。互斥忙态用 `busy: 'backup' | 'vault' | null` 单值表达——两个布尔可以同时为 true 是非法组合，不给它存在的机会

## Obsidian vault（`obsidian/`）

产出 `favbase/<平台 slug>/<收藏夹>/<标题>.md` 的 ZIP，解压即可作为 Obsidian vault 子目录。形态是**一次性导出而非插件同步**（扩展无长驻 server），所以幂等责任落在文件名与 frontmatter `id` 上。

- `query.ts` — `queryObsidianNotes(db) → ObsidianNote[]`。主查询 LEFT JOIN `item_contents`（无正文的 item 不能被丢），tags/sources 走独立侧表查询再用 Map 装配（镜像 `lib/collections/collections-query.ts`，避免一个宽 join 把 item 行乘以 tags×sources）。侧表查询**不带 `WHERE item_id IN (...)`**——全表导出本就要全部，同时绕开 bind-param 上限。排序 `(created_at, id)`，这是文件名去重后缀可复现的前提。**不按 platform 过滤**：静默丢行比出现意外目录名更糟
- `sanitize.ts` — 纯函数。`sanitizeFileName`（禁用字符集是 Obsidian 实测结论而非猜测：全平台 `[ ] # ^ |` + Windows `\ / : * ? < > "`，前导 `.` 会被当隐藏文件静默忽略，尾部 `.`/空格 Windows 拒收，截断 100 字符留足 UTF-8 与路径余量）、`sanitizeTag`（空格→`-`，白名单 charset，无字母者前缀 `_`——`#1984` 非法，返回 `null` 表示丢弃）、`quoteYamlScalar`（**无条件双引号**：判断"何时需要引号"是一堆特殊情况，无条件加是合法 YAML 且没有任何分支）、`dedupeFileName`（同目录冲突加 ` (2)`，key 小写因为解压目标文件系统大小写不敏感）
- `serialize.ts` — `toObsidianZip(notes, { originalLinkLabel })` 纯函数。frontmatter 引号规则只有一条判据：**bareness 是功能必需（日期——Obsidian 只把未引号 ISO 解析为日期）或由构造保证（tag 经白名单后不含任何 YAML 元字符）时才裸写，其余全部引号**，没有 per-field 例外清单。`sortedSources` 用码位序**不用 `localeCompare`**——目录归属由该序第一个决定，locale 敏感排序会让导出结构随 UI 语言变

### 管线持有的不变量

- **一 item 一文件**：属多个收藏夹的 item（zhihu/youtube 的多对多）只产出一个 `.md`，目录归排序第一的收藏夹，其余写进 frontmatter `sources`。复制成多份是数据完整性破洞——Obsidian 里两个同内容文件就是两条独立笔记，搜索双份命中、tag 计数翻倍、编辑不同步
- **无 source 兜底 `_unsorted/`**：不假设每个 item 必有 link（`lib/ingest` 的 `droppedLinkItemIds` 说明会被丢）
- **`aliases` 只在清洗真的改了标题时写**：dedupe 后缀不是清洗失败，给它加 alias 会与同名兄弟笔记的文件名撞车
- **i18n seam 在 UI 边界**：正文回链 label 由 UI 传入 `originalLinkLabel`，lib 层零 `t()`
- **主线程 `zipSync`**：与 CSV 导出同一模式。不上 Web Worker——MV3 扩展页 CSP 默认 `script-src 'self'`，fflate 异步 API 依赖 blob: worker 会被拦。大库卡顿另立任务，不在此过度设计
- **`platform_meta` 不进 frontmatter**：六平台字段不统一，进了 schema 就散。代价是 Dataview 查不到播放量/star 数
