# 37 抖音字幕与转录接入手册（2026-10-08）

> 状态：**草案；Step 0 已完成 2026-10-08（用户账号、BrowserOS neo 实测，只读）**——网页 aweme 对象有 `cla_info` 字段但 136 个样本全空，v1 「优先 AI 字幕」半边改为**直接 ASR**（`fetchOfficialSubtitle: async () => null`，不写 `douyin-subtitle.ts`）；另发现纯音轨 `video.bit_rate_audio[]`，D-g 据此修订。证据在 Step 0 落地记录与任务目录 `research/douyin-step0-subtitle-media-probe-2026-10-08.md`；**Step 1 已完成 2026-10-08（内容模型翻转 + 领域层；代码 + 单测，已复核，commit 3f3babe）**，按任务目录 `info.md` 执行，其 §0 四条裁决（D6 的 desc 也空 → `'no_content'`、`decodeDetail` 空 payload 抛冷却错误、`pickAudioSourceUrls` 三级全拼、入库门用 D-f 谓词）是对本文的有意偏离，见 Step 1 节末「Step 1 落地记录」；**Step 2 已完成 2026-10-08（Background handler；代码 + 单测，已复核，commit 1b0b227）**，按任务目录 `info.md` 的 Step 2 节执行，其 §0 九条裁决（detail 懒到 ASR 路径里取、共享下载器收候选列表、extractor 的结构化错误透传、`douyin-api` 两个具名错误类、`aweme_id` 回声闸门等）是对本文的有意偏离，见 Step 2 节末「Step 2 落地记录」；**Step 3 已完成 2026-10-08（app 侧：前置条件泛化、Transcript lane、积压补扫、pipeline 条、角标；代码 + 单测，已复核，commit 0afb943）**，按任务目录 `info.md` 的 Step 3 节执行，其 §0 十一条裁决加复核后一条（前置条件返回「缺哪种」、签名被拒也停放、等用户动作期间短路转录、login / verify 等标签页重新加载、producer 与 ASR 半边各提一份共享实现、角标列走共享分页查询、已有 session 在跑时跳过积压等）是对本文的有意偏离，见 Step 3 节末「Step 3 落地记录」；判据里的清库与实机部分留到 Step 4。**Step 4 已完成 2026-10-09（实机端到端，零代码；commit b6ebfab）**：清单 1–9 全部有记录，本页签名到 156 次零拒绝、Groq 接受 mp4 直传、D5 / D7 实测通过；新发现两项缺陷——Whisper 在静音短视频上输出非空幻觉套话（D6 接不住，10%）、Groq `on_demand` 档 ASPH 限流下「重试一次」永久丢条目（16%）且每次重试重发 detail 签名请求——见 Step 4 节末「Step 4 落地记录」，剩余积压暂停在 `'pending'`。§1 的 D1–D7 是待用户确认的决策（每条带推荐项）；D-a 起是写手册时由代码核对推出的设计默认项。一次对话只做一个 Step；执行任一 Step 前先读 §1 决策、§2 否决清单、§3 铁律，再读该 Step 的八段。
>
> 任务目录：`.trellis/tasks/10-08-douyin-transcription-subtitle-first-asr-fallback-tagging-reuse-bilibili-flow/`。前置手册：`docs/33`（抖音收藏接入，Step 0–3 已落地）、`docs/04`（B站转录管线）、`docs/29`（B站字幕串台事故与归属校验）。
>
> 起因：用户 2026-10-08 要求「抖音收藏的视频已经拿到了，但没有字幕。视频优先 AI 字幕，没有 AI 字幕就转录，然后保存内容到数据库，然后打标签。这些 B站都写了，尽量复用」。

---

## 0. 结论

| 问题 | 结论 | 证据 |
|---|---|---|
| B站链路能复用多少 | **转录策略管线、ASR 客户端、音频下载、Offscreen 分块、字幕缓存、串行转录状态机、处理 lane（Embed / Tag）、pipeline 条、配置阻塞横幅全部按原样复用，零平台分支**。要新写的只有抖音的三块平台碎片（§4.1 表）：取媒体地址与字幕轨（经抖音标签页）、WebVTT → `SubtitleRow[]` 解析、落库 seam | `lib/transcription/CLAUDE.md:13`「新增平台：建 `lib/<platform>/<platform>-transcription-handler.ts` … 在 `platformHandlers` 注册一行」；`lib/cache/CLAUDE.md`「新平台直接传自己的 platform 字符串」；`lib/auto-transcribe/CLAUDE.md`「平台 adapter 只提供单条转录、错误标记…」 |
| 「打标签」要做什么 | **不写新代码**。转录落库后调 `enqueueCollectionProcessingItem` 进共享 Embed / Tag lane（抖音同步已在用它，`entrypoints/app/sections/douyin/douyin-sync-adapter.ts:55-62`）；打标签的输入在 descriptor 加 `descriptionField: 'desc'` 后自动带上文案 | `lib/tagging/tagging-service.ts:101-128`：标题 + 作者 + `platformMeta[descriptor.descriptionField]` + `item_contents.plainText` |
| 真正的难点 | 不在转录，在**内容模型**：抖音今天把 `desc` 当正文、入库即 `'chunked'`、随即打标签（`lib/douyin/douyin-sync-service.ts:406-407`）。转录后替换正文**不会重新打标签**（`collection-processing-policy.ts:119`：Tag 候选 = 尚无标签）。所以视频必须像 B站一样以 `'pending'` 入库、转录后才进 Embed / Tag（D1） | §1 D1 |
| 抖音有没有「AI 字幕」接口 | **字段有，样本零**（Step 0 实测）。网页播放器读 aweme 顶层 `cla_info: { list: [{ id, url, language }], original_language_info }`（不是开源解析器读的 `video.cla_info.caption_infos[]`，那是移动端形状）；但收藏列表、detail、related、搜索、精选公开课共 136 个 aweme 对象里 `cla_info` 全部缺失或 `null`。**v1 直接 ASR**，`cla_info` 只作将来的钩子记在 §4.2 | Step 0 落地记录；research/`douyin-step0-subtitle-media-probe-2026-10-08.md` §4 |
| 音频从哪来 | **首选纯音轨 `video.bit_rate_audio[0]`**（Step 0 实测：DASH fMP4、AAC HE v2 48 kbps，99 s 视频 0.6 MB，约为最低 mp4 档的 1/10；20 条样本里 13 条视频有（1 条有 2 档）、6 条视频 `null`（15 / 23 / 35 / 43 / 53 s 与一条 2022 年的 170 s 老视频：除老视频外都 ≤ 53 s，正好是 mp4 退路也很小的短视频）、图文 `null`），退路是最低码率的 `format: 'mp4'` 档。写手册时「抖音网页没有纯音轨流」是错的。现有链路吃得下：`fetchAudioBlob` 把下载的字节当 `audio/mp4` 给 Groq（Groq 接受 mp4），超 24 MB 走 Offscreen FFmpeg，那里本来就 `-vn -map 0:a:0 -c:a copy` 抽音轨 | `lib/transcription/audio-extractor.ts:4-54`、`lib/offscreen/ffmpeg-subsystem.ts:187-196`、`lib/transcription/constants.ts:1` |
| 媒体地址何时取 | 转录时经抖音标签页发一次 `aweme/v1/web/aweme/detail/`（受 Argus 签名保护，SW 直连不行），不在同步时存 URL（会过期，且 SW 读不到 `platform_meta`）。Background handler 自己 prepare，与 B站同形（D3） | §1 D3；docs/33 `research/douyin-request-signing.md` 第 72 行受保护路径表含 `detail/` |
| 需要新表 / 迁移吗 | 不需要。`contentState` 是普通 text 列；`item_contents.subtitle_source` 已存在。**但库里现有的抖音行要清掉重拉**（D2） | §1 D2 |
| manifest 变化 | **零**。CDN 下载靠 bookmarks 的 `<all_urls>`（`lib/collections/platform-descriptor.ts:159`），`scripting` 与 `https://www.douyin.com/*` 已在。Step 2 的判据之一是 manifest 逐字节不变 | `wxt.config.ts:49-73` |

---

## 1. 决策记录

### 1.1 待用户确认（每条给推荐项）

| # | 决策 | 推荐 | 备选与否决理由 |
|---|---|---|---|
| **D1** | **抖音视频的内容模型翻转为 B站式**：descriptor 改 `contentKind: 'transcript'`、`descriptionField: 'desc'`（镜像 bilibili 的 `intro`，`platform-descriptor.ts:119-122`）；可转录的（D-f：`mediaKind === 'video' && durationMs > 0`）视频入库 `contentState: 'pending'`、不写 `item_contents`、不派发处理 lane；转录落库后才经 `enqueueCollectionProcessingItem` 进 Embed / Tag（Step 1 勘误：原写「`mediaKind === 'video'` 的条目」，入库门改用 D-f 谓词，无时长的视频与图文同形——否则它们永远 `'pending'`、永远进不了 producer，见 Step 1 落地记录）。图文（`images` 非空）维持现状：`desc` 即正文、入库 `'chunked'`、同步时派发 | **做**。否则：① 转录替换正文后不会重新打标签（`collection-processing-policy.ts:119` Tag 候选 = `not(hasTag)`，`tagging-service.ts:71-72` 注释明说「re-transcription won't re-tag」），标签永远停在只看过文案的版本；② Coverage 的 content 段会在转录前就显示 100%（`'chunked'` 已算 done，`:102-105`），pipeline 条的「转录」段没有意义 | A′ 保留文案正文、转录后重打标签：要么删标签重跑（在共享 lane 上为一个平台加特殊路径），要么改 Tag 候选谓词（破坏「幂等、重转录不重打」的既有契约）。否决。<br>A″ 正文 = 文案 + 转录拼接：切块与 `subtitle_source` 语义都混掉。否决 |
| **D1 的副作用，一并确认** | 图文的正文就是 `desc`，加了 `descriptionField: 'desc'` 后打标签 prompt 会把 `desc` 喂两遍（descriptor 注释 `platform-descriptor.ts:100-107` 明确提醒过这种重复） | **接受**：重复的是一段通常 < 200 字的文案，代价是 prompt 多几十 token；为它在共享 tagging 里加「description 与 content 相同则跳过」属于为一个平台加判断 | 给抖音分两个 `contentKind`：descriptor 是按平台一份，拆成按 mediaKind 两份要动 `lib/chat/tools.ts:57-59` 的 `CONTENT_KIND_LIST` 与 completeness contract。否决 |
| **D2** | **库里现有的抖音行清掉重拉**（2026-10-07 Step 3 实测留下的 466 条，全部 `'chunked'` + 已派发打标签） | **清**（同 docs/33 Step 3 清库先例，用户批准后执行）。扩展未上线、无用户数据（memory：don't design migrations），insert-only 下入库后也改不回 `'pending'` | 写一次性修复把视频行退回 `'pending'` 并删标签：为测试数据写迁移。否决 |
| **D3** | **媒体地址与字幕轨在 Background handler 里现取**：`lib/douyin/douyin-transcription-handler.ts` 用 `douyinTabTransport`（`lib/douyin/douyin-tab.ts:147-168`，SW 里 `browser.tabs.query` / `browser.scripting.executeScript` 都可用）发 `aweme/v1/web/aweme/detail/?aweme_id=`，从响应按 D-g 取音频候选（Step 0 后不再取字幕轨：`cla_info` 零样本） | **做**。与 `lib/transcription/CLAUDE.md:13`「各平台 handler 完全独立」同形；SW 只需要 `videoId`（= `aweme_id`），wire schema 不动（`platform` 本来就是自由字符串，`lib/background/message-protocol.ts:56`） | B 同步时把 `play_addr` / 字幕 URL 写进 `platform_meta`：URL 带签名会过期（TikTok 同形字段带 `url_expire`，抖音 `[UNKNOWN]`），而且 SW 没有 PGlite、读 meta 要走 read proxy 或改 wire。否决。<br>C 同步时在内存里把 aweme 对象连 URL 一起交给转录 producer、`TranscribeRequest` 带 URL：改 wire schema、handler 不再自给自足、断掉的 session 重启后仍要 detail。否决（若 Step 4 实测 detail 请求被签名门禁拒绝，再回到这里重议） |
| **D4** | **节奏**：每条视频的 detail 请求经一个转录专用的节奏器，常量 `VITE_DOUYIN_DETAIL_DELAY_MIN_MS` / `_JITTER_MS`（铁律 7），只控 detail 请求间隔，不像同步那样每 25 次长休息 | **做，默认 5000 / 3000**（与同步页间隔同值）。ASR 路径每条本来 ≥ 10 s，节奏器实际只约束字幕命中路径的连发。首次积压（约 466 条）会在同一个标签页生命周期里发 466 次签名请求，远超 a_bogus 分桶里的「140 次」（docs/33 §6 `[UNKNOWN]`，同步最多到 28 次）——这是 Step 4 要盯的第一个数字 | 复用同步的 `createDouyinPacer`（含 25 次一次 1–3 分钟休息）：转录间隔已够长，再加长休息是把 8 小时的积压拉成一天。否决 |
| **D5** | **抖音标签页缺失时转录 session 的行为**：session 派发前门（无标签页不派发、不算错误）；session 进行中标签页关掉 → handler 返回新错误码 `DOUYIN_TAB_MISSING`，`lib/auto-transcribe` 把它当「缺前置条件」停放当前条目并等待，**不**逐条标 `'error'` | **做，把「缺 ASR key」泛化为「缺前置条件」**：`AutoTranscribeAdapter.hasAsrKey / waitForAsrKey` 改名为 `isPrerequisiteMissing(error) / waitForPrerequisite()`，pipeline 的停放逻辑（`lib/auto-transcribe/pipeline.ts:232-241`）不变，只是判定由 adapter 决定；B站 adapter 的实现仍只认 `ASR_INVALID_KEY && !hasKey`。**判定必须是「此刻」的，照 ASR 守卫的形状** `code === 'ASR_INVALID_KEY' && !(await hasAsrKey())`：抖音 adapter 收到 `DOUYIN_TAB_MISSING` 后再查一次 `findDouyinTab()`，为 null（或 reason 是 `login` / `verify`）才停放；标签页在、只是瞬态失败，就是普通单条错误（§4.3 T2 的空转风险） | 不泛化、错误即标 `'error'`：标签页一关，一分钟内整份积压全部落 `'error'`、永不重试。否决。<br>在 adapter 的 `transcribe()` 里自旋等标签页：那个签名没有 checkpoint，暂停失效。否决 |
| **D6** | **转录结果为空（无口播、纯 BGM）时**：`persistExistingItemContent` 对空文本返回 `null`（`lib/ingest/ingest.ts:300-301`），B站条目因此停在 `'pending'`、永不再入队——这是 B站今天的缺口。抖音无口播视频比例高得多，必须收口 | **空转录 → 正文退回 `desc`**（`subtitle_source: null`，`desc` 也空则 `'no_content'`）。条目在知识库里的样子等于今天（文案可检索、可打标签），只是多了一次 ASR 的代价 | 空转录 → `'error'`：把「没话说」当故障，Coverage 的 error 数失真。否决。<br>空转录 → `'no_content'`：丢掉今天已经有的文案正文。否决 |
| **D7** | **积压补扫**：B站的 Transcript producer 只吃本次同步新插入的条目，关掉 app.html 丢 session 后留下的 `'pending'` 只能靠卡片上的手动转录按钮救（`lib/auto-transcribe/CLAUDE.md`「不查历史 pending」、`sections/bilibili/CLAUDE.md`「mount 也不扫历史 pending」）。抖音 v1 不做手动按钮，`'pending'` 会越积越多 | **每次同步运行末尾把本平台 `'pending'` 的视频条目追加进同一个 Transcript producer**（查 DB，不查远端；在 `runDouyinSync` 里、funnel 之内）。这不违反 `lib/auto-transcribe` 的约束（那条约束管的是 lib 模块自己不查 pending；app 侧 producer 喂什么由平台 adapter 决定） | 挂载时补扫：违反「同步只由按钮触发」（`sections/douyin/CLAUDE.md`）且每次开页面都要标签页。否决。<br>照抄 B站、先做手动按钮：用户要的是自动链路；手动按钮列为后续项（§5 Step 4「未做」） |

