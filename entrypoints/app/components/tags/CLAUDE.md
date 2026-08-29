# app/components/tags

平台无关的标签 UI 子系统（app.html 内共享，同层先例 `components/iconify/`）。platform 全部为**参数**，本目录零平台字面量、零 `@/lib/bilibili`/`@/lib/github` 导入——平台知识归各 section 的卡片 adapter（`sections/bilibili/tagged-video-card.tsx`、`sections/github-stars/tagged-repo-card.tsx`）。数据一律经 `@/lib/tagging`（(platform, platformItemId) 寻址，零 drizzle/entity/getDb 导入）。

## 模块结构

- `use-item-tags.ts` — 数据 hooks：`useItemTags(platform, ids)`（批量 `getTagsForPlatformItems` → `Record<id, TagRef[]>`，ids 变化（翻页/换夹）自动重载，`refresh()` 供手动编辑后刷新；只有有标签的 id 出现在 record，调用方 `tagsById[id] ?? []`）+ `useUsedTags(platform?)`（`getAllUsedTags(platform)` 供筛选 chips；传 platform 时列表与计数限定该平台）。两 hook 均订阅 `'item-tagged'` 领域事件（`lib/events`，AI 打标落库实时刷新）：`useItemTags` 按 `e.platform === platform` **且**命中当前页 id（**小写比较**——bvid 大小写混用遗留防护，github 数字 id 不受影响）才重载；`useUsedTags` 传了 platform 则按 `e.platform` 过滤，未传无条件重载。均先 `await initDbProxy()` 防首屏 DB 未初始化竞态 + cancelled flag 防卸载后 setState
- `use-tag-filter.ts` — `useTagFilter(usedTags)`：选中标签筛选状态（`selectedTagIds`/`toggleTag`/`clearTags`）+ **孤儿剪枝**——选中 tag 从 usedTags 消失（最后一条链接被删）即移出选择，否则唯一已用标签删光时 TagFilterChips 整体消失、无"清除"按钮，用户困死在空网格
- `use-collection-tags.ts` — `useCollectionTags(platform, itemIds)`：把收藏页标签五件套（`useItemTags` + `useTagEditState` + `useUsedTags` + `useTagFilter` + `handleTagsChanged`）打成一个组合 hook，返回 `{ tagsById, editing, openTagEditor, closeTagEditor, usedTags, selectedTagIds, toggleTag, clearTags, handleTagsChanged }`。**`handleTagsChanged` 不变量封死在此**——同刷 itemTags + usedTags，因为 `useItemTags` 在 view 顶层常驻、筛选激活时不卸载，tagged grid 里的编辑必须同时刷新 `tagsById` 否则清除筛选后普通网格标签过期。github/x/zhihu 三 view 各传 `(platform, pageItemIds)`，无五件套复制、无手工接线出错空间
- `tag-row.tsx` — `TagRow { tags, onEditTags? }`：卡片内标签 chip 行（小号 outlined Chip + 行尾 `mdi:tag` IconButton 编辑入口，`tags.editTooltip` 兼 `aria-label`），布局用共享 `CollectionCardRow`（`components/collection/`）——内边距归卡片外壳，本文件零 `px/pb`。空 tags 且无 onEditTags 时返回 null。**无标签但可编辑时不画空行**：编辑按钮绝对定位到卡片右上角（依赖 `MuiCard` 的 `position: relative`），仅在 `.MuiCard-root:hover` / `:focus-within` 时显现（`background.paper` 底 + `z1` 阴影，因为 hover 中的卡片本身已是 neutral 洗色），手动打标路径保留、闲置卡片不再每张带灰标签图标（docs/19 P0-2）。**必须渲染在 CardActionArea 之外**防误触卡片跳转
- `tag-edit-popover.tsx` — `TagEditPopover`（props 含 `platform`）+ `useTagEditState()`（记录 `{ platformItemId, anchorEl }`，每个网格单实例）。内容：当前标签 Chip（onDelete 解链）+ TextField（Enter 提交，IME composing 守卫，空白忽略），直接调 `addTagToPlatformItem`/`removeTagFromPlatformItem`（handler 内先 `await initDbProxy()` 防首屏点击竞态），busy 禁用，成功回调 `onChanged()`
- `tag-filter-chips.tsx` — `TagFilterChips`：纯 props 筛选器，消费共享 `CollapsibleChipRow`（默认前 8 个，支持多选且收起时保留所有已选隐藏项）+ `headerExtra` 清除按钮；tag header icon 不自带品牌色，继承共享 `ChipRowShell` 的 `text.secondary`。**无已用标签时整体不渲染**（孤儿标签经 getAllUsedTags 天然隐身）
- `tagged-item-grid.tsx` — `TaggedItemGrid { platform, tagIds, renderCard, skeleton, onTagsChanged? }`：标签筛选激活时的网格。`getItemsByTags(tagIds, platform)`（AND 语义、createdAt 降序、平台限定）加载 `TaggedItem`；**render-prop seam**：`renderCard(item, openTagEditor)` 由各 section 提供本平台卡片 adapter，本组件不知道卡片长什么样。内置单 `TagEditPopover` 实例（platform 透传）；编辑后重查本 grid——item 掉出筛选自然消失，此时 effect 自动关 popover 防 detached anchorEl——并上抛 `onTagsChanged`。订阅 `'item-tagged'`（按 `e.platform` 过滤）重查。骨架屏（`skeleton` prop）只在 tagIds 组合变化时重置；version 重查（编辑/事件）原位更新不闪骨架。空结果 `tags.noMatches` 走共享 `NoMatchesState`（与搜索/分类无匹配同一密度，`text.secondary` 非 disabled）；网格用共享 `CardGrid`/`CardGridItem`（`components/collection/`）
- `index.ts` — barrel，section 消费者单一 import 面

## 约定

- **平台无关铁律**：本目录禁止出现平台字面量与平台 lib 导入（prd 验收项，grep 可查）。平台 N 接入打标 = 传 platform 参数 + 提供 renderCard adapter，零标签逻辑复制
- **render-prop + 聚合 registry 分工**：平台页筛选仍用 `TaggedItemGrid.renderCard`；真实跨平台需求已在 `sections/collections/collection-item-card.tsx` 建穷尽 platform→TaggedCard registry，本共享目录仍保持零平台知识
- **刷新双通道**：AI 自动打标走 `'item-tagged'` 事件（emit 在 tagging-service，零穿线）；手动编辑走显式 `onChanged → refresh` 链路（add/remove 不发事件）。消费 section 若 `useItemTags` 常驻不随筛选卸载（如 github-stars-view），TaggedItemGrid 的 `onTagsChanged` 必须同时 refreshItemTags——否则清除筛选后普通网格标签过期。**收藏页（github/x/zhihu）用 `useCollectionTags` 后此不变量已封在 hook 内**（`handleTagsChanged` 同刷两通道），无需各 view 自行记得；仅当直接手拼五件套（如未来非收藏页场景）时才需注意
- i18n：复用 `tags.*` key（sectionTitle/editTooltip/addPlaceholder/clearFilter/noMatches，zh/en 齐全），组件内 `useTranslation()` 订阅
