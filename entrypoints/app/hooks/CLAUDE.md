# app/hooks

app.html 专用共享 hooks（跨 section 复用；平台无关）。与 `lib/hooks/`（跨 context 共享，如 useSettings）区分：本目录的 hook 只跑在 Extension Page context。

## 模块结构

- `background-jobs-store.ts` — 模块级 `useSyncExternalStore` job store，跨 Hash Router 挂载保留 `sync|embed|tag|transcribe` 运行态。`startJob` 去重单批 runner；`trackJobRun` 不启动任务，只把 Bilibili/Bookmarks 已存在的重叠 Embedding/Tagging Promise 聚合为一条 lane，最后一个 Promise settled 才结束。所有派生 snapshot 只在 `setJob` 更新，引用稳定。
- `use-collection-library.ts` — 单列表 + facet + 手动同步的共享状态机；同步经 `startJob(logTag,'sync')`，并暴露同 namespace 的 `embedJob/tagJob` 给 pipeline Adapter。平台只注入稳定的 query/facets/lastSynced/sync/error-classifier Interface。
- `collection-phase.ts` — `resolveCollectionPhase(state): CollectionPhase`（audit docs/15 HIGH-2 的收敛产物）：收藏页内容区的 8 分支优先级阶梯纯函数。返回 discriminated union `'tag-filtered' | 'query-error' | 'auth-failed' | 'sync-error' | 'skeleton' | 'empty-library' | 'no-matches' | 'grid'`。**分支顺序即契约**——顺序封在这一处，各 view 只做 `switch(phase)` → 平台节点映射，view 不再各自维持顺序（消除「某平台漏 authFailed 短路」类静默 bug）。入参是布尔旗标对象（tagFiltered/queryError/authFailed/syncErrorEmpty/metaLoading/syncingEmpty/libraryEmpty/loading/noMatches）；无 authFailed 概念的平台（github：token 缺失走 NoTokenState 整页短路）传 `authFailed:false`。`collection-phase.test.ts` 逐分支 + 全旗标叠加锁死顺序
- `use-processing-coverage.ts` — 平台级 DB Processing Coverage hook：返回 `loading|ready|error` 判别状态，订阅 durable content/embedding/tagging 事件，并以 100ms trailing window 合并聚合查询；无轮询。
- `pipeline-segments.ts` — 纯 Adapter Module：平台声明 stage→coverage key 与可选 runtime；Module 统一 live-over-idle、unknown、loading/error 与 job payload 校验。

## 约定

- **config 函数必须引用稳定**（模块级常量或 useCallback）——它们在 effect 依赖数组里，不稳定引用会每 render 重查。
- **泛型层零 storage / 零平台导入**：唯一依赖 `@/lib/database` 的 `initDbProxy`。auth 解析（如 X 的 `getXAuth()`）必须留在各平台 adapter 的 `syncFn` 闭包内。
- 消费方（薄 adapter）：`sections/github-stars/use-github-stars.ts`（useSettings token 门 + estimatedTotal 进度计算）、`sections/x/use-x-bookmarks.ts`、`sections/zhihu/use-zhihu-favorites.ts`、`sections/youtube/use-youtube-playlists.ts`（useSettings 凭据门（github 模式）：apiKey+channel 同步读 `hasConfig`，无异步授权探针——API key 形态单维度）。**不适用**：bookmarks（auto-on-mount 同步）、bilibili（folders+videos 双 hook）——形态不同，不强行塞进该抽象（docs/15 HIGH-1 范围圈定）。
