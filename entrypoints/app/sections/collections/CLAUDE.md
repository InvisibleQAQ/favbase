# Cross-platform Collections Section

`/collections` 全平台聚合页。默认显示 Bilibili/GitHub/浏览器书签/X/知乎/YouTube 的全部持久化条目，按 `lib/collections` 的平台原生时间全局降序；支持标题/作者搜索、平台单选、URL 单标签筛选、全局分页和逐卡标签编辑。

## 模块结构

- `use-collections.ts` — 只读页面状态：300ms 搜索防抖、平台/搜索/标签切换回第 1 页、cancelled guard、分页查询、手动/AI 标签变更刷新；先读取 Used Tags，再验证 Hash Router `tag` 参数
- `collection-tag-filter.ts` — 纯 URL 契约：只接受一个当前已使用的 UUID；替换/清除只修改 `tag`，保留其他查询参数
- `collection-item-card.tsx` — `Record<CollectionPlatform, Tagged*Card>` 的穷尽 renderer registry，直接复用六个平台卡片 adapter
- `collections-view.tsx` — 组合共享 collection 哑组件与动态 `(platform, platformItemId)` `TagEditPopover`；不复用单平台 `CollectionPageScaffold`

## 约定

- 页面只读本地库，不提供 sync-all；同步、认证、转录、正文提取仍在各平台页
- 平台 labels/path/icon 来自 `app/collection-platform-registry.ts`，禁止另写平台列表
- mixed grid 的 tag editor 必须同时记录 platform 与 platformItemId，避免跨平台 id 碰撞
- 聚合页标签筛选固定单选；Used Tags 读取必须限定 `COLLECTION_PLATFORMS`；非法、重复、未知平台、未知或失效 `tag` 用 replace 清理并回退未筛选查询，浏览器前进/后退由 `useSearchParams` 恢复
- 新平台接入 = `lib/collections/platforms.ts` 判别符 + app 元数据 + 本目录 card adapter；不得复制原平台卡片
