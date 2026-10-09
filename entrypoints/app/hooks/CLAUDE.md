# app/hooks

app.html 专用的共享 hooks 与页面运行时 job 调度（只跑在 Extension Page context；跨 context 共享的 hook 在 `lib/hooks/`）。单个模块的行为看各源文件，这里只记跨文件才成立的规则。

## 两档分层

- 平台感知层只有四个模块：`library-gate`、`use-daily-auto-sync`、`platform-sync`、`use-credential-gated-library`，可以读 storage / DB、认识平台词汇。其余全部是泛型层：零 storage、不 import 任何具体平台的模块（`collection-job-platform` 是纯判别符映射，两档都可 import）。
- 依赖单向：平台感知层向泛型层注入（`setJobGate`、`deps` 参数）；泛型层反向 import 即违规，`background-jobs-store` 尤其不得 import `library-gate`。
- 两档都不得 import `sections/`：各平台 Sync Adapter 的聚合点在 app 根 `collection-platform-auto-sync.ts`，由 `App.tsx` 注入 `useDailyAutoSync(platforms)`（hook 没有默认 registry）。守卫：`tests/platform-completeness-contract.test.ts`。
- `useCollectionLibrary` 的 DB 依赖只有 `initDbProxy` 与 `@/lib/database/collection-queries` 的 `getPlatformLastSyncedAt`（按判别符读，不认识具体平台）；凭据与配置解析留在 `sections/<platform>/<platform>-sync-adapter.ts`，hook 的 `syncFn` 只引用 adapter。

## Job store（`background-jobs-store.ts`）

- `startJob` 的碰撞策略由派发方显式声明：`'drop'`（active 时拒绝，`started:false`；sync / extract 的跨挂载去重）、`'queue'`（FIFO，active run 结算后——成功或失败——由 store 出队接续）、`'coalesce'`（并入最新一个同为 coalesce 的 pending run，本次 runner 丢弃；绝不并入 `'queue'` 条目）。
- 排队只归 store：调用方不得用 `settled` promise 自造重试或排队循环。`settled` 结算于本次派发对应的那个 run。
- 闸门 reader 经 `setJobGate` 注入，在 run **实际启动**时评估（含 pending 出队时）。命中时 job 照常创建、runner 照常启动，只是 born-paused，`started` 仍是 `true`——绝不能返回 `started:false`，否则排队中的工作会被结算成空。
- 注册 reader 不触碰已在跑的 run（暂停它们靠 `library-gate` 的 fan-out）；reader 抛错按「未暂停」处理。
- 进 store 的工作只有 `startJob` 一个入口：不要再加「观察一个外部 Promise」的旁路（旧 `trackJobRun` 就是这样的死代码），它绕过闸门与碰撞策略。
- job 队列只活在当前 app.html，不要把它当持久恢复。

## 暂停状态机（`pipeline-run-control.ts`）

- 暂停是合作式的：Pause 先进 `pausing`，worker 到下一个 `checkpoint()` 才进 `paused`；不取消在途请求或 DB 写入。
- Resume 从 `pausing` 与 `paused` 都回到 `running`（前者撤销尚未生效的暂停，后者释放等待）：不得丢掉 checkpoint 之前到达的 resume。
- born-paused 的 run 在第一个 `checkpoint()` 就挂起；resume 早于首个 checkpoint 时直接放行，不得产生第二个 worker。

## 处理 lane（`collection-processing-jobs.ts`）

- 每个 `(jobPlatform, lane)` 串行、可暂停，不同平台的 lane 可并行；item 在领取前 checkpoint。
- 碰撞策略只在这里声明、由 store 执行：tag batch = `'queue'`（每批 ids 不同，逐批必跑）、embed batch = `'coalesce'`（runner 都是整份 `'chunked'` backlog drain，可互换）、streaming drain = `'queue'`。三者都不丢工作，模块内不得出现 `settled` 重试递归。
- 同步收尾时 Embed 恒派发平台整份 backlog（`embedPlatformBacklog`，零新条目也派发），Tags 只吃本轮新 ids。
- streaming inbox 在 drain 结算后若有迟到 item 必须 re-wake。
- 终态 `job:completed|failed` trace 在 runner wrapper 内发出：queued run 的 `settled` 解析时 store 可能已启动下一个 run，读快照会串台。
- provider 保存后的恢复只走 `resumeCollectionProcessing`（`collection-processing-resume.ts`）；Settings 不接触 job key 与 lane。

