# app/components/tags

平台无关的标签 UI 子系统：数据 hooks、编辑 popover、筛选 chips、标签网格、tagged card 工厂。智能模块，组件内自带 `useTranslation()`；是 `CollectionPageScaffold` 具名 import 的智能模块之一（名单在 `components/collection/CLAUDE.md`）。

## 约束

- 零平台知识：platform 一律是参数，本目录不出现平台字面量，不 import 任何平台 lib。平台接入打标 = 传 platform + 一行 `taggedCard(<P>Card, '<prop>', to<P>Item)`（`sections/<platform>/tagged-*-card.tsx`）。
- 数据一律经 `@/lib/tagging`，零 drizzle / entity / `getDb`。唯一的 `@/lib/database` 类型导入是 `tagged-card.tsx` 的 `import type { PagedItemRow } from '@/lib/database/collection-queries'`：那是 lib 分页查询交给 mapper 的行契约，只有类型（`initDbProxy` 的值导入是另一回事）。
- `taggedCard` 的 `toItem` 必须是平台 lib 分页查询自己用的那个导出 mapper（`to<P>Item`；B站例外，是 section 内的 `toBiliFavVideo`）。不要在 tagged card 里另写一份映射：标签网格与平台网格读同一份才不会漂移。
- 跨平台的 platform → tagged card 穷举表在 `sections/collections/collection-item-card.tsx`，不进本目录。
- 手动编辑后必须同时刷新 item tags 与 used tags：`useItemTags` 在页面顶层常驻、筛选激活时不卸载，只刷一边的话清除筛选后普通网格的标签是旧的。`useCollectionTags` 的 `handleTagsChanged` 封住了这条不变量（消费方是 scaffold）；手拼各个 hook 时自己负责。
- 刷新走两条通道：AI 自动打标发 `'item-tagged'` 领域事件；手动 add / remove 不发事件，走显式 `onChanged → refresh`。
- `useTagFilter` 的孤儿剪枝别删：选中的 tag 从 used tags 消失后必须移出选择，否则唯一已用标签删光时筛选 chips 整行消失、没有清除按钮，用户困在空网格。
- `TagRow` 渲染在卡片的链接区域之外（防误触跳转），布局用 `CollectionCardRow`，本目录不写卡片内边距。
- Chip 一律不写 `variant`，吃主题默认 soft；筛选 chip 的选中态归 `components/collection/chip-row.tsx` 的 `FilterChip`。
- `TagFilterChips` 在没有已用标签时整体不渲染。

## 坑

- `useItemTags` 比对事件里的 id 用小写：B站 bvid 大小写混用的遗留防护。
- 数据 hook 与编辑 handler 都先 `await initDbProxy()`：首屏时 DB 代理可能还没建好。
- 无标签但可编辑的卡片不画空行：编辑按钮绝对定位在卡片右上角，只在卡片 hover / focus-within 时显现，依赖 `MuiCard` 的 `position: relative`。
- `TaggedItemGrid` 编辑后重查，条目掉出筛选时自动关 popover（防 anchor 指向已卸载节点）；重查是原位更新，骨架只在 tag 组合变化时出现。
- 标签输入框的 Enter 提交带 IME composing 守卫，别去掉：中文输入法选词的 Enter 会误提交。
