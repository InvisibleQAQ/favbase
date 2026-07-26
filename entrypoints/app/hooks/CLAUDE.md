# app/hooks

app.html 专用共享 hooks（跨 section 复用；平台无关）。与 `lib/hooks/`（跨 context 共享，如 useSettings）区分：本目录的 hook 只跑在 Extension Page context。

## 模块结构

- `background-jobs-store.ts` — 模块级 `useSyncExternalStore` job store，跨 Hash Router 挂载保留 `sync|extract|embed|tag|transcribe` 未完成态。`startJob` 持有 owner token、cooperative control、`running|pausing|paused|completed|failed` phase、末次成功 `lastProgress` 与 `{started,settled}` 句柄；同 key 去重且旧 run 的迟到 settlement 不能覆盖新 run。`trackJobRun` 仅为不可控旧 Promise 的兼容 observer，不得用于需要暂停的 pipeline。
- `pipeline-run-control.ts` — 单 run cooperative pause 状态机；Pause 先进入 `pausing`，worker 在下一个 `checkpoint()` 才进入 `paused`，Resume 释放等待并回到 `running`。不取消当前请求或 DB 写入。
- `collection-processing-jobs.ts` — 六平台 Embed/Tags 的 app-runtime 执行器。两条 lane 各自串行、各自可暂停，item 在领取前 checkpoint；后到 batch 等当前同 lane settlement 后接续，streaming item 进入模块级 inbox，均不得把去重变成丢工作。inbox 内部观察 fire-and-forget ticket rejection，lane 仍统一报告失败；`CollectionProcessingTicket` 让 Bilibili 只 await Embed。队列仅存活于当前 app.html，不伪装持久恢复。
- `use-collection-library.ts` — 单列表 + facet + 手动同步的共享状态机；同步经 `startJob(logTag,'sync')`，把 cooperative checkpoint 传给平台 `syncFn`，并暴露同 namespace 的 typed `syncJob`/`embedJob`/`tagJob` 给 pipeline Adapter。平台只注入稳定的 query/facets/lastSynced/sync/error-classifier Interface。
- `collection-phase.ts` — `resolveCollectionPhase(state): CollectionPhase`（audit docs/15 HIGH-2 的收敛产物）：收藏页内容区的 8 分支优先级阶梯纯函数。返回 discriminated union `'tag-filtered' | 'query-error' | 'auth-failed' | 'sync-error' | 'skeleton' | 'empty-library' | 'no-matches' | 'grid'`。**分支顺序即契约**——顺序封在这一处，各 view 只做 `switch(phase)` → 平台节点映射，view 不再各自维持顺序（消除「某平台漏 authFailed 短路」类静默 bug）。入参是布尔旗标对象（tagFiltered/queryError/authFailed/syncErrorEmpty/metaLoading/syncingEmpty/libraryEmpty/loading/noMatches）；无 authFailed 概念的平台（github：token 缺失走 NoTokenState 整页短路）传 `authFailed:false`。`collection-phase.test.ts` 逐分支 + 全旗标叠加锁死顺序
- `use-processing-coverage.ts` — 平台级 DB Processing Coverage hook：返回 `loading|ready|error` 判别状态，订阅 durable content/embedding/tagging 事件，并以 100ms trailing window 合并聚合查询；无轮询。
- `pipeline-segments.ts` — 纯 Adapter Module：平台声明 stage→coverage key 与可选 runtime；`backgroundJobRuntime` 统一 phase/progress/lastProgress/pause/resume，`completedProgress:'last-run'` 只给 Fetch 保留本次总数并显示 100%。Module 统一 live-over-idle、unknown、loading/error、控制文案与 job payload 校验。

## 约定

- **config 函数必须引用稳定**（模块级常量或 useCallback）——它们在 effect 依赖数组里，不稳定引用会每 render 重查。
- **泛型层零 storage / 零平台导入**：唯一依赖 `@/lib/database` 的 `initDbProxy`。auth 解析（如 X 的 `getXAuth()`）必须留在各平台 adapter 的 `syncFn` 闭包内。
- 消费方（薄 adapter）：`sections/github-stars/use-github-stars.ts`（useSettings token 门 + estimatedTotal 进度计算）、`sections/x/use-x-bookmarks.ts`、`sections/zhihu/use-zhihu-favorites.ts`、`sections/youtube/use-youtube-playlists.ts`（useSettings 凭据门（github 模式）：apiKey+channel 同步读 `hasConfig`，无异步授权探针——API key 形态单维度）。**不适用**：bookmarks（auto-on-mount 同步）、bilibili（folders+videos 双 hook）——形态不同，不强行塞进该抽象（docs/15 HIGH-1 范围圈定）。