## Platform Sync（`platform-sync.ts`）

- `runPlatformSync` 是 Platform Sync 被记录、同步后批量 lane 被派发的唯一位置。各平台 `*-sync-adapter.ts` 在函数体**内部**调用它，只包住联系平台的那一段。
- 顺序是契约：`checkpoint`（born-paused 的 run 恢复前不记尝试）→ 记尝试 → 同步 → 失败：记失败并 rethrow **原**错误 / 成功：先派发 lane 再记成功。
- 不联网就能判定的凭据缺失在 funnel **之前**处理（空转 return 或抛原错误类），不算尝试、不写记录。funnel 不做策略：不认识静默错误、闸门、冷却。
- `startCollectionProcessingJobs` 只许出现在定义处与 funnel（守卫：`tests/platform-completeness-contract.test.ts`）。逐条处理的平台（bilibili / bookmarks / douyin）自己经 `enqueueCollectionProcessingItem` 派发、给 funnel 传 `newItemIds: []`——这是合法路径，不是绕过。
- 「平台同步成功意味着什么」只在 adapter 定义一次：手动 hook 与 daily registry 引用同一个 `run<P>Sync`，不得在触发方复制凭据解析或后处理。触发策略（UI 门、冷却、daily 的 `<p>AutoSyncPolicy`）留在触发方，不进 `run<P>Sync`。

## Job 命名空间

- job 命名空间一律经 `jobPlatformForCollection(platform)` 派生，不写字符串字面量：github / x / zhihu / youtube 的 `jobPlatform` ≠ 平台 id，抄字面量会让手动同步与 funnel 派发的 embed / tag lane 落在两个命名空间。守卫：同一契约测试，扫 `entrypoints/app/**`。
- `collection-job-platform.ts` 保持纯翻译：不读 storage、不注册 gate。
- `useCollectionLibrary` 的 config 同时有 `platform`（条目平台）与 `jobPlatform`（job 命名空间）两个键。冗余是刻意的，不要改成内部派生：通用 hook 的测试靠每例唯一的命名空间隔离（job store 是没有 reset 的模块单例）。

## 每日自动同步与知识库闸门

- daily 闸门读 Platform Sync Record 的 `last_attempt_at`：当天任何一次尝试（手动或自动、成功 / 失败 / 静默 / 未结束）都占掉当天的自动名额，手动按钮不受限（docs/32 §5.2）。不要改回读 `sources.lastFetchedAt`：失败与空库同步不写 source 行，会被读成「从未同步」而反复重打刚风控过我们的平台。
- 评估顺序：`shouldAutoSync` → `isPaused` → `probeReady` → `startJob`。暂停中不发探针、不记尝试，恢复后当天仍会补跑。
- `isSilentError` 只影响呈现：funnel 照样记失败，静默同样占名额。
- `library-gate.ts` 在模块加载时自注册 `setJobGate(isLibraryPaused)`；app.html 里它被加载的保证来自 `App.tsx` → `use-daily-auto-sync` 的 import 链，拆掉这条链闸门会静默失效。
- `pauseLibrary` / `resumeLibrary` 先改内存镜像再写 storage（同 tick 生效，防点击与派发竞态）。对运行中 run 的 pause / resume fan-out 只在 `applyPaused` 一处，点击路径与跨 tab 的 storage watch 共用。
- 持久值是「暂停中的平台列表」，`[]` = 全部运行，所以新平台接入零改动。

## 收藏页 hooks

