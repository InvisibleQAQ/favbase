# 41 Tagging Budget：自动打标签的每日 token 上限（2026-10-15）

> 状态：**设计已定（用户 2026-10-15 逐条确认）；Step 1–3 已落地（2026-10-15，见 §6），Step 4 未开工**。执行稿是任务目录 `.trellis/tasks/10-15-tagging-daily-token-budget/prd.md`（`.trellis/` 不进版本库，决策以本文为准）。
>
> 起因：自动打标签对每条 Collection Item 发一次 `generateObject`（`lib/tagging/tagger.ts`），输入是标题、简介、正文前 2000 字和 50 个已有标签（`lib/tagging/prompt.ts`）。花费与收藏数成正比，而且无人值守：首次同步几千条收藏，就可能一次烧掉用户 LLM key 的大部分余额。仓库里没有任何节流；设置页 LLM 卡上的 `maxTokens` 没有消费者（`lib/summary/CLAUDE.md`），而且它是单次请求的输出上限，本来就管不到这件事。
>
> 术语：**Tagging Budget**（`CONTEXT.md`）。规则落地后的 owner：`lib/tagging/CLAUDE.md`（预算语义、扣账）、`lib/storage/CLAUDE.md`（账本 key）、`entrypoints/app/hooks/CLAUDE.md`（Tags lane 的形状）、`entrypoints/app/sections/settings/CLAUDE.md`（保存后续跑）。本文只记决策、否决与落地经过。

## §1 决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **只管自动打标签**：只统计、只拦截 `tagPlatformItem` 这一条路。Chat（`lib/chat/agent.ts`）与 B站总结（`lib/summary/summarizer.ts`）用同一个 LLM key，但不计入、不受限（用户决定） | 账单失控的根因是花费与收藏数成正比、没人看着；Chat 与总结是用户一次次点出来的。让后台打标签吃光额度再挡住前台 Chat，就是后台饿死前台 |
| D2 | **全平台一个池、一个 seam**：检查与扣账只在 `lib/tagging/tagging-service.ts` 的 `tagPlatformItem` 内。批量（`tagNewItems` / `tagPlatformBacklog`）与逐条派发（`enqueueCollectionProcessingItem`，bilibili / bookmarks / douyin）都经过它。没有分平台额度，并行的 tag lane 先到先得（用户要求：所有平台共用） | 平台目录零改动，新平台接入自动受约束；`lib/tagging` 零平台知识的守卫（`tests/platform-completeness-contract.test.ts`）照常成立 |
| D3 | **计量 = 输入 + 输出**：扣 `usage.inputTokens + usage.outputTokens`（AI SDK v6 `LanguageModelUsage`；reasoning tokens 已含在 output 里，缓存命中的输入照算）。端点不回传用量（字段为 `undefined`）时按字符数估：system + prompt + 输出 JSON 的字符数，宁多勿少。`NoObjectGeneratedError` 带 `usage`，照扣；没有 usage 的抛错（HTTP 错误等）记 0 | 用户口径「一天总共花费的 token 数（包含输入输出）」。字符数对中文接近、对英文高估约 4 倍，高估是预算的安全方向 |
| D4 | **先查后扣**：调用前今日剩余 > 0 即放行，调用后按实际用量扣。不做调用前的预估拦截 | 超支有界：最多「同时在跑的 tag lane 数 × 一次调用」，约一两万 token，对百万级上限可忽略 |
| D5 | **账本是设备本地状态**：`storage.local` 一个 key，值 `{ day: 本地日期 YYYY-MM-DD, tokens }`；`day` 不是今天即视为 0。日界与每日自动同步同口径（`entrypoints/app/hooks/daily-sync-gate.ts` 的本地自然日）。读改写在 `navigator.locks` 下串行。不进 WebDAV（`lib/storage/CLAUDE.md`：只同步 settings 与 locale） | 两个 app.html 标签页可能同时跑 tag lane，不加锁会互相覆盖、少记用量。上限值在 settings 里，随 WebDAV 同步；用量各设备各算 |
| D6 | **设置**：`UserSettings` 新键 `taggingDailyTokenBudget`，正整数，默认 **5_000_000**（用户决定），没有「不限」开关。放在 LLM 卡「高级」区，与 `maxTokens` 并排；不是连接字段，改了不用重测即可保存；下方显示「今日已用 X / 上限」。`maxTokens` 不动 | `maxTokens` 是单次请求的输出上限，与每日总量是两个概念（用户澄清 2026-10-15，`CONTEXT.md` Flagged ambiguities）。想不限的用户填一个大数，少一个 UI 状态 |
| D7 | **用完后条目留待打，同步收尾续上**：`tagPlatformItem` 新增结果 `'deferred'`（不调 LLM、不改库），批量循环在第一条 `'deferred'` 处结束，run 正常完成，不是失败。Tags lane 改成与 Embed 同形：每次 Platform Sync 收尾恒派发本平台整份 Tags backlog，碰撞策略 `'queue'` → `'coalesce'`；逐条派发路径不变 | 下一个自然日的同步按平台自然续上。顺带关掉现存缺口：失败或中断的条目以前只能等 LLM 配置保存时补打（docs/33「Step 2.5 落地记录」里「中断那一次调用里已经切完块的条目没人派发」一条） |
| D8 | **呈现与续跑**：「今日额度已用完」是派生状态，等于「账本今日已用 ≥ 上限」且「该平台 Tags coverage 有待打条目」；不是 run 的新终态，不进 toast，不是 Configuration Blocker。LLM 卡每次保存成功，都对 `COLLECTION_PLATFORMS` 的每个平台派发 Tags backlog，不再只认 `?resume`；`?resume` 只剩 Embedding 在用 | 刷新页面、换平台页都一致，无需持久化 run 结果。用户调高上限就是「现在就要继续」；Tags lane 是 coalesce 积压排空，没有积压的平台以 0/0 立即结束 |

