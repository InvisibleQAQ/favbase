# 40 ASR 幻觉过滤（2026-10-12）

> 状态：**代码 + 单测已完成并提交 2026-10-12**。已入库的套话正文与 video cache 的清理不在本任务内。
>
> 起因：docs/37 Step 4 新发现 1。静音 / 纯音乐片段的 Whisper（`whisper-large-v3-turbo`）结果不是空的，而是固定套话；各平台的「空转录」分支接不住，套话入库、切块、向量化、进检索（`favbase search "李宗盛"` 前 3 条全是幻觉正文）。抖音 90 条里 9 条整段是套话，1 条结尾带套话；B站走同一条 ASR 路径。
>
> 规则的 owner：`lib/transcription/CLAUDE.md`。本文只记决策、否决与落地经过。

## §1 决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **黑名单，按 segment 整段丢**：`lib/transcription/asr-hallucination.ts` 维护一份套话签名表，segment 文本规范化（NFKC、去全部空白、小写）后包含任一签名即丢弃整段 | 实测 10 / 10 是三种固定串；它们被别人在同一模型上独立报告过（vexa #155、HF `whisper-large-v3-turbo` discussion #35），是训练数据里字幕组署名 / 频道口播的记忆，不是随机输出。BoH 论文（arXiv 2501.11378）的结论相同：非语音幻觉集中在少数固定串，后处理删除是有效的保险 |
| D2 | **只收真人几乎不说的署名 / 口播串**：频道名、站点名、署名用的化名（「明镜与点点」「优优独播剧场」「Amara.org」「Zither Harp」等），外加署名头「字幕志愿者」；繁体写法单独成条（NFKC 只折叠全半角，不做繁简转换）；每条在源码注释里写来源 | 「谢谢观看」「点赞 订阅 转发」也会被幻觉出来，但真人也说；收进来就会删掉真实语音。BoH 论文用 n-gram 概率排除常见短语，同一个考虑。「字幕志愿者」不是专名，是例外：后面跟的名字每次不同（D3），只能收署名头；代价是谈字幕志愿工作的真实语音会丢掉那一段，接受 |
| D3 | **整段丢，不做子串删除** | 套话后面常跟一个随机人名（「字幕志愿者 李宗盛 / 杨栋梁 / 杨茜茜」），只删签名会留下孤立人名；几条套话也会挤在一个 segment 里（HF #35 的样本）。套话是在非语音片段上解码出来的，和真实语音同段的情况没观察到，代价可接受 |
| D4 | **接缝是 `mapTranscriptionToRows`** | Groq 响应 → rows 的唯一出口，直传与 Offscreen 分块（`transcribeChunk` → `requestGroqTranscription`）都经过它；分块续传的进度表存的也是过滤后的行。官方字幕不经过它，也不该过滤 |
| D5 | **全部被丢 = 空转录** | 走各平台现有的空转录路径，不新增状态：抖音退回 `desc`（docs/37 D6），B站 `persistExistingItemContent` 对空正文返回 `null`——条目停在 `'pending'`、不进 Embed / Tag（docs/37 D6 记的B站既有缺口；过滤前它会带着套话正文 `'chunked'` 并被打标签）。video cache 不命中空 rows，所以空结果不会被缓存成「已转录」 |

## §2 否决清单（后续不得重提）

| 路线 | 否决理由 |
|---|---|
| 用 `no_speech_prob` / `avg_logprob` 门槛（含 Whisper 参考实现的 `no_speech > 0.6 且 avg_logprob < -1`） | 我们用的 `whisper-large-v3-turbo` 的 `no_speech_prob` 在 faster-whisper 上实测恒为 0（SYSTRAN/faster-whisper #1128）；Whisper 作者本人说它「often not a reliable predictor of voice activity」（openai/whisper discussion #29）。记忆型套话的 `avg_logprob` 往往很高，门槛拦不住它，却会误杀 BGM 下的真实口播。Groq 的 turbo 是否同样恒为 0 是 `[UNKNOWN]`，要重提先拿实测分布 |
| 子串删除（BoH 论文的 Aho-Corasick 删除） | 见 D3 |
| 按整条转录判定（整条是套话才丢） | 接不住「结尾带套话」那 1 条；segment 粒度同时覆盖整段与夹带 |
| 改 prompt 去掉「字幕」二字 | 假说：prompt 是前文条件，`GROQ_TRANSCRIPTION_PROMPT` 里的「中文字幕」可能把解码往字幕署名上推（openai/whisper #1606 有人指出 prompt 会让静音幻觉更糟）。没有对照实验，且 prompt 同时决定简体输出，改它影响全部转录。`[UNKNOWN]`，要动先做对照 |
| VAD 预处理 | 要在 Offscreen 里引入 VAD 模型、改切块与时间轴，对「固定串」这个问题过重 |

## §3 落地记录（2026-10-12，代码 + 单测）

执行稿是任务目录 `prd.md`（`.trellis/` 不进版本库，决策以本文为准）。

- `lib/transcription/asr-hallucination.ts`（新）：签名表 + `isKnownAsrHallucination(text)`。
- `lib/transcription/groq-client.ts`：`mapTranscriptionToRows` 对命中的 segment 返回 `null`（与空白 segment 同一处）。
- 测试：`asr-hallucination.test.ts`（11 条已报告串（含复核补的两条繁体）、多串同段、空白 / 全角 / 大小写变体命中；「谢谢观看」「记得点赞 订阅 转发」「字幕组」「明镜高悬」等真实语音不命中）；`groq-client.test.ts` 加两例（夹带的套话段被丢、前后真实段保留；整段套话 → `[]`）。
- 先红：两个文件改实现前 `2 failed`（新模块不存在；`expected [ { text: '字幕志愿者 李宗盛' … } ] to deeply equal []`）。
- 文档：`lib/transcription/CLAUDE.md` 的已知缺口改为「约束」节的四条与「坑」节的一条；docs/37 Step 4 新发现 1、「未做」与 §6 D6 行加指针。
- 复核（trellis-check）：补繁体签名「字幕志願者」「優優獨播劇場」（公开的 Whisper 自动字幕里都出现过，「字幕志願者 李宗盛」原先会漏过）；D2 与源码注释不再把「字幕志愿者」称作专名，写明它的误伤代价。证伪：删掉两条新签名，两条新用例变红。

**未做 / 留给后面**

- 已入库的套话正文（抖音 9 条整段 + 1 条夹带）与对应的 video cache 条目不会自己变干净：抖音这些条目已是 `'chunked'`，不会再被转录；即使重转，cache 命中也会把旧行原样返回。清理是一次性的本机数据操作，由用户决定（扩展未发布，不写迁移）。
- B站视频页面板对「成功但 0 行」沿用现状：转录按钮仍在，状态保持无字幕。
- 名单只覆盖已观察 / 已报告的串；新串出现时按 D2 加一行并写来源。