### 1.2 设计默认项（写手册时由代码推出，后续 Step 不得无理由改回）

| # | 默认项 | 理由 |
|---|---|---|
| D-a | **字幕来源标签仍是 `'official' \| 'asr'`**，抖音 AI 字幕记 `'official'` | `lib/subtitle/CLAUDE.md`：`SubtitleSource` 按转录方法区分，不加平台名；`item_contents.subtitle_source` 与卡片的 CC / ASR 角标都认这两个值 |
| D-b | **`postProcess` 对抖音是恒等函数**，不复用 `processSubtitles` | 那是 B站特有的后处理（过滤点赞、投币话术），`lib/bilibili/CLAUDE.md`「别搬进 `lib/transcription`」。抖音字幕没有这类话术；要过滤什么等 Step 4 看样本 |
| D-c | **`transcribeAndPersist` 的平台无关核心提到 `lib/transcription/`**，平台只注入 `platform` + 落库函数 + `markError` | 它今天硬编码 `PLATFORM = 'bilibili'` 与 `persistContentChunks`（`lib/bilibili/transcribe-utils.ts:10, 40-86`）。抖音是第二个真实调用方——全局规则「抽象等重复真实出现再做」此刻成立。逐字节 videoId 闸门、`item-content-updated` 事件、`startProcessing` seam 三件事对抖音完全一样；B站侧改成薄包装、行为不变、测试照过。**不与 `lib/transcription/CLAUDE.md:13`「各平台 handler 完全独立，不抽共享 adapter 接口」冲突**：那条管的是 SW 侧的平台 handler（prepare + 组 deps），这里提的是 app 侧的落库 seam；SW handler 抖音照样独立写一份。新文件进 `tests/lib-import-smoke.test.ts` 清单（它的加载图必须 storage-free，同 `transcribe-utils.ts`） |
| D-d | **`lib/auto-transcribe` 与 `AutoTranscribeBar` / `use-auto-transcribe` 不复制，参数化 pipeline 实例** | `AutoTranscribeBar` 只吃 `AutoTranscribeState`（`sections/bilibili/auto-transcribe-bar.tsx:11`），`useAutoTranscribe` 只差一个 pipeline 单例（`use-auto-transcribe.ts:9`）。把 bar 挪到 `components/`、hook 接收 pipeline 参数，B站零行为变化 |
| D-e | **抖音 v1 只做自动转录（同步后流式 + D7 积压），不做卡片上的手动转录 / 取消按钮** | `TranscriptionCoordinator` 深度绑定 B站类型（`BiliFavVideo`、`isProcessableVideo`、`getEmbeddedBvids`、cache `'bilibili'`，`lib/bilibili/transcription-coordinator.ts:1-12`），泛化它是另一个 Step 的活。卡片的 `footer` slot（`components/collection/collection-card.tsx:53-54`）留着，字幕来源角标（CC / ASR）v1 就加 |
| D-f | **转录只认 `mediaKind === 'video' && durationMs > 0` 的条目**；图文、`duration: 0`、`status.is_delete` 的作品不进 producer | `mapAweme` 已有这两个字段（`lib/douyin/douyin-api.ts:458-460`）。谓词叫 `isTranscribableAweme`，只是内存判定，**不**进 `PLATFORM_DOWNSTREAM_ELIGIBILITY.douyin`：它不是下游排除（图文照样要 Embed / Tag），与 B站 `isProcessableVideo` 的语义不同 |
| D-g | **音频源三级取数（Step 0 修订）**：① `video.bit_rate_audio[0].audio_meta.url_list` 的 `main_url → backup_url → fallback_url`（纯音轨，注意这里的 `url_list` 是对象不是数组）；② 没有纯音轨时取 `video.bit_rate[]` 里 `format === 'mp4'` 且 `is_h265 === 0` 的最低码率档，再退任意 codec 的最低 mp4 档；③ 都没有才 `video.play_addr.url_list`。每级都按 url_list 顺序 fall-through，非 2xx 换下一条 | Step 0 实测：按 `bit_rate` 升序的第一档多半是 h265 + bytevc1 且 `format: 'dash'`（手册原写法会选到它）；纯音轨 `main_url` 的主机 `v26-web` 对无 Referer 的 SW 请求 403（`Forbid_code 020200`），`backup_url`（`v11-weba`）与 `fallback_url`（play API 302）都 200，所以顺序 fall-through 不是可选项。纯音轨把 ≤ 24 MB 直传变成常态（22 min 视频估 8 MB），超限的才进 Offscreen 抽音轨；直传 mp4 时视频轨跟着上传是接受的浪费（Groq 按音频秒计费，不按字节） |
| D-h | **detail 响应的验证码扫描要把 `aweme_detail` 加进容器键** | `scanVerify`（`douyin-api.ts:211-231`）只对 `aweme_list` / `collects_list` 之外的字符串值匹配 `captcha` 等标记；detail 响应的条目在 `aweme_detail` 下，一条讲 captcha 的视频文案会被当成验证页、整条转录以「去验证」失败。`ITEM_LIST_KEYS`（`:200`）加 `aweme_detail` |
| D-i | **detail 的 `status_code: 0` + `aweme_detail: null` + 带 `filter_detail`（如 `status_self_see` / `core_dep`）= 作品不可用的合法结果**，条目标 `'error'`、不算风控 | docs/33 `research/douyin-rate-limiting.md` 第 55 行：dtk 规则 12「payload.explained → business_error」只在 `aweme/detail/` 上观测到。没有 `filter_detail` 的空 payload 仍按 F8 当软风控 |
| D-j | **新错误码四个**：`DOUYIN_TAB_MISSING`（D5；`params.reason: 'closed' \| 'login' \| 'verify'`）、`DOUYIN_MEDIA_UNAVAILABLE`（D-i，含 `filter_detail` 原因）、`DOUYIN_SIGNATURE_REJECTED`（Argus 403 与 `sdk-not-ready`，提示刷新抖音标签页）、`DOUYIN_RATE_LIMITED`（冷却，带 `retryAfter`）；其余折进既有码（无 play URL → `ASR_NO_AUDIO_SOURCE`；Step 2 勘误：原写「5xx / 不可达 → `DOWNLOAD_FAILED`」作废——那是音频下载失败的码，文案会说错；detail 的 5xx 耗尽是 plain `Error` → `ASR_UNKNOWN`，不可达耗尽 → `DOUYIN_TAB_MISSING` + `reason: 'closed'`，见 §4.3 T2 / T11） | 每个码要同步 `lib/runtime-message/schemas.ts:20-37` 的 wire enum、`lib/i18n/index.test.ts:97-100` 的双向 parity、两个 locale 的 `error.<CODE>`（`lib/transcription/CLAUDE.md:14`）。四个各有不同的用户动作（开 / 登录 / 验证标签页；放弃；刷新标签页；等冷却），折不进一个；不借 `ASR_RATE_LIMIT`，见 §4.3 T4 |

---

## 2. 否决清单（后续 Step 不得重提）

| 路线 | 否决理由 |
|---|---|
| 用 `music.play_url`（「原声」）当音轨 | 只在作品用原声时它才是视频音轨；用了授权 BGM 就转录出一首歌。没有可靠的判别字段 |
| SW 直接 fetch `aweme/v1/web/aweme/detail/` | 2026-09-10 / 14 起在 Argus 受保护路径表里（docs/33 `research/douyin-request-signing.md` 第 72 行与 `public-favorites-semantics.md` 第 147 行），SW 直连 403 |
| **自己构造** `https://www.douyin.com/aweme/v1/play/?video_id=<uri>` 稳定播放地址 | 社区 2026-08 起报告 iesdouyin share API 已不返回数据（Phantomlau3674/douyin-video-decoder），现状 `[UNKNOWN]`；而 detail 响应里的 `bit_rate[]` 直链已经够用，不另引入一条待验证路线。（Step 0 实测：服务端在每个 `url_list` 的第 3 条 / `fallback_url` 里**自己给出**带 `sign` / `biz_sign` 的 play API 地址，SW 无 cookie 请求它 302 到新签的 CDN 直链，视频与纯音轨都 200——按 url_list 顺序用它是 D-g 的 fall-through，不是这条否决的路线；否决的是自己拼） |
| 转录时从页面 DOM / `<video>` 元素截流 | 要激活标签页、与 DOM 耦合，docs/33 §2.2 已否决同类路线 |
| 在抖音标签页里（MAIN world）下载音频再传回 SW | 1.6 MB 一页的 JSON 已靠 `executeScript` 结构化克隆回传，几十 MB 的音频走这条路没测过；CDN 直链从 SW / Offscreen 下载本来就是 B站的现成路径，Step 0 先验证它能走 |
| 把 B站的 `TranscriptionCoordinator` 泛化后给抖音做手动按钮 | v1 不做手动按钮（D-e）；泛化是独立任务 |
| 共享 tagging 里加「description 与 content 相同则跳过」 | 为一个平台的图文加判断（D1 副作用，已接受重复） |

---

## 3. 跨 Step 铁律

1. **docs/33 §3 的九条铁律全部继续生效**：detail 请求绝不预填签名参数、`collect*` 才是收藏、id 一律字符串、按形态判失败、403 / 429 不在请求层重试、不碰用户的抖音标签页、数值全走 `envNumber('VITE_DOUYIN_*')` 并登记 env 守卫、测试先红后绿、一次对话一个 Step。
2. **SW 图不得触到 `lib/douyin/douyin-sync-service.ts`**（`:34` 值导入 `@/lib/database`，`:36-49` 导入 entities 与 `lib/ingest`）。handler 只许 import `douyin-api.ts`、`douyin-tab.ts`、新建的纯模块 `douyin-media.ts`，以及 `lib/background/transcription-utils.ts`（`lib/background/CLAUDE.md:27`：import `transcription-handlers.ts` 会成环）。守卫：`scripts/check-background-bundle.mjs`（`pnpm build`，2 MiB 上限、零 PGlite 标记、零动态 `import(`）+ `tests/agent-bridge-background-bundle-contract.test.ts` 新增两条 import 边。
3. **`persistExistingItemContent` 是重转录写正文的唯一入口**（`lib/ingest/CLAUDE.md:26`），`subtitleSource` 如实透传（`'official' | 'asr'`，退回文案时 `null`）。
4. **videoId 闸门逐字节比对**（`lib/bilibili/CLAUDE.md`「转录落库」；aweme_id 是纯数字串，但闸门本身不因平台放宽）。
5. **`lib/douyin/` 零 `fetch(`**（字幕 VTT 与 mp4 都由共享的 `fetchAudioBlob` / Offscreen 下载，或 `fetchWithDeadline`）；`douyin-tab.ts` 的裸 `fetch` 白名单不扩大。
6. **共享模块零平台知识**：`lib/transcription`、`lib/auto-transcribe`、`lib/cache`、`lib/tagging` 里不得出现 `'douyin'` 字面量或 `platform_meta` 的 key（守卫 `tests/platform-completeness-contract.test.ts`）。
7. **图文的同步路径一行不改**：`'chunked'` 入库、同事务写正文、逐页派发、D-g 幽灵清扫全部照旧（`lib/douyin/CLAUDE.md`「同步编排」）。
8. **每个 Step 的文档（目录 `CLAUDE.md`、本文落地记录、`CONTEXT.md` 若动术语）与代码同一个 commit**；commit 只在用户明确要求时做。

---

## 4. 形状速查

### 4.1 B站链路地图与抖音的复用表

| 环节 | B站实现 | 抖音 | 动作 |
|---|---|---|---|
| 策略管线 cache → 官方字幕 → ASR | `lib/transcription/pipeline.ts:81` `runTranscriptionPipeline`，差异经 `PipelineDeps`（`:16-39`）注入 | 同一个函数 | **复用** |
| Background 平台 handler | `lib/bilibili/bilibili-transcription-handler.ts:16`：prepare → 组 deps → 调 pipeline → `notifyTab` | `lib/douyin/douyin-transcription-handler.ts`：prepare = 经 tab transport 取 detail | **新写**（约 80 行，形状照抄） |
| handler 注册 | `lib/background/transcription-handlers.ts:23-25` `platformHandlers` | 加一行 `douyin: handleDouyinTranscribe` | **一行** |
| 官方字幕 fetcher | `lib/bilibili/bilibili-transcription-adapter.ts:20`（wbi/v2 + `ownsSubtitleUrl` 归属校验，B站专属） | **v1 不写**（Step 0：`cla_info` 零样本）。handler 的 `fetchOfficialSubtitle: async () => null`；将来有样本再按 §4.2 的 `cla_info.list[]` 形状补 `douyin-subtitle.ts` | **一行** |
| 音频 URL 提取 | `lib/bilibili/bilibili-api.ts:346` `extractBiliAudioUrl`（DASH 最高带宽音轨） | `lib/douyin/douyin-media.ts` `pickAudioSourceUrls(detail)`（返回有序候选：纯音轨三条 → 最低 mp4 档三条，D-g），下载侧逐条 fall-through | **新写**（纯函数） |
| 音频下载 / 直传 / 分块 | `lib/background/transcription-utils.ts:42` `createTranscribeAudio` → `fetchAudioBlob` → Groq 或 Offscreen | 同一个函数，传入抖音的 `extractAudioUrl` | **复用** |
| 字幕缓存 | `lib/cache/video-cache.ts`，key `local:vc:bilibili:<bvid>` | `getVideoCache('douyin', awemeId)` / `mergeVideoCache('douyin', …)` | **复用**（传平台串） |
| 后处理 | `processSubtitles`（B站话术过滤） | 恒等（D-b） | — |
| 落库 seam | `lib/bilibili/transcribe-utils.ts:40` `transcribeAndPersist` → `persistContentChunks`（`bili-sync-service.ts:168`）→ `persistExistingItemContent` | 核心提到 `lib/transcription/transcribe-and-persist.ts`（D-c）；抖音的 `persistDouyinTranscript` / `markDouyinError` 进 `douyin-sync-service.ts` | **抽核心 + 新写两个函数** |
| 串行转录状态机 | `lib/auto-transcribe/pipeline.ts` `AutoTranscribePipeline`，adapter `lib/bilibili/auto-transcribe-adapter.ts:25` | `lib/douyin/auto-transcribe-adapter.ts`（同形，`transcribe` / `markError` / 前置条件 / quota） | **复用管线 + 新写 adapter** |
| app 侧 producer（同步 → Transcript inbox） | `sections/bilibili/auto-transcribe-runtime.ts` `runBiliStreamingSync` + `createTranscriptProducer`，`startJob(JOB_PLATFORM, 'transcribe', …, 'queue')` | `sections/douyin/auto-transcribe-runtime.ts`：`onPagePersisted` 放宽为带条目（D7 的积压也从这里进） | **新写**（照抄形状） |
| Embed / Tag 派发 | `sections/bilibili/bilibili-processing-adapter.ts` | 抖音 sync adapter 已有同一调用（`douyin-sync-adapter.ts:55-62`），抽成 `douyin-processing-adapter.ts` 供同步与转录共用 | **搬一下** |
| pipeline 条的「转录」段 | `bilibili-view.tsx:55-57` `transcriptionStage` + `useJob(JOB_PLATFORM, 'transcribe')` | `douyin-view.tsx:62-68` 加 `content:` | **几行** |
| 自动转录进度条 / 配额暂停 | `sections/bilibili/auto-transcribe-bar.tsx`、`use-auto-transcribe.ts` | 挪到 `components/auto-transcribe/`，hook 收 pipeline 参数（D-d） | **搬 + 参数化** |
| 缺 ASR 横幅 | `CollectionConfigurationNotice asrBlocked`（`bilibili-view.tsx:281`） | `douyin-view.tsx:168-174` 传 `asrBlocked` | **一行** |
| 卡片字幕来源角标 | `video-card.tsx` CC / ASR Chip | `douyin-card.tsx` 读 `item_contents.subtitle_source`（查询加一列） | **小改** |
| 处理 lane、Library Gate、job 命名空间 | 全部共享（`'transcribe'` 已是 `BackgroundJobKind`，`background-jobs-store.ts:29`；闸门 `library-gate.ts:35-41`） | — | **零改动** |

