# 38 临时限流的可恢复等待（2026-10-09）

> 状态：**代码 + 单测已完成 2026-10-09，未提交（待用户审阅）**。恢复抖音积压的实机运行（含 §1 D6 的 UPDATE）不在本任务内。
>
> 起因：docs/37 Step 4 实测，Groq `on_demand` 档的 ASPH（每小时音频秒数，7200 s/h）限流下，自动转录状态机「临时限流重试一次、再失败就 `markError`」让 31 条被限流的条目里 5 条（16%）永久落 `'error'`。v1 没有 `'error'` 的重试入口，抖音 D7 积压只捡 `'pending'`；剩余积压 347 条 / 40 h 音频，不修按比例还会再丢约 50 条（docs/37 Step 4 新发现 2）。
>
> 规则的 owner：`lib/auto-transcribe/CLAUDE.md`（判定与等待）、`lib/douyin/CLAUDE.md`（候选直链 memo）、`lib/offscreen/CLAUDE.md`（分块续传）。本文只记决策、否决与落地经过。

## §1 决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **临时限流不计次、不标 error**：带 `retryAfter` 且不是 quota 的失败，条目不出队，session 在 `'paused'` 倒计时后重试同一条，次数不设上限；条目在库里保持 `'pending'`，关掉 app.html 后由 D7 积压捡回 | 限流是供应方的节流，不是条目的故障；上限 = 永久丢条目 |
| D2 | **递增退避**：等待 = `max(retryAfter, min(600, 60·2^(k-1)))` 秒，k = session 内连续收到的临时限流次数（第一次 k = 1），任何其他结果（成功、普通失败、抛错、停放、quota）即复位。60 / 600 是 `lib/auto-transcribe` 的模块常量 | ASPH 的 `retry-after` 不可靠：等满 21 / 7 / 8 s 仍被拒，实测 p50 83 s、max 405 s。共享模块，不走平台 `envNumber` |
| D3 | **判定顺序契约不变**：前置条件 → `ASR_QUOTA_EXCEEDED` → 临时限流（按形状）→ 普通失败 | quota 也带 `retryAfter`，必须先判 |
| D4 | **抖音重试不重签**：Background 的抖音 handler 按 `aweme_id` 记候选直链列表（SW 生命周期单例，TTL `VITE_DOUYIN_AUDIO_URL_TTL_MS` = 30 min，容量 `VITE_DOUYIN_AUDIO_URL_MEMO_SIZE` = 32，超出淘汰最旧）；extractor 最先查它，命中则不查标签页、不等节奏器、不发 detail | Step 4：123 次 detail 里 30 次是限流后的重试，把 a_bogus 计数与风控暴露放大约四分之一。TTL 远小于直链约 3 h 的过期：memo 里过期的直链会让下载落 `DOWNLOAD_FAILED` 而丢条目 |
| D5 | **分块断点续传**（用户决定 2026-10-09）：Offscreen 对自己下载的音频字节算 sha256，进度表 key = 哈希 + model + baseUrl，值 = 分块计划 + 已合并行 + 下一块下标；每成功一块写一次，整条成功删除；计划不逐项相等就丢弃从头来。只存行、不存块字节，TTL 24 h、LRU 8。SW↔Offscreen 协议与 SW 的 `finally` release 都不改 | 只做 D1 会引入新故障：任一块 429 即整条重来，总音频超过每小时额度的作品（积压最长 9124 s）在队头无限循环、每轮烧光一小时额度、卡死其后全部条目。docs/37 Step 4 新发现 4「新发现 2 的修法能接住它」因此不成立（已在 docs/37 勘误）。续传后已转完的块不再丢，而一块 ≤ `CHUNK_SECONDS`（600 s，末块最多再并入 < 45 s）≪ 7200 s：每次额度恢复都至少能过下一块，所以必然结束（单次重试仍可能在同一块再撞 429，那只是多等一轮） |
| D6 | **Step 4 已落 `'error'` 的 5 条**（用户决定 2026-10-09）：不写代码、不做迁移；恢复积压的那次实机运行里经 CDP 对本机库执行一条 UPDATE 翻回 `'pending'`，执行前列出 id 给用户确认，由下一次同步的 D7 追加进队列 | 扩展未发布，没有用户数据要迁移 |