- `useCollectionLibrary` 的 config 函数必须引用稳定（模块级常量或 `useCallback`）：它们在 effect 依赖里，不稳定引用会每次 render 重查。
- `controlledFilter` 是唯一的受控 seam：给值（含 `null`）即外部事实源（路由参数）拥有 filter，hook 在 render 期把页码回 1（不用 effect，避免一次「新 filter + 旧 page」的废查询），`setFilter` 变 no-op。
- 触发时机（按钮 / 挂载 / daily）是平台 adapter 的策略，hook 不带 auto-on-mount 开关。
- 平台 hook 不给通用字段改名，view 直接读 `items` / `filter` / `facets`。bilibili（folders + videos 双 hook）不套这个抽象，但它的 sync runner 同样只调共享 Sync Adapter。
- `'credentials'` 平台（github / youtube）的 run 门、`probeReady`、页面门（`useCredentialGatedLibrary`）必须读 adapter 导出的同一个解析函数（`githubCredentials` / `youtubeCredentials`），否则三处会分叉。
- `collection-sync-error.ts` 刻意零 i18n：`@/lib/i18n` 加载即读 `chrome.storage`，而它被没有 mock i18n 的 hook 测试间接加载。翻译在 `collection-sync-error-message.ts`，只许 view import；view 声明一份 `SyncErrorCopy`，不写 switch。
- `resolveCollectionPhase`（`collection-phase.ts`）的分支顺序即契约：view 只做 `switch(phase)`，不各自排优先级。
- pipeline 段的形状只在 `collectionPipelineStages` 声明（Fetch → 可选 content 段 → Embedding → Tagging），view 经 `useCollectionPipeline` 消费，不手写 stages 数组。
- pipeline 段是纯展示快照，没有段级 pause / resume：运行控制只归 per-platform 闸门（`library-gate.ts` + `components/library-gate/`）。
- `transcriptionStage`（`pipeline-segments.ts`）是转录平台共享的 content 段：runtime 读该平台的 `transcribe` job（手动与自动转录共用同一个 key），view 不自己拼段对象。
- 进度契约：Fetch 段完成后保留本次总数并显示 100%（`completedProgress: 'last-run'`）；同步进度带 `fetchedCount`、远端总数未知的平台用 `fetchedCountProgress`，其余用默认 `readJobProgress`。
- `useCollectionBreadcrumbs` 是收藏路由祖先的唯一 owner，每个平台收藏页 view 必须调用它（守卫：同一契约测试）。末项永远无 href；文案取导航名（`nav.*`），可能与页面 h1 不逐字相同（聚合页 h1「全部收藏」/ 末项「收藏夹」）。
- 面包屑只给必经层级加级：bilibili 详情页传 `leaf`（收藏夹名）；bookmarks 的 `:folderId` 不传——它是带「全部」chip 的可选筛选，不是层级。
- `SEARCH_DEBOUNCE_MS` 只在 `use-collection-library.ts` 定义，其它收藏页 import 它。

## Transcript lane（`transcript-lane.ts`）

- 泛型层：一个平台一条 lane（`createTranscriptLane(pipeline, jobPlatform)`），Fetch producer 的 `append` 只收已映射的 `AutoTranscribeVideo[]`；资格判定与平台形状到 `AutoTranscribeVideo` 的映射留在各平台 section 的 `auto-transcribe-runtime.ts`，lane 不认识任何平台。
- session 以 `startJob(jobPlatform, 'transcribe', …, 'queue')` 派发：手动单视频转录占着 key 时由 store 排队接续，不写重派发循环。
- tail **按 lane**（= 按 pipeline 实例）串行，不跨平台：否则 B站的自动转录会排在抖音几百条积压后面。
- 已知缺口（v1 接受）：B站与抖音两条 session 可以同时从同一个 app.html 标签页发 `TRANSCRIBE_AUDIO`，而 SW 的 `lib/background/job-registry.ts` 一个 tab 只记一个转录 job——后发者顶掉前者的 controller 与 videoId：B站手动取消会中止最近登记的那条，被顶掉的视频失去去重，Offscreen 进度会算到后者头上。要么以后共用一条转录队列，要么 registry 按 `(tabId, platform)` 键。

## 坑

- `useCollectionBreadcrumbs` 不要 memo：`t` 是稳定的模块函数，`useMemo` 会把字符串冻在旧 locale。
- `useCountdown` 在渲染期读 `Date.now()`，不要把 `now` 存进 state：没有倒计时时 state 不 tick，页面挂了很久才出现的 deadline 首帧会按挂载时刻多算。
- `facetQuery` 函数体里的 `as TQuery` 不能删：去掉后 `tsc` 报 TS2345（`TQuery` 可能被实例化成约束的另一个子类型）。
- `useJobsBadge` 只写不清理：unload 不可靠，关掉 app.html 后由 SW 的 `lib/background/jobs-badge.ts` 擦除；action API 失败只 warn，不能拖垮页面。
- `useCollectionPipeline` 的 coverage refresh key 里 `syncing` 独立于 Fetch 段的 running：github 在 readme 相位提前 settle Fetch 段，而 sync job 仍在跑。
