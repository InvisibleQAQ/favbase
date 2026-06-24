# 数据库导出功能规格

## 概述

在 app.html Dashboard 页面新增数据库导出功能，支持 JSON 和 CSV 两种格式，导出 PGlite 中的全部业务数据。

## 导出范围

全量导出以下 6 张表：

| 表 | 说明 | 关键列 |
|----|------|--------|
| `authors` | UP主/作者 | platform, platform_author_id, name, avatar_url |
| `sources` | 收藏夹/播放列表 | platform, platform_source_id, title, description |
| `items` | 核心条目（视频） | platform, platform_item_id, title, author_name, content_state |
| `item_sources` | 条目↔收藏夹关联 | item_id, source_id |
| `item_contents` | 字幕/转录全文 | item_id, plain_text |
| `item_chunks` | 文本分块+向量 | item_id, chunk_index, chunk_text, embedding(1536) |

## 技术方案

### 为什么不用 COPY TO

PGlite 支持 `COPY table TO '/dev/blob' WITH (FORMAT csv, HEADER)`，结果以 `Blob` 挂在查询结果上。但 app.html 通过 3-hop RPC proxy 访问数据库（app.html → Background SW → Offscreen），`Blob` 无法通过 Chrome Port 的 JSON 序列化层传输。

### 实际路径：SELECT + 应用层序列化

通过现有 RPC proxy 的 `getDb()` 执行 Drizzle 查询，在 app.html 侧将结果序列化为 JSON/CSV，触发浏览器下载。

```
app.html UI → getDb().query.*.findMany() → RPC proxy → Offscreen PGlite
                                                          ↓
                                              rows (JSON-safe 对象)
                                                          ↓
                                          app.html 侧序列化为 JSON/CSV
                                                          ↓
                                          Blob → URL.createObjectURL → <a>.click() 下载
```

### JSON 格式

单个 `.json` 文件，结构：

```json
{
  "exported_at": "2026-06-24T12:00:00Z",
  "version": 1,
  "tables": {
    "authors": [ { "id": "...", "platform": "bilibili", ... } ],
    "sources": [ ... ],
    "items": [ ... ],
    "item_sources": [ ... ],
    "item_contents": [ ... ],
    "item_chunks": [ ... ]
  }
}
```

- `item_chunks.embedding` 数组（1536 维浮点数）体积大，默认**排除** embedding 列，仅导出 chunk_text。用户可选"包含向量"。
- 日期字段序列化为 ISO 8601 字符串。

### CSV 格式

每张表一个 `.csv` 文件，打包为 `.zip` 下载。

- 文件名：`authors.csv`, `sources.csv`, `items.csv`, `item_sources.csv`, `item_contents.csv`, `item_chunks.csv`
- 首行为列名 header
- `item_contents.plain_text` 含换行符，需正确转义（双引号包裹）
- `item_chunks.embedding` 默认排除，同 JSON
- `platform_meta`（jsonb）序列化为 JSON 字符串写入单元格

### ZIP 打包

CSV 多文件场景需要 ZIP。使用 [fflate](https://github.com/101arrowz/fflate)（轻量、纯 JS、无 WASM 依赖、支持浏览器）或 [JSZip](https://stuk.github.io/jszip/)。

## UI 设计

Dashboard 页面（`sections/overview/overview-view.tsx`）新增导出区域：

- 位置：现有 StatWidget 行下方或 Quick Stats 卡片内
- 组件：一个 Card，标题"数据导出"
- 内容：
  - 格式选择：ToggleButtonGroup（JSON / CSV）
  - 可选项：Checkbox "包含向量嵌入"（默认不勾选）
  - 导出按钮：点击后执行查询 + 序列化 + 下载
  - 进度：导出期间按钮显示 CircularProgress，禁用重复点击

### 文件命名

- JSON：`favbase-export-2026-06-24.json`
- CSV：`favbase-export-2026-06-24.zip`

## 注意事项

- 数据量：MVP 阶段数据量小（百~千级视频），全量 SELECT 无性能问题。未来数据量增长后考虑分页流式导出
- embedding 向量：1536 维 × 每条 ~12KB JSON，千级 chunks 就是 ~12MB。默认排除，避免导出文件过大
- `jsonb` 字段（`platform_meta`）：JSON 导出保持原始对象，CSV 导出序列化为字符串