### 4.2 detail 接口（经 tab transport）

| 项 | 值 |
|---|---|
| 请求 | `GET /aweme/v1/web/aweme/detail/`，query = `aweme_id` + 三个公共参数（`COMMON_QUERY`，`douyin-api.ts:59-63`，目前模块私有，Step 1 导出或加 `buildDetailRequest(awemeId)`）。零签名参数 |
| 成功 | HTTP 200，`status_code: 0`，`aweme_detail: { … }`，与列表条目同形（docs/33 `research/douyin-collects-web-api.md` 第 220 行） |
| 作品不可用 | `status_code: 0` + `aweme_detail: null` + `filter_detail`（原因码）→ D-i；无 `filter_detail` 的空 payload → F8 同类（软风控） |
| 媒体字段（取数顺序，Step 0 定稿） | ① `video.bit_rate_audio[]`（纯音轨；每档 `{ audio_extra, audio_meta: { bitrate, codec_type, format: 'dash', media_type: 'audio', size, sub_info, url_list: { main_url, backup_url, fallback_url } }, audio_quality }`，可为 `null`）；② `video.bit_rate[]`（每档 `{ bit_rate, gear_name, format: 'mp4' 或 'dash', is_h265, is_bytevc1, play_addr: { data_size, uri, url_list[3], width, height, file_hash } }`，`format === 'mp4'` 中最低码率、优先 `is_h265 === 0`）；③ `video.play_addr.url_list`。`url_list` 固定 3 条：`v11-weba` CDN、`v26-web` CDN、`www.douyin.com/aweme/v1/play/?…sign&biz_sign`（服务端给的，不是自己拼的）。`play_addr.uri` 留作日志；`video.cdn_url_expired`（仅 detail）= 直链过期 unix 秒 |
| 字幕字段（Step 0 定稿） | aweme **顶层** `cla_info: { list: [{ id, url, language }], original_language_info }`，可缺失或 `null`（网页播放器源码；`language` 含 `CN` 即中文，否则英文）。**实测 136 / 136 为空**（含 30 条英文公开课），所以 v1 不读它；将来补时选轨规则是「`language` 含 `CN` 的第一条，否则第一条有 `url` 的」。开源解析器的 `video.cla_info.caption_infos[]` / `subtitle_infos[]` 在网页响应里都不存在 |
| 字幕格式 | `[UNKNOWN]`（零样本，播放器把 `cla_info.list[].url` 直接交给 xgplayer texttrack）。v1 不解析；将来补解析器时两种都认，输出 `SubtitleRow { from, to, text }`（`lib/subtitle/types.ts`） |
| URL 过期（Step 0 定稿） | CDN 直链路径 `/<32 hex 签名>/<8 hex 过期 unix>/video/tos/…`：视频档 ≈ 签发 + 3 h，纯音轨 ≈ + 24 h；detail 的 `video.cdn_url_expired` 就是这个数。过期段改一位即 403。handler 在同一次调用里取 URL、立刻下载，不跨调用复用（设计不变） |
| 验证码扫描 | `aweme_detail` 加进 `ITEM_LIST_KEYS`（D-h） |

### 4.3 失败形态 → 动作（转录路径；同步路径的 F1–F12 不变）

| # | 形态 | 动作 | 错误码 |
|---|---|---|---|
| T1 | `findDouyinTab()` 为 null（handler 入口） | 不发请求 | `DOUYIN_TAB_MISSING`（D5：停放，不标 error） |
| T2 | transport `unreachable`（注入超时、标签页中途关闭、网络错误） | 不重试（Step 2 勘误：指 handler 不在共享瞬时预算之外另加重试；detail 仍走 `requestEnvelope`，unreachable 与 5xx / 空 200 共用 `MAX_RETRIES`，耗尽后才是本行）。**停放与否看此刻 `findDouyinTab()`**：为 null 才算缺前置条件（D5），否则是普通单条失败——否则「标签页在、网络抖一下」会停放 → 立刻恢复 → 重入队 → 再失败，空转 | `DOUYIN_TAB_MISSING`（adapter 再查一次标签页决定是否停放） |
| T2′ | transport `sdk-not-ready`（页面 fetch 仍是 native） | 不重试；用户动作是刷新标签页，与 T3 同一条文案（Step 3 勘误：与 T3 一样**停放**等标签页重新加载，不标 `'error'`，见 Step 3 落地记录偏离 2） | `DOUYIN_SIGNATURE_REJECTED` + `params.reason: 'sdk-not-ready'` |
| T3 | 403 + `ArgusSecurityPlugin` | 不重试（Step 3 勘误：停放，同 T2′） | `DOUYIN_SIGNATURE_REJECTED`（文案：刷新抖音标签页后重试） |
| T4 | 403 / 429 无 Argus、200 空 body（重试耗尽） | 复用 `classifyResponse` 抛出的 `DouyinRateLimitError(resetAt 非空)` → 折成转录错误。**不借用 `ASR_RATE_LIMIT`**：它的文案写死「Groq 速率限制」（`lib/i18n/locales/zh-CN.ts` `transcribe.rateLimit` / `error.ASR_RATE_LIMIT`），屏幕上会说错供应商 | `DOUYIN_RATE_LIMITED` + `retryAfter`（= `resetAt − now`）；`lib/auto-transcribe` 对带 `retryAfter` 的错误的处理（`pipeline.ts:248-253`，临时限流最多重试一次）要改成按「有 `retryAfter`」判，不按 `code === 'ASR_RATE_LIMIT'` 判——这是共享模块里一个字面量换成一个形状，不是平台分支 |
| T4′ | F6 验证页（`DouyinRateLimitError(resetAt: null)`） | 用户必须去标签页完成验证 → **停放**（同 T1），不是重试一次后标 `'error'` | `DOUYIN_TAB_MISSING` + `params.reason: 'verify'`；`waitForPrerequisite` 对这个 reason 只能等用户动作：轮询间隔同 T1，恢复后重发 detail |
| T5 | `status_code: 8` 未登录 / 2483 | 停放（同 T1：用户要去标签页登录） | `DOUYIN_TAB_MISSING` + `params.reason: 'login'` |
| T6 | 作品不可用（D-i） | 标 `'error'`，继续下一条 | `DOUYIN_MEDIA_UNAVAILABLE` |
| T7 | 有 `aweme_detail` 但取不到任何 play URL（图文误入、`status.is_delete`） | 标 `'error'` | `ASR_NO_AUDIO_SOURCE` |
| T8 | 字幕轨存在但下载失败 / 解析出 0 行 | 记 warn，落 ASR（与 B站 `fetchOfficialSubtitle` 返回 `null` 同义）。**v1 不触发**（Step 0 后 `fetchOfficialSubtitle` 恒为 `null`） | — |
| T9 | mp4 下载非 2xx / CORS 拒绝 | 既有路径 | `DOWNLOAD_FAILED` |
| T10 | ASR 返回 0 行 | 正文退回 `desc`（D6） | 成功 |
| T11 | 其他非零 `status_code` | 标 `'error'` | `ASR_UNKNOWN` + `params.detail` 含 `status_code / status_msg` |

每个错误 `message` 带 HTTP 状态与 300 字符 body 片段（`textSnippet`）——与 docs/33 §4.4 同一条原则：这是把 `[UNKNOWN]` 变成已知的唯一途径。

### 4.4 内容状态流转（D1 之后）

| 条目 | 入库 | 转录成功 | 转录为空（D6） | 终态失败 |
|---|---|---|---|---|
| 视频（可转录的，D-f） | `'pending'`，无 `item_contents`，不派发 | `item_contents { plainText: 转录全文, subtitle_source: 'official' \| 'asr' }` + 带时间戳 chunk（`chunkSubtitleRows`）→ `'chunked'` → 派发 Embed / Tag | `item_contents { plainText: desc, subtitle_source: null }` + `charSplit` chunk → `'chunked'` → 派发；desc 也空 → `'no_content'`、不派发（Step 1 裁决） | `'error'`（`markDouyinError`） |
| 图文、无时长的视频（Step 1） | `'chunked'`（正文 = desc，同事务），逐页派发 | 不进转录 | — | — |

Coverage 的 content 段（`collection-processing-policy.ts:102-105`）：视频 `'pending'` 不算 done → pipeline 条「转录」段如实显示积压。

### 4.5 节奏与常量（D4）

| 常量 | 默认 | 说明 |
|---|---|---|
| `VITE_DOUYIN_DETAIL_DELAY_MIN_MS` | 5000 | 两次 detail 请求的最小间隔（SW 模块级「上次请求时刻」+ `sleep`；SW 重启丢一次间隔，可接受） |
| `VITE_DOUYIN_DETAIL_DELAY_JITTER_MS` | 3000 | `jitteredDelayMs` |
| `VITE_DOUYIN_TAB_POLL_MS` | 5000 | Step 3：session 停放后轮询 `findDouyinTab()` 的间隔（D5） |

登记 `tests/platform-env-constants-guard.test.ts` 的 `EXPECTED_ENV_CONSTANTS`、`.env.example` 与 `.env.local` 的抖音块（后者征得用户同意）。不复用同步的 `createDouyinPacer`（§1 D4 否决项）。

---

## 5. 分步

### Step 0 — 实机探测（只读，用户账号）

**目标**：把 §6 前四条 `[UNKNOWN]` 变成已知，定稿 §4.2 的字段契约。不改代码。

**依赖**：BrowserOS 在跑（CDP `127.0.0.1:9110`，docs/33 Step 3 的方法）、已登录抖音；**用户批准**在其账号上发约 4 次请求并开一个 douyin.com 标签页。

**做法**（照 docs/33 Step 0 / 3 的 CDP 脚本形状，脚本放 `%TEMP%\fbcdp\dy\`，不入仓库）

1. 开 `https://www.douyin.com/user/self?showTab=favorite_collection`，等页面 SDK 就位（`Function.prototype.toString.call(window.fetch)` 不含 `[native code]`）。
2. 页内 fetch `listcollection count=1 cursor=0`：记录 `aweme_list[0].video` 的全部顶层键、`bit_rate[]` 每档的 `bit_rate / gear_name / play_addr.url_list[0]` 形状、是否存在 `cla_info / caption_infos / subtitle_infos / subtitleInfos / claInfo` 任一键。
3. 挑一条在网页播放器里**能看到「字幕」开关**的收藏视频（没有就从首页找一条公开视频），页内 fetch `aweme/v1/web/aweme/detail/?aweme_id=…`：同样记录键；对比列表条目与 detail 的字幕字段是否一致（列表没有、detail 有 → 转录时必须 detail；两者都有 → 仍走 detail，但记下来）。
4. **从扩展 SW 上下文**（`chrome://extensions` 的 favbase SW target，`Runtime.evaluate`）`fetch(字幕 URL, { credentials: 'omit', mode: 'cors' })`：HTTP 状态、`content-type`、前 200 字符（是否 `WEBVTT`）；再 `fetch(最低码率 mp4 URL)` 只读 `content-length` 与状态（`method: 'HEAD'` 不行就 `GET` 后 `cancel()` body）。记录 URL 里的过期参数名。
5. 可选：同一 URL 10 分钟后再 HEAD 一次，看是否过期。

**判据**：§4.2「字幕字段」「URL 过期」两格填上实测值；§6 前四行各标「已证实 / 已证伪 / 仍未知 + 原因」；若字幕字段在列表与 detail 里都不存在，D3 的「优先 AI 字幕」半边变成「直接 ASR」，§4.1 的 `douyin-subtitle.ts` 缩成 `fetchOfficialSubtitle: async () => null`，本文页头注明。

**回滚**：关掉探测开的标签页。零代码。

#### Step 0 落地记录（2026-10-08，只读实测，零代码）