默认值的后果：按每条约 2k tokens 估（`[UNKNOWN]` 未实测，见 §5），5M 约等于每天 2500 条，2500 条以内的收藏库首次同步当天基本打完。所以默认值防的是上万条的超大库和失控循环，不会让普通用户第一天的账单变小。这是用户知情后的选择。

## §2 否决清单（后续不得重提）

| 路线 | 否决理由 |
|---|---|
| 预算覆盖 Chat / 总结并一起拦截 | 后台打标签可以把用户主动发起的操作饿死 |
| 全部计数、只拦打标签 | 要跨 SW（总结）与 app.html（Chat、打标签）两个 runtime 记账、改三个调用点；「今日已用」也不再是 Tagging Budget 的语义 |
| 分平台额度 | 没有积压的平台白占份额；每接一个新平台都要补默认值 |
| 复用 `maxTokens` 的存储键 | 已装用户都存着 100000，复用等于把预算静默改成 100k；语义也不同 |
| 超额就跳过、不续跑 | 被挡下的条目永远没有标签，与 docs/38 §2 否决「单条重试上限」同理 |
| 用完后 lane 停在跨天倒计时等待态（类似自动转录的 `quota_paused`） | 多一个跨天等待态与计时器；同步收尾和保存设置已经能续上 |
| 调用前预估这次会不会超、超就不发 | 精度换不来什么，D4 的超支本来就有界 |
| 默认不限 | 需要保护的恰恰是不会去设置的人 |
| 单条失败的重试上限 | 同 docs/38 §2：没有 `'error'` 重试入口时，上限等于永久丢条目 |

## §3 铁律（实现时不得违反）

