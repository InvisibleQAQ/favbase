# 数据导出模块

PGlite 全量导出（JSON / CSV+ZIP），纯 app.html 侧运行。高内聚 4 模块 + 1 UI 组件。

表清单唯一真相源是 `lib/database/schema.ts`：`EXPORT_TABLES` 与 `TableData`（mapped type，key 取自 `Tables[K]['_']['name']`）均从 `typeof schema` 派生，schema 加表后导出自动纳入，本模块零改动。守卫测试 `tests/export-schema-sync.test.ts` 断言 CSV/JSON 输出与 schema 表集一致。

## 模块结构

- `query.ts` — `EXPORT_TABLES`/`TableData` 派生定义；`queryAllTables(db, includeEmbedding)` 并发查询全部表，Date→ISO 序列化，含 `embedding` 列的表可选剥离该列。`isTableDataEmpty()` 判空
- `serialize-json.ts` — `toExportJson(data)` 纯函数，输出 `{ exported_at, version:1, tables }` JSON string
- `serialize-csv.ts` — `toExportCsvZip(data)` 纯函数，RFC 4180 CSV + fflate ZIP 打包，返回 Uint8Array；空表兜底表头由 `getTableColumns()` 派生（无硬编码列清单）
- `download.ts` — `triggerDownload(blob, filename)` 浏览器下载 + `buildExportFilename(format)` 文件名生成
- 导出 UI 组件 `entrypoints/app/sections/overview/export-card.tsx` 消费本模块（渲染位置在 settings 页面"存储管理" tab）
