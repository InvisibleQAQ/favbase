# Cross-platform Collections Query

跨平台收藏只读查询层。消费统一 `items` 表，向 app.html 聚合页提供平台判别类型、全局排序、搜索、分页与当前页标签水合；UI 不接触 Drizzle schema。

## 模块结构

- `platforms.ts` — `COLLECTION_PLATFORMS` / `CollectionPlatform` / `isCollectionPlatform`，持久化平台判别符的唯一白名单
- `collections-query.ts` — `getCollectionItems`：限定平台注册项，标题/作者 ILIKE 搜索，全局分页；排序按平台现有时间语义（Bilibili `fav_time`、GitHub `starredAt`、YouTube `addedAt`，其余 `publishedAt`），无日期条目置后并以 `createdAt`/id 稳定排序；分页后批量加载 tags
- `collections-query.test.ts` — in-memory PGlite 守护混合排序、平台过滤、搜索转义、分页和标签水合
- `index.ts` — 公共导出面

## 约定

- 新平台必须先加入 `COLLECTION_PLATFORMS`，再补 app 侧元数据与卡片 adapter；未知 platform 不进入聚合结果
- 时间字段只在本 module 解释，禁止在 React 中抓多平台页面后客户端 merge/sort（会破坏全局分页）
- 查询参数始终绑定，LIKE 输入必须经 `escapeLike`；UI 通过 `getCollectionItems` 读取，零 entity/getDb 导入