1. 预算的检查与扣账只在 `tagPlatformItem` 一处。app 层、lane、平台 adapter 不得另做预算判断。
2. 预算不按平台分账；`lib/tagging` 非测试文件仍零平台知识。
3. `tagPlatformItem` 仍然 never throws。账本读失败按「已用完」处理（返回 `'deferred'` 并记日志）：这个功能的目的就是保护余额，读不到账本就不花钱。LLM 调用成功后扣账失败只 warn，不得把 `'tagged'` 改成失败，否则已经花掉的钱白花。
4. 「额度已用完」不是失败：run 不 throw，段不显示 failed，不进 toast（根 `CLAUDE.md` UI 规则：持续状态不进 toast）。
5. 「额度已用完」不是 Configuration Blocker：`lib/collections/configuration-blockers.ts` 的 `deriveConfigurationBlockers` 不变，也不复用它的文案。
6. pipeline strip 纯展示、无段级控件（`entrypoints/app/components/collection/CLAUDE.md`）：「调整上限」的链接不进段内（见 Step 4）。
7. 账本只经一个模块读写，owner 登记在 `lib/storage/CLAUDE.md`；UI 只用 typed get / watch。
8. 设置值在系统边界经 `canonicalizeSettings` 校验（正整数），非法值整体拒绝，与其它数值字段同规则。

## §4 执行步骤

一步一个会话，每步做完等用户审阅提交再进下一步。

### Step 1 — lib 半边：账本、拦截、扣账（已落地 2026-10-15；对本节与 §1 的修正见 §6）

- `lib/storage/settings-schema.ts`：`UserSettings`、`DEFAULT_SETTINGS`、`UserSettingsSchema` 加 `taggingDailyTokenBudget`。
- `lib/storage/keys.ts` 加账本 key；账本模块（typed get / watch / charge，charge 在 `navigator.locks` 下读改写）放在 `lib/storage`，与 `asr-prerequisite.ts` 同层。
- `lib/tagging`：日界与剩余额度的纯函数；`tagger.ts` 的 `generateTags` 返回标签与用量（两条分支都要，含 `NoObjectGeneratedError` 与估算兜底）；`tagging-service.ts` 的 `tagPlatformItem` 在 `d.generate` 之前查、之后扣，`TagItemResult` 加 `'deferred'`；`tagNewItems` 在第一条 `'deferred'` 处结束；`TaggingDeps` 加预算 seam 供测试注入。
- `TagItemResult` 的消费者（`entrypoints/app/hooks/collection-processing-jobs.ts` 的逐条 ticket 等）把 `'deferred'` 当作已结算、非失败；`tsc` 会点名穷举 switch。
- 文档：`lib/tagging/CLAUDE.md`（预算约束；`onProgress`「必达输入总数」的契约改为「可在 `'deferred'` 处提前结束」）、`lib/storage/CLAUDE.md`（账本 owner）。
- 验收：跨日归零；先查后扣；usage 缺失走估算；`NoObjectGeneratedError` 扣其 usage；无 usage 的抛错记 0；`'deferred'` 不调 LLM；批量在 `'deferred'` 处停；扣账失败不改 `'tagged'`；账本读失败返回 `'deferred'`；非法设置值被 `canonicalizeSettings` 拒绝。每组先写测试、对旧代码跑红。

### Step 2 — Tags lane 改成积压排空（已落地 2026-10-15，见 §6）

- `entrypoints/app/hooks/collection-processing-jobs.ts`：`defaultDeps.tag` 改走 `tagPlatformBacklog`，忽略 itemIds（照抄 embed 那段注释的写法）；`startCollectionProcessingJobs` 去掉「ids 为空不派 tag」的早退；`startBatchLane` 两条 lane 都用 `'coalesce'`。逐条派发 `enqueueCollectionProcessingItem` 不变：积压排空与逐条派发走同一个 `(jobPlatform, 'tag')` key，串行执行，`tagPlatformItem` 的幂等跳过保证不会重复花钱。
- 文档：`entrypoints/app/hooks/CLAUDE.md`「处理 lane」里 tag batch = `'queue'` 与「Tags 只吃本轮新 ids」两条；`lib/tagging/CLAUDE.md` 对应条目；`platform-sync.ts` 里 `PlatformSyncOutcome.newItemIds` 的注释若提到 tag 一并改；docs/33「Step 2.5 落地记录」的「中断那一次调用里已经切完块的条目没人派发」一条加指针到本文。
- 验收：零新 id 的同步也派发 tag backlog；连续两次派发 coalesce 成一次；逐条派发的平台照常工作。

### Step 3 — 设置页（已落地 2026-10-15，见 §6）

