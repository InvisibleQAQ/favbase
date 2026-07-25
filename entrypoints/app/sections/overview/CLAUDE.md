# Collection Analytics Dashboard

默认 `#/` Dashboard 是只读收藏数据分析页，不是后台任务监控器。数据只来自持久化收藏表，禁止模拟指标、队列状态、任务进度或 pause/retry 控制。

## 模块结构

- `use-collection-analytics.ts` — 初始化 DB、取消保护、重试和 `'item-tagged'` 刷新；首个成功非空快照按 Item Count 选择最大平台，注册顺序打破平局，手动 Tab 选择后刷新不抢焦点
- `overview-view.tsx` — loading/error/empty/data 四态；摘要带、六平台构成、Top Tags 深链、横向滚动 Tabs 与单平台原生维度榜单
- `overview-view.test.tsx` / `use-collection-analytics.test.tsx` — 守护可访问状态、六 Tab、标签链接和选择稳定性
- `export-card.tsx` — 数据导出工具仍由设置页“存储管理”消费，不属于 Dashboard

## 约定

- React 只消费 `@/lib/collections` 的完整 analytics 快照，不导入 entity 或解释 `platform_meta`
- 平台标题、路由和图标来自 `collectionPlatformRegistry`；平台差异用 dimension kind 数据表达，UI 不写平台条件分支
- 页面使用 MUI 主题 token、精确 tabular numerals、稀疏分隔线和单层分区；禁止 KPI 卡片墙、嵌套 Card、渐变装饰和无意义动效
- Top Tag 链接固定为 `/collections?tag=<uuid>`；空数据库仍显示六个平台与真实零值
