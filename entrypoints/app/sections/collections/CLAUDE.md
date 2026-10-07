# Cross-platform Collections Section

`/collections` 全平台聚合页：只读本地库里各平台的持久化条目，按 `lib/collections` 的平台原生时间全局降序。

## 约束

- 页面只读：不提供 sync-all；同步、认证、转录、正文提取都留在各平台页。
- 刻意不走 `CollectionPageScaffold`（它带同步与 pipeline）：本页自己组合 `components/collection/` 的哑组件，加载态与空态也用共享骨架和 `StateBox`，不自画 Card。
- 面包屑是 `useCollectionBreadcrumbs(null)` 直接传给 `SectionTitleBar links`。末项是导航名「收藏夹」，与 h1「全部收藏」刻意不同字：一个是导航节点名，一个是页面名（用户决定）。
- 平台 label / path / icon 只来自 `entrypoints/app/collection-platform-registry.ts`，禁止另写平台列表。
- `collection-item-card.tsx` 的 `CARD_ADAPTERS` 是按 `CollectionPlatform` 穷尽的表，直接复用各平台自己的 tagged card，不得复制平台卡片；由 `tests/platform-completeness-contract.test.ts` 对账。接入新平台的完整清单见 `.trellis/spec/frontend/platform-onboarding.md`。
- mixed grid 的标签编辑必须同时记 `platform` 与 `platformItemId`：只记 id 会跨平台碰撞。
- 标签筛选固定单选。URL 的 `tag` 只接受一个当前已使用的 UUID；非法、重复、未知或失效的值用 `replace` 清掉并回退到未筛选查询。
- 改写 `tag` 时只动这一个参数，保留其他查询参数；先读 Used Tags 再校验 `tag`，Used Tags 的读取必须限定 `COLLECTION_PLATFORMS`。
- 平台、搜索、标签任一变化都回到第 1 页。
- chip 行标题图标只给 glyph 与尺寸，颜色归 `components/collection/` 的共享 chip 行外壳，本页不设。