- `lib/hooks/useSettings.ts` 的 LLM draft 加字段；`entrypoints/app/sections/settings/llm-config-card.tsx` 高级区加输入框（与 `maxTokens` 并排，正整数），下方显示「今日已用 X / 上限」（watch 账本，跨日显示 0）；文案要让两个 token 输入框一眼区分（单次请求最大输出 vs 自动打标签每日上限，含输入输出）；`lib/i18n/locales/zh-CN.ts` 与 `en.ts` 同改。
- `entrypoints/app/sections/settings/settings-view.tsx` 的 `saveLlm` 成功后对 `COLLECTION_PLATFORMS` 逐个 `resumeCollectionProcessing(platform, 'llm')`；Embedding 的 `?resume` 不变。
- 文档：`entrypoints/app/sections/settings/CLAUDE.md`「LLM / Embedding 保存成功后据 `resume` 恢复」一条拆开改写。
- 验收：只改预算不需要重测连接即可保存；保存成功派发全部平台，保存 reject 不派发；「今日已用」随账本实时变化。

### Step 4 — 收藏页呈现

- Tags 段：D8 的派生状态成立时显示独立状态，不是 failed，也不是 completed；文案放 `pipeline.*`，由 view 翻译后传给零 `t()` 的共享组件（根 `CLAUDE.md` i18n 规则）。改动落在 `entrypoints/app/hooks/pipeline-segments.ts`（派生）与 `components/collection/` 的段状态类型（展示）。
- 「调整上限」链接：因为铁律 6，链接不放在段内，放在 scaffold 的「配置提醒」位置（区块顺序见 `components/collection/CLAUDE.md`），由一个独立组件渲染，链到 `settingsPath('ai/llm')`；不并入 `CollectionConfigurationNotice`（铁律 5）。**这一点偏离了讨论时「Tags 段附链接」的说法，开工前请用户确认。**
- 验收：刷新页面后状态仍在；各平台页一致；跨日或调高上限后状态消失。

## §5 残留与未知

- `[UNKNOWN]` 每条约 2k tokens 是粗估，没有实测。Step 1 落地后用真实 usage 回填本节，并据此复核默认值的说法。
- `[UNKNOWN]` 个别 provider 对 4xx 是否计费；D3 按记 0 处理。
- 稳定失败的条目（模型对某条内容每次都输出坏 JSON）每天都会被积压排空重试、每天扣额度。按 5M 的量级可以忽略，不加上限（§2 最后一行）。
- 用量按设备分别计算，两台设备各有一份额度。
- Knowledge Tool（`getProcessingCoverage`，Chat 与 Agent Bridge 共用）不报告预算耗尽：外部 agent 会把待打条目说成「还在处理中」。这句话本身不算错（明天会继续），v1 不改 Agent Bridge 的工具契约。
- `maxTokens` 仍然没有消费者（`lib/summary/CLAUDE.md` 已记），不在本任务范围内。

## §6 落地记录

### Step 1（2026-10-15）

**落地**：lib 半边按 D3–D5 与铁律 1–3、7、8 落地，Step 2–4 的文件未动。

- 账本：`lib/storage/tagging-budget.ts`，key 是 `local:tagging-budget-ledger`。
- 预算纯函数与默认端口：`lib/tagging/budget.ts`。
- `generateTags` 改为返回 `{ tags, tokens }`。已拿到回应、已计费的失败，包成 `TaggingSpendError(tokens, cause)` 抛出。
- `TaggingDeps.budget` 是测试注入点。

**对 §1 与 §4 的修正**（实现时发现，按 D3「宁多勿少」和铁律 3 的本意处理）：