后果：B站自动转录走同一个状态机和 Offscreen，自动受益；B站视频页面板（content script 直发 `TRANSCRIBE_AUDIO`）不经状态机，只在用户手动重试时受益于 Offscreen 分块续传。代价是 Offscreen 多一份常驻的进度表（最多 8 条的行）。

## §2 否决清单（后续不得重提）

| 路线 | 否决理由 |
|---|---|
| 单条重试上限 + 延后到下次同步 | 在症状上打补丁：长作品永远转不完，每个 session 白烧 N × 7200 s 额度 |
| 在 Offscreen 里撞 429 原地等待、再重试同一块 | SW 一直挂着等 Offscreen 的应答，单个事件处理超过 5 min 会被 Chrome 终止 `[UNKNOWN]`；Offscreen 的转录也不认取消信号。等待留在 app.html 的状态机里 |
| 新相位 / 新文案 | `'paused'` 的文案 `autoTranscribe.paused`（「速率限制，暂停 {{seconds}}s...」）本来就不针对特定供应商 |
| memo 音频字节 | 每条最多 24 MB 常驻内存；CDN 重下不计风控 |
| 让 SW 在请求里带「从第几块开始」（改 SW↔Offscreen 协议） | 进度只有 Offscreen 知道（它下载、切块、拿 ASR 的行）；搬到 SW 要改 schema、路由与 contract test，SW 重启还会丢。按字节哈希续传对 SW 透明 |
| 进度表按音频 URL 作 key | 同一音轨的候选直链换主机（抖音 `main_url` / `backup_url` / `fallback_url`）就续不上；URL 还带过期签名 |

## §3 落地记录（2026-10-09，代码 + 单测，未提交）

执行稿是任务目录 `prd.md`（`.trellis/` 不进版本库，决策以本文为准）。

### 做了什么

- `lib/auto-transcribe/pipeline.ts`：删掉 `rateLimitRetried`；run 作用域新增 `consecutiveRateLimits`，临时限流分支 `+1` 后按 D2 等待，等完过一次 `control?.checkpoint()` 再重发；离开单条重试循环（结果、普通失败、停放）、quota 分支、抛错的 catch 三处复位。
- `lib/douyin/douyin-api.ts`：`createDouyinAudioUrlMemo({ ttlMs?, capacity? })` 与两个 env 常量，放在 `createDouyinDetailPacer` 旁边。`lib/douyin/douyin-transcription-handler.ts`：`DouyinTranscribeSession.audioUrls` 必填；`resolveAudioSources` 最先查 memo，回声闸门与 `pickAudioSourceUrls` 都过了才写；模块级单例 `audioUrlMemo` 与 `detailPacer` 并列。import 白名单不变。
- `lib/offscreen/chunk-progress.ts`（新，零 I/O）：`chunkProgressKey`、`createChunkProgressStore`、`transcribeChunksResumable`（续传循环）。`lib/offscreen/ffmpeg-subsystem.ts`：`doPrepare` 对下载的字节算 `sha256Hex` 存进 chunk session，`doTranscribe` 改为接线。`lib/transcription/audio-fingerprint.ts`：私有的 sha256 提成导出的 `sha256Hex(bytes)`，`assertAudioNotReused` 行为不变。
- env：`tests/platform-env-constants-guard.test.ts` 登记两个键；`.env.example` 与 `.env.local` 的抖音块各加两行（后者只加注释与留空的 key——守卫在文件存在时也校验它）。
- 文档：三份 owner `CLAUDE.md`；`entrypoints/app/sections/douyin/CLAUDE.md` 删掉已不成立的「风控冷却期间条目会落 `'error'`」；docs/37 Step 3「未做」、Step 4 新发现 2 / 4 与「未做」加指针，新发现 4 勘误。根 `CLAUDE.md` 不动：动这几个目录时 owner `CLAUDE.md` 已指到本文。