- 环境：BrowserOS neo MCP（server 0.0.67 / Chromium 151）直接驱动 douyin.com 标签页（docs/33 Step 3 时连不上，这次正常）；扩展 SW 侧用 CDP 9110 `Runtime.evaluate`，SW 休眠时从扩展自己的 offscreen 文档发一条 runtime 消息唤醒。账号同 docs/33（喜欢 235）。脚本 `%TEMP%\fbcdp\dy\t0\`（`t0-list.js`、`wake-sw.mjs`、`sw-fetch.mjs`、`probe-*.js`、`t0-notes.md`）。本探测自己发的签名 API 请求 2 次（`listcollection count=20` 一次、`aweme/detail` 一次），CDN / play API 请求 11 次（SW 9 次：mp4 直链 3 次含 6.5 min 复查与篡改过期段、纯音轨 `main_url` 主机 3 次、`backup_url`、`fallback_url`、`url_list[2]` play API；页面侧纯音轨 2 次）；另开过 3 个自己的标签页看播放器与页面自己的接口（5 个视频页、1 个搜索页、精选 2 个 tab，页面自己发出约 20 次签名请求），已全部关闭。全部原始形状（脱敏）在任务目录 `research/douyin-step0-subtitle-media-probe-2026-10-08.md`。
- **字幕：字段有，样本零 → v1 直接 ASR。** 网页播放器 SubtitlesPlugin 读 aweme 顶层 `cla_info.list[].{ id, url, language }`（`client-entry` 把 `cla_info` 映射成 `claInfo = { list, originalLanguageInfo }`），AB 配置 `subtitles.enable = 1`、语言 `zh-Hans-CN` / `en-US`。但 136 个 aweme 对象（收藏 20，含我自己 detail 的 1 条与在播放器里开的 4 条；页面自己的 detail / related / series 去重后 16；搜索「英文演讲」30；精选公开课 / 知识 70）`cla_info` 全部缺失或 `null`，4 条收藏在播放器里 texttrack 列表为空。按本 Step 判据：§4.1 的 `douyin-subtitle.ts` 不写，handler `fetchOfficialSubtitle: async () => null`；`cla_info` 形状记在 §4.2 作钩子。`is_subtitled`（顶层，0 / 缺省）与它无关。
- **媒体：发现纯音轨。** `video.bit_rate_audio[]`（DASH fMP4，AAC HE v2 48 kbps，99 s 视频 604 KB，`url_list` 是 `{ main_url, backup_url, fallback_url }` 对象）在 20 条样本里 13 条视频有（1 条有 2 档）、6 条视频 `null`（15 / 23 / 35 / 43 / 53 s 与一条 2022 年的 170 s 老视频：除老视频外都 ≤ 53 s，正好是 mp4 退路也很小的短视频）、图文 `null`。手册原「抖音没有纯音轨流」作废，D-g 改为三级取数 + url_list 顺序 fall-through。顺序不是可选项：纯音轨 `main_url`（`v26-web`）对无 Referer 的 SW 请求 403（`Forbid_code 020200`，同一 URL 在页面里 200 / 206），`backup_url`（`v11-weba`）与 `fallback_url`（play API 302）都 200。
- **直链：** SW 里（`credentials: 'omit'`, `mode: 'cors'`，与 `fetchAudioBlob` 相同）最低 H.264 mp4 档 `v11-weba` 直链 200 `video/mp4` 7,590,969 B `ftypisom`，`access-control-allow-origin: *`；`url_list[2]` 的 play API（服务端给的 `sign` + `biz_sign`，无 cookie）302 到新签 CDN 后 200。过期：路径第 2 段 8 hex = unix 秒 = detail 的 `video.cdn_url_expired`，视频档 ≈ 签发 + 3 h、纯音轨 ≈ + 24 h；6.5 min 后同 URL 仍 200；过期段改一位 403（前面 32 hex 是签名）。「同一次调用里取用、不跨调用复用」不变。
- **D-g 的坑：** `bit_rate[]` 按 `bit_rate` 升序的第一档多半是 h265 + bytevc1 且 `format: 'dash'`（`720_3_1` / `540_x_1`），手册原写法会选到它。退路改为 `format === 'mp4'` 中最低码率、优先 `is_h265 === 0`。
- **detail：** 经页面 fetch 一次成功（`status_code 0`，`aweme_detail` 82.8 KB，256 ms，`a_bogus` + `x-secsdk-web-signature` + `verifyFp` 自动补上）；与列表条目同形（`play_addr.uri`、`bit_rate` 14 档、`bit_rate_audio` 1 档一致），detail 独有 `cdn_url_expired` / `download_addr` / `is_h265` 等约 40 键。单次成功不证明签名被接受（docs/33 调研：错签约 3/8 也能拿到数据），Step 2 判据负责。
- **顺带：** 页面自己的 API 全走 XMLHttpRequest（SDK 同样补签），favbase 的 `window.fetch` 路线在 docs/33 已证实；`music.play_url` 20 条全有但按 §2 不碰；视频页在后台标签页会自动播放，探测时逐一暂停了。
- **未做 / 留给后面：** 非空 `cla_info` 的 URL 主机、格式、SW CORS（无样本）；Groq 对 fMP4 纯音轨（`ftyp` + DASH 分段）与 h265 mp4 的接受度（Step 4 清单 3 扩成三类：纯音轨、H.264 mp4、h265 mp4）；`bit_rate_audio` 为 `null` 的视频占比（样本 6 / 19，Step 4 记数）。

### Step 1 — 内容模型翻转 + 领域层（`lib/douyin/`、descriptor）

**目标**：D1 / D6 / D-c / D-f / D-g / D-h 落地并测绿；SW 图未动；app 侧仍不转录（视频入库后停在 `'pending'`，图文照旧）。

**依赖**：Step 0 定稿字段；D1 / D2 经用户确认。本 Step 不改 `.env.local`（节奏常量在 Step 2）、不清库（改法第 3 条）。

**文件**

| 文件 | 动作 |
|---|---|
| `lib/collections/platform-descriptor.ts:209-231` | `contentKind: 'transcript'`、`descriptionField: 'desc'`，注释改写（原注释「video transcription is out of scope」作废） |
| `lib/douyin/douyin-api.ts` | 导出 `buildDetailRequest(awemeId)`；`ITEM_LIST_KEYS` 加 `aweme_detail`（D-h）；`DouyinRawAweme` 不变 |
| `lib/douyin/douyin-media.ts`（新，纯函数） | `decodeDetail(envelope)` → `{ kind: 'aweme', detail } \| { kind: 'unavailable', reason }`（D-i）；`pickAudioSourceUrls(detail)`（D-g 三级有序候选：纯音轨 main / backup / fallback → 最低 H.264 mp4 档的 3 条 url_list → `play_addr.url_list`）；`isTranscribableAweme(meta)`（D-f） |
| ~~`lib/douyin/douyin-subtitle.ts`~~ | **不写**（Step 0：`cla_info` 136 个样本全空；将来有样本再按 §4.2 的形状补） |
| `lib/douyin/douyin-sync-service.ts` | `contentState`：视频 `'pending'`，图文沿用（`:406-407`）；`textOf` 对视频返回 `''`（它只在 `'chunked'` 时被调，`lib/ingest/ingest.ts:425-433`）；新增 `persistDouyinTranscript(awemeId, rows, source)`（`rows` 空 → 退回 meta 的 `desc`，D6）、`markDouyinError(awemeId)`、`getDouyinPendingVideos()`（D7 的查询：`contentState = 'pending'` 且 `platform_meta->>'mediaKind' = 'video'`，返回 producer 需要的 `{ awemeId, title, coverUrl, authorName, durationMs }`） |
| `lib/transcription/transcribe-and-persist.ts`（新） | D-c：从 `lib/bilibili/transcribe-utils.ts:40-86` 提出核心，签名 `transcribeAndPersist({ platform, videoId, title, persist, hooks })`；`createStatusListener` 一并提出 |
| `lib/bilibili/transcribe-utils.ts` | 改成薄包装（`platform: 'bilibili'`、`persist: persistContentChunks`），对外签名不变；测试照过 |
| `lib/douyin/CLAUDE.md`、`lib/bilibili/CLAUDE.md`、`lib/transcription/CLAUDE.md` | 内容模型、seam 搬家、新纯模块的约束 |
| `CONTEXT.md` | 抖音 Content 的含义变了：视频 = 字幕 / 转录（空则退回文案），图文 = 文案。与 docs/33 D1 写进去的那条并列（铁律 8） |
| `tests/lib-import-smoke.test.ts` | 清单加 `lib/transcription/transcribe-and-persist.ts`、`lib/douyin/douyin-media.ts` |
| `tests/platform-completeness-contract.test.ts` 等 | 按 `tsc` 与契约测试的红项逐条烧 |

**改法要点**

1. 先翻 descriptor，跑 `pnpm compile && pnpm vitest run tests/platform-completeness-contract.test.ts lib/chat`——`CONTENT_KIND_LIST`（`lib/chat/tools.ts:57-59`）与 Knowledge Tool 的描述文本会随之变化，看哪些测试红。
2. `persistDouyinTranscript` 走 `persistExistingItemContent(db, 'douyin', awemeId, text, chunks, source)`：转录非空 → `chunkSubtitleRows(rows)` + `source`；为空 → `desc` + `charSplit(desc, { preferParagraph: false })` + `null`。它**不**启动 Embed / Tag（铁律 3；`lib/ingest/CLAUDE.md:38`）。
3. **本 Step 不清库**。insert-only 下既有的 466 条 `'chunked'` 行不会被重新入库，对新代码无害；Step 1 的正确性由内存 PGlite 测试证明。若在这里清库，视频会以 `'pending'` 入库却要等到 Step 3 才有人转录——一次对话一个 Step，中间是好几天没有正文的库。清库重拉（D2）挪到 Step 3 的判据第一行。

**测试**（先红后绿）

- descriptor：`contentKind` / `descriptionField` 黄金值；tagging 输入对抖音带上 `desc`。
- `douyin-media`：Step 0 的真实形状做夹具（脱敏 id / URL，research 文件 §2）——纯音轨优先且 `url_list` 对象按 main / backup / fallback 展开、`bit_rate_audio` 为 `null` 时退 mp4、最低 mp4 档不取 h265 + dash 档、无 `bit_rate` 退 `play_addr`、`filter_detail` → unavailable、图文 / `duration 0` 不可转录、`aweme_detail` 里含 `captcha` 的文案**不**触发验证标记（D-h，撤掉 `ITEM_LIST_KEYS` 的新增即红）。
- ~~`douyin-subtitle`~~：Step 0 后不写。
- `douyin-sync-service`（内存 PGlite）：视频 `'pending'` 无正文无派发、图文 `'chunked'` 照旧、`persistDouyinTranscript` 三条（非空 / 空退回 desc / desc 也空 → `'no_content'`、返回 `null`；Step 1 勘误：原写「`null` 且状态不变」，与 D6 冲突，按 D6）、`subtitle_source` 如实、`getDouyinPendingVideos` 只返回视频、重转录覆盖正文并重建 chunk。
- `transcribe-and-persist`：B站现有测试原样过；新增一条用假 persist 证明闸门与事件对任意 platform 成立。

**验证**：`pnpm vitest run lib/douyin lib/bilibili lib/transcription lib/ingest tests/platform-completeness-contract.test.ts tests/lib-import-smoke.test.ts tests/platform-env-constants-guard.test.ts`；`pnpm compile`；`pnpm test`。不跑 `pnpm build`（SW 图未动）。

**回滚**：revert。库里的 `'pending'` 行对旧代码无害（它只是永远不被处理）。

**判据**：上面全绿；`lib/douyin/CLAUDE.md` 写明「视频 `'pending'`、图文 `'chunked'`」与 D6 的退回规则；B站的落库行为由既有测试证明未变。

#### Step 1 落地记录（2026-10-08，代码 + 单测；commit 3f3babe）

执行稿是任务目录 `info.md`（主会话读完代码后写的逐文件规格），与本文冲突处以它的 §0 为准。范围：只动 `lib/`、`tests/`、三份目录 `CLAUDE.md`、`CONTEXT.md`、本记录与 `prd.md`；`entrypoints/`、`.env.*`、库、`pnpm build` 都没碰。

**做了什么**

- `lib/collections/platform-descriptor.ts`：douyin `contentKind: 'transcript'`、`descriptionField: 'desc'`，注释按 D1 / D6 改写。翻完先按改法要点 1 跑 `pnpm compile` 与契约 / `lib/chat` / `lib/collections` / `lib/tagging`：**既有套件零红**（16 文件 / 165 例全过）——`CONTENT_KIND_LIST` 是从 descriptor 派生的集合，`transcript` 与 `post-text` 两个值本来就在集合里，Knowledge Tool 的描述文本一字未变。红的只有先写的两条新断言（descriptor 黄金值、tagging 输入带 `desc`），翻完即绿。
- `lib/douyin/douyin-api.ts`：导出 `buildDetailRequest(awemeId)`（GET，`aweme_id` + 三个公共参数，零签名参数）、`WHAT_DETAIL`、`cooldownFrom`；`ITEM_LIST_KEYS` 加 `aweme_detail`（D-h）。
- `lib/douyin/douyin-media.ts`（新，纯函数）：`decodeDetail`（D-i）、`pickAudioSourceUrls`（D-g）、`isTranscribableAweme`（D-f）。只 import `./douyin-api` 与 `@/lib/http/response-body`。
- `lib/douyin/douyin-sync-service.ts`：入库门 `contentStateOf`（`isTranscribableAweme` → `'pending'`，否则 `desc` 即正文）；`ingestPage` 的 `textOf` 只对非可转录条目给 `desc`；新增 `persistDouyinTranscript` / `markDouyinError` / `getDouyinPendingVideos` 与 `DouyinPendingVideo`。
- `lib/transcription/transcribe-and-persist.ts`（新，D-c）：从 `lib/bilibili/transcribe-utils.ts` 逐行提出的核心，签名 `transcribeAndPersist({ platform, videoId, title, persist, hooks })`，`createStatusListener` 一并搬入；`PersistContentResult` 的 owner 改为这里。`lib/bilibili/transcribe-utils.ts` 改成薄包装（`platform: 'bilibili'`、`persist: persistContentChunks`），对外签名不变；`bili-sync-service.ts` 的 `PersistContentResult` 改为 re-export。`transcribe-utils.test.ts` 一字未改、原样绿。
- 测试：`platform-descriptor.test.ts` +1、`tagging-service.test.ts` +1、`douyin-api.test.ts` +2（另 `requests` 表加 `aweme/detail` 一行，表驱动的两条 it.each 各多一例）、`douyin-media.test.ts` 新 16 例（复核 +1，见下）、`douyin-sync-service.test.ts` +12 新例 / 5 处既有用例改夹具或断言（25 → 37）、`transcribe-and-persist.test.ts` 新 6 例；`tests/lib-import-smoke.test.ts` 清单加两个新模块。
- 文档：`lib/douyin/CLAUDE.md`（新节「内容模型与转录落库」、失败形态表加 detail 四行、D-h）、`lib/bilibili/CLAUDE.md`「转录落库」（seam 搬家、留指针）、`lib/transcription/CLAUDE.md`（新节「app 侧落库 seam」）、`CONTEXT.md`（Douyin Content 两分，与 docs/33 D1 那条并列）、本文页头 / §1.1 D1 / §4.4 / Step 1 测试清单、`prd.md`。

**对本文的偏离（`info.md` §0 的四条裁决）**

1. **D6「desc 也空」→ `'no_content'`、返回 `null`**（本文 Step 1 测试清单原写「`null` 且状态不变」，与 §1.1 D6 自相矛盾）。留在 `'pending'` 会被 D7 的积压补扫每次同步重新入队、白跑一次管线，Coverage 永远到不了 100%。实现经 `settleItemContent(db, id, '', chunkDesc)` 结算，不写正文。
2. **`decodeDetail` 对「无 `filter_detail` 的空 payload」抛 `DouyinRateLimitError(resetAt = now + COOLDOWN_MS)`**（与列表 F8 同形），不加第三个 kind；`cooldownFrom` 因此从 `douyin-api.ts` 导出。
3. **`pickAudioSourceUrls` 对 D-g 措辞的有意偏离**：D-g 写「② 没有纯音轨时 … ③ 都没有才 play_addr」；实现把三级候选**全部**按序拼成一个去重后的列表。下载侧逐条 fall-through 时，纯音轨三条全 403 也还有 mp4 可退；只给一级等于把「主机 403」变成整条失败。
4. **`'pending'` 的门在入库处、用 D-f 的 `isTranscribableAweme`，不是 D1 字面的「`mediaKind === 'video'`」**：两条合起来会留下一类永远转录不了的 `'pending'`（时长缺失 / 为 0 的视频）。无时长的视频与图文同形入库（`desc` 即正文、同步时派发），`getDouyinPendingVideos` 于是不需要再按 `mediaKind` 过滤。D1 的目的（转录后才打标签）不变。

**其他偏离与补充**

5. 既有用例的改动超出测试清单点名的三处：「first sync walks every page」的 `newItemIds` 由 5 个 id 改为 `[]`（默认夹具是带时长的视频，入库即 `'pending'`，没有正文落地）；`chunkCountOf` 挪到 helper 区，另加 `contentOf` / `chunksOf` 两个 helper。
6. 多一条本文没列的用例「a transcription cut short before its chunks keeps its transcript when a page of the running sync sweeps it」：Transcript lane 与 Fetch lane 并发时，转录正文已写、chunk 未写，随后同步的一页含该视频——那一页的清扫先问 `textOf`。它锁的是 `textOf` 对可转录视频恒 `''` 的理由。运行开头那次清扫（`textOf: () => ''`）会先治愈上一次运行留下的幽灵，所以只有同一次运行里并发产生的幽灵才会走到页级 `textOf`；用例靠 transport 在答第一页之前制造中断。
7. `persistDouyinTranscript` 先过滤全空白行，正文与切块都用过滤后的 rows（`info.md` 写的是原 rows 拼正文），两者才一致。`markDouyinError` 多写 `updatedAt`（bilibili 的 `markVideoError` 不写）。`decodeDetail` 判 `filter_detail` 时字符串先 trim（只有空白的字符串不算解释）。
8. `WHAT_DETAIL` 由 `douyin-media.ts` 使用（错误消息前缀），`info.md` 的 import 白名单按模块算，不按符号。

**先红证据**（每个文件先写断言跑一次，再改实现）

| 文件 | 改实现前 |
|---|---|
| `platform-descriptor.test.ts`、`tagging-service.test.ts` | 2 例红：`expected 'post-text' to be 'transcript'`、`expected undefined to be '文案 #tag'` |
| `douyin-api.test.ts` | 整个文件红：`buildDetailRequest is not a function` |
| `douyin-media.test.ts` | 模块不存在 |
| `douyin-sync-service.test.ts` | 12 failed / 36：三条行为红（`newItemIds` 得到 5 个 id 而非 `[]`；`'11'` 得 `'chunked'` 而非 `'pending'`；无 desc 的视频得 `'no_content'` 而非 `'pending'`），其余 `persistDouyinTranscript is not a function` |
| `transcribe-and-persist.test.ts` | 模块不存在 |

**证伪**（每次改一处、跑对应文件、还原；还原后 sha256 与改前一致）

| # | 改动 | 变红 |
|---|---|---|
| D-h | 撤掉 `ITEM_LIST_KEYS` 的 `aweme_detail` | api 1 例（`expected 'captcha' to be null`） |
| D-g a | 第二级不偏好 `is_h265 === 0` | media 4 例 |
| D-g b | 第二级不过滤 `format === 'mp4'` | media 1 例 |
| D-g c | 纯音轨 `backup_url` 排在 `main_url` 前 | media 2 例 |
| D-g d | 只给第一级（有纯音轨就不列 mp4） | media 1 例 |
| textOf | `descById` 对可转录视频也给 `desc` | sync 1 例：并发转录中断后的正文被 `'desc 1'` 覆盖、`subtitle_source` 丢失 |

**验证**（2026-10-08）

- `pnpm vitest run lib/douyin lib/bilibili lib/transcription lib/ingest lib/collections lib/tagging tests/platform-completeness-contract.test.ts tests/lib-import-smoke.test.ts tests/platform-env-constants-guard.test.ts tests/platform-sleep-guard.test.ts tests/http-fetch-deadline-guard.test.ts lib/chat`：43 文件 / 511 例全过。
- `pnpm compile`：通过（根 `tsc --noEmit` + `pnpm -r compile`）。
- `pnpm test`：根 225 文件 / 1953 例、`packages/*` 15 文件 / 263 例全过，无偶发超时。
- 没跑 `pnpm build`（SW 图未动，本 Step 不要求）。

**未做 / 留给后面**

- 清库重拉（D2）按改法第 3 条挪到 Step 3 判据第一行；库里既有的 466 条 `'chunked'` 抖音行对新代码无害（insert-only，不会被重新入库）。
- `createStatusListener` 的大小写无关比对原样搬入（已知缺陷，`lib/bilibili/CLAUDE.md`），不在本 Step 范围。
- 根 `CLAUDE.md` 的目录索引里 `lib/transcription/` 一行原只写「管线」（复核时已补半句，见下）。`lib/ingest/CLAUDE.md` 未动：`persistExistingItemContent` 与 `settleItemContent` 的用法都在它许可的范围内。
- `docs/37` §4.1 表的「落库 seam」与「字幕缓存」等行描述的是 Step 2 / 3 的接线，本 Step 不改。

**Step 1 复核（2026-10-08，trellis-check；随 3f3babe 提交）**

逐条核对 `info.md` §1.1–§1.6 与 §0 四条裁决、§3 铁律 3–7、import 边界、五个守卫：代码与落地记录一致，零缺陷。改了四处文档、加了一例测试：

1. `lib/collections/CLAUDE.md` `descriptionField` 一条：规则不变，补上 douyin 是已接受的例外（图文的 Content 就是 `desc`，descriptor 仍填 `'desc'`），指向 §1.1 D1 副作用行。
2. 根 `CLAUDE.md` 目录索引 `lib/transcription/` 一行补「兼 app 侧落库 seam `transcribe-and-persist.ts`」。
3. `lib/douyin/CLAUDE.md`：两条多事实的 bullet 各拆开（`getDouyinPendingVideos` / `markDouyinError`；`pickAudioSourceUrls` 的三级列表 / 纯音轨顺序不可改 / `url_list` 是对象）。
4. `douyin-media.test.ts` +1：`classifyResponse` → `decodeDetail` 整条链对 detail body 成立（`has_more` / 列表键的形状检查在分页解码器里，不在 `classifyResponse`）——Step 1 的 16 例都是手工拼的 envelope，没有一例走过 Step 2 handler 真正会走的路径；读代码确认能过，加一例锁住。
5. 复核发现、未改：`persistDouyinTranscript` 对「空转录 + 空 desc」调 `settleItemContent(db, id, '', …)`，空文本下 `chunkAndSettle` 不换 chunk、不碰 `item_contents`——对 `'pending'` 条目干净；若将来对**已转录**的条目重转录得到空结果，旧正文与旧 chunk 会留在 `'no_content'` 之下。v1 不可达（积压只取 `'pending'`，无手动重转录），留给加手动按钮的人。
6. 复核发现、留给主会话：`prd.md`「待用户决定」仍写「见 docs/37 §1.1（D1–D7）」，而 `CONTEXT.md` 与本记录把 D1 / D6 记为「用户决定 2026-10-08」，两处口径要对齐——主会话已把 `prd.md` 改为「D1 / D6 视为已确认：依据是用户 2026-10-08 的指令『完成 step1』」。（`.trellis/spec/frontend/platform-onboarding.md` §3 / §4.4 的抖音混合内容模型由主会话在复核同时改好，随 3f3babe 提交。）
7. 验证（复核改动之后重跑）：`pnpm vitest run lib/douyin lib/bilibili lib/transcription lib/ingest lib/collections lib/tagging lib/chat` + 五个守卫：43 文件 / 512 例全过（复核前 511）；`pnpm compile` 通过；`pnpm test` 根 225 文件 / 1954 例、`packages/*` 15 文件 / 263 例全过，无偶发超时。

### Step 2 — Background handler（SW 图扩一支）

**目标**：`TRANSCRIBE_AUDIO { platform: 'douyin', videoId: awemeId }` 从 app.html 发到 SW 后能跑完 cache → 字幕 → ASR，错误码齐全；`pnpm build` 过 bundle 守卫；manifest 逐字节不变。

**依赖**：Step 1。

**文件**

| 文件 | 动作 |
|---|---|
| `lib/douyin/douyin-transcription-handler.ts`（新） | `handleDouyinTranscribe(msg, tabId, ctx, signal)`：入口 `findDouyinTab()`（T1）→ 节奏等待（D4）→ `requestEnvelope({ transport: douyinTabTransport, pacer: 转录节奏器 }, buildDetailRequest(videoId), 'detail')` → `decodeDetail` → 组 deps：`fetchOfficialSubtitle: async () => null`（Step 0）、`transcribeAudio`：按 `pickAudioSourceUrls(detail)` 的候选逐条下载、非 2xx 换下一条（Step 0：纯音轨 `main_url` 主机对 SW 403，`backup_url` 200；`createTranscribeAudio` 今天只收单个 URL 提取函数，Step 2 决定是在 handler 里循环还是让共享下载器收候选列表——共享侧改动必须零平台知识）、`cacheGet / cacheSave` 用 `'douyin'`、`postProcess: rows => rows`、`getAsrConfig: getAsrSettings` → `runTranscriptionPipeline` → 失败 `notifyTab(... 'failed')` |
| `lib/background/transcription-handlers.ts:23-25` | `douyin: handleDouyinTranscribe` |
| `lib/transcription/types.ts:53-69`、`lib/runtime-message/schemas.ts:20-37`、`lib/i18n/locales/{zh-CN,en}.ts` | D-j 四个错误码 + `error.<CODE>` 文案 |
| `lib/douyin/douyin-api.ts` | 转录节奏器 `createDouyinDetailPacer()`（只控间隔）与两个 env 常量（§4.5） |
| `tests/agent-bridge-background-bundle-contract.test.ts` | 新增边：handler 不得 import `douyin-sync-service` / `@/lib/database` / `@/lib/ingest`；`douyin-tab.ts` 仍只 import `wxt/browser` + descriptor + backoff |
| `tests/platform-env-constants-guard.test.ts`、`.env.example`、`.env.local` | 两个新键 |
| `lib/transcription/CLAUDE.md`、`lib/background/CLAUDE.md`、`lib/douyin/CLAUDE.md` | handler 的 import 边界、detail 的 cache 与节奏 |

**改法要点**

1. 错误折算（§4.3）：`DouyinRateLimitError(resetAt 非空)` → `DOUYIN_RATE_LIMITED` + `retryAfter: ceil((resetAt-now)/1000)`；`DouyinRateLimitError(resetAt: null)`（验证页）→ `DOUYIN_TAB_MISSING` + `reason: 'verify'`；`DouyinAuthError` → `DOUYIN_TAB_MISSING` + `reason: 'login'`；无标签页 / `unreachable` → `DOUYIN_TAB_MISSING` + `reason: 'closed'`；Argus 403 / `sdk-not-ready` → `DOUYIN_SIGNATURE_REJECTED`；`DouyinStatusError` → `ASR_UNKNOWN`。全部用 `createErrorInfo`，不抛类实例过 IPC（`lib/transcription/CLAUDE.md:10`）。
2. pipeline 的 `cid` 参数对抖音无意义，传 `0`（`PipelineRequest.cid` 是 number，不改类型）。
3. `assertAudioNotReused` 照常生效：同一 mp4 指纹配不同 `aweme_id` 即拒。
4. 不在 handler 里缓存 detail 响应：每次调用现取（§4.2「URL 过期」）。

**测试**

- handler 单测（fake transport、fake `ctx`）：T1–T7（含 T2′ / T4′）、T11 每行一例；字幕命中 → `source: 'official'` 且不调 ASR；无字幕 → ASR；cache 命中短路；节奏器两次调用间隔落在 `[MIN, MIN+JITTER)`。
- 错误码 parity（`lib/i18n/index.test.ts:97-100`）自动红再绿。
- `pnpm build`：`[bundle-contract]` 的模块数与字节数记进落地记录；`background.js` 里 `douyin-sync-service` / `pglite` 零命中。

**验证**：`pnpm vitest run lib/douyin lib/background lib/i18n tests/agent-bridge-background-bundle-contract.test.ts tests/platform-env-constants-guard.test.ts`；`pnpm compile`；`pnpm test`；`pnpm build && diff /tmp/manifest-before.json .output/chrome-mv3/manifest.json`（**零差异**）。

**回滚**：revert；SW 图回到 Step 1 之前。

**判据**：从 app.html DevTools 手发一条 `TRANSCRIBE_AUDIO { platform: 'douyin' }` 能得到 `success: true`（字幕或 ASR 任一路径）；manifest 零差异；bundle 守卫绿。

#### Step 2 落地记录（2026-10-08，代码 + 单测；commit 1b0b227）

执行稿是任务目录 `info.md` 的 Step 2 节（主会话读完 B站 handler、共享下载器、pipeline、`douyin-api` / `douyin-tab` / `douyin-media` 与五个守卫后写的逐文件规格），与本文冲突处以它的 §0 为准。范围：`lib/`、`tests/`、`.env.example`、`.env.local`（只在抖音块末尾加两行）、三份目录 `CLAUDE.md`、本记录与 `prd.md`；`entrypoints/`、`lib/auto-transcribe/`、库都没碰。D3 / D4 视为已确认：依据是用户的指令「完成 step2」，而 Step 2 的文件表就是 D3（detail 在 Background handler 里经 tab transport 现取）与 D4（转录专用节奏器）的落地；回滚是 revert。`.env.local` 的两行（§4.5 要求征得同意）同样以这条指令为据，只加了注释与留空的 key，没动别的行。

**做了什么**

- `lib/douyin/douyin-transcription-handler.ts`（新）：`createDouyinTranscribeHandler(session)` + 默认导出 `handleDouyinTranscribe`（模块级 `createDouyinDetailPacer()` 单例）。detail 不是 pipeline 之前的 prepare，而是在 ASR 路径的 URL extractor 里：T1 `findTab()` → 节奏 → `requestEnvelope`（不传 `control`）→ `decodeDetail` → `aweme_id` 回声闸门 → `pickAudioSourceUrls`。`fetchOfficialSubtitle` 恒 `null`（Step 0）、`postProcess` 恒等（D-b）、cache 用 `'douyin'`、`cid: 0`。错误按类折算成 §4.3 的码（`toTranscribeErrorInfo`），`DOUYIN_RATE_LIMITED` 只带 `retryAfter`（秒）。
- `lib/background/transcription-handlers.ts`：`douyin: handleDouyinTranscribe`。
- `lib/transcription/audio-extractor.ts`：`fetchFirstAudioBlob(urls, signal, onProgress)`（按序逐条下载，非 2xx 与网络错误换下一条，AbortError 穿透，全败抛最后一条，空列表 `ASR_NO_AUDIO_SOURCE`）、`isAbortError`。`lib/background/transcription-utils.ts`：`createTranscribeAudio` 第三个参数改为 `extractAudioUrls → Promise<string[]>`，extractor 抛的 `TranscribeErrorInfo` / AbortError 透传，Offscreen 分块拿的是实际下载成功的那条 URL。`lib/bilibili/bilibili-transcription-handler.ts` 包一层成单元素列表，行为不变。
- `lib/douyin/douyin-api.ts`：`DouyinSignatureError(reason: 'argus' | 'sdk-not-ready')`、`DouyinUnreachableError`（都直接 `extends Error`，message 一字未改，同步侧按两个平台基类分类不受影响）；`createDouyinDetailPacer({ sleep, random, now })`（按上次请求发送时刻、无长休息）；两个 env 常量 `VITE_DOUYIN_DETAIL_DELAY_MIN_MS` / `_JITTER_MS`（5000 / 3000）。
- 错误码四处同步：`lib/transcription/types.ts`、`lib/runtime-message/schemas.ts`、`lib/i18n/locales/{zh-CN,en}.ts`（四条文案不含 reason / snippet）。
- 守卫：`tests/agent-bridge-background-bundle-contract.test.ts` 加三组（四个 douyin 文件不得值导入 `douyin-sync-service` / `@/lib/database*` / `@/lib/ingest*` / 两个 barrel、无动态 `import(`；`douyin-tab.ts` 的 import 集合 ⊆ 四个白名单且 `./douyin-api` 只能 type-only；`transcription-handlers.ts` 含静态注册）；`tests/platform-env-constants-guard.test.ts` 登记两个新键；`.env.example` / `.env.local` 抖音块各加两行。
- 测试：`douyin-transcription-handler.test.ts` 新 17 例（§4.3 T1–T7、T11 每行一例，另有 cache 命中零请求、缺 key 零请求、ASR 路径的候选列表顺序、`aweme_id` 不符、abort、默认导出接线）；`audio-extractor.test.ts` 新 8 例；`transcription-utils.test.ts` 新 6 例；`douyin-api.test.ts` +7 例（节奏器 5，含复核加的并发串行；错误类 2）、1 例改断言。
- 文档：`lib/douyin/CLAUDE.md`（新节「Background 转录 handler」，失败形态表三行改类型名）、`lib/transcription/CLAUDE.md`（新节「音频候选与下载」）、`lib/background/CLAUDE.md`（Handler 节两条）、本文页头与 §4.3 T2 行、`prd.md`。

**对本文的偏离（`info.md` Step 2 节 §0 的九条裁决）**

1. **detail 懒到 ASR 路径里取**，不是「prepare → 组 deps → pipeline」：按本文顺序，cache 命中与缺 ASR key 都会白发一次签名请求、白等一次节奏器，cache 命中时无标签页还会以 T1 失败，与 D7「重开后不重复转录（cache 命中）」冲突。测试锁住：cache 命中与缺 key 两例都断言 `findTab` / transport 零调用。
2. **共享下载器收候选列表**（本文留给 Step 2 的决定）：机制在 `lib/transcription`（零平台知识），B站传单元素列表。
3. **`createTranscribeAudio` 透传 extractor 抛的结构化错误与 AbortError**：否则四个 `DOUYIN_*` 码全被改写成 `ASR_NO_AUDIO_SOURCE`（证伪 M1：撤掉即 15 例红）。
4. **两个具名错误类**：handler 按类折算 T2 / T2′ / T3，不靠 message 字符串匹配。
5. **`aweme_id` 回声闸门**（本文没写）：detail 答错视频 → `ASR_UNKNOWN`、不下载。docs/29 的教训。
6. **T2 的「不重试」解读为「不在共享预算之外另加重试」**：detail 走 `requestEnvelope` 的 `MAX_RETRIES`，与同步一致；§4.3 T2 行已加勘误。代价：标签页中途关掉后约 10–16 s（3 次 unreachable 叠退避与间隔）才报 `DOUYIN_TAB_MISSING`。
7. **`DOUYIN_RATE_LIMITED` 不借 `resetAt` / `providerId`**（那是 ASR quota 的形状）。
8. **`getAsrSettings` 走 leaf `@/lib/storage/settings`**（`lib/storage/CLAUDE.md`），B站 handler 的 barrel 导入是既有代码、未动。
9. **文案不含 `params.reason` 与 snippet**（`lib/i18n/CLAUDE.md`）；`DOUYIN_TAB_MISSING` 三个 reason 共用一条，Step 3 的横幅再细分。

其他：T1 的 message 前缀 `WHAT_DETAIL`（只作 debug）；本文测试清单里「字幕命中 → `source: 'official'` 且不调 ASR」在 v1 不可达（`fetchOfficialSubtitle` 恒 `null`），记为 N/A，不是漏测；「节奏器两次调用间隔落在 `[MIN, MIN+JITTER)`」在 `douyin-api.test.ts` 锁住。

**先红证据**（每个文件先写断言跑一次，再改实现）

| 文件 | 改实现前 |
|---|---|
| `lib/transcription/types.ts` 只加码 | `pnpm compile`：`lib/i18n/index.test.ts(100,70): error TS2322: Type 'true' is not assignable to type 'never'`（wire / domain parity） |
| wire enum 加码、locale 未加 | `lib/i18n/index.test.ts` 4 failed：`expected 'error.DOUYIN_TAB_MISSING' not to be 'error.DOUYIN_TAB_MISSING'`（四个码各一） |
| `douyin-api.test.ts` | 7 failed / 92：`createDouyinDetailPacer is not a function` ×4、`instanceof assertion needs a constructor but undefined was given` ×3 |
| env 守卫 | 先 `envNumber keys not registered … VITE_DOUYIN_DETAIL_DELAY_MIN_MS / _JITTER_MS`；登记后 `.env.example` / `.env.local` 各报 `missing documented lines` |
| `audio-extractor.test.ts` + `transcription-utils.test.ts` | 13 failed / 14：`fetchFirstAudioBlob is not a function` ×7、`isAbortError is not a function`；行为红 `expected { code: 'ASR_NO_AUDIO_SOURCE' } to match { code: 'DOUYIN_TAB_MISSING' }`、`… to be AbortError`（裁决 3 的证据） |
| `douyin-transcription-handler.test.ts` | `Failed to resolve import "./douyin-transcription-handler"`；实现写完 17 / 17 一次过 |

**证伪**（每次改一处、跑对应文件、还原；还原后 sha256 与改前一致）

| # | 改动 | 变红 |
|---|---|---|
| F1 | handler 加 `import { getDb } from '@/lib/database'` | bundle contract 1 例 |
| F2 | `douyin-tab.ts` 的 `./douyin-api` 改成值导入 | 1 例 |
| F3 | 删掉 `transcription-handlers.ts` 的 douyin import | 1 例 |
| M1 | 撤掉 `createTranscribeAudio` 的透传（= Step 2 前的 catch） | utils 2 例 + handler 13 例 |
| M2 | 撤掉 `aweme_id` 回声闸门 | handler 1 例 |
| M3 | T1 查标签页挪到 detail 请求之后 | handler 4 例（ASR 顺序、T1、T2 的 `findTab` 计数、默认导出） |

**验证**（2026-10-08）

- `pnpm vitest run lib/douyin lib/background lib/transcription lib/bilibili lib/i18n tests/agent-bridge-background-bundle-contract.test.ts tests/platform-env-constants-guard.test.ts tests/platform-sleep-guard.test.ts tests/http-fetch-deadline-guard.test.ts tests/lib-import-smoke.test.ts tests/platform-completeness-contract.test.ts`：41 文件 / 481 例全过（复核前 480）。
- `pnpm compile`：通过。`pnpm test`：根 228 文件 / 2002 例（复核前 2001）、`packages/*` 15 文件 / 263 例全过，无偶发超时。
- `pnpm build`（复核的节奏器改动之后重跑）：`[bundle-contract] background graph 14 modules / 961873 bytes`（改前基线同一台机器同一天：14 modules / 947147 bytes，多出的 14,726 字节是 handler + `douyin-api` / `douyin-tab` / `douyin-media` 进 SW 图；复核前一次 build 是 961807），PGlite 标记 / dangling initializer / 动态 `import()` 零命中；`background.js` 里 `douyin-sync-service` / `pglite` 零命中。
- manifest：基线 build 与两次改后 build 的 `.output/chrome-mv3/manifest.json` 逐字节相同（`cmp` 零差异）。

**未做 / 留给后面**

- **本 Step 判据的第一条（从 app.html 手发 `TRANSCRIBE_AUDIO` 得到 `success: true`）没跑**：它需要 (a) 在 BrowserOS neo 里 `chrome.runtime.reload()` 装上新 build——会关掉用户已开的扩展页面，要先征得同意；(b) 已配置的 ASR key——docs/33 Step 3 实测时没有，没 key 的话只能到 `ASR_INVALID_KEY`，到不了 `success: true`。两者齐了再跑，顺手把 Step 4 清单 2 的签名计数从 0 开始记。
- `lib/auto-transcribe/pipeline.ts` 仍按 `code === 'ASR_RATE_LIMIT'` 判临时限流，`DOUYIN_RATE_LIMITED` 的 `retryAfter` 要等 Step 3 改成「带 `retryAfter`」才被消费；Step 3 之前它是普通单条错误。
- 节奏等待与注入请求都不认 `signal`，取消最坏多等约 8 s + 一次请求（已写进 `lib/douyin/CLAUDE.md`）。
- Step 3 要注意：`lib/background/job-registry.ts` 一个 tab 只记一个转录 job（`controllers` / `tabVideoIds` 按 tabId 键）。B站与抖音的自动转录都从同一个 app.html 标签页发，两条 session 若并发，后发的会顶掉前者在 registry 里的 controller 与 videoId（`abortTranscription(tabId)` 只能中止后者，Offscreen 进度会算到后者头上）。`'queue'` 碰撞只在各自的 `JOB_PLATFORM` 命名空间内串行，跨平台不串行；producer 设计时要么共用一条转录队列，要么接受这个缺口并写明。
- 每次抖音 ASR 都会在 SW 控制台留一行 `[audio-extractor] … HTTP 403`：纯音轨 `main_url` 主机对 SW 恒 403（Step 0），fall-through 的预期噪音，Step 4 看日志别追。
- `createTranscribeAudio` 的 extractor 签名仍带 `cid`，抖音忽略它；不对称但无害。

**Step 2 复核（2026-10-08，trellis-check）**

逐条核对 `info.md` Step 2 节 §0 九条裁决与 §1.1–§1.10、铁律 2 / 5 / 6、§4.3 每行的测试、取消点、`createTranscribeAudio` 的调用链、错误码与 env 的四处同步、三份 `CLAUDE.md`、测试质量。品味评分：好。致命问题一条，已修：

1. **`createDouyinDetailPacer` 对并发调用不串行**（对 `info.md` §1.1 字面写法的有意偏离）。两个 `beforeRequest()` 同时进来时都在 `await` 之前读到同一个 `lastAt`、算出同一个 `due`，一起睡一起醒，背靠背发两条签名 detail 请求——模块级单例只保证「一个实例」，没保证「任意两条 detail 相隔 ≥ MIN」。触发条件：两个 app.html 标签页各跑一个 session（`ctx.startTranscription` 按 tab 登记，不互斥）。修法是 promise 链排队，后到者只在前者写完 `lastAt` 后才算自己的 `due`；拒绝的 wait 不卡住后续调用。先红证据：`expected [ 'a', 'b' ] to deeply equal [ 'a' ]`（两个调用在 5 s 同时 resolve）；新用例用真 `sleep` + 假时钟（注入「在 `sleep` 里推进时钟」的写法测不出这个 race）。
2. `douyin-transcription-handler.test.ts` T2 补断言 `pacer.beforeRequest` 恰 3 次：「重试也等间隔」从 api 层锁到 handler 层。
3. `lib/douyin/CLAUDE.md` +1 条（并发排队；同步的 `createDouyinPacer` 不排队是因为每次运行一个实例、运行由 job store 串行）；`lib/transcription/CLAUDE.md` 的 `params.reason` 取值收成指向 `lib/douyin/CLAUDE.md` 的指针——同一张折算表两份必漂。
4. 铁律 6 的判断：`audio-extractor.ts` / `transcription-utils.ts` 注释里提 Douyin 与 docs/37 D-g 是出处引用，代码零平台分支；四个 `DOUYIN_*` 码是 D-j 明文要求进 `types.ts` 与 wire enum 的枚举。不算违规。
5. 复核发现、主会话随手改：本文 §1.2 D-j「5xx / 不可达 → `DOWNLOAD_FAILED`」与实现不符（detail 不是音频下载），已在该格加勘误；`lib/transcription/CLAUDE.md`「新增平台」一条的「自己 prepare」改述为取媒体可以懒到 deps 里。
6. 复核发现、未改：`pipeline.ts` 的 AbortError 判断与 `isAbortError` 是同一逻辑两处写，`isAbortError` 放 `types.ts` 旁更顺（pipeline → extractor 的 import 方向别扭）——小重构，留给后面。
7. 验证（复核改动之后重跑）：§2 的 vitest 命令 41 文件 / 481 例全过（复核前 480）；`pnpm compile` 通过；`pnpm test` 根 228 文件 / 2002 例、`packages/*` 15 文件 / 263 例全过，零偶发超时。主会话随后重跑 `pnpm build`：见上面「验证」一节的 bundle 数字（复核改动后重测）。

### Step 3 — app 侧：流式转录、积压、pipeline 条、角标

**目标**：点「立即获取」后新入库的视频自动排进 Transcript lane，转录后进 Embed / Tag；关过页面留下的 `'pending'` 在下一次同步末尾被补上（D7）；pipeline 条多一个「转录」段；卡片有 CC / ASR 角标；缺 ASR 与缺标签页各有横幅。

**依赖**：Step 2。

**文件**

| 文件 | 动作 |
|---|---|
| `lib/auto-transcribe/types.ts`、`pipeline.ts:232-241, 248-253` | D5：`hasAsrKey / waitForAsrKey` → `isPrerequisiteMissing(error) / waitForPrerequisite()`；`asrBlocked` 改名 `prerequisiteBlocked` 并带 `reason: 'asr' \| 'platform-tab'`（UI 文案据此选）；临时限流的判定从 `code === 'ASR_RATE_LIMIT'` 改为「错误带 `retryAfter`」（§4.3 T4） |
| `lib/bilibili/auto-transcribe-adapter.ts` | 按新接口实现（只认 `ASR_INVALID_KEY`），行为不变 |
| `lib/douyin/auto-transcribe-adapter.ts`（新） | `transcribe` → `transcribeAndPersist({ platform: 'douyin', persist: persistDouyinTranscript })`；`markError: markDouyinError`；`isPrerequisiteMissing(error)`：`ASR_INVALID_KEY` 且此刻无 key，或 `DOUYIN_TAB_MISSING` 且此刻 `findDouyinTab() === null` / reason 是 `login` / `verify`（D5：瞬态失败不停放）；`waitForPrerequisite`：前者同 B站 watch settings，后者轮询 `findDouyinTab()`（间隔经 `envNumber('VITE_DOUYIN_TAB_POLL_MS')`，登记 env 守卫）；quota 两个函数照抄 |
| `entrypoints/app/sections/douyin/auto-transcribe-runtime.ts`（新） | 照 `sections/bilibili/auto-transcribe-runtime.ts`：pipeline 单例、`createTranscriptProducer`、`startJob(JOB_PLATFORM, 'transcribe', …, 'queue')`；producer 的输入 = 同步每页新插入的视频（`onPagePersisted` 放宽为 `(ids, items)`）+ 同步末尾 `getDouyinPendingVideos()`（D7） |
| `entrypoints/app/sections/douyin/douyin-sync-adapter.ts` | 同步前门不变；funnel 内动态 `import('./auto-transcribe-runtime')`（同 B站，转录 runtime 不进启动 chunk）；派发改经 `douyin-processing-adapter.ts` |
| `entrypoints/app/sections/douyin/douyin-processing-adapter.ts`（新） | 从 sync adapter 抽出的 `enqueueDouyinCollectionProcessing` |
| `entrypoints/app/components/auto-transcribe/`（新，搬迁） | `AutoTranscribeBar` 与 `useAutoTranscribe(pipeline)`；B站 section 改 import 路径 |
| `entrypoints/app/sections/douyin/douyin-view.tsx` | `content: transcriptionStage(...)`（把 B站本地的 `transcriptionStage` 提到 `hooks/pipeline-segments.ts`）、`useJob(JOB_PLATFORM, 'transcribe')`、`<AutoTranscribeBar>`、`CollectionConfigurationNotice prerequisiteBlocked`、`extraRefreshKey` |
| `entrypoints/app/sections/douyin/douyin-card.tsx` | CC / ASR Chip（`subtitle_source` 经 `getDouyinItems` 多查一列） |
| `lib/collections/configuration-blockers.ts:52`、`components/configuration-blocker/`、`lib/chat/tools.ts:235` | `capability: 'asr'` 之外加一种（文案「打开并登录抖音标签页后自动继续」）。**注意**：这是共享模块，capability 名要像 `'asr'` 一样是能力词而不是平台词——用 `'platform-tab'` + `platform` 参数，守卫 `tests/platform-completeness-contract.test.ts` 才不会红。`asrBlocked` 改名 `prerequisiteBlocked` 会连带 `lib/chat/tools.ts:235`（那里写死 `asrBlocked: false`，Knowledge Tool 没有状态机上下文，改名后仍传「无阻塞」） |
| i18n（zh-CN + en） | `configurationBlocker.platformTab`、`error.DOUYIN_*` 三条（Step 2 已加）、`douyin.subtitleSource.*` |
| `sections/douyin/CLAUDE.md`、`entrypoints/app/hooks/CLAUDE.md`、`components/auto-transcribe/CLAUDE.md`（新）、`lib/auto-transcribe/CLAUDE.md` | 前置条件泛化、积压补扫是抖音的有意偏离、bar 的归属 |

**改法要点**

1. 同步 → 转录的顺序，**两条输入源不能混**：`onPagePersisted` 今天收的是 `result.contentPersisted`（`douyin-sync-service.ts:265`）——以 `'pending'` 入库的视频**永远不在这个列表里**（ingest 只对 `'chunked'` 条目写正文，`lib/ingest/ingest.ts:425-433`），照原样接线会得到一个空的 Transcript inbox。所以页回调改成两个参数：`contentPersisted`（图文 + 治愈的幽灵，派发 Embed / Tag，照旧）与 `insertedVideos`（`result.inserted` 里 `mediaKind === 'video'` 的条目，带 producer 需要的标题 / 封面 / 作者 / 时长，`IngestResult.inserted` 是 `IngestedItem[]`，`lib/ingest/ingest.ts:145`）；后者 `append` 进 producer。同步成功结算前再 `append(getDouyinPendingVideos())`（D7）——`session.append` 按 videoId 去重（`lib/auto-transcribe/CLAUDE.md`），本次刚入库的不会被重复加入。
2. Fetch 不 await Transcript（`sections/bilibili/CLAUDE.md`「转录与处理 lane」）；producer 在 `finally` 里 `close()`。
3. 无标签页时同步本来就在 funnel 前抛 `DouyinAuthError`，所以 producer 不会被创建；session 中途丢标签页走 D5 停放。
4. `useAutoTranscribe(pipeline)`：B站传 `biliAutoTranscribePipeline`，抖音传 `douyinAutoTranscribePipeline`；hook 零副作用（`sections/bilibili/CLAUDE.md`「`use-auto-transcribe.ts` 是单例 pipeline 的纯订阅」）。

**测试**

- `lib/auto-transcribe/pipeline.test.ts`：`isPrerequisiteMissing` 返回真时停放、`waitForPrerequisite` 恢复后按原顺序重入、过一次 checkpoint；B站既有用例改接口后原样绿。
- `lib/douyin/auto-transcribe-adapter.test.ts`：`DOUYIN_TAB_MISSING` 算前置条件缺失、`ASR_INVALID_KEY` 有 key 时不算；`waitForPrerequisite` 在标签页出现后 resolve。
- `sections/douyin/auto-transcribe-runtime.test.ts`：每页视频进 inbox、图文不进、`'pending'` 积压在成功结算前追加且去重、Fetch 不等 Transcript、producer `close` 后 session 能完成。
- `douyin-sync-adapter.test.ts`：派发经 processing adapter；无标签页仍在 funnel 前抛。
- `douyin-view.test.tsx`：转录段出现、横幅两种 reason 文案、角标。
- 守卫：completeness contract（新 capability 不带平台字面量）、i18n 无硬编码 CJK、ui-vendor-boundaries（bar 搬家后不引入新依赖）。

**验证**：`pnpm vitest run lib/auto-transcribe lib/douyin lib/bilibili entrypoints/app/sections/douyin entrypoints/app/sections/bilibili entrypoints/app/components/auto-transcribe tests/platform-completeness-contract.test.ts tests/i18n-no-hardcoded.test.ts tests/ui-vendor-boundaries.test.ts`；`pnpm compile`；`pnpm test`；`pnpm build`（bar 搬家影响 app chunk，不影响 SW；manifest 零差异）。

**回滚**：revert；库里已转录的正文对旧代码仍是合法 `'chunked'` 行。

**判据**：先按 D2 清库（用户批准后删 `items where platform='douyin'`（级联）、`authors` 孤儿、`platform_sync_records`、`local:douyin-backfill`，docs/33 Step 3 的 `clear-douyin.js` 可照用）；重拉一次后，不碰页面，视频逐条出现 CC / ASR 角标、标签随后出现；关掉 app.html 再开、再同步一次，残留的 `'pending'` 被补上；关掉抖音标签页，进度条显示等待而不是错误；`pnpm build` 的 manifest 零差异。

#### Step 3 落地记录（2026-10-08，代码 + 单测；commit 0afb943）

执行稿是任务目录 `info.md` 的 Step 3 节（主会话读完 `lib/auto-transcribe`、两个 adapter、B站与抖音 section、横幅、`collection-queries`、`job-registry` 与六个守卫后写的逐文件规格），与本文冲突处以它的 §0 为准。范围：`lib/`（`lib/background/` 与 SW handler 的代码未动）、`entrypoints/app/`、`tests/`、`.env.example` / `.env.local`（抖音块各两行）、十三份目录 `CLAUDE.md`、`.trellis/spec/frontend/platform-onboarding.md` §4.4、本记录与 `prd.md`；库没碰。D5 / D7 视为已确认：依据是用户的指令「完成 step3」，而 Step 3 的文件表就是两者的落地；回滚是 revert。`.env.local` 的两行同样以这条指令为据，只加注释与留空的 key。

实现子代理在收尾时因额度限制中断，没有交回先红证据与偏离清单；主会话确认 `pnpm compile` 与聚焦集全绿后，由复核子代理逐文件对稿，并用 19 个单点变异重建「测试锁住了行为」的证据（下表），替代丢失的先红记录。

**做了什么**

- 前置条件泛化（D5）：`lib/auto-transcribe` 的 adapter 接口 `hasAsrKey / waitForAsrKey` 换成 `missingPrerequisite(error) → 'asr' | 'platform-tab' | null` 与 `waitForPrerequisite(error)`；状态 `asrBlocked: boolean` 换成 `prerequisiteBlocked`。`TranscribePrerequisite` 住 `lib/collections/configuration-blockers.ts`（能力词，不是平台词），`deriveConfigurationBlockers` 对 `'platform-tab'` 出一条无 `pending`、无设置链接的阻塞项；Knowledge Tool 传 `null`。
- 临时限流按形状判（§4.3 T4）：判定顺序改为「前置条件 → `ASR_QUOTA_EXCEEDED` → 带 `retryAfter` 的重试一次 → 普通失败」。quota 必须先判：groq-client 对每个 429 都带 `retryAfter`（无头默认 30 s）。`DEFAULT_RATE_LIMIT_PAUSE_SECONDS` 成了死代码，已删。
- ASR 半边不复制：B站 adapter 里的四段 storage 逻辑提到 leaf `lib/storage/asr-prerequisite.ts`，两个 adapter 共用；B站 adapter 测试里的两例原样搬进它的测试。
- `lib/douyin/auto-transcribe-adapter.ts`（新）：`transcribe` 经共享 seam 落库，`markError: markDouyinError`；前置条件判定与三种等待见下面偏离 2–4。`lib/douyin/douyin-tab.ts` 只加一个导出 `waitForDouyinTabLoad()`（`tabs.onUpdated` 的下一次 douyin.com 标签页 `complete`），import 集合不变。
- 两条输入源（改法要点 1）：`syncDouyinCollections` 新增 `onVideosPending`，每页从 `result.inserted` 回连 aweme、过 `isTranscribableAweme` 后发出，与 D7 积压共用 `DouyinPendingVideo` 一个形状。
- Transcript lane 泛化：B站 runtime 的 tail / 派发 / producer 提到泛型层 `entrypoints/app/hooks/transcript-lane.ts`，tail 按 lane（= 按 pipeline 实例），不跨平台串行；B站 runtime 只留资格判定与映射。
- 抖音 app 侧：`sections/douyin/auto-transcribe-runtime.ts`（pipeline 单例、`runDouyinStreamingSync`：每页视频进 inbox，sync 成功后追加 D7 积压）、`douyin-processing-adapter.ts`（从 sync adapter 抽出）；sync adapter 在 funnel 内动态 import runtime，标签页门不变。
- UI：`AutoTranscribeBar` 与 `useAutoTranscribe(pipeline)` 搬到 `components/auto-transcribe/`（D-d），B站改传自己的 pipeline；`transcriptionStage` 提到 `hooks/pipeline-segments.ts`；抖音 view 有转录段、进度条、`prerequisiteBlocked` 横幅；抖音卡片在 footer 画 CC / ASR 角标（复用 `card.sourceCC` / `card.sourceASR`，`info` 色）。角标的列来自共享 `pagedItemsQuery` 的 LEFT JOIN `item_contents`（`PagedItemRow.subtitleSource` 三值：`undefined` 未加载 / `null` 非转录 / 来源）。
- i18n 只加一个 key `configurationBlocker.platformTab`（`{{platform}}` = 导航名），不加 `douyin.subtitleSource.*`。env：`VITE_DOUYIN_TAB_POLL_MS`（5000）登记守卫与两个 env 文件。
- 文档：`lib/{auto-transcribe,collections,chat,douyin,storage,database,background}/CLAUDE.md`、`entrypoints/app/{hooks,components/auto-transcribe（新）,components/configuration-blocker,sections/bilibili,sections/douyin}/CLAUDE.md`、根 `CLAUDE.md` 目录清单、`platform-onboarding.md` §4.4、本文页头与 §4.3 T2′ / T3 两行。

**对本文的偏离（`info.md` Step 3 节 §0 的十一条裁决，加复核后一条）**

1. **前置条件接口返回「缺哪种」**：手册写 `isPrerequisiteMissing(error)`（布尔）加改名后的 `prerequisiteBlocked` 带 `reason`；布尔载不动横幅要的 reason，合成一个返回值、一个状态字段。`waitForPrerequisite` 收停放时的那条错误，adapter 据此选等待方式。
2. **`DOUYIN_SIGNATURE_REJECTED` 算前置条件缺失、不标 `'error'`**（§4.3 T2′ / T3 已加勘误）：修复动作是用户刷新标签页，与 login / verify 同类；SDK 一失效就逐条落 `'error'`，而 v1 没有重试入口——正是 D5 否决「错误即标 error」的理由。
3. **等「用户对标签页做了动作」期间 adapter 短路 `transcribe()`**：login / verify / signature 停放后，后续条目不再发 `TRANSCRIBE_AUDIO`，直接返回停放时的错误、一并停放；否则每条都白发一次节奏化的签名请求打到同一堵墙上（466 条约一小时的 403）。`closed` 不短路：SW 的 T1 门零请求，cache 命中仍能成功。
4. **三种等待**：ASR key → 共享 settings watcher；`closed` → 轮询 `findDouyinTab()`（`VITE_DOUYIN_TAB_POLL_MS`）；login / verify / signature → 下一次 douyin.com 标签页加载完成。手册写的「轮询 `findDouyinTab()`」在登录墙上会立刻 resolve → 重入队 → 再发一次签名请求 → 再停放，空转。代价：页内完成验证而不刷新不会自动恢复，横幅文案写明「完成后刷新该标签页」。
5. **页回调改法**：手册写「`onPagePersisted` 放宽为 `(ids, items)`」；实现是新增独立回调 `onVideosPending`，按 `inserted` 算（夹内页会重新列出 head 已入库的视频，insert-only 下不得重复入队）。
6. **producer 泛化到 `hooks/transcript-lane.ts`**（手册写「照抄形状」）：抖音是第二个真实调用方，抽象此刻成立；tail 按 lane，B站的自动转录不会排在抖音几百条积压后面。
7. **ASR 半边提到 `lib/storage/asr-prerequisite.ts`**（手册写「quota 两个函数照抄」）：照抄就是 copy-paste。
8. **角标的列走共享分页查询**（手册写「`getDouyinItems` 多查一列」）：零平台知识的 LEFT JOIN，所有平台的分页查询都带上这一列；标签筛选网格没有这列、不画角标。
9. **`'platform-tab'` 不进 `ConfigurationCapability`**：那个类型兼作设置页叶子，`settingsPath('ai/platform-tab')` 没有页面。阻塞项类型扩为 `ConfigurationCapability | 'platform-tab'`，横幅对它不渲染设置链接。
10. **文案复用 `card.sourceCC` / `card.sourceASR`**，不加手册 i18n 行里的 `douyin.subtitleSource.*`。
11. **D7 积压在 sync 开始时已有抖音转录 session 在跑就跳过**（复核发现、主会话裁决，不在执行稿里）：lane 让后一个 producer 排在活动 session 后面，此刻读出的积压等轮到时已过期，已转录的条目会被重放（cache 命中、不发签名请求，但重写正文、替换 chunk 清掉 embedding、重新 embed、每条再等 10–15 s）；首次积压要跑几个小时，期间再点一次「立即获取」或每日自动同步就会触发。`isActive()` 在入口判。代价：前一次 sync 失败、没追加积压时，遗留的 `'pending'` 要等下一次开始时没有 session 在跑的同步。备选「lane 提供惰性追加、在 session 创建时才读积压」否决：要把异步加载塞进泛型层，还得处理 loader 在 `close()` 之后 resolve（对已关闭的 session `append` 会抛）。

**复核（trellis-check）的修正**

- `collection-configuration-notice.test.tsx` 两个新用例在断言之后才重置共享的 `configState`，一条断言失败会把状态漏给下一例；改为 `beforeEach` 统一重置（变异 M13 实测出现过级联）。
- `douyin-sync-adapter.ts` 对非 promise 的 ticket 写了 `void`，去掉。
- `entrypoints/app/hooks/CLAUDE.md` 的「Transcript lane」一节插在了「收藏页 hooks」中间，把其后几条规则吞到新标题下；挪到该节之后。B站与 `components/auto-transcribe/` 两份 `CLAUDE.md` 里的改动日志式写法改成现状描述。`platform-onboarding.md` §4.4 原写「app 侧在 docs/37 Step 3 落地」，改为现状。

**证伪**（每次改一处、跑对应测试文件、还原；还原后 `sha256sum -c` 与改前一致。机器另有进程占约 55% CPU，统一加 `--hookTimeout=90000 --testTimeout=60000`，免得超时冒充「被杀」）

| # | 改动 | 变红 |
|---|---|---|
| M1 | pipeline 先判 `retryAfter` 再判 quota | 2 例（`expected 'paused' to be 'quota_paused'`） |
| M2 | 改回按 `ASR_RATE_LIMIT` 码判临时限流 | 1 例（平台限流不再重试一次） |
| M3 | 去掉 adapter 的 `transcribe()` 短路 | 1 例 |
| M4 | `closed` 不查 `findTab()` 就停放 | 1 例（`expected 'platform-tab' to be null`） |
| M5 | signature 返回 `null` | 1 例 |
| M6 | login 改为轮询 `findTab()` | 1 例（`waitForTabLoad` 零调用） |
| M7 | `onVideosPending` 按页算而不是按 `inserted` | 1 例（夹内页重复列出的 `'1'` 被再次入队） |
| M8 | sync 失败也追加积压 | 1 例 |
| M9 | 积压读取失败向外抛 | 1 例（`promise rejected "Error: db gone"`） |
| M10 | 多条 lane 共用一个模块级 tail | 2 例（跨平台被串行） |
| M11 | 去掉 LEFT JOIN 与该列 | 2 例 |
| M12a / b | `null` / `undefined` 也画角标；CC 与 ASR 对调 | 1 例；2 例 |
| M13 | `'platform-tab'` 也渲染设置链接 | 1 例（修完测试隔离后） |
| M14a / b | `waitForDouyinTabLoad` 对 `loading` / 非抖音 host 也 resolve | 1 例；2 例 |
| M15a / b | sync adapter 绕过 funnel；runtime 先于标签页门 | 2 例；2 例 |
| G1 / G2 | 去掉偏离 11 的入口判断；改为 sync 之后才读 `isActive()` | 各 1 例（`getDouyinPendingVideos` 被调 1 次）；新用例先红同一句 |

**验证**（2026-10-08）

- 聚焦集（`info.md` Step 3 节 §2 的命令，加大超时）：94 文件 / 853 例全过。默认超时下同一集合有 17 个文件超时、零断言失败（PGlite `beforeAll`，机器负载）。
- `pnpm compile`：通过。
- `pnpm test`：根 236 文件 / 2050 例首跑 30 个文件失败，全部是 PGlite `beforeAll` 超时及其级联（`afterAll` 的 `close` 读 undefined、`chat-view.test.tsx` 的 DOM 残留），零真实断言失败；当时机器 CPU 被其他进程占到 77%，import 阶段累计 1602 s。这 30 个文件加 `--hookTimeout=120000 --testTimeout=60000` 重跑：30 文件 / 360 例全过。根部失败让 `&&` 跳过了 `packages/*`，单独跑 `pnpm -r test`：15 文件 / 263 例全过。
- `pnpm build`：`[bundle-contract] background graph 14 modules / 962605 bytes`（Step 2 基线同一台机器同一天：961873；多出的 732 字节是 SW 图上的 `configuration-blockers.ts` 与 `douyin-tab.ts` 的增量），PGlite 标记 / dangling initializer / 动态 `import()` 零命中；`background.js` 里 `douyin-sync-service` / `pglite` 零命中。
- manifest：改前基线 build 与改后 build 的 `.output/chrome-mv3/manifest.json` 逐字节相同（`cmp` 零差异）。

**未做 / 留给后面**

- **本 Step 判据的实机部分没跑**：清库（D2，删 `items where platform='douyin'` 级联、`authors` 孤儿、`platform_sync_records`、`local:douyin-backfill`）要用户当场批准；之后的「不碰页面，视频逐条出现 CC / ASR 角标、标签随后出现」「关掉 app.html 再开、再同步，残留的 `'pending'` 被补上」「关掉抖音标签页，进度条显示等待」需要已配置的 ASR key 与 BrowserOS neo 里 reload 扩展（会关掉用户已开的扩展页面）。三者齐了在 Step 4 一并跑，Step 4 清单 6 / 7 就是这两条。
- **风控冷却期间条目会落 `'error'`**（复核发现，按本文 §4.3 T4「重试一次」保留）：`DOUYIN_RATE_LIMITED` 的 `retryAfter` 是 30 分钟冷却，每条在 `paused` 里等满、重试一次，再被拒即 `'error'`；持续风控时约每 30 分钟永久失去一条（v1 无重试入口），并向被风控的账号每 30 分钟多发 1–2 次签名请求。改法要在共享状态机里加「瞬态失败、保持 `'pending'` 不标 error」一类，或给平台冷却一个不借 ASR quota 文案的暂停态；Step 4 清单 2 先看实际出现频率再定。
- SW 的 `job-registry` 一个 tab 只记一个转录 job，B站与抖音 session 并发会串台（Step 2 已记）；v1 接受，写进 `entrypoints/app/hooks/CLAUDE.md` 与 `lib/background/CLAUDE.md`。
- session 被取消时若正在等标签页加载，adapter 的短路状态会留到下一次 douyin.com 标签页加载完成；v1 抖音没有取消入口，基本不可达。同一轮停放里先后出现两类前置条件时，`prerequisiteBlocked` 显示后一类、等待的是前一类；SW 先查 ASR key 再查标签页，实际不会同时出现。
- 卡片上的手动转录 / 取消按钮（D-e）与 `'error'` 条目的重试入口仍是后续项。

### Step 4 — 实机端到端验证（生产条件）

**目标**：在用户账号上跑完一次「清库 → 全量 → 自动转录积压 → 打标签」，把 §6 剩余 `[UNKNOWN]` 收口，按实测调默认值。

**依赖**：Step 1–3 已落地；ASR key 已配置（Step 3 实测时无 key）。

**清单**

1. **字幕命中率**：积压里 `subtitle_source = 'official'` 与 `'asr'` 的比例；字幕轨的语言分布；是否有 VTT 解析失败的样本（T8）。
2. **签名计数**：同一标签页生命周期内 detail 请求累计次数；第一次出现 Argus 403 / `sdk-not-ready` 时的计数——这是 docs/33 §6「140 次分桶」的直接测量。出现即记录，对策是文案「刷新抖音标签页」，**不是**自动 reload。
3. **mp4 直传**：Groq 对带视频轨的 mp4（文件名 `audio.m4a`）是否接受；≤ 24 MB 与 > 24 MB 各至少一条；Offscreen 抽音轨耗时。
4. **D6 比例**：空转录退回 `desc` 的条目数——若过半，说明 ASR 在无口播视频上白跑，评估是否要在转录前用 `music.title`（「原声」字样）之类的弱信号跳过（**不在本 Step 做**，只记数）。
5. **节奏**：字幕命中路径的实际间隔（应 ≥ 5 s）；整份积压总耗时。
6. **D7**：中途关 app.html，重开后再同步，`'pending'` 被补上且不重复转录（cache 命中）。
7. **D5**：session 进行中关抖音标签页 → 停放；重开 → 继续，无条目被标 `'error'`。
8. **打标签**：转录后的标签明显比文案版更贴内容（抽 10 条人工看）。
9. **Chat / Agent Bridge**：`favbase search "<字幕里的关键词>" --platform douyin` 命中转录正文。

**不做**：不压测风控；不在本 Step 改节奏常量以外的代码。

**回滚**：推翻默认值 → 只改对应 `VITE_DOUYIN_*`；推翻路线（detail 被拒、CDN 不可下载）→ 停下来回 §1 D3 重议，不就地换路线。

**判据**：清单 1–9 全部有记录；§6 每条收口；落地记录写进本文。

#### Step 4 落地记录（2026-10-09，实机，零代码；commit b6ebfab）

**条件**：用户 05:45 重装扩展（库与 storage 全新，抖音零行，D2 清库因此不必执行、什么都没删）并配好 Groq ASR（`whisper-large-v3-turbo`，service tier `on_demand`）；B站全量自动转录与抖音共用这把 key，用户在开跑前手动暂停了B站；LLM（tagging）与 embedding 由用户在 06:37 配上，lane 经 `resumeCollectionProcessing` 自动恢复。抖音标签页是我在 BrowserOS neo 里开的 `user/self?showTab=favorite_collection`（登录态有效），从没碰用户的标签页。06:15:48 点「立即获取」，07:48:30 在抖音页点「Pause library build」暂停（用户选的停止点：同一标签页生命周期的签名请求越过 140），暂停后零请求。剩余积压留在 `'pending'`，点 Resume 并开一个 douyin.com 标签页即续跑。

**测法**（scratch，不入仓库，`%TEMP%\fbcdp\dy\s4\`）：在我的抖音标签页里，于 SDK 已接管 `window.fetch` 之后包一层只读计数器（不在 SDK 就绪前装，transport 的 `sdk-not-ready` 判定保持真实），记每次 `aweme/v1/web/*` 的状态码、`status_code`、detail 的音轨形状；PerformanceObserver 记本页生命周期内全部 `aweme/v1/web/*` 请求（含页面自己的 XHR，a_bogus 按页计数）；app.html 里挂只读 `onMessage` 收 `TRANSCRIBE_STATUS`（错误码不落库，只在推送里）；60 s 一次的一次性 CDP 采样读库。没有常驻调试器挂在标签页上。

**结果**

| # | 清单 | 实测 |
|---|---|---|
| 1 | 字幕命中率 | `official` 0 / `asr` 90；123 次 detail 响应的 `cla_info` 全部 null（Step 0 的 136 个样本之后又 93 个不同作品）。语言分布、VTT 解析无从测 |
| 2 | 签名计数 | 生命周期一（06:13–06:27）：我们的请求 59 次（list 28 + detail 31），本页 `aweme/v1/web/*` 共 81 次；生命周期二（06:30 重开–07:50）：我们的 96 次（detail 92），本页共 **156 次**。155 次我们的请求**全部** 200 / `status_code 0`，零 Argus 403、零 `sdk-not-ready`、零验证页、零空 payload；`aweme_id` 回声 123 / 123 一致，`filter_detail` 零。「本页签名 < 140」分桶至少到 156 没被打分 |
| 3 | mp4 直传 | 没有纯音轨的 37 个作品全部 ≤ 170 s，选中的最低 H.264 mp4 档最大 20.7 MB；其中 35 条以 `audio.m4a` 直传 Groq 转录成功，另 2 条是限流落 error / 暂停时仍 pending，与 mp4 无关——**Groq 接受带视频轨的 mp4**。> 24 MB：mp4 档一次都没出现；纯音轨出现一次（1329 s 视频 32.14 MB），走 Offscreen 分块 3 块，chunking → done 30 s，成功 |
| 4 | D6 比例 | 空转录退回 `desc`：**0 / 90**。但 9 / 90（10%）的正文整段是 Whisper 幻觉（6 条「字幕志愿者 李宗盛 / 杨栋梁」、3 条「请不吝点赞 订阅 转发 打赏支持明镜与点点栏目」），另 1 条结尾带「优优独播剧场——YoYo Television Series Exclusive」；全部是 ≤ 31 s 的静音 / 纯音乐短视频。没有过半，`music.title` 跳过不必做；真问题是幻觉，见下「新发现 1」 |
| 5 | 节奏 | 字幕命中路径不存在（无 official）。相邻 detail 间隔 min 5.3 s / p50 20 s / p90 120 s，< 5 s 零次。同步全量 469 条约 8.5 min（06:15:48 → 06:24）。转录 06:16 → 07:47 共 90 条、5.03 h 音频；撞 ASPH 之后稳态 ≈ 每小时 2 h 音频。首次积压 442 条共约 45 h 音频 → 整份积压按 ASPH 至少约 23 h（ASD 日上限 `[UNKNOWN]`，本次没撞到） |
| 6 | D7 | 两次关 app.html：① 06:31:12（两条之间）→ 重开、再同步（fetched 20 / inserted 0）→ 积压追加、06:32:07 续转；② 06:33:36 在 `uploading` 时关 → SW 照常完成并写 `vc:douyin:7679033686959901961`（42 行）→ 重开再同步后该条 06:34:26 落库 `asr`，**没有第二次 detail、没有阶段推送**（cache 命中）。全程 detail 无重复转录（重复的 30 次全部来自限流重试，见新发现 2） |
| 7 | D5 | 06:26:50 关抖音标签页 → 410 条在 74 s 内逐条以 `DOUYIN_TAB_MISSING` + `closed` 停放（T1 门零网络，0.26 s / 条；一轮停放只起一个等待），横幅「waiting for a logged-in site tab…」，**零 `'error'`**；06:30:15 重开 → 06:30:27 自动恢复，按原顺序重入 |
| 8 | 打标签 | 随机抽 10 条：7 条至少有一个只能从转录得出的标签（「原住民」「简历优化」「3D地球 / 公开数据」「AIAgent / AI编程」等），转录明显比文案版贴内容；2 条正文是幻觉，标签仍由标题 / 文案撑住。视频平均 4.76 个标签，抖音共 309 个不同标签 |
| 9 | 检索 | 用户配对 Agent Bridge 后，`favbase search "巴罗" --platform douyin`、`"比拉瓦尔"`（两词只在转录里，标题 / 文案没有）首条命中的 `chunk_text` 正是转录正文。反例：`"李宗盛"` 前 3 条命中全是幻觉正文（codex 教程、AI 视频提示词、山东旅游） |

**新发现**（都没改代码，按本 Step「不做」）

1. **Whisper 幻觉，跨平台**：静音 / 纯音乐片段的 ASR 返回非空的固定套话，D6 的「空转录」判定接不住，垃圾正文入库、切块、向量化、进检索（清单 9 的反例）。`lib/transcription` 与B站同一条 ASR 路径都没有过滤。后续项：在共享 ASR 结果上加幻觉过滤（已知套话黑名单，或 Groq `verbose_json` 的 `no_speech_prob` / `avg_logprob`），命中即按空转录处理（抖音退回 `desc`）——要先查 Groq 的响应字段，`[UNKNOWN]`。
2. **ASR 限流在 Groq `on_demand` 档是常态，「重试一次」会永久丢条目**：首次限流在 06:35（开跑 19 min、42 条之后），是 ASPH（每小时音频秒数 7200）而非日额度，码是 `ASR_RATE_LIMIT`。到暂停共 36 次限流落在 31 条上，**5 条二次被拒落 `'error'`（16%）**——`retry-after` 对 ASPH 不可靠（等满 21 s / 7 s / 8 s 仍被拒；p50 83 s，max 405 s）。v1 没有 `'error'` 的重试入口，D7 积压只捡 `'pending'`。Step 3「未做」预判的是抖音风控冷却，实测触发它的是 ASR 供应方。另外每次重试都重走 extractor，**再发一次 detail 签名请求并重下音频**（123 次 detail 里 30 次是重试，24%）：这把 a_bogus 计数与风控暴露放大了约四分之一。后续项与 Step 3「未做」那条合并：共享状态机里「带 `retryAfter` 的临时限流」改为保持 `'pending'` 的可恢复等待（像 `quota_paused`，但不借 quota 文案），不标 error；抖音侧可选在 SW 生命周期内按 `aweme_id` 记住已解析的候选直链（直链 ≥ 3 h 有效），重试不再签名。
3. **D-g 的「纯音轨让 ≤ 24 MB 直传成为常态」对长视频不成立**：纯音轨码率两档——约 48–56 kbps（时长 ≤ 478 s）与约 194 kbps（21 条，≥ 256 s）。194 kbps 下 24 MB ≈ 990 s，剩余积压里 30 条 > 990 s 会进 Offscreen 分块（已实测可用）。唯一一条有两档纯音轨的作品，`[0]` 是低码率那档，所以 `[0]` 不保证最低码率；要不要按码率挑最低档，等有更多双档样本再定。
4. **2.5 h 的作品（积压里最长 9124 s）在 ASPH 7200 s/h 下注定失败**（推断，未实测）：分块转录过程中必撞限流，整条重来一次再被拒即 `'error'`。新发现 2 的修法能接住它。
5. **Transcribe 段的口径两处不一**：session 在跑时显示 session 进度（「32/442」，只算视频），session 结束后显示 coverage（「62/469」，27 条图文以 `'chunked'` 计入已完成）。图文不转录却算进分子分母。小问题，记下不改。
6. **`closed` 停放会把整个队列在一分钟内逐条过一遍 SW**（每条一次 `TRANSCRIBE_AUDIO`、零网络），这是 Step 3 偏离 3 的设计（cache 命中仍能成功），实测代价可忽略。

**§6 收口**：见 §6 表各行状态列（2026-10-09 更新）。

**未做 / 留给后面**

- 剩余积压 347 条（40.0 h 音频）暂停在 `'pending'`；`'error'` 5 条（全是新发现 2）。重新跑之前先定新发现 2 的修法，否则按 16% 推算还会再丢约 50 条。
- 新发现 1（幻觉过滤）、2（限流不标 error + 重试不重签）是下一个任务的候选，各自要一份手册。
- B站自动转录仍是用户手动暂停的状态（library gate），由用户决定何时恢复：恢复后它与抖音共用 Groq ASPH。
- `job-registry` 一个 tab 一个转录 job 的串台缺口（Step 2 / 3 已记）本次没触发：B站在暂停中。

---

## 6. 未知与风险

| `[UNKNOWN]` | 影响 | 状态 |
|---|---|---|
| 抖音网页 aweme 对象是否带 AI 字幕轨字段（`video.cla_info.caption_infos` / `subtitle_infos` / 其他） | 「优先 AI 字幕」半边是否存在 | **已证伪（2026-10-08）**：字段是顶层 `cla_info.list[]`（播放器源码），但 136 个样本全空；v1 直接 ASR。Step 4（2026-10-09）又 93 个不同作品的 detail 全部 null。非空样本的 URL 主机、格式、CORS 仍未知 |
| 字幕轨在收藏列表条目里就有，还是只在 `aweme/detail` 里 | 不影响路线（D3 一律 detail），影响 Step 0 结论的表述 | **仍未知**（两边都没有非空样本；列表与 detail 都没有 `cla_info` 键，精选接口给 `null`） |
| 字幕 VTT URL 与 `bit_rate[].play_addr` 直链能否从扩展 SW / Offscreen 以 `credentials: 'omit'` 下载（CORS、Referer、签名参数） | D3 路线成立与否 | **直链已证实（2026-10-08）**：SW 里 mp4 档 `v11-weba` 直链 200（`access-control-allow-origin: *`），play API 第 3 条 302 后 200；纯音轨 `v26-web` 主机 403 但 `backup_url` / `fallback_url` 200 → 必须顺序 fall-through。Step 4（2026-10-09）：生产链路 90 条全部下载成功（含 Offscreen 二次下载）。VTT 无样本，仍未知 |
| 直链是否带过期参数、有效期多长 | 是否能跨调用复用（本文按「不复用」设计） | **已证实（2026-10-08）**：路径第 2 段 8 hex = 过期 unix（= `cdn_url_expired`），视频 ≈ 3 h、纯音轨 ≈ 24 h，6.5 min 后仍 200，改过期段即 403。设计不变 |
| `aweme/detail` 经注入 transport 的签名是否被接受 | 同上 | **已证实（2026-10-09，Step 4）**：123 / 123 次 200 / `status_code 0`，回声一致 |
| a_bogus 单页面生命周期签名计数分桶 | 首次积压约 466 次 detail | **部分收口（2026-10-09，Step 4）**：同一页面生命周期内本页 `aweme/v1/web/*` 请求到 156 次（我们的 96 次）零拒绝，「< 140」分桶至少到 156 没被打分；更高的计数（整份积压约 560 次，含重试）仍未知 |
| Groq 对带视频轨的 mp4（文件名 `.m4a`）的接受度 | D-g | **已证实（2026-10-09，Step 4）**：35 条 mp4 直传全部转录成功（≤ 20.7 MB）；> 24 MB 的 mp4 没出现（无纯音轨的作品都 ≤ 170 s），该路径的 FFmpeg 抽音轨仍未在生产上跑过 |
| 无口播视频比例 | D6 的 ASR 浪费 | **已测（2026-10-09，Step 4）**：空转录 0 / 90，但 9 / 90 的正文是 Whisper 幻觉套话（≤ 31 s 静音 / 纯音乐片段）——D6 的前提「无口播 = 空转录」不成立，见 Step 4 新发现 1 |
| 页内 fetch 的风控阈值 | 节奏默认值 | docs/33 §6 仍未知；不压测。Step 4：两个生命周期合计 155 次（含 28 页同步）零风控信号，节奏默认值不改 |

---

## 7. 参考

- 本仓库：`docs/33`（抖音接入，§1 D3 / D4、§3 铁律、§4.4 形态、§6 未知）、`docs/04`（B站转录管线）、`docs/29`（字幕归属校验与串台事故）、`.trellis/spec/frontend/platform-onboarding.md` §4.4「延迟正文」
- 目录规则：`lib/transcription/CLAUDE.md`、`lib/auto-transcribe/CLAUDE.md`、`lib/cache/CLAUDE.md`、`lib/subtitle/CLAUDE.md`、`lib/bilibili/CLAUDE.md`「转录落库」、`lib/douyin/CLAUDE.md`、`lib/ingest/CLAUDE.md`、`lib/background/CLAUDE.md`、`lib/offscreen/CLAUDE.md`、`entrypoints/app/hooks/CLAUDE.md`「处理 lane」、`entrypoints/app/sections/bilibili/CLAUDE.md`「转录与处理 lane」
- 外部（写手册时字幕字段的唯一线索；**Step 0 已证实网页响应不是这个形状**，见 §4.2）：ucmao/media-parser `src/parsers/douyin_parser.py` `get_subtitles`（读 `video.cla_info.caption_infos[]` → `video.subtitle_infos[]`，选 `zh-Hans` 等，下载后按 WebVTT cue 解析）；fyfsxkh/TokBrain `app/services/f2_links.py` `_subtitle_candidates`（容器 `video.subtitleInfos` / `video.subtitle_infos` / `aweme.subtitle_infos` / `aweme.video_subtitle`）；社区项目 VidSumAI 则声称「抖音无标准 CC 字幕」
- 抖音 detail 的 `filter_detail` 业务结果：docs/33 `research/douyin-rate-limiting.md` 第 55 行（dtk 规则 12 / 13）