1. D3 漏了一种已计费的失败：`json_object` 模式（`output: 'no-schema'`）下，调用已经成功并计费，之后客户端 Zod 校验才失败。按那次调用的用量照扣。
2. D3 说「`NoObjectGeneratedError` 带 usage」，但这不总成立：usage 本身或其中某个字段可能缺失。缺的字段各自按字符数估，输出那一项取 `err.text`。
3. D3 说「端点不回传用量时字段为 `undefined`」，这不准确。`@ai-sdk/openai-compatible` 会把缺失的 `prompt_tokens` / `completion_tokens` 转成 0（`dist/index.mjs` 的 `!= null ? x : 0`）。所以读数为 0 也改按字符数估，否则对这类端点，预算等于没开。
4. 铁律 3 要区分两种情况：
   - 账本读取 reject：返回 `'deferred'`。
   - 读到格式不对的值：视为今日已用 0，记一条 warn，下一次扣账会覆盖它。
   不能把坏值当成「已用完」：被挡下的条目永远不扣账，坏值也就永远不会被覆盖，打标签会卡死到有人手动清存储。
5. D4 的检查位置：放在候选检查之后、读正文与全库已有标签之前，仍然早于 `d.generate`。
   - 未配置、不在候选里、已打过标签的条目，返回 `'skipped'`，不读账本。
   - 额度用完时，逐条派发的每一条只多一次账本读。
6. §4 Step 1 说「`tsc` 会点名穷举 switch」，实际不成立。`TagItemResult` 只有两个消费者，都没有穷举：`collection-processing-jobs.ts` 的 ticket 类型，以及 `transcribe-and-persist.ts` 的 `void`。所以零改动。
7. 日界判断有两份实现：`localDayKey` 和 `daily-sync-gate.ts` 判断的是同一个本地自然日。因为 lib 不能 import `entrypoints/`，只能各写一份。这条已记进 `lib/tagging/CLAUDE.md` 的坑。

**Service Worker 模块图**：SW 经 `@/lib/storage` barrel 引入存储模块（`entrypoints/background.ts` 与 `lib/background/app-handlers.ts`，原有情况），所以账本模块也进了 SW 的 chunk。它的 `defineItem` 是懒定义的，加载时不碰 `chrome.runtime`。`pnpm build` 的 bundle 检查通过。

**留给后续 Step**：

- Step 2：逐条派发路径不会因为 `'deferred'` 停下。后面每一条各自返回 `'deferred'`，只读一次账本，不调 LLM。
- Step 3：「今日已用」用 `lib/tagging/budget.ts` 的 `taggingTokensSpentToday`。它还没进 `@/lib/tagging` 的 barrel，用到时再导出。
- Step 4：batch lane 在 `'deferred'` 处提前结束时 `done < total`，run 仍以 completed 收尾。Tags 段闲置时读 DB coverage，不读 `lastProgress`（`entrypoints/app/hooks/pipeline-segments.ts`），所以 D8 的派生状态照常从账本和 coverage 算。

**§5 未回填**：本步没有用真实端点跑，每条约 2k tokens 仍是 `[UNKNOWN]`。

**验证**：

- `pnpm vitest run lib/tagging lib/storage`：135 个用例通过。
- `pnpm compile`：通过。
- `pnpm test`：根目录 245 个文件 / 2262 个用例，packages 15 个文件 / 263 个用例，全绿。
- `pnpm build`：通过，background graph 14 个模块。
- 每组测试都先对旧代码跑红，再写实现。

### Step 2（2026-10-15）

**落地**：按 D7 与铁律 1、2 落地。lane 里没有任何预算判断；`lib/tagging` 只改了 `tagNewItems` 的 JSDoc。

- `defaultDeps.tag` 改走 `tagPlatformBacklog`，忽略 funnel 传来的 ids；`startCollectionProcessingJobs` 去掉了「ids 为空不派 tag」的早退；`startBatchLane` 两条 lane 都用 `'coalesce'`。
- `enqueueCollectionProcessingItem` 未动。

**对 §4 的补充**（实现时发现）：

1. `tagPlatformBacklog` 只收 `CollectionPlatform`，所以 `ProcessingWorker.platform` 与 `StartCollectionProcessingJobsInput.itemPlatform` 从 `string` 收窄成 `CollectionPlatform`。唯一的非测试调用方 `platform-sync.ts` 本来就传 `CollectionPlatform`。
2. 计划之外还有几处写着「funnel 只补跑 embed 积压」，已一并改掉：`entrypoints/app/sections/bookmarks/CLAUDE.md`、`.trellis/spec/frontend/platform-onboarding.md`，以及 bookmarks / bilibili / douyin 三个 sync adapter 的注释。