### 对 PRD 的偏离

1. **限流等待之后多一个 checkpoint**（PRD 未写，主会话补的要求）：等待可长达 30 min，期间按下的 Library Gate 暂停必须挡住重发。checkpoint 位置是契约，`lib/auto-transcribe/CLAUDE.md` 的清单已补上它，也补上了原本就有、清单漏列的 quota 等待之后那一个。
2. **抛错（`transcribe` reject）也复位 k**：PRD 列的是成功、普通失败、停放、quota；抛错在本模块里按普通失败处理（`markError` 后下一条），一并复位。
3. **改了三个既有用例**：删「retries a platform rate limit once … then marks the item on a second failure」（行为反转，被 D1 / D2 的新用例取代）；删「waits for the provider retry delay before retrying a temporary rate limit」（`retryAfter` 2 s 现在等 60 s，由「1800 s 冷却取 `retryAfter`」一例取代）；「pauses when the retry response reports daily quota exhaustion」把推进 1 s 改为 60 s——它是「先限流后 quota」的混合用例，限流那一段的等待变成了下限。纯 quota 与前置条件的用例一字未改。
4. **memo 放在 `douyin-api.ts`** 而不是 `douyin-media.ts`：后者的白名单不许 import `@/lib/env`；放在节奏器旁边，handler 的 import 白名单也不用扩。TTL 从写入时刻算；淘汰最早写入的（重新写入算最新，读不刷新顺序）。
5. **续传循环与进度表同在 `chunk-progress.ts`**：这样「第 k 块 429 后续传、结果与一次跑完逐字节相同」能用假 ASR 做纯单测，`ffmpeg-subsystem.ts` 只剩接线。第 0 块与其余块走同一个 `mergeTimestampedChunkRows`（累积为空时它不裁剪不去重、只平移），输出与旧代码的 `i === 0` 分支相同。
6. **进度表的 LRU 把一次续传算作使用**；TTL 从最后一次写入算。
7. 加了 PRD 验收之外的三条守卫：回声闸门不符的 detail 不进 memo；同一字节从另一主机下载照样续上（证明 key 是字节哈希而不是 URL）；key 不能靠挪分隔符伪造。

### 先红证据（每组先写测试、对旧代码跑一次）

| 文件 | 改实现前 |
|---|---|
| `lib/auto-transcribe/pipeline.test.ts` | 9 failed / 24：三次连续限流 `expected [ 2 ] to deeply equal [ 60 ]`；封顶 `expected [ 2 ] to deeply equal [ 60, 120, 240, 480, 600, 600 ]`；1800 s `expected [ 1800 ] to deeply equal [ 1800, 1800 ]`；复位四例 `expected [ 2, 2 ] to deeply equal [ 60, 120, 60 ]` 等；`stop()` `expected 'done' to be 'cancelled'`；checkpoint `expected "vi.fn()" to be called 1 times, but got 2 times` |
| `lib/douyin/douyin-api.test.ts` | `createDouyinAudioUrlMemo is not a function` ×6 |
| `lib/douyin/douyin-transcription-handler.test.ts`（memo 已实现、handler 未接线） | 1 failed：TTL 内的重试 `expected { success: false, error: { …(3) } } to deeply equal { success: true, … }`（第二次又发 detail，脚本耗尽） |
| `tests/platform-env-constants-guard.test.ts` | `envNumber keys not registered … VITE_DOUYIN_AUDIO_URL_TTL_MS / VITE_DOUYIN_AUDIO_URL_MEMO_SIZE` |
| `lib/offscreen/chunk-progress.test.ts` | 模块不存在 |
| `lib/offscreen/ffmpeg-subsystem.test.ts` | 1 failed / 5：`expected [ +0, 1, 2, 3 ] to deeply equal [ 2, 3 ]`（重试从第 0 块重来） |

