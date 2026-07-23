# Cross-platform Collections Section

`/collections` 全平台聚合页。默认显示 Bilibili/GitHub/浏览器书签/X/知乎/YouTube 的全部持久化条目，按 `lib/collections` 的平台原生时间全局降序；支持标题/作者搜索、平台单选 chips、全局分页和逐卡标签编辑。

## 模块结构

- `use-collections.ts` — 只读页面状态：300ms 搜索防抖、平台/搜索切换回第 1 页、cancelled guard、分页查询、手动/AI 标签变更刷新
- `collection-item-card.tsx` — `Record<CollectionPlatform, Tagged*Card>` 的穷尽 renderer registry，直接复用六个平台卡片 adapter
- `collections-view.tsx` — 组合共享 collection 哑组件与动态 `(platform, platformItemId)` `TagEditPopover`；不复用单平台 `CollectionPageScaffold`

## 约定

- 页面只读本地库，不提供 sync-all；同步、认证、转录、正文提取仍在各平台页
- 平台 labels/path/icon 来自 `app/collection-platform-registry.ts`，禁止另写平台列表
- mixed grid 的 tag editor 必须同时记录 platform 与 platformItemId，避免跨平台 id 碰撞
- 新平台接入 = `lib/collections/platforms.ts` 判别符 + app 元数据 + 本目录 card adapter；不得复制原平台卡片