**复核发现的三处缺口，已修**（提交 `7172d64` 之后，用户要求一并处理）：

1. **两个 app.html 标签页对同一条各调一次 LLM。** job store 每个标签页一份，DB 却是共用的。两个标签页同时同步同一平台，各跑一份 tag backlog，按同样的顺序同步推进，对同一批条目各花一次钱。总花费仍受账本约束（D5），浪费的是当天额度。Step 2 之前同步收尾只派本轮新 ids，只有保存 LLM 设置的续跑会派整份 backlog，重叠窗口小得多。
   - 修法：`tagPlatformItem` 按条目认领（`TaggingDeps.claim`，默认 `ifAvailable` 的 Web Lock，锁名带 platform 与 platformItemId）。认领被别处持有时返回 `'skipped'`。
   - 从候选检查到写库都在认领之内：拿到认领时另一个标签页可能刚打完这一条。预算检查的位置不变（§6 Step 1 修正 5），铁律 1 照旧。
   - 两个标签页的 drain 因此交替推进、分摊工作，同一条只花一次钱。
   - 否决按平台加锁：拿不到锁就跳过，会漏掉持有方查询之后才入库的条目；排队等锁，又盖不住逐条派发。
   - 没有 `navigator.locks` 时返回 `'failed'`，不退回无认领执行，与账本锁同一立场。
2. **同步收尾的 Tags run 可能以 failed 收尾。** `tagNewItems` 从不抛错，`tagPlatformBacklog` 读配置或查候选失败会抛。修法：`tagPlatformBacklog` 也 never throws，失败只记日志、报 `0/0`，条目留给下一次同步。持续的 DB 故障仍会经 coverage 查询把段显示成 failed，不会被藏起来。Embed backlog 不变：它的失败要把 provider 问题暴露出来，而打标签的 provider 失败本来就按条目吞掉。
3. **funnel 上的 ids 没有消费者。** 两条 batch lane 都是整份 backlog drain 之后，`PlatformSyncOutcome.newItemIds` 和派发入参里的 `itemIds` 就是死数据。已经全部删掉：
   - funnel 与派发入参（`startCollectionProcessingJobs` 改用 `startCollectionProcessingBacklog` 的那份 deps）；
   - 各平台 Sync Adapter 的返回值；
   - github / x / youtube / zhihu / douyin sync service 结果里的同名字段。
   - bilibili 的 `newItemIds` 保留：它驱动 `insertedCount` 与转录回调，是真消费者。
   - 原来断言 `newItemIds` 的 lib 测试，凡是在证明真实行为的（例如 github 幽灵自愈），都改成断言 Embed 积压里的条目（`tests/processing-backlog-support.ts` 的 `embedBacklogIds`）；纯透传的断言直接删掉。

**残留**：LLM 返回空标签的条目（`'skipped'`）仍是 pending candidate。持有方释放认领后，另一个标签页的 drain 走到它，会再调一次 LLM。单标签页下次同步本来也会重试这一条，量级可以忽略。

**验证（`7172d64`）**：

- 5 个新增 / 改动的用例先对旧代码跑红。
- `pnpm vitest run entrypoints/app/hooks`：21 个文件 / 167 个用例通过。
- `pnpm compile`：通过。
- `pnpm test`：根目录 245 个文件 / 2264 个用例，packages 15 个文件 / 263 个用例，全绿。
- 本步不涉及 UI，没跑 `pnpm build`。

**验证（三处修复）**：

- 认领与 backlog 不抛错的用例先对旧代码跑：7 个失败，5 个是认领、2 个是 backlog。「LLM 未配置时不认领」是位置守卫，旧代码上本来就过。
- 变异检查：把候选查询挪到认领外面，「候选检查在认领之内」与「被别处持有」两个用例都会失败。
- 删 ids 管线是纯重构，没有行为变化，不适用先红后绿。
- `pnpm compile`：通过。
- `pnpm test`：根目录 245 个文件 / 2271 个用例，packages 15 个文件 / 263 个用例，全绿。
- 不涉及 UI，没跑 `pnpm build`。