对旧代码本来就绿的用例（「不该复用」一侧：TTL 过后、另一个 `aweme_id`、失败不记、跨字节 / model / baseUrl / 计划不续传）是防过度复用的守卫，由下表的变异证明不是空断言。

### 证伪（每次改一处、跑对应测试文件、还原；还原后 sha256 与改前一致）

| # | 改动 | 变红 |
|---|---|---|
| P1 | 先判 `retryAfter` 再判 quota（docs/37 Step 3 M1） | 4 例（含「judges a daily quota before the retryAfter shape」超时、「pauses when the retry response …」断言） |
| P2 / P3 | 去掉下限 / 去掉封顶 | 8 例 / 1 例 |
| P4′ / P6 / P7 | 离开重试循环不复位 / quota 不复位 / 抛错不复位 | 3 例 / 1 例 / 1 例 |
| P8 | 限流等待后不过 checkpoint | 1 例 |
| P9 | 恢复「只重试一次」 | 4 例 |
| D1 | memo 挪到 T1 之后 | 1 例 |
| D2 / D3 | 不写 memo / 回声闸门之前就写 | 1 例 / 1 例 |
| D4 | memo 不认 key（返回最新一条） | 4 例 |
| D5 / D6 | TTL 边界改成 `>` / 去掉 TTL | 各 2 例 |
| D7 / D8 / D9 | 不淘汰 / 返回的列表与内部共享 / 重新写入不刷新顺序 | 3 例 / 1 例 / 1 例 |
| C1 / C2 | 进度不写 / 成功后不删 | 6 例 / 5 例 |
| C3 / C4 / C13 | 计划不比 / 只比长度 / 不符的条目跳过但保留 | 6 例 / 6 例 / 5 例 |
| C5 / C6 | key 不含 model 与 baseUrl / key 用分隔符拼 | 3 例 / 1 例 |
| C7 | 按 URL 而不是字节哈希作 key | 1 例 |
| C8 / C9 / C10 | 去掉 TTL / 不淘汰 / 续传不算使用 | 1 例 / 1 例 / 6 例 |
| C11 / C12 | 存的行与调用方共享 / 忽略进度、总从第 0 块开始 | 1 例 / 5 例 |

### 验证（2026-10-09）

- 聚焦集：`pnpm vitest run lib/auto-transcribe lib/douyin lib/offscreen lib/transcription lib/background lib/bilibili tests/platform-env-constants-guard.test.ts tests/agent-bridge-background-bundle-contract.test.ts tests/http-fetch-deadline-guard.test.ts tests/platform-sleep-guard.test.ts tests/platform-completeness-contract.test.ts tests/lib-import-smoke.test.ts entrypoints/app/sections/douyin entrypoints/app/sections/bilibili entrypoints/app/hooks`：79 文件 / 761 例全过。
- `pnpm compile`：通过。
- `pnpm test`：根 238 文件 / 2093 例、`packages/*` 15 文件 / 263 例全过，零偶发超时。
- `pnpm build`：`[bundle-contract] background graph 14 modules / 963108 bytes`（同机同日改前基线 14 modules / 962605 bytes，多出的 503 字节是 memo 与 handler 的改动），PGlite 标记 / dangling initializer / 动态 `import()` 零命中；`background.js` 里 `douyin-sync-service` / `pglite` 零命中。
- manifest：改前基线 build 与改后 build 的 `.output/chrome-mv3/manifest.json` 逐字节相同（`cmp`，sha256 `f01ee304…`）。

### 复核（2026-10-09，trellis-check）

