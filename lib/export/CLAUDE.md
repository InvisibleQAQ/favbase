# 数据导出模块

PGlite 全量导出（JSON / CSV+ZIP），纯 app.html 侧运行。高内聚 4 模块 + 1 UI 组件。

## 模块结构

- `query.ts` — `queryAllTables(db, includeEmbedding)` 并发查询 6 张表，Date→ISO 序列化，可选剥离 embedding 列。`isTableDataEmpty()` 判空
- `serialize-json.ts` — `toExportJson(data)` 纯函数，输出 `{ exported_at, version:1, tables }` JSON string
- `serialize-csv.ts` — `toExportCsvZip(data)` 纯函数，RFC 4180 CSV + fflate ZIP 打包，返回 Uint8Array
- `download.ts` — `triggerDownload(blob, filename)` 浏览器下载 + `buildExportFilename(format)` 文件名生成
- 导出 UI 组件 `entrypoints/app/sections/overview/export-card.tsx` 消费本模块（渲染位置在 settings 页面"存储管理" tab）