### Step 3（2026-10-15）

**落地**：按 D6、D8 落地，Step 4 的文件未动。

- `LlmDraft` 加 `taggingDailyTokenBudget`。它不是连接字段，只改预算不用重测即可保存。
- LLM 卡高级区：`maxTokens` 与预算并排放在第一行，temperature 挪到第二行。`maxTokens` 的 label 改为「单次请求最大输出 Token」，与预算一眼可分。
- 预算下方显示「今日已用 X / 上限」，数据来自 `entrypoints/app/hooks/use-tagging-tokens-spent-today.ts`（初读加 watch）。上限取已保存的值，不取 draft。
- `saveLlm` 成功后对 `COLLECTION_PLATFORMS` 逐个派发 Tags backlog，不看 `?resume`。Embedding 不变。

**对 §4 与 §6 Step 1 的补充**（实现时发现）：

1. `taggingTokensSpentToday` 没有进 `@/lib/tagging` 的 barrel（§6 Step 1 原计划用到时再导出）。hook 直接从叶子模块 `@/lib/tagging/budget` import，因为 barrel 会拖进 tagging-service 与数据库。
2. hook 放在 `entrypoints/app/hooks/`，这是该目录「泛型层零 storage」规则的唯一例外，已登记在该目录的 `CLAUDE.md`。别的位置都不行：`lib/hooks/` 只放与 Content Script 共用的 hook；放进 `sections/settings/` 的话，Step 4 的收藏页就要 import `sections/`，这是禁止的。
3. 预算输入用 `Number` 加 `Number.isSafeInteger` 解析，不用 `parseInt`：`parseInt` 会把 `1.5` 截成 1 收下。这个口径与 schema 的 `z.number().int().positive()` 相同（zod 4 的 `.int()` 就是安全整数）。
4. 配置提醒给 LLM 链接附的 `?resume=` 现在是冗余参数，无害，没有改。

**已知瑕疵（未修）**：

- `maxTokens` 的新旧文案都说它限制单次请求的输出，但它没有消费者（`lib/summary/CLAUDE.md`）。改 label 只是为了与预算区分（D6），没有新增承诺。接线不在本任务范围内（§5）。
- en 下 `formatCompactNumber` 只保留 1 位小数，已用 4.95M 起就显示「5M / 5M」，实际还剩不到 1%。zh 的同类窗口只有 500 token。量级可以忽略，没有改。
- 读数没有跨午夜定时器：页面挂过零点后，要等下一次渲染才归零。

**留给 Step 4**：`use-tagging-tokens-spent-today` 与 `lib/tagging/budget.ts` 都走 `@/lib/storage` barrel，在没有 `chrome` 的测试里 import 会出 unhandled rejection（已记进 `entrypoints/app/hooks/CLAUDE.md` 的坑）。如果 Step 4 在 `useCollectionPipeline` 这类所有平台 view 共用的 hook 里调用它，所有平台 view 的测试都要补 mock。两条路，开工时定：

- 由 view 调用 hook，把读数往下传；
- 或者把 `budget.ts` 改成 import storage 的两个叶子模块。

**验证**：

- 新增与改动的用例都先对旧代码跑红：settings-view 的两个 LLM 派发用例（带与不带 `?resume`）失败；llm-config-card 的 8 个用例里 7 个因找不到预算输入框失败，剩下的「读不到账本时不渲染读数行」是反向守卫，旧代码上本来就绿；hook 的测试因模块不存在失败。
- 变异检查：去掉 hook 里的 `watched` 判断，「watch 先到时初读不覆盖」用例失败。
- 复核补了三个用例：Embedding 保存 reject 不派发；初读失败后 watch 能恢复读数；StrictMode 双挂载。
- `pnpm compile`：通过。
- `pnpm test`：根目录 247 个文件 / 2290 个用例，packages 15 个文件 / 263 个用例，全绿。
- `pnpm build`：通过，background graph 仍是 14 个模块，新 hook 没有进 SW 的模块图。
- 没有在浏览器里看过设置页的新布局与读数行。
