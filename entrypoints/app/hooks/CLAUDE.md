# app/hooks

app.html 专用共享 hooks（跨 section 复用；平台无关）。与 `lib/hooks/`（跨 context 共享，如 useSettings）区分：本目录的 hook 只跑在 Extension Page context。

## 模块结构

- `use-collection-library.ts` — `useCollectionLibrary<TItem, TFacet, TProgress, TError>`：「单列表 + facet chips + 手动同步」收藏页的平台无关状态机（audit docs/15 HIGH-1 的收敛产物）。持有全部编排逻辑：搜索 300ms 防抖（`searchRef` 值比对，真变化才重置 page=1）、分页查询 effect（`cancelled` 旗标 + `initDbProxy()` 幂等 join + queryVersion 重查）、库元信息 `refreshMeta`（`Promise.all` facets/lastSynced/无筛选 total + `mountedRef` 守卫）、sync 编排（syncing 互斥 + 进度回调 + refreshMeta + queryVersion 递增 + finally 清 progress）、`totalPages = max(1, ceil(total/pageSize))`（默认 pageSize=24）。平台注入点 5 个：`queryFn`（吃归一化 `CollectionQueryParams { filter, search, page, pageSize }`）、`facetsFn`、`lastSyncedFn`、`syncFn`、`classifyError`（+`logTag` console 前缀）。返回泛化字段名（items/filter/setFilter/facets/...），平台 adapter 负责映射回领域命名

## 约定

- **config 函数必须引用稳定**（模块级常量或 useCallback）——它们在 effect 依赖数组里，不稳定引用会每 render 重查。
- **泛型层零 storage / 零平台导入**：唯一依赖 `@/lib/database` 的 `initDbProxy`。auth 解析（如 X 的 `getXAuth()`）必须留在各平台 adapter 的 `syncFn` 闭包内。
- 消费方（薄 adapter）：`sections/github-stars/use-github-stars.ts`（唯一带 useSettings token 门 + estimatedTotal 进度计算）、`sections/x/use-x-bookmarks.ts`、`sections/zhihu/use-zhihu-favorites.ts`。**不适用**：bookmarks（auto-on-mount 同步）、bilibili（folders+videos 双 hook）——形态不同，不强行塞进该抽象（docs/15 HIGH-1 范围圈定）。