逐条核对 PRD 的六条需求与验收、判定顺序契约、三份 owner `CLAUDE.md`、SW↔Offscreen 协议（未改）、`assertAudioNotReused`（行为不变）、Offscreen 加载期无定时器、第 0 块合并等价（累积为空时 `mergeTimestampedChunkRows` 不过滤、不去重，只平移，与旧 `i === 0` 分支相同；静音块同理）、memo 的拷入拷出与写入时机。品味评分：好。改了三处，都先红后绿：

1. **checkpoint 放行后不查 abort**（`pipeline.ts` 限流与 quota 两个分支）：checkpoint 不认 `stop()`，Library Gate 暂停期间按下的停止会在放行后让同一条重发，普通失败还会 `markError`，session 以 `'done'` 而不是 `'cancelled'` 结束。quota 那个是既有缺口，本任务把等待拉长到分钟级后才真正可达。两处补 `ac.signal.throwIfAborted()`，与领取每条视频前同形。先红：新用例两行（限流 / quota）`expected 'done' to be 'cancelled'`；单撤限流分支那一行只红限流一行。
2. **`'paused'` 倒计时逐 tick 递减**：后台标签页的定时器被节流时显示的秒数漂移，等待从几秒变成 60–1800 s 后可见。`startCountdown` 改为一律从 deadline 算——quota 原有的「按 `quotaResetAt` 算」是它的特例，一并消掉。先红：`expected 59 to be 9`。
3. 本文两处措辞：§1 D5「每次重试至少前进一块」改为「额度恢复后至少能过下一块」（单次重试仍可能在同一块再撞 429）；「后果」里 B站视频页面板不经状态机（content script 直发 `TRANSCRIBE_AUDIO`），只受益于分块续传。`pipeline.ts` 计数器注释「across items」不准（任何出循环都复位，计数从不跨条目），改了。
4. `lib/auto-transcribe/CLAUDE.md` 加两条：checkpoint 放行后再查 abort；倒计时从 deadline 算。

验证（复核改动之后）：`pnpm vitest run lib/auto-transcribe lib/douyin lib/offscreen lib/transcription tests/platform-env-constants-guard.test.ts tests/agent-bridge-background-bundle-contract.test.ts entrypoints/app/components/auto-transcribe entrypoints/app/sections/douyin entrypoints/app/sections/bilibili`：32 文件 / 395 例全过；`pnpm compile` 通过；`pnpm test` 根 238 文件 / 2096 例、`packages/*` 15 文件 / 263 例全过，零偶发超时。改动只在 app.html 侧的 `lib/auto-transcribe`，不在 SW 图上，没有重跑 `pnpm build`。

### 残留与未知

- **持续的抖音风控冷却**：`DOUYIN_RATE_LIMITED` 的 `retryAfter` 是 1800 s，session 停在队头那一条，每 ≥ 30 min 发一次 detail 签名请求（detail 失败不进 memo），不设上限；修之前是每条 1–2 次后落 `'error'`、接着打下一条。用户看到的是 1800 s 的 `'paused'` 倒计时，可以用 Library Gate 暂停。恢复积压的实机运行里看它实际出现的频率。
- memo 命中的直链若在下载时已被 CDN 作废（早于约 3 h 的过期段），下载落 `DOWNLOAD_FAILED`，按普通失败落 `'error'`。TTL 30 min 让它不太可能发生；没有做「下载失败即作废 memo」。
- 进度表只在 Offscreen 内存里：扩展 reload、浏览器重启会丢，续传从头。
- 分块条目的每次重试仍下载两次（SW 下整条判大小与指纹、Offscreen 再下一次）并重切一次；CDN 不计风控，FFmpeg 切块是本地开销。
- Groq ASPH 是不是滑动窗口 `[UNKNOWN]`：续传后每块 ≤ 约 645 s ≪ 7200 s，结论不依赖它。
- B站与抖音两个 session 共用一把 Groq key 时的 ASPH 争用、`job-registry` 一个 tab 一个转录 job 的串台缺口：本任务范围外。
