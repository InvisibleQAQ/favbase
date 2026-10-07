# 33 抖音收藏接入手册（2026-10-03）

> 状态：**Step 0 已完成 2026-10-03**（调研 + 用户账号实测 + 决策 D1–D4 + 默认项）；**Step 1 已落地 2026-10-03（代码 + 单测，已复核）**，见 Step 1 节末「Step 1 落地记录」（断点状态收成两个字段，`restartBackfill` 删除；复核把 D-e 收窄为仅续传段第一次请求、并纳入该请求的 F10）；**Step 2 已落地 2026-10-03（代码 + 单测；已提交 `b6c6a54`，CLI 0.2.2 已发布）**，判别符已翻，见 Step 2 节末「Step 2 落地记录」（用户 2026-10-03 决定的三处偏离：job namespace 用平台 id、transport 进 `lib/douyin/` 独立 leaf、验证页与限流冷却两条文案）；**Step 2.5 已落地 2026-10-04（代码 + 单测，已复核，未提交）**，§6 末的两项阻塞关闭，见 Step 2.5 节末「Step 2.5 落地记录」（新条目的正文与 item 行同事务落盘、抖音每次运行至少清扫一次幽灵、接口序位 `listCursor` / `listIndex` 入库；复核发现含 NUL 字节的正文会让整次入库回滚，已在入库的文本边界剔除，D-h）；**Step 3 待实施**。一次对话只做一个 Step；执行任一 Step 前先读 §1 决策、§2 否决清单、§3 铁律，再读该 Step 的八段。
>
> 任务目录：`.trellis/tasks/10-03-douyin-public-favorites-platform/`（`prd.md` 记需求与决策，`research/` 五份调研是本文所有外部事实的出处）。接入契约：`.trellis/spec/frontend/platform-onboarding.md`。
>
> 起因：用户要求「添加第 7 个平台，抖音收藏，先只做公开收藏，先搜索资料再动手」。调研与实测推翻了「只做公开」在抖音上的可执行性（D1），也推翻了「扩展直接带 cookie fetch」这条知乎式路线（D4）。

---

## 0. 结论

| 问题 | 结论 | 证据 |
|---|---|---|
| 能不能取到数据 | 能，但**只能在已登录的 www.douyin.com 标签页的页面环境（MAIN world）里发请求**，由抖音页面自己的 SDK 补签名 | `research/douyin-request-signing.md`；用户账号实测 `collects/list` 9/9、`aweme/listcollection` 13/13 都带上了页面签名且**无一被签名门禁拒绝**（listcollection 里 11 次正常返回数据，2 次是故意测页大小上限的 `count=40/50` → `status_code: 5`）（`research/douyin-live-probe-2026-10-03.md`） |
| 「公开收藏」能不能做 | 抖音只在**收藏夹**上标公开 / 私密；全部收藏列表的条目没有可见性字段；账号级开关在 4 个网页接口里都读不到 → 只做公开不可执行，用户改为同步全部收藏（D1） | `research/douyin-public-favorites-semantics.md`、实测 #2 |
| 风控 | 抖音不发任何限流响应头；严重时是账号级隐式风控、持续数小时、连用户自己刷抖音都报「服务异常」→ 比其他平台更保守的节奏 + 断点续传（D2） | `research/douyin-rate-limiting.md` |
| 需要新表 / 迁移吗 | 不需要（`items.platform` 是普通 text 列，spec §3） | — |
| manifest 变化 | `host_permissions` 末尾多 `https://www.douyin.com/*`，`permissions` 多 `scripting` | §1 D4、默认项 |

---

## 1. 决策记录

| # | 决策 | 来源 | 否决项 |
|---|---|---|---|
| **D1** | **同步全部收藏**（`POST /aweme/v1/web/aweme/listcollection/`）；`status === 1` 的收藏夹是 **Source**（筛选 chip），其他值一律不当公开。私密收藏夹不是 Source，但它里面的视频经全部收藏照样成为 Collection Item——**这是对 B 站 / 知乎「私密夹的视频不是 Collection Item」的有意偏离**，Step 2 必须写进 `CONTEXT.md` 与 B 站规则并列 | 用户 2026-10-03（看过实测：开发账号 0 个收藏夹、2299 条收藏） | A 严格只同步公开夹（无夹用户 0 条）；B' 剔除仅在私密夹里的视频；C 按账号级「主页收藏列表」开关（无检测器） |
| **D2** | 防限流按 §4.3 默认值；**首次全量一次跑完**（分段休息 + 逐页入库 + 断点续传兜底） | 用户 2026-10-03 | 每次最多 N 页、分多次拉（连点两次等于一次跑完） |
| **D3** | **只用用户已打开的 douyin.com 标签页**。没有 → 空态 + 「打开抖音」按钮（X 先例）；每日自动同步只在存在可用抖音标签页时跑，否则静默跳过、不算尝试 | 用户 2026-10-03 | 扩展自己开后台标签页（后台签名是否被接受未知、页面自动播放很重、每天弹页面）；手动时自动开、自动时不开 |
| **D4** | **页面 SDK 签名**：app.html 用 `chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args })` 往抖音标签页注入一个 fetch 函数，签名由页面 SDK 自动补（`a_bogus` + `x-secsdk-web-signature`）。Chrome 文档已核实：promise 结果会被等待；`world` 自 Chrome 95（下限 117 内）；`func` 序列化、`args` 须可 JSON 序列化 | 用户 2026-10-03（看过「直连 403」的证据后批准）；实测 | 移植 `a_bogus` / websign；`webRequest` 抓包重放；SW 直连（见 §2） |
| 默认项 | 新增 `scripting` 权限（偏离 spec §12「只多 host_permissions」，扩展未上线、无重新授权问题）；host permission `https://www.douyin.com/*` 追加在末尾；正文 = `desc`，同步时即得，`contentKind: 'post-text'`；排序 = 作品发布时间（抖音无逐条收藏时间，知乎同款妥协） | 用户 2026-10-03「其他默认都同意」 | — |
| **D5** | **存接口序位，排序不改**：条目首次入库时把它在全部收藏列表里的位置写进 `platform_meta`——`listCursor`（该页响应返回的 cursor，末页为 `null`）与 `listIndex`（页内下标）。排序仍按作品发布时间，两个字段暂无读者。已知缺口：首见于公开夹分页的条目两个字段都是 `null`，first-write-wins 不回填；「cursor = 收藏时间」仍 `[UNKNOWN]`，所以字段名不带时间含义 | 用户 2026-10-04（insert-only：入库后补不了，只能清掉抖音数据全量重拉，约 20 分钟且多一次风控暴露） | 不存；存并立刻按收藏顺序排（基于未证实的假设，且要给 `sortKey` descriptor 加新格式） |
| **D6** | **幽灵清扫修在共享管线的入库事务里**：新条目的 `item_contents.plainText` 与 item 行同事务写入，`'has_content'` ⇒ 正文已落盘成为不变量；sweep 现有的 `plainText` 回退从此恒成立，零平台接线 | 用户 2026-10-04（看过代码事实：不止抖音，X 遇已知 id 即停、YouTube 对已入库视频不再拉详情，两者的 `textOf` 同样覆盖不到上次留下的幽灵） | sweep 加 `textFromMeta` 回退 hook（YouTube 的 meta 只有截断简介，救不回全文；新平台要记得接）；只修抖音（症状补丁，X / YouTube 原样保留） |

**写手册时由代码核对推出的设计默认项**（非用户决策，理由写在这里，后续 Step 不得无理由改回）：

| # | 默认项 | 理由 |
|---|---|---|
| D-a | 全部收藏里的条目**不挂任何 Source** | X / GitHub 用一个合成 Source（`lib/x/x-sync-service.ts:177`、`lib/github/github-sync-service.ts:235`），但它们的 `dimensions.source` 是 `null`。抖音的 Source 维度是收藏夹，合成「全部收藏」会在 `FacetChips` 与 Dashboard 细分卡里冒出一个假夹，还和「全部」chip 重复 |
| D-b | 处理 lane **逐条派发**：每页入库后对该页 `contentPersisted`（platformItemId）调 `enqueueCollectionProcessingItem`（`entrypoints/app/hooks/collection-processing-jobs.ts:266`），funnel 收 `newItemIds: []` | 逐页入库下，中途失败的运行已经写进库的条目不会经 funnel 派发打标（funnel 只在成功时 `startCollectionProcessingJobs`，`collection-processing-jobs.ts:147`）；tag backlog 只在配置恢复时跑。书签提取与 B 站转录是同一理由的先例（spec §4.4「A page closed mid-run must not leave items that are chunked but never embedded」）。`itemId` 传的是 platformItemId：`embedPlatformItem(platform, platformItemId)`（`lib/embedding/indexing.ts:246`）、`tagPlatformItem(platform, platformItemId)`（`lib/tagging/tagging-service.ts:76`） |
| D-c | `findDouyinTab()` 是**唯一**的标签页解析器（`!tab.discarded && tab.status === 'complete'`），标签页门、`probeReady`、transport 三处共用 | `probeReady` 若对一个被 Memory Saver 丢弃或仍在加载的标签页返回 true，每日协调器会记一次尝试、transport 再失败，当天名额白白烧掉。三个读者一个解析器，与 spec §8 anchor 5 同理 |
| D-d | 空 body 与 5xx / 不可达 / 注入超时**共用**一份重试预算（`MAX_RETRIES = 2`） | `withRetries` 一次调用一个跨原因计数器（`lib/http/retry.ts`）；为「空 body 只重试 1 次」单开计数器是为一个未测量的数字加机制 |
| D-e | 断点 cursor 被拒时自愈：**仅续传段第一次请求（携带存储断点的那次，含它的瞬态重试）**，`status_code ≠ 0`、`aweme_list: null` + `has_more: 1`，或返回的 cursor 不前进 / 回退（F10）→ 写回 `{ resumeCursor: null, backfillDone: false }`，下次从 `cursor=0` 关闭「整页已知即停」一路走到 `has_more: 0`（Step 1 勘误：原写「置 `restartBackfill`」，该字段已删，见 Step 1 落地记录；Step 1 复核收窄：原写「只在续传段」，任一页都触发；Step 1 复核时主会话决定纳入首请求 F10） | 16 位 cursor 跨天是否仍有效、失效时服务端怎么回应都 `[UNKNOWN]`；若按限流或普通错误处理，续传会永远卡死。代价是多一次全量。只有第一次请求带的是**存储的** cursor：它返回的 cursor 不前进 / 回退，等于服务端没认这个断点，与被拒同类。续传段第 2 页起用的是本次刚从服务端拿到的 cursor，那里被拒多半是真风控，若也清断点，就是在被限流时安排一次约 115 页的全量重走 |
| D-f | 页大小 20 | 实测 `count=30` 可用、`≥ 40` → `status_code: 5`（硬错误，不是截断）；20 是 jiji262 / f2 / dtk 的取值，离上限有余量；`count=10` 全量约 230 次签名，会越过 a_bogus 里「本页签名 < 140 次」的分桶（dtk 逆向，服务端是否打分 `[UNKNOWN]`） |
| D-g | **每次运行至少清扫一次幽灵**：运行开头的 Source upsert 调用无条件执行并带 `content`（Step 2.5） | 其他平台每次同步都会带 `content` 调一次 `ingestCollection`，所以每次都清扫；抖音的增量运行在头部首页整页已知时一页都不入库，上次中断留下的幽灵会一直等到下一条新收藏才被切块、派发 |
| D-h | **入库的文本边界剔除 U+0000**（主会话 2026-10-04 的默认决定，Step 2.5 复核）：不透明文本经 `lib/ingest` 进 `item_contents` 之前先剔除 U+0000 再 trim，且先于任何判空。共享管线的行为，对所有平台生效，不只抖音。不覆盖 `persistExistingItemContent`（chunk 是调用方备好的）与 `title` / `platform_meta` 里的 NUL | Postgres 的 `text` 存不了 U+0000，所以今天存得进去的正文一个字符都不变，变的只是今天会抛错的输入；正文与 item 行同事务（D6）之后，一条这样的正文会让整次入库回滚、每次同步都如此（github 的 UTF-16 README 是现成的触发源）。否决：按批 savepoint（那次同步仍然永远失败）；接受现状（带着回归上线） |

---

## 2. 历史与否决清单（后续 Step 不得重提）

### 2.1 2026-08 的未提交实现

- 2026-08-19/20 曾有一版 `lib/douyin/` + `entrypoints/app/sections/douyin/`：SW / app 直接 fetch + `webRequest` 捕获 msToken（存 `chrome.storage.session`）+ circuit breaker。**它从未进入 git**：`git log --all -- 'lib/douyin/*'` 为空；唯一痕迹是归档任务 `.trellis/tasks/archive/2026-08/08-20-fix-douyin-split-auth-preflight-into-not-logged-in-vs-capture-missing/prd.md` 与 `.trellis/workspace/favbase/journal-4.md` Session 179；`index.md` 里那条 `75c42a2` 实为一个无关的样式提交。
- 那份 PRD 写着「不改变捕获设计（**禁止伪 token / 禁止开 tab / 禁止页面上下文降级**，docs/19 决策保持）」。那个 docs/19 从未落地（今天的 docs/19 是 app 设计审查）。
- **D4 有意推翻「禁止页面上下文降级」**：2026-08-16/17 起抖音对收藏接口强制页面签名（Argus），SW 直连已无可行路线；那版实现恰好在强制签名后的第三天卡在「已登录仍报 missing msToken」。用户 2026-10-03 在看过直连 403 的证据后批准了 D4。**「禁止开 tab」与 D3 一致，保留。**
- 遗留物：`.env.local` 的 `# --- douyin ---` 块有 8 个零代码读取的死键（docs/26 附录 C 第 4 条）。它在 Step 1 被替换（§5 Step 1）。

### 2.2 否决的取数路线

| 路线 | 否决理由 | 出处 |
|---|---|---|
| SW / app.html 带 cookie jar 直接 fetch（知乎式） | 2026-08-16/17 起三个收藏接口都在页面 SDK 的 `webSign` 受保护表里，缺签名 → `403 Blocked by ArgusSecurityPlugin (Signature\|Uifid) Not Found` | `douyin-request-signing.md` §1 |
| 移植 `a_bogus` + websign 到 TS | 无维护中、有服务端验收记录的 TS 实现；绑定 bdms / secsdk 版本；服务端抽样校验（坏签名约 3/8 也能拿到数据）让失效难以发现；主流下载器作者以「合规」为由停止维护算法 | 同上 §2 |
| `webRequest` 抓包重放 | 签名覆盖精确 query 与时间戳，换 cursor 即失效；多加一个参数 → `403 Sign Invalid`；MV3 读不到响应体 | 同上 §3c |
| 调 `byted_acrawler.frontierSign` / bdms 内部下标 | 页面不暴露签名函数（名字在字节码 VM 里运行时生成）；`frontierSign` 历史上只产 X-Bogus | 同上 §3b |
| 被动监听 + 驱动页面滚动 | 慢；虚拟列表只在标签页激活时分页；和 DOM / 路由耦合 | 同上 §5② |
| 静态 MAIN-world content script（`bilibili-inject` 式） | 每次打开抖音都常驻；要 MAIN→ISOLATED→runtime 三跳桥；SDK 在 `document_start` 之后才重包 `fetch`（OpenBiliClaw 的遮蔽 bug）。`executeScript` 注入已加载完的页面，SDK 早已就位 | 同上 §3a |

### 2.3 否决的范围与风控取值

- 「公开」的三种定义（A / B' / C）见 §1 D1。
- `status_code ∈ {2154, 2156, 10000, 10001}` **不作为风控码表**：dtk 自注「not gospel」，10000 是 TikTok 的信封，能找到的 2154 真实样本都是 2019–2021 年移动端签名缺失。按形态判，不按码判（§4.4）。
- 页面通道下 403 / 429 **不在请求层重试**：jiji262 的页面通道明确不重试，「重试只会加速触发验证码」（2026-08-22）。直连路径的 1/2/5 s 重试不适用。

---

## 3. 跨 Step 铁律

1. **`douyin-api.ts` / `douyin-sync-service.ts` 的加载图零 chrome、零 storage；`chrome.*` 只在 transport leaf**（Step 2 勘误：用户 2026-10-03 决定：平台的请求与计时代码要留在 `lib/<p>/` 的守卫范围内。原写「`lib/douyin/` 零 chrome、零 storage、零裸 `fetch(`」——transport 与 `findDouyinTab()` 改住 `lib/douyin/douyin-tab.ts`，那里有本平台唯一一处裸 `fetch(`，经 `ALLOWED_BARE_FETCH` 文件级登记）：请求经注入的 transport（§4.1）。sync-service 的加载图必须过 `tests/lib-import-smoke.test.ts`（Step 2 翻判别符后已自动纳入），全目录过 `tests/http-fetch-deadline-guard.test.ts` / sleep / env 守卫；api 与 sync-service 不得 import 这个 leaf（`douyin-tab.test.ts` 按 AST 守）。
2. **绝不预填任何签名参数**（`a_bogus` / `verifyFp` / `fp` / `uifid` / `timestamp` / `x-secsdk-web-signature` / `msToken`）：签名覆盖精确 query，SDK 签完后再改一个参数就是 `403 Sign Invalid`。只发业务参数 + `device_platform=webapp&aid=6383&channel=channel_pc_web`，路径一律相对 `www.douyin.com`。
3. **抖音 API 的 `favorite*` 是「喜欢 / 点赞」，`collect*` 才是收藏**。`/aweme/v1/web/aweme/favorite/`、`favorite_permission`、`show_favorite_list`、`favoriting_count` 全都与本平台无关。
4. **id 一律用字符串**：`aweme_id`、`collects_id_str`、`sec_uid`。`collects_id` 是 int64 JSON number，`JSON.parse` 后已丢精度。
5. **按形态判失败，不按码判**（§4.4）；合法零结果（§4.2）绝不报错，风控形态绝不吞成空。
6. **不在请求层重试 403 / 429**；不碰用户的抖音标签页（不 reload、不导航、不 `tabs.update`）。
7. **数值全部 `envNumber('VITE_DOUYIN_*', default)`**，登记 `tests/platform-env-constants-guard.test.ts` 的 `EXPECTED_ENV_CONSTANTS`，`.env.example` 与 `.env.local` 的抖音块与之双向一致。
8. **测试先红后绿**；每个 Step 的文档（目录 `CLAUDE.md`、spec、本文落地记录）与代码同一个 commit。
9. 一次对话一个 Step；commit 只在用户明确要求时做。

---

## 4. 接口与形状速查（Step 1 / 2 共用）

### 4.1 transport 契约（lib 定义类型，app 实现）

> Step 2 勘误：实现也在 lib——`lib/douyin/douyin-tab.ts` 是独立的 chrome leaf（用户 2026-10-03 决定：平台的请求与计时代码要留在 `lib/<p>/` 的守卫范围内），app 侧只接线；`douyin-api.ts` / `douyin-sync-service.ts` 的加载图仍零 chrome。

```ts
// lib/douyin/douyin-api.ts —— 形状示意，命名可在 Step 1 定稿
export interface DouyinRequest {
  method: 'GET' | 'POST';
  path: string;                    // '/aweme/v1/web/...'，相对 www.douyin.com
  query: Record<string, string>;   // 业务参数 + 三个公共参数，不含任何签名参数
  form?: Record<string, string>;   // POST 时编码成 application/x-www-form-urlencoded
  timeoutMs: number;               // lib 给：resolveHttpDeadlineMs()（lib/http/fetch-with-deadline.ts:38），不新增常量
}

export type DouyinTransportResult =
  | { kind: 'response'; status: number; text: string }
  | { kind: 'sdk-not-ready' }               // 页面 fetch 仍是 native
  | { kind: 'unreachable'; message: string }; // 网络错误 / 超时 / 标签页关了 / 注入失败

export type DouyinTransport = (req: DouyinRequest) => Promise<DouyinTransportResult>;
```

transport 自己**不抛**，把一切失败折成 `kind`；分类全部在 lib（§4.4），这样 lib 测试能用 fake transport 覆盖每一种失败。

### 4.2 端点

| 端点 | 方法 / 参数 | 分页 | 列表键 | 合法零结果 |
|---|---|---|---|---|
| `/aweme/v1/web/aweme/listcollection/`（全部收藏） | **POST**，query 多 `publish_video_strategy_type=2`；form `count`、`cursor` | `cursor`：首页 `0`，之后用响应的 **16 位微秒时间戳**，逐页递减；`has_more` 是 **0/1** | `aweme_list` | `aweme_list: []` + `has_more: 0` |
| `/aweme/v1/web/collects/list/`（收藏夹列表） | GET，`cursor`（偏移，从 0）、`count` | `has_more` 是 **bool** | `collects_list` | **`collects_list: null` + `total_number: 0`**（实测，用户无夹） |
| `/aweme/v1/web/collects/video/list/`（夹内条目） | GET，`collects_id=<collects_id_str>`（带 s）、`cursor`（偏移）、`count` | `has_more` 0/1，**无** `max_cursor` | `aweme_list` | `aweme_list: []` + `has_more: 0` |

- 收藏夹公开判定：`status === 1`；`0` 私密；其他值不当公开。`states` / `is_normal_status` 语义不明，**不得**当隐私标志（单源证据：dtk 2026-09-14，一个账号两个夹）。
- 失效作品：从 `aweme_list` 剔除，单列在 `disabled_item_ids` / `invalid_item_id_list`；一页条数 < `count` **不代表到底**，只看 `has_more`。
- `count ≥ 40` → `status_code: 5` + `aweme_list: null`（无 `status_msg`）。
- 每条 aweme 原始 JSON ≈ 80 KB（20 条一页 1.6 MB）。transport 按原文回传可以接受（单次结构化克隆毫秒级），Step 3 记录实际耗时；**不要**在注入函数里做字段投影（解析逻辑会被拆到一个无法单测的序列化函数里）。

### 4.3 aweme → 行映射

| 字段 | 来源 |
|---|---|
| `platformItemId` | `aweme_id` |
| `title` | `desc` 首个非空行，截断（长度经 `envNumber`）；空则回退作者昵称 |
| `originalUrl` | `images` 非空 → `https://www.douyin.com/note/<id>`，否则 `https://www.douyin.com/video/<id>` |
| `platformAuthorId` / `authorName` | `author.sec_uid`（`uid` 会轮换，不能做主键） / `author.nickname` |
| `publishedAt` | `create_time * 1000`（作品发布时间；无逐条收藏时间） |
| `contentState` | `desc` 非空 `'chunked'`，空 `'no_content'`，**从不** `'pending'` |
| 正文 / 切块 | `desc` / `charSplit(text, { preferParagraph: false })`（同 X，叶子导入 `@/lib/embedding/char-split`） |
| `platform_meta` | 至少 `desc`、`authorName`、`authorSecUid`、`avatarUrl`、`coverUrl`、`durationMs`（`video.duration`，毫秒）、`mediaKind`（`'video' \| 'note'`）、首见 `folderId` / `folderTitle`（仅展示；筛选走 `item_sources`）、接口序位 `listCursor` / `listIndex`（D5，Step 2.5：首次入库时所在列表页响应返回的 cursor（末页 `null`）与页内下标；首见于公开夹分页则两个都是 `null`；只写不读，排序不改）。不存 `statistics.play_count`（网页恒 0） |

### 4.4 失败形态 → 动作（按形态判）

| # | 形态 | 动作 | 错误 |
|---|---|---|---|
| F1 | 没有可用抖音标签页（`findDouyinTab()` 为 null） | **funnel 之前**抛，不算尝试 | `DouyinAuthError('missing')` |
| F2 | transport `sdk-not-ready` | 不重试 | `Error`（提示刷新抖音标签页） |
| F3 | 403 + body 含 `ArgusSecurityPlugin` | 立即停，不重试（签名问题，是 favbase 或 SDK 变了） | `Error` + body 片段 |
| F4 | 403 / 429 无 Argus body | 不重试，停本次运行 | `DouyinRateLimitError(resetAt = now + COOLDOWN_MS)` |
| F5 | 200 空 body | 与 F11 共用重试预算，耗尽 → 同 F4 | 同 F4 |
| F6 | 200 非 JSON（挑战页）/ 任意层级出现 `verify_check` / `verify_center_decision_conf` 非空 / `verify_ticket` / `captcha` | 立即停，提示去抖音标签页完成验证 | `DouyinRateLimitError(resetAt: null)` |
| F7 | `status_code: 8` 且 `status_msg` 含「未登录」/ `status_code: 2483` / 「请先登录」 | 停，引导登录 | `DouyinAuthError('missing')`（favbase 不预先确认抖音登录态，同知乎恒 `missing`） |
| F8 | `status_code: 0` + 列表空 / `null` + `has_more` 真 | 有 `disabled_item_ids` / `invalid_item_id_list` → 整页失效，继续翻；否则软停（已入库的保留） | `DouyinRateLimitError(resetAt = now + COOLDOWN_MS)` |
| F9 | 其他非零 `status_code`（含 `5`） | 停 | `Error`（含 `status_code` / `status_msg` / body 片段） |
| F10 | cursor 不前进 / 回退 / 重复（listcollection 非首页回到 `0` 也算，Step 1 复核补） | 停；续传段第一次请求出现时另按 F12 自愈（Step 1 复核，主会话决定） | `Error` |
| F11 | 5xx / transport `unreachable` | `withRetries` 最多 `MAX_RETRIES` 次，`backoffDelayMs` | 耗尽 → `Error` |
| F12 | **续传段第一次请求**（携带存储断点的那次）出现 F8（无失效 id）、F9 或 F10 | 按 D-e 自愈：断点写回 `{ null, false }`，本次以 F8 / F9 / F10 原错误结束（Step 1 勘误：原写「置 `restartBackfill`」；Step 1 复核收窄：原写「续传段」任一页；F10 是复核时主会话决定纳入的）。续传段之后的页按 F8 / F9 / F10 原样处理，断点留在最后一页成功入库之后 | 原错误 |

每个错误消息都带 HTTP 状态、300 字符 body 片段（`textSnippet`，`lib/http/response-body.ts`）、`status_code` / `status_msg`——这是把 `[UNKNOWN]` 变成已知的唯一途径。

### 4.5 节奏（D2）

| 常量 | 默认 | 说明 |
|---|---|---|
| `VITE_DOUYIN_PAGE_SIZE` | 20 | D-f |
| `VITE_DOUYIN_PAGE_DELAY_MIN_MS` | 5000 | 页间隔 = `jitteredDelayMs(MIN, JITTER)` |
| `VITE_DOUYIN_PAGE_DELAY_JITTER_MS` | 3000 | |
| `VITE_DOUYIN_REST_EVERY_PAGES` | 25 | 每 N 次请求休息一次 |
| `VITE_DOUYIN_REST_MIN_MS` | 60000 | 休息 = `jitteredDelayMs(MIN, JITTER)` |
| `VITE_DOUYIN_REST_JITTER_MS` | 120000 | |
| `VITE_DOUYIN_MAX_PAGES` | 200 | 每段翻页的失控保险丝（> 2299 / 20 ≈ 115） |
| `VITE_DOUYIN_MAX_RETRIES` | 2 | F5 / F11 共用（D-d） |
| `VITE_DOUYIN_BACKOFF_BASE_MS` | 2000 | `backoffDelayMs(retry, BASE, JITTER)` |
| `VITE_DOUYIN_BACKOFF_JITTER_MS` | 500 | |
| `VITE_DOUYIN_COOLDOWN_MS` | 1800000 | F4 / F5 / F8 的 `resetAt` |
| `VITE_DOUYIN_TITLE_MAX_CHARS` | 140 | 标题截断（同 X 的 140） |

**一次运行的所有请求共用一个节奏器**（三个接口一条串行链）：第一个请求前不等，之后每个请求前等页间隔，每满 `REST_EVERY_PAGES` 次再加一次休息。节奏器的 `sleep` / `random` 可注入，测试不真等。预计：首次全量 115 页 × 6.5 s + 4 次休息 ≈ 20 min；每日增量通常 1–2 页。

---

## 5. 分步

### Step 1 — `lib/douyin/` 领域层（不翻判别符）

**目标**：建成并测绿抖音的整个领域层——请求构造、响应分类、分页游走、节奏器、逐页入库、断点续传、查询——全部用 fake transport 与内存 PGlite 验证。`COLLECTION_PLATFORMS` 不动，`tsc` 全程绿（spec §4）。

**依赖**：无代码依赖。**唯一的用户动作**：本 Step 必须改用户 gitignored 的 `.env.local`（见「改法」第 6 条），动手前先征得同意。

**文件**

| 文件 | 动作 |
|---|---|
| `lib/douyin/douyin-api.ts` | 新建：transport 类型（§4.1）、请求构造、响应分类（§4.4）、错误类、节奏器、三个分页游走、纯函数解析器 |
| `lib/douyin/douyin-sync-service.ts` | 新建：唯一的 schema 知识持有者——同步编排 + 逐页 `ingestCollection` + 断点状态机 + 查询 + `narrowDouyinMeta` / `toDouyinItem` |
| `lib/douyin/douyin-api.test.ts`、`lib/douyin/douyin-sync-service.test.ts`、`lib/douyin/narrow-meta.test.ts` | 新建 |
| `lib/douyin/CLAUDE.md` | 新建（根 CLAUDE.md 规则：新目录同 commit 建文档） |
| `tests/platform-env-constants-guard.test.ts` | `EXPECTED_ENV_CONSTANTS` 加 §4.5 的 12 行 |
| `.env.example` | 加 `# --- douyin ---` 块（每键一行注释 + `# KEY=default`） |
| `.env.local` | **只替换** `# --- douyin ---` 块（征得用户同意） |
| 本文 | Step 1 落地记录 |

**改法**

1. **错误类**：`DouyinAuthError extends PlatformAuthError`、`DouyinRateLimitError extends PlatformRateLimitError`（`lib/collections/sync-errors.ts:43`、`:56`，按文件路径 import，不走 barrel），各自显式 `this.name`。
2. **请求构造**：三个公共参数 + 业务参数；listcollection 多 `publish_video_strategy_type=2`；POST 用 `form`。导出纯函数（如 `buildCollectionRequest(cursor)`）供测试断言「零签名参数」。
3. **分类器**：`classifyResponse(result, what)` 按 §4.4 输出「数据 / 合法零结果 / 抛哪种错」。F6 的 `verify_check` 递归查找键或字符串值（douyin-cli 的做法）；F7 按 `status_msg` 文本匹配，不只看裸 `8`。
4. **节奏器**：`createDouyinPacer({ sleep, random })`，`await pacer.beforeRequest()`；重试用 `withRetries({ maxRetries: MAX_RETRIES, control }, attempt)` + `retryAfter(backoff, exhausted)`（`lib/http/retry.ts`），F5 / F11 返回 `retryAfter`，其余直接抛。每次领取下一页前 `await control?.checkpoint()`（spec §4.3：暂停不是取消）。
5. **同步编排**（`douyin-sync-service.ts`），一次运行的顺序：
   1. `collects/list` 全量 → `status === 1` 的夹 → `ingestCollection({ sources: 公开夹, items: [], links: [] })`（空夹也是 Source）。
   2. **头部段**：从 `cursor=0` 翻 listcollection；每页 `ingestCollection({ sources: [], items, links: [] })`（D-a），`onPagePersisted(result.contentPersisted)`；遇到**整页**（剔除失效后非空）都在已知集合（开跑时 `platformItemIds` 读一次，入库后并入）→ 停。不用「首个已知 id 即停」：重新收藏的旧视频会顶到最前面。
   3. **续传段**：若 `backfillDone === false` 且有 `resumeCursor` → 从它接着翻到 `has_more: 0`。
   4. 每个公开夹全量走 `collects/video/list`，入库条目并写 `links`（夹里有、全量列表还没拉到的照样入库）。
   5. 返回 `{ fetched, inserted, folders, newItemIds }`。
6. **断点状态机**：状态 `{ resumeCursor: string | null; backfillDone: boolean }` 由调用方传入、经 `onBackfill(state)` 回写（lib 零 storage）（Step 1 勘误：原有第三个字段 `restartBackfill`，已删，理由见 Step 1 落地记录）。规则：
   - 首次（`backfillDone: false`、`resumeCursor: null`）：头部段即全量，每页把响应 cursor 写成 `resumeCursor`；见 `has_more: 0` → `backfillDone: true`、`resumeCursor: null`。
   - 之后若 `backfillDone: false`：头部段**不改** `resumeCursor`（那些页比断点新），续传段每页把它推向更旧（cursor 单调递减，只取更小者）。
   - `{ resumeCursor: null, backfillDone: false }`（首次、或 D-e 写回）即「全量走」：头部段关闭「整页已知即停」，从 0 走到底。
   - 中途抛错：已入库的保留（insert-only），断点停在最后一页成功入库之后。
7. **`.env.local`**：删掉 8 个旧死键（`PAGE_SIZE`/`MAX_RETRIES`/`BACKOFF_BASE_MS`/`BACKOFF_JITTER_MS`/`PAGE_DELAY_MIN_MS`/`PAGE_DELAY_JITTER_MS`/`MAX_PAGES`/`CIRCUIT_COOLDOWN_MS` 的旧注释块），换成 §4.5 的 12 个键（与 `.env.example` 同形，`# KEY=default`）。理由：`EXPECTED_ENV_CONSTANTS` 一登记，守卫的 `.env.local` 半边（`tests/platform-env-constants-guard.test.ts:205-245`）就要求新键都在；Step 2 一翻判别符，`PLATFORM_KEY_LINE` 拼进 `DOUYIN` 前缀（`tests/platform-env-guard-contract.ts`），旧键就成了孤儿。
8. **查询**：`getDouyinItems({ folderId?, search?, page, pageSize })`——`publishedAt DESC NULLS LAST`，`sourceMembership` 筛夹，`searchCondition` 搜 `title` / `authorName` / `platform_meta->>'desc'`；`getFolderCounts()` 走 `sourceItemCounts`。导出 `toDouyinItem`（mapRow，Step 2 的 tagged card 复用）与 `narrowDouyinMeta`。

**测试**（先红后绿；fake transport 回放 §4.2 的真实形状）

- 请求：三个公共参数在、**零签名参数**、POST form 编码、相对路径、`collects_id` 用字符串。
- 分类器：§4.4 的 F2–F11 每一行一例；合法零结果三例（`collects_list: null` + `total_number: 0`；两种 `aweme_list: []` + `has_more: 0`）；`count` 错误的 `status_code: 5`；F8 有 / 无 `disabled_item_ids` 两例。
- 节奏器：第一个请求不等；页间隔落在 `[MIN, MIN+JITTER)`；第 25 次后插一次休息；`withRetries` 预算被 F5 / F11 共用；F4 / F6 / F7 不触发重试。
- 游走：两种 cursor 语义（16 位微秒 vs 偏移）；`has_more` bool 与 0/1；整页失效继续翻；cursor 不前进 → F10；保险丝。
- 入库（内存 PGlite）：**没有 link 的条目能入库并能被 `getDouyinItems` 查到**（D-a 的前提，必须锁）；`sources: []` 的 `ingestCollection` 调用不报错；公开夹 → Source、私密夹不是；夹内条目带 link、`getFolderCounts` 计数；`images` 非空 → `/note/`；`contentState` 规则；`contentPersisted` 经 `onPagePersisted` 逐页回调。
- 断点：首次全量中途抛错 → 已入库保留、`resumeCursor` 停在最后一页；下次先头部段（整页已知即停）再续传到底、`backfillDone: true`；续传段第一次请求 F8 / F9 / F10 → D-e 自愈、第 2 页起 F8 / F9 → 断点不清（Step 1 复核补）；`{ null, false }` 下头部段不早停（Step 1 勘误：原写「`restartBackfill` 下」）。
- `narrowDouyinMeta`：缺字段回退、非法类型回退。

**验证**

```bash
pnpm vitest run lib/douyin tests/platform-env-constants-guard.test.ts
pnpm compile
pnpm test
```

本 Step 不跑 `pnpm build`（无 manifest / app 改动）。`lib-import-smoke` 与 env 守卫的「平台目录无裸数值常量」半边要到 Step 2 翻判别符后才覆盖 `lib/douyin`（`PLATFORM_DIRS` 由 `COLLECTION_PLATFORMS` 派生），所以本 Step 自己先按它们的规则写（只叶子导入 `@/lib/embedding/char-split`、不碰 `@/lib/storage`、所有数值走 `envNumber`）。

**回滚**：删 `lib/douyin/`，还原 `EXPECTED_ENV_CONSTANTS`、`.env.example`；`.env.local` 的抖音块恢复与否由用户决定（它本来就是死块）。零 manifest、零数据库影响。

**判据**：上面三条命令全绿；fake transport 覆盖 §4.4 每一行；「无 link 条目可入库可查询」有测试锁住；`lib/douyin/CLAUDE.md` 写明 transport 契约、断点状态机、D-a / D-b / D-e 的理由。

#### Step 1 落地记录（2026-10-03，代码 + 单测；判别符未翻，未提交）

**做了什么**

- `lib/douyin/douyin-api.ts`：transport 契约（§4.1 原样）、三个请求构造、`classifyResponse`、`findVerifyMarker`、错误类 `DouyinAuthError` / `DouyinRateLimitError`（继承 `sync-errors.ts` 基类，按文件路径导入）与 `DouyinStatusError`、`createDouyinPacer`、`requestEnvelope`、`mapAweme` / `mapFolder`、三个游走 `walkCollection` / `fetchPublicFolders` / `walkFolderItems`；§4.5 的 11 个数值。
- `lib/douyin/douyin-sync-service.ts`：`syncDouyinCollections(transport, opts)`（测试入口 `syncDouyinCollectionsToDb(db, …)`，`pacer` / `now` 可注入）按改法第 5 条的顺序编排、逐页 `ingestCollection`、两字段断点、`getDouyinItems` / `getFolderCounts`、`narrowDouyinMeta` / `toDouyinItem`；`TITLE_MAX_CHARS`。
- 三个测试文件、`lib/douyin/CLAUDE.md`；`EXPECTED_ENV_CONSTANTS` 12 行（11 行登记 `douyin-api.ts`，`TITLE_MAX_CHARS` 登记 `douyin-sync-service.ts`）；`.env.example` 末尾追加抖音块。`.env.local` 由主会话替换，本 Step 未读未改（守卫的 `.env.local` 半边在先红那一跑里就已经绿）。

**与手册的偏离**

1. **断点状态删掉 `restartBackfill`，只留 `{ resumeCursor, backfillDone }`**（设计 B）。「全量走（关闭整页已知即停）」直接判 `!backfillDone && resumeCursor === null`；D-e 写回 `{ null, false }` 就自然进入全量走，第三个字段与这一状态等价，是冗余标志。更重要的是手册字面会出真 bug：若只有 `restartBackfill` 才关早停，首次全量第一页已入库、`onBackfill` 还没写回就中断 → 状态仍是 `{ null, false, false }` → 下次头部第一页整页已知即停、又没有断点可续 → 回填永远完不成（测试「B: …」锁住）。PRD 原本就只写了两个字段。手册里 `restartBackfill` 共 6 处，全部改掉并注「Step 1 勘误」：§1 D-e、§4.4 F12、改法第 6 条的类型与子弹、测试「断点」一条、Step 2 的 storage 行——比任务点名的两处（D-e、Step 2 storage）多 4 处。
2. **续传段只在本次以断点开跑时运行**：改法第 5 条写「若 `backfillDone === false` 且有 `resumeCursor`」，没说是开跑时还是头部段之后的状态。全量走的头部段每页都写 `resumeCursor`，若按头部段之后的状态判，全量走撞保险丝的同一次运行会接着再续 200 页，保险丝失效一半。现在的判定是 `!fullWalk && !backfillDone && resumeCursor !== null`，撞保险丝的回填在下次运行续上。
3. **节奏器放在 `withRetries` 的 attempt 里**（设计 A）：每次真实请求（含重试）都等页间隔、都计入 `REST_EVERY_PAGES`，所以一次重试的等待 = 退避 + 页间隔；等待结束、发请求前再 checkpoint 一次，所以每次请求 2 次 checkpoint（`withRetries` 一次 + 节奏器之后一次），测试按此锁。手册改法第 4 条没定位置。
4. **验证码检测范围**（设计 C）：手册写「递归查找键或字符串值」，但条目里的 `desc` / 昵称 / 收藏夹名出现 "captcha" 会被误判成风控、整次同步以「去验证」停掉。现在键名在任意层级命中，字符串值只在信封层匹配、不进入 `aweme_list` / `collects_list` 条目。依据：唯一的字符串值真实样本 `search_nil_info.search_nil_type: 'verify_check'` 在信封层（`research/douyin-rate-limiting.md` §1.1 E）。另一处收窄：手册只对 `verify_center_decision_conf` 要求「非空」，实现对四个键都要求带非空值（`null` / `''` / `{}` / `[]` / `0` / `false` 不算），减少条目里同名空字段的误判。
5. **手册未列的形态**（设计 D，按「绝不信任 200」处理）：其他非 2xx（非 403 / 429 / 5xx）→ `Error` + 片段、不重试；JSON 不是对象或没有数字 `status_code` → `Error`；`has_more` 缺失或不是 bool / 0 / 1 → `Error`（比「缺列表键且缺 `has_more`」更严：没有 `has_more` 就不能翻页）；列表键是非数组非 null → `Error`。`status_code: 0` + 列表 `[]` / `null` / 缺键 + `has_more` 假 = 合法零结果：`collects_list: null` + `has_more: false` 是 probe #3 实测形状，`aweme_list: null` + `has_more: 0` **无直接样本** `[UNKNOWN]`，按同一规则放行（已知的扣数据形态都带 `has_more: 1`）。
6. **F9 用 `DouyinStatusError extends Error`**（带 `statusCode` / `statusMsg`）而不是裸 `Error`：游走要靠它认出 F9 触发 D-e。名字不是 `*AuthError` / `*RateLimitError`，completeness contract 的继承检查不涉及它；app 侧分类器照旧当普通错误。D-e 的触发点是 `walkCollection` 的 `onStartCursorRejected` 钩子（复核前名为 `onCursorRejected`、任一页都调，见下方「Step 1 复核」），只有续传段传（头部段 F8 / F9 不动断点，测试锁住）。
7. **`MAX_PAGES` 保险丝静默返回 `'fuse'`**（同 zhihu 的 `MAX_ITEM_PAGES_PER_COLLECTION`）而不抛：全量走撞保险丝时断点已写，下次续上。已知限制：非全量走的头部段一天新增超过 200 页（> 4000 条）撞保险丝，那一段之后不会被补上。
8. 小处：`onPagePersisted` 只在该页 `contentPersisted` 非空时调；标题在 `desc` 与昵称都空时再回退到 `aweme_id`；`sec_uid` 为空的条目剔除作者行，ingest 随之丢掉该条目（同 X 剔除空 restId，设计 F）。
9. **`.env.local` 的写法**：改法第 7 条说新键「与 `.env.example` 同形，`# KEY=default`」；主会话替换时沿用了该文件自己的 `# KEY=` 空值写法（`.env.local` 其他平台块都是空值写法），两种写法守卫都接受（`content.includes(\`# ${key}=\`)`）。`.env.example` 的抖音块用 `# KEY=default`，注释文案按主会话提供的块写入：派发提示在传输中被转成了乱码，文案是还原出来的，12 行注释按 UTF-8 → GBK 往返编码与收到的乱码逐位比对、可恢复位置零差异（含「」）；与 `.env.local` 是否逐字一致本 Step 未核对（`.env.local` 不读），守卫只认 `# KEY=` 行、不依赖注释。

**先红证据**

- 实现前第一跑 `pnpm vitest run lib/douyin tests/platform-env-constants-guard.test.ts`：4 个文件红——3 个测试文件 `Failed to resolve import "./douyin-api"` / `"./douyin-sync-service"`；env 守卫 2 例红（`ENOENT … lib\douyin\douyin-api.ts`；`.env.example is missing documented lines for` 12 个键），`.env.local` 半边当时已绿。
- 实现后逐条证伪，每次改一处、跑 `lib/douyin`、再还原：头部改成「首个已知 id 即停」→ 增量与「重新收藏的旧视频」2 例红；全量走也早停 → B 与两例 D-e 共 3 例红；字符串值扫进条目 → 2 例红；头部段也传 `onCursorRejected`（复核后改名 `onStartCursorRejected`）→ 「头部段不自愈」2 例红；去掉节奏器之后的 checkpoint → 1 例红；F8 判定忽略失效 id → 1 例红。
- 另用一个临时测试（跑完即删）把 Step 2 才会覆盖本目录的守卫提前套上：裸数值常量正则、`new Promise` / `setTimeout` / `chrome.` / `@/lib/storage` / `@/lib/collections` 与 `@/lib/embedding` barrel 的文本扫描、无 `chrome` 全局零 mock 加载 `douyin-sync-service`，全绿。

**验证**（复核后重跑，复核前的数字是 109 例 / 1853 例）

- `pnpm vitest run lib/douyin tests/platform-env-constants-guard.test.ts tests/http-fetch-deadline-guard.test.ts tests/platform-sleep-guard.test.ts`：6 文件 / 120 例全过（`lib/douyin` 3 文件 / 109 例）。
- `pnpm compile`：通过。
- `pnpm test`：根 219 文件 / 1864 例全过，`packages/*` 15 文件 / 263 例全过，无偶发超时。

**Step 1 复核（2026-10-03，trellis-check；仍未提交）**

改了四处代码、一处 `.env.example`，每处都有测试，且都按「撤掉修复 → 新增用例变红 → 还原」证伪过：

1. **D-e 收窄为仅续传段第一次请求**（携带存储断点的那次，含它在 `withRetries` 里的瞬态重试）。原实现在续传段**任一页**的 F8 / F9 都清断点；可 D-e 的理由只是**存储的** cursor 跨天是否有效 `[UNKNOWN]`，第 2 页起的 cursor 是本次刚从服务端拿到的，那里的 F8 多半是真风控——这时清断点等于在被限流时安排一次约 115 页的全量重走，最坏的反应。现在 `walkPages` 只在 `pages === 0` 时调回调，回调改名 `onStartCursorRejected`；之后的页按普通 F8 / F9 抛，断点留在最后一页成功入库之后。§1 D-e、§4.4 F12、Step 1「测试」断点一条已同步。新增 4 例（api 层两例「第 2 页 F8 / F9 不调回调」、sync 层两例「第 2 页 F8 / F9 后 `onBackfill` 最后写的是第 1 页推进后的 cursor、下次从那里续到底」）+ 1 例锁定「第一次请求 503 重试后再 F9 仍算起始 cursor 被拒」；撤掉 `pages === 0` 判定 → 新增 4 例红。原有的「续传段第 1 页 F8 / F9 → 清断点」两例保留并仍绿。
2. **F10 漏洞：listcollection 非首页的 cursor 回到 `0` 被当成前进**。`advances` 原写 `prev === '0' ? n > 0 : n < p`，`prev` 非 0 时 `0 < p` 恒真；而 `cursor=0` 是「从头开始」，一页带条目 + `cursor: 0` + `has_more: 1` 会把游走送回最新一页、循环到 200 页保险丝（全量走时还会把断点写成 `'0'`）。改为降序一律要求 `n > 0`。撤掉 → 新增 1 例红。
3. **存储断点未校验就进 `BigInt`**：`resumeCursor` 来自 app 侧 storage（Step 2），原样作为续传起点，非纯数字串会在 `advances` / `olderCursor` 里以 `SyntaxError: Cannot convert … to a BigInt` 冒出来。`decodeCursor` 改为导出，sync service 在边界用它读入，不可用就当 `null`（= D-e 的效果：本次全量走）；`backfillDone` 只认 `true`。撤掉 → 新增 1 例红。
4. **`.env.example` 一个标点**：`VITE_DOUYIN_MAX_RETRIES` 注释里「共用一份预算；403 / 429 不重试」的分号改逗号，与主会话写入 `.env.local` 的原文一致。偏离第 9 条说的「可恢复位置零差异」不覆盖这一处：「；」与「，」后接 ASCII 字符时 GBK 乱码完全相同，正是不可恢复的位置；同类位置的另外两处（`默认 200；2299`、`默认 20；实测 … ，docs/33 D-f`）与主会话原文一致。
5. 另加 1 例锁定「重试预算耗尽时抛**最后一次**信号的错误」（空、空、5xx → 普通 `Error`，与已有的空、5xx、空 → `DouyinRateLimitError` 成对）。
6. **续传段第一次请求的 F10 也触发 D-e**（复核报告后**主会话决定**）：携带存储断点的那次请求返回的 cursor 不前进 / 回退，等于服务端没认这个断点（例如失效后从头返回），与 D-e 要防的「断点被拒导致续传永久卡死」同类——不纳入的话，每次运行都会在头部段之后抛 F10，续传永远卡住，UI 也没有重置入口。D-e 是代码推出来的设计默认项、不是用户决策，这样改符合它的初衷，代价同样是多一次全量。`walkPages` 在 F10 抛出前调同一个 `rejected`（只在 `pages === 0` 时非空），第 2 页起的 F10 不触发；头部段不传回调，行为不变。§1 D-e、§4.4 F10 / F12、Step 1「测试」断点一条已同步。新增 3 例：api 层「首请求 F10 → 调回调、抛 F10」「第 2 页 F10 → 不调」，sync 层「首请求 F10 → `onBackfill` 最后写回 `{ null, false }`、下次全量走到底」。撤掉 F10 前的回调调用 → 首请求两例红；撤掉 `pages === 0` 判定 → 「第 2 页 F10 不调」与第 1 条的 4 例共 5 例红。「`has_more` 真但 cursor 不可用」（`decodeListPage` 抛的 F10 变体）不触发：那是响应缺字段，不是服务端回应了一个没越过断点的 cursor。

**复核发现、未改的**（各自的理由）：

- `titleOf` 用 `.slice` 截断，可能切开一个代理对（emoji）——与 X（`lib/x/x-sync-service.ts:188`）同款，要改应各平台一起改。
- `ORDER BY publishedAt DESC NULLS LAST` 没有并列决胜键，分页在同秒发布的作品之间不稳定——与 zhihu / x 同款。
- 逐页 `ingestCollection` 每页都按平台全量重读 author / item id 映射并跑一次幽灵清扫，首次全量约 115 次；实际耗时留给 Step 3 记录。（Step 2 勘误：原写「正确性无影响」，不成立。声明 `'chunked'` 的条目在入库事务里先以 `'has_content'` 插入（`lib/ingest/ingest.ts:364`），正文与切块在事务之外逐条写（`:434-440`）；这一段中途断掉（关页、重载、写库抛错），该页还没轮到的条目就停在 `'has_content'`、没有 `item_contents.plainText`。之后**任何一次**带 `content` 的 `ingestCollection` 调用都清扫全平台幽灵（`:442-461`），文本先取本次调用的 `textOf`、再取已存 `plainText`，都没有就落 `'no_content'`；抖音的 `textOf` 只认本页（`lib/douyin/douyin-sync-service.ts:378`）。`'no_content'` 不在幽灵谓词里（`lib/ingest/ingest.ts:143-145`），条目再次出现时已是存量、不进 5a（`:436-438`），所以永久无正文。正文其实还在 `platform_meta.desc`，ingest 不读它。复核时用临时测试实跑确认（跑完已删），见 §6 末「阻塞项」。）（2026-10-04：Step 2.5 已修——正文与 item 行同事务落盘，这里的行号指修复前的代码。）
- `platformMeta.folderId` / `folderTitle` 几乎总是 `null`：编排顺序是先走全部收藏、后走收藏夹，条目首见几乎都来自全部收藏。这是改法第 5 条顺序的结果，不是 bug；Step 2 的卡片若要展示所属夹，应读 `item_sources` 而不是这两个字段。
- `sec_uid` 为空的作品被 ingest 丢弃、永远不进已知集合，所以含它的那一页永远不是「整页已知」，增量头部段会多读一页。频率 `[UNKNOWN]`（失效作品本应已被抖音剔除），代价每次运行至多多一页，不改。

---

### Step 2 — 翻判别符 + app 侧 + 权限 + 文档

**目标**：抖音成为第 7 个 Collection Platform：页面、手动 / 每日同步、处理 lane、Dashboard、Chat / Agent Bridge 全部可用，`pnpm build` 产出的 manifest 只多两处（§0）。

**依赖**：Step 1 已提交。**本 Step 含一次对外发布，必须由用户决定**：

- `tests/agent-bridge-cli-aliases.test.ts` 在 `COLLECTION_PLATFORMS` 加入 `douyin` 的那一刻就会红，除非 `skills/favbase/SKILL.md` 的**两份**平台清单（`<platform>` 句 + frontmatter `description`）都加上抖音。
- 而 `packages/favbase/CLAUDE.md` 的 Release 一节规定：**改 SKILL.md 的 commit 就是发布 commit**——同 commit 递增 `packages/favbase/package.json` 的 `version` 与 SKILL.md 的 `metadata.version`（先 `npm view favbase version` 确认下一个号，今天本地是 0.2.1），并在同一次坐下来时按该文件 Release 第 2–6 步发布（npm 2FA，只有用户能做）。
- 两条路，用户选：**(a)** Step 2 的 commit 即发布 commit，用户当场发布；**(b)** Step 2 做完先不提交，等用户准备好发布再一起提交。不存在「先提交、以后再发」——那正是 Release 一节记录的违规。

**文件**：不在这里抄注册表清单（spec §5：手抄的清单会腐烂）。按 spec §5 的方法让机器生成待办：

```bash
# 0. 基线（翻之前，干净工作树）
pnpm build && cp .output/chrome-mv3/manifest.json /tmp/manifest-before.json
# 1. lib/collections/platforms.ts：COLLECTION_PLATFORMS 末尾追加 'douyin'
pnpm compile                                                   # 每个缺键的穷举 Record
pnpm vitest run tests/platform-completeness-contract.test.ts    # 类型看不见的部分，一次聚合列出
```

然后逐条烧掉。下表只给**抖音专属的取值与做法**，以及守卫不会提醒你的东西：

| 位置 | 抖音的值 / 做法 |
|---|---|
| domain descriptor（`lib/collections/platform-descriptor.ts`） | `jobPlatform: 'douyin'`（Step 2 勘误：用户 2026-10-03 决定：bilibili / bookmarks 已是同名先例，不再给平台 id 发明第二个名字——job namespace 直接用平台 id，原写的 `'douyin-collections'` 作废；其余四平台的统一不在本步）、`readiness: 'login'`、`contentKind: 'post-text'`、`descriptionField: null`、`hostPermissions: ['https://www.douyin.com/*']`、`sortKey: { source: 'publishedAt' }`、`dimensions: { ranked: ['author', 'favoriteFolder'], author: 'author', source: 'favoriteFolder', meta: null }`；`platform-descriptor.test.ts` 的 hostPermissions 黄金顺序末尾追加 |
| app descriptor（`entrypoints/app/collection-platform-registry.ts`） | `title: 'nav.douyinFavorites'`（Step 2 勘误：原写 `nav.douyinCollections`；`Collection` 是 favbase 自己的领域词，`CONTEXT.md`，与 `nav.zhihuFavorites` / `nav.bilibiliFavorites` 同形）；`palette: 'ink'`（黑标品牌，同 github / x）；`icon` 先把离线 SVG 加进 `components/iconify/icon-sets.ts`（抖音 logo 与 TikTok 音符同形，用 iconify 现有集合里的 tiktok 图标，具体名字 Step 2 查——取 `simple-icons:tiktok`）；`childRoutes: []`；`hint` 用 `welcome.picker.hint.douyin` |
| 四处重值注册表 | `PLATFORM_DOWNSTREAM_ELIGIBILITY.douyin = null`；auto-sync `{ runSync: runDouyinSync, ...douyinAutoSyncPolicy }` |
| `wxt.config.ts` | `permissions` 加 `'scripting'`，注释写明「往用户已打开的 douyin.com 标签页注入 MAIN-world fetch，由页面 SDK 签名（docs/33 D4）」 |
| `lib/storage/keys.ts` + storage item | 断点状态 `local:douyin-backfill`（`{ resumeCursor, backfillDone }`，即 `DouyinBackfillState`；Step 1 勘误：原有 `restartBackfill`，已删，见 Step 1 落地记录）；设备本地状态，WebDAV 只同步 settings + locale（`lib/sync/sync-engine.ts`），无需排除 |
| `entrypoints/app/sections/douyin/` | 见下方「改法」（Step 2 勘误：改法第 1、2 条的标签页解析与 transport 不在这里，进了 `lib/douyin/douyin-tab.ts`，见那两条的注） |
| i18n（zh-CN + en） | `nav.douyinFavorites`（Step 2 勘误，同上；同 `nav.zhihuFavorites` / `nav.youtubePlaylists` 的形状，它也是 `PLATFORM_META.title`）、`welcome.picker.hint.douyin`、`douyin.*`（标题、caption——说明「按发布时间排序」、搜索、无匹配、未登录空态、限流 / 验证文案、收藏夹 chip 标题）；en 显示名进 SKILL.md frontmatter `description` 的对账 |
| welcome marquee | `capability-marquee.tsx` 加药丸（守卫只查覆盖，位置是设计决定，docs/26 D5） |
| `skills/favbase/SKILL.md` | 两份清单 + `metadata.version`；`packages/favbase/package.json` 同号（见依赖） |
| `CONTEXT.md` | D1 偏离与 B 站规则并列；术语：抖音 `collect` = 收藏、`favorite` = 喜欢；「抖音的 Source 是公开收藏夹，全部收藏里的条目可以不属于任何 Source」 |
| `.env.local` | 确认 Step 1 已替换抖音块（翻判别符后旧键会成孤儿） |

**改法**（`entrypoints/app/sections/douyin/`）

1. `douyin-tab.ts`（Step 2 勘误：用户 2026-10-03 决定：平台的请求与计时代码要留在 `lib/<p>/` 的守卫范围内——与第 2 条合成一个 leaf `lib/douyin/douyin-tab.ts`，不在 `sections/douyin/`；返回标签页 id `number | null`；url 模式取 descriptor 的 `hostPermissions[0]`）：`findDouyinTab()`——`chrome.tabs.query({ url: 'https://www.douyin.com/*' })`，取第一个 `!discarded && status === 'complete'` 的；host permission 足以读到这些标签页的 url，**不需要** `tabs` 权限。标签页门、`probeReady`、transport 三处都调它（D-c）。
2. `douyin-tab-transport.ts`（Step 2 勘误：同上，并入 `lib/douyin/douyin-tab.ts`；注入函数的 `fetch(` 在 `ALLOWED_BARE_FETCH` 加文件级一行；外层超时复用同一个 `req.timeoutMs`，不新增 env 键）：实现 `DouyinTransport`。注入函数 `douyinPageFetch(req)`：
   - **自包含**：零闭包、零 import、零模块级常量、零 TS 专有运行时语法；所有输入走 `args`。`executeScript` 用 `toString()` 序列化它，打包器若插入 `__name(...)` / `__async` 之类 helper，页面里第一次调用就是 `ReferenceError`。扩展页 CSP 禁 `new Function`，所以这是唯一路线。
   - 先查 `Function.prototype.toString.call(window.fetch)` 是否含 `[native code]` → 是则返回 `{ kind: 'sdk-not-ready' }`。
   - 相对路径 `fetch(path + '?' + query, { method, credentials: 'include', headers: form ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined, body, signal: AbortSignal.timeout(timeoutMs) })`，返回 `{ kind: 'response', status, text }`；`catch` → `{ kind: 'unreachable', message }`。
   - 外层再包一圈超时（被冻结的后台页里，页内的 `AbortSignal` 不会触发），`executeScript` 抛错（标签页关了、导航走了、被丢弃）→ `unreachable`。
3. `douyin-sync-adapter.ts`：`runDouyinSync(onProgress, control)`——`findDouyinTab()` 为 null → **funnel 之前**抛 `DouyinAuthError('missing')`（F1，不算尝试）；读断点状态 → `runPlatformSync('douyin', control, async () => { … syncDouyinCollections(transport, { backfill, onBackfill: 写回 storage, onPagePersisted: (ids) => ids.forEach((id) => enqueueCollectionProcessingItem({ jobPlatform: jobPlatformForCollection('douyin'), itemPlatform: 'douyin', itemId: id })), onProgress, control }); return { fetched, inserted, newItemIds: [] }; })`（D-b）。`douyinAutoSyncPolicy = { probeReady: async () => (await findDouyinTab()) !== null, isSilentError: (e) => e instanceof DouyinAuthError }`。
4. `use-douyin.ts`（Step 2 勘误：文件名取 `use-douyin-favorites.ts`，同 `use-zhihu-favorites.ts`；`jobPlatformForCollection(PLATFORM)` 的值就是 `'douyin'`）：`useCollectionLibrary({ queryFn: facetQuery(getDouyinItems, 'folderId'), facetsFn: getFolderCounts, platform: PLATFORM, syncFn: runDouyinSync, jobPlatform: jobPlatformForCollection(PLATFORM) })`，`const PLATFORM = 'douyin'` 写一次（spec §7.2）。
5. `douyin-view.tsx`：`CollectionPageScaffold` + `useCollectionPipeline` + `useCollectionBreadcrumbs`；`NotLoggedInState` 带打开 `https://www.douyin.com/` 的 `SiteAction`，文案说清「登录后**保持这个标签页打开**，回来点获取；首次全量约 20 分钟」；`SyncErrorCopy`（`auth` / `rateLimited` / `rateLimitedUntil`——验证码与限流共用「去抖音标签页看看是否要验证，稍后再试」）（Step 2 勘误：用户 2026-10-03 决定：验证与冷却是两件事，`SyncErrorCopy` 本来就按 `resetAt` 的有无来选文案——两条文案、不共用：`resetAt === null`（F6 验证页）→ `rateLimited` = 去抖音标签页完成验证后再试；`resetAt` 非空（F4 / F5 / F8 冷却）→ `rateLimitedUntil` = 请求过于频繁、{{reset}} 后再试，并配倒计时锁按钮）；`DouyinRateLimitError.resetAt` 非空时 `useCountdown((now) => rateLimitRemainingMs(syncError, now))` 锁「立即获取」；收藏夹 chip 用 `FacetChips`（`components/collection-states/`）。
6. `douyin-card.tsx`（`CollectionCard` 外壳：封面、`desc` 摘要、作者、时长角标、图文标记）、`tagged-douyin-card.tsx`（一行 `taggedCard(DouyinCard, '<prop>', toDouyinItem)`）、`douyin-grid-skeleton.tsx`、`CLAUDE.md`；`entrypoints/app/pages/douyin.tsx` 一行 re-export。

**测试**

- `douyinPageFetch` 序列化守卫：断言 `String(douyinPageFetch)` 不含 `__name`、`__async`、`import`，也不引用任何不在其参数与浏览器全局里的标识符；再用 `new Function` **在测试环境里**重建它跑一遍（测试环境没有扩展 CSP）。
- transport：`findDouyinTab` 过滤 `discarded` / `loading`；`executeScript` 抛错、超时、`sdk-not-ready` 都折成对应 `kind`。
- adapter：无标签页 → 抛 `DouyinAuthError` 且**不写** Platform Sync Record（funnel deps 注入断言）；逐页 `enqueueCollectionProcessingItem` 收到的是 platformItemId；断点状态读写；`probeReady` 与标签页门用同一个 `findDouyinTab`。
- view：未登录空态、限流锁按钮、chip 渲染（照 zhihu / x 的 view 测试形状）。（Step 2 勘误：五个平铺平台 view 此前都没有测试文件，所以没有「zhihu / x 的形状」可照；`douyin-view.test.tsx` 照 `sections/configuration-heading.test.tsx` 的形状写。）
- spec §2 的全部守卫：completeness contract、import-smoke、env、sleep、fetch-deadline、SKILL.md 双清单、marquee 覆盖、i18n 无硬编码 CJK。

**验证**（spec §12 顺序）

```bash
pnpm vitest run tests/platform-completeness-contract.test.ts tests/lib-import-smoke.test.ts
pnpm vitest run lib/douyin entrypoints/app/sections/douyin
pnpm compile
pnpm test
pnpm build && diff /tmp/manifest-before.json .output/chrome-mv3/manifest.json
```

manifest diff 只允许两处：`host_permissions` **末尾**多 `https://www.douyin.com/*`、`permissions` 多 `scripting`（Step 2 勘误：「末尾」指平台段的末尾——manifest 里平台 host 之后还跟着 provider host，所以它落在 `https://www.googleapis.com/*` 之后、provider 段之前；`scripting` 追加在 `permissions` 最后）。任何既有条目改序或改字都是缺陷。最后手走 spec §9（视图里的英文硬编码文案）。

**文档（同 commit）**：`entrypoints/app/sections/douyin/CLAUDE.md`（新建）、`lib/douyin/CLAUDE.md`（补 app 侧接线）、`.trellis/spec/frontend/platform-onboarding.md`（「Already onboarded」加 douyin；§4.1 写明「注入式 transport」是 `fetchWithDeadline` 规则的例外及其守卫方式；逐页入库 + 断点续传 + 逐条派发作为新形状；§12 manifest diff 记 `scripting` 例外）、根 `CLAUDE.md` 目录索引两条、`entrypoints/app/CLAUDE.md` 路由表、`lib/storage/CLAUDE.md`（新 key）、`CONTEXT.md`、本文 Step 2 落地记录。

**回滚**：revert 本 Step 的 commit 即可（无迁移；`local:douyin-backfill` 残留无害）。若已发布 CLI：npm 版本不能复用，回滚 = 再发一个去掉抖音的版本。

**判据**：验证五条全绿；manifest diff 恰好两处；无标签页时空态正确、每日自动同步静默跳过且不写记录（单测层面）；SKILL.md 与 CLI 版本按用户选的 (a) / (b) 处理完毕。

#### Step 2 落地记录（2026-10-03，代码 + 单测；写下时未提交、CLI 0.2.2 未发布——之后已提交 `b6c6a54` 并发布，见「未做与延后」的发布一条）

**做了什么**

- 翻判别符：`COLLECTION_PLATFORMS` 末尾追加 `'douyin'`，然后按 spec §5 让 `pnpm compile`、completeness contract 与 `pnpm test` 生成待办，逐条烧掉。
- 两份 descriptor：domain `jobPlatform: 'douyin'`、`readiness: 'login'`、`contentKind: 'post-text'`、`descriptionField: null`、`hostPermissions: ['https://www.douyin.com/*']`、`sortKey: { source: 'publishedAt' }`、`dimensions: { ranked: ['author', 'favoriteFolder'], author: 'author', source: 'favoriteFolder', meta: null }`；app `title: 'nav.douyinFavorites'`、`icon: 'simple-icons:tiktok'`（离线 SVG 取自 Iconify API）、`palette: 'ink'`、`hint: 'welcome.picker.hint.douyin'`、`childRoutes: []`。四处重值注册表：`PLATFORM_DOWNSTREAM_ELIGIBILITY.douyin = null`、`COLLECTION_PAGE_LOADERS`、`CARD_ADAPTERS`、auto-sync（评估顺序最后一位）。`wxt.config.ts` 的 `permissions` 末尾加 `'scripting'` 并注明用途。
- `lib/douyin/douyin-tab.ts`（新）：`findDouyinTab()`、注入函数 `douyinPageFetch`、`executeScript` 边界的 `decodePageFetchResult`、`douyinTabTransport`（每次请求重新解析标签页；`executeScript` 与 `sleep(req.timeoutMs)` 赛跑）。`tests/http-fetch-deadline-guard.test.ts` 的 `ALLOWED_BARE_FETCH` 加本文件一行并写明理由，文件头的白名单规则补「为何不能走 `fetchWithDeadline`、期限如何另行保证」这一类。
- `lib/storage`：`STORAGE_KEYS.douyinBackfill = 'local:douyin-backfill'`，`ui-state.ts` 的 `douyinBackfillStorage`（fallback `{ resumeCursor: null, backfillDone: false }`，类型只 `import type`），barrel 导出。
- `entrypoints/app/sections/douyin/`（新）：`douyin-sync-adapter.ts`、`use-douyin-favorites.ts`、`douyin-view.tsx`、`douyin-card.tsx`、`tagged-douyin-card.tsx`、`douyin-grid-skeleton.tsx`、`CLAUDE.md` 与两份测试；`entrypoints/app/pages/douyin.tsx`。
- i18n（zh-CN + en 各 17 键）：`nav.douyinFavorites`（zh「抖音收藏」、en「Douyin Favorites」）、`welcome.picker.hint.douyin`、`douyin.*` 15 个（含 `count.one`、`verificationRequired`、`rateLimited`、`mediaKind.note`）。welcome 跑马灯下排在 `summary` 与 `pglite` 之间加抖音药丸（保持平台 / 能力交替）。
- `skills/favbase/SKILL.md` 两份清单加抖音（`<platform>` 句末尾加 `douyin`，frontmatter `description` 末尾加 `Douyin favorites`，都与 `COLLECTION_PLATFORMS` 同序），`metadata.version` 与 `packages/favbase/package.json` 同改 `0.2.2`（`packages/favbase/` 里再没有别的版本副本：`CLAUDE.md` 与 `exit-codes.test.ts` 提到的 0.2.1 是历史叙述）。只做了 Release 第 1 步。
- 文档：本记录、`lib/douyin/CLAUDE.md`、`sections/douyin/CLAUDE.md`、spec（Already onboarded、§3 三行参考答案、§4.1 注入式 transport 例外、新 §4.6 逐页入库 + 断点续传 + 逐条派发、§12 / §13 的 API 权限例外）、根 `CLAUDE.md`（docs/33 状态一句 + 目录索引两条）、`entrypoints/app/CLAUDE.md` 路由表、`lib/storage/CLAUDE.md`、`CONTEXT.md`（D1 偏离与 B 站规则并列、`collect` / `favorite` 词汇陷阱、Relationships 一句改成「零个或多个 Source」）、`lib/collections/CLAUDE.md`、`sections/collections/CLAUDE.md`、`components/iconify/CLAUDE.md`。

**与手册的偏离**

1. **job namespace 直接用平台 id**（用户 2026-10-03 决定：bilibili / bookmarks 已是同名先例，不再给平台 id 发明第二个名字）：`jobPlatform: 'douyin'`，不发明 `'douyin-collections'`。其他四个平台的统一不做。
2. **transport 与 `findDouyinTab()` 住 `lib/douyin/` 的独立 leaf**（用户 2026-10-03 决定：平台的请求与计时代码要留在 `lib/<p>/` 的守卫范围内），不在 `sections/douyin/`；手册的两个文件（`douyin-tab.ts` + `douyin-tab-transport.ts`）合成一个 `lib/douyin/douyin-tab.ts`。§3 铁律 1 已改述。外层超时复用 `req.timeoutMs`，没有新增 env 键（`.env.local` 未动）。
3. **验证页与限流冷却两条文案**（用户 2026-10-03 决定：验证与冷却是两件事，`SyncErrorCopy` 本来就按 `resetAt` 的有无来选文案）：`SYNC_ERROR_COPY = { auth, rateLimited: 'douyin.verificationRequired', rateLimitedUntil: 'douyin.rateLimited' }`，共享 `syncErrorMessage` 按 `resetAt` 有无选键；只有冷却锁按钮。
4. 命名：`nav.douyinFavorites`（不是 `nav.douyinCollections`）、`use-douyin-favorites.ts`（不是 `use-douyin.ts`）、`findDouyinTab()` 返回标签页 id（`number | null`）。
5. **标签页 url 模式从 descriptor 读，不在 leaf 里再写一遍字面量**——这是证伪时撞出来的：手写 `'https://www.douyin.com/*'` 时，往该文件塞一个裸数值常量，env 守卫**没有变红**（下表 G3 第一次）。原因：env 守卫与裸 fetch 守卫都用 `/\/\*[\s\S]*?\*\//` 朴素正则剥块注释，字符串里的「斜杠 + 星号」被当成注释开头，一直吞到下一个 `*/`，中间的代码从扫描里消失。改从 `PLATFORM_DESCRIPTORS.douyin.hostPermissions` 读之后同一处证伪变红。**同一盲区今天就在别处**（复核时按 TypeScript 解析出的真实注释范围逐文件对照，非测试文件）：`lib/x/x-api.ts:224-231`（`Accept: '*/*'`，env 与裸 fetch 两个守卫都扫它）、`lib/collections/platform-descriptor.ts:124-233` 与 `lib/permissions/host-access.ts:30-34`（只有裸 fetch 守卫扫）；被藏起的行里今天没有违规，`entrypoints/**`（CJK 守卫同一写法）零盲区。`lib/bookmarks/bookmark-page-fetch.ts:106` 的 `*/*` 其后再无 `*/`，正则不成立，**不**在盲区里（初稿误记）。守卫是跨平台的，本步不改，见「未做与延后」。
6. 新增手册没有列的两处：`decodePageFetchResult`（`executeScript` 返回的是 `unknown`，按根 `CLAUDE.md` 跨 runtime 规则先经 decoder，畸形结果一律 `unreachable`）；`douyin-tab.test.ts` 的分层断言（api 与 sync-service 不 import 这个 leaf、不读 `chrome.*` / `browser.*`——leaf 加载期不碰 chrome，所以 import-smoke 看不见这条边）。
7. 库空态也带「打开抖音」（`EmptyLibraryState site=…`，同 X）：库只能经已打开的抖音标签页填满。auth 相位 `pipeline` 传 `undefined`、`configurationNotice` 恒传（同 zhihu；它在 scaffold 上是可选 slot，漏传 `tsc` 不报，而没有横幅时 Tags 积压就没有恢复入口）。
8. 卡片：标题即 `desc` 首行（3 行 clamp），不再重复一段摘要；不展示所属收藏夹（`platformMeta.folderTitle` 几乎总是 null，见 Step 1 复核）。封面照先例不设 `referrerPolicy`，失败回退字形。
9. 测试夹具：成员清单类改为由 `COLLECTION_PLATFORMS` 派生（`overview-view.test.tsx` 的 `emptySnapshot`、`collection-analytics.test.ts` 的零快照）；有意义的黄金顺序保留手写、末尾追加抖音（`platform-descriptor.test.ts` host 顺序、`collection-platform-registry.test.ts` 与 `load-navigation.test.ts` 的导航顺序、auto-sync 评估顺序、三张 job namespace 镜像表）。`sync-errors.test.ts` 补抖音两个错误类（不补不会红，但它声称覆盖每个平台）。
10. `wxt.config.test.ts` 只锁 `host_permissions`，`permissions` 数组没有黄金断言；本步没加：跨平台项，本步不做。

**先红证据**

- 翻判别符后第一跑：`tsc` 列出 6 个源码穷举 `Record`（auto-sync、page loaders、`PLATFORM_META`、`CARD_ADAPTERS`、domain descriptor 的 `satisfies`、eligibility）、2 张测试镜像表（`collection-job-platform.test.ts`、`library-gate.test.ts`），以及由 descriptor 缺键连带出的 TS7053（`lib/chat/tools.ts`、`collection-analytics.ts`、`tagging-service.ts`、`wxt.config.ts` 与三个测试）；completeness contract 在 descriptor 缺键处直接 `TypeError`；全量 `vitest` 72 个文件红（多数在 import 时就因 descriptor 缺键崩掉）。
- 注册表补齐后第二跑：7 个文件 / 11 例红——`agent-bridge-cli-aliases` 两份 SKILL.md 清单、`collection-platform-registry.test.ts` 1 例与 `load-navigation.test.ts` 4 例导航顺序、`collection-analytics.test.ts` 零快照、`collection-processing-resume.test.ts` namespace 表、`overview-view.test.tsx` 2 例（夹具只有六个平台），另 `collection-platform-auto-sync.test.ts` 整个套件加载失败（抖音 adapter 引入 `collection-processing-jobs`，该测试对 `@/lib/database` 的 mock 没有 `schema`）。
- 新代码逐条证伪（改一处、跑对应测试、还原）：

| # | 改动 | 变红 |
|---|---|---|
| M1 | 删掉 adapter 在 funnel 前的标签页门 | adapter「funnel 之前抛」1 例 |
| M2 | 逐页派发改成什么都不派 | adapter「逐页派发」1 例 |
| M3 | 给 funnel 回报 `result.newItemIds`（双重派发） | 同上 1 例 |
| M4 | `findDouyinTab` 接受被丢弃的标签页 | tab 测试 3 例 |
| M5 | 去掉外层 `sleep(req.timeoutMs)` 赛跑 | 「冻结页超时」1 例（5 s 测试超时） |
| M6 | 注入函数读模块常量 | 自由标识符 1 例 + 「从源码重建」3 例 |
| M7 | 不经 decoder 直接信任 `executeScript` 结果 | 1 例 |
| M8 | 只留一条限流文案（手册原写法） | view「冷却」1 例 |
| M9 | 去掉冷却锁 | view 3 例 |
| M10 | 漏传 `configurationNotice` | view 2 例 |
| G1 | 去掉 `ALLOWED_BARE_FETCH` 一行 | 裸 fetch 守卫 2 例 |
| G2 | leaf 里手写 `new Promise` + `setTimeout` | sleep 守卫 1 例（证明本目录已在扫描范围） |
| G3 | leaf 里加裸数值常量 | 第一次**不红**（偏离 5）；改从 descriptor 读之后 env 守卫 1 例 |
| G4 | sync-service import leaf | 分层断言 1 例（import-smoke 仍绿，正是加这条断言的理由） |
| G5 | 删掉跑马灯药丸 | completeness contract 1 例 |
| G6 | `jobPlatform` 改回 `'douyin-collections'` | 5 个文件 6 例（namespace 镜像表、resume 表、auto-sync、adapter 派发） |

**验证**（2026-10-03，全部在本工作树跑）

- `pnpm vitest run tests/platform-completeness-contract.test.ts tests/lib-import-smoke.test.ts tests/agent-bridge-cli-aliases.test.ts`：3 文件 / 58 例全过。
- `pnpm vitest run lib/douyin entrypoints/app/sections/douyin`：6 文件 / 141 例全过。
- `pnpm compile`：通过（根 `tsc --noEmit` + `pnpm -r compile`）。
- `pnpm test`：根 222 文件 / 1901 例、`packages/*` 15 文件 / 263 例全过，无偶发超时。
- `pnpm build`：通过；`[bundle-contract] background graph 14 modules / 948269 bytes`（基线 14 / 947838，+431 字节，模块数不变）。增量全是数据：SW 图里的 `platform-descriptor` chunk 多了 `COLLECTION_PLATFORMS` 的 `'douyin'`、`PLATFORM_DESCRIPTORS.douyin`、`STORAGE_KEYS.douyinBackfill` 与 `douyinBackfillStorage` 的定义（`app-handlers` 经 `@/lib/storage` barrel 取 `onboardingStorage`，barrel 的 eager item 随之进 SW），`x-auth` chunk 里的 `PLATFORM_DOWNSTREAM_ELIGIBILITY` 多了 `douyin: null`。`lib/douyin/` 的代码零进入 SW（`background.js` 零 `douyin` 命中）。
- manifest：`diff` 原文是单行 JSON 的整行替换；按字符比对恰好两处插入——`permissions` 在 `"favicon"` 之后插入 `,"scripting"`，`host_permissions` 在 `"https://www.googleapis.com/*"` 之后插入 `"https://www.douyin.com/*",`；按键比对，其余条目与顺序逐项不变。
- 打包后的注入函数：在 `.output/chrome-mv3/chunks/app-*.js`（app 主 chunk——auto-sync 注册表是 eager 的，所有平台 adapter 都在那里）里找到，压缩成 `async function du(e){…}`（580 字符）；按 AST 算出的自由标识符只有 `AbortSignal, Error, Function, String, URLSearchParams, window`，零 `__name` / `__async` / `__awaiter` / `import(` / `require(`（整个 chunk 也零 helper 命中），`new Function` 从这段原文重建得到 `AsyncFunction`。
- spec §9 手走：抖音 view / card 里没有英文硬编码展示文案（只有 `alt: ''` 与站点 URL）；CJK 守卫照常通过。

**未做与延后**

- **两项阻塞 Step 3 首次真实账号全量入库**（insert-only，事后补不回来），见 §6 末「阻塞项」：幽灵清扫会把中断页的条目永久落 `no_content`（Step 1 复核里那句已就地勘误）；是否存接口序位由用户决定。（2026-10-04：两项都由 Step 2.5 关闭。）
- 翻判别符后已过期、本步按指示不动（都是手写副本，无守卫）：welcome 首屏三句「六个平台 / Six platforms」文案（`lib/i18n/locales/*.ts`）、`skills/favbase/INSTALL.md` 开头的平台枚举、README / README_zh_CN / PRODUCT.md 的平台清单。
- 首次全量期间页面不重读：`useCollectionLibrary` 只在挂载时（`entrypoints/app/hooks/use-collection-library.ts:248-258`）与 sync job 的 `generation` 变大时（`:265-276`）重读 meta，没有订阅任何领域事件，`generation` 只在成功时加一（`entrypoints/app/hooks/background-jobs-store.ts:296`，失败分支 `:304` 不动）。所以约 20 分钟里库为空的页面一直是骨架屏，中途失败显示空库错误框（库里其实已有条目），重新挂载才恢复。延后。逐条派发仍是 adapter 里手拼 `{ jobPlatform, itemPlatform, itemId }`（同书签与 B 站），没有命名入口。
- 冷却锁只在内存（job store 的 error）、只锁标题栏按钮（`entrypoints/app/components/collection/collection-page-scaffold.tsx:325`），刷新即解；错误相位的 Retry 直接是 `onSync`（`:271`），每日自动同步的 `probeReady` 也只看标签页，都不看它。平台守卫的目录集合仍由 `COLLECTION_PLATFORMS` 派生（翻判别符前看不见新目录），`permissions` 无黄金断言。均未做。
- 守卫的块注释剥离盲区（偏离 5）：`lib/x/x-api.ts`、`lib/collections/platform-descriptor.ts`、`lib/permissions/host-access.ts` 今天就有（被藏起的行里暂无违规），修法是守卫按 AST 或 TypeScript scanner 剥注释——跨平台工具改动，留给独立任务。
- `sdk-not-ready`、Argus 403、`DouyinStatusError` 等「非 auth、非限流」失败在 UI 上显示英文原文（`'unknown'` 分支，docs/32 Step 4 的既定设计）；「SDK 未就绪 → 刷新抖音标签页」是否值得一条本地化文案，等 Step 3 看它多常见。
- **发布**：SKILL.md 改动即发布 commit（`packages/favbase/CLAUDE.md` Release）。本步只做了第 1 步（版本号），没有跑第 2–6 步；要么这次提交即当场发布（a），要么先不提交（b），由用户决定；推 `main` 之前必须发布 0.2.2。（2026-10-04 核对：已提交 `b6c6a54`「…; release favbase 0.2.2」，`npm view favbase version` 返回 `0.2.2`，`packages/favbase/package.json` 同号。）
- `[UNKNOWN]`（Step 3 实机验证）：扩展 `executeScript` 注入的请求是否和 DevTools / CDP 一样被签名接受、后台标签页的签名是否被接受（§6）；抖音 CDN 封面 URL 是否带会过期的签名参数（过期后卡片只会回退字形，不会报错）；`executeScript` 回传 1.6 MB 页的实际耗时。

---

### Step 2.5 — 清掉 Step 3 的两项阻塞（幽灵清扫 + 接口序位）

**目标**：首次真实账号全量入库之前处理掉 §6 末「阻塞项」两条。两条都是 insert-only 下入库之后补不回来的。

**依赖**：Step 2 已落地；§1 的 D5 / D6（用户 2026-10-04）与 D-g。

**文件**

- 改：`lib/ingest/ingest.ts`、`lib/ingest/ingest.test.ts`、`lib/ingest/CLAUDE.md`
- 改：`lib/douyin/douyin-sync-service.ts`、`lib/douyin/douyin-sync-service.test.ts`、`lib/douyin/CLAUDE.md`
- 只加测试、不改实现：`lib/x/x-sync-service.test.ts`、`lib/youtube/youtube-sync-service.test.ts`
- 文档：`lib/x/CLAUDE.md`、`lib/youtube/CLAUDE.md`（各有一句与事实不符的幽灵描述）、spec `platform-onboarding.md` §4.6 的「Known defect」、本文页头 / §4.3 / §6 / 本节落地记录、根 `CLAUDE.md` 的 docs/33 条目

**改法**

A. 正文与条目同事务落盘（D6，`lib/ingest/ingest.ts`）

1. 入库事务内：对**本次新插入**、平台声明 `'chunked'`、且 `content.textOf(pid).trim()` 非空的条目，把 `item_contents { itemId, plainText, subtitleSource: null }` 与 item 行在同一个事务里写入。正文为空的直接以 `'no_content'` 入库，不再经 `'has_content'` 中转。调用不带 `content` 时行为不变。
2. 正文行另设更小的批大小：正文可达 100 KB（`MAX_README_CHARS`），沿用 `INSERT_CHUNK_SIZE = 500` 会拼出 50 MB 的单条语句。
3. phase 5a 只切块并落定状态，**不再重写** `item_contents`——否则每个新条目的正文写两遍，第二遍是 UPDATE。sweep 里文本取自已存 `plainText` 的分支同理。`settleItemContent` 的对外语义不变（书签提取照用）。
4. sweep 的文本来源顺序不变（本次 `textOf` → 已存 `plainText` → `'no_content'`）。最后一档从此只对本次修复之前留下的幽灵可达。
5. 不动：`IngestInput` / `IngestResult` 的形状、各平台 sync-service 的调用、`persistExistingItemContent`、github 的 `getReposNeedingReadme`（它仍负责修复之前留下的无正文幽灵）。
6. 「`plain_text` 与 `subtitle_source` 一起写」照守：事务内的 insert 显式写 `subtitleSource: null`。

B. 抖音每次运行至少清扫一次（D-g，`lib/douyin/douyin-sync-service.ts`）

- 运行开头的 Source upsert 调用改为无条件执行并带 `content`（`textOf` 恒返回空串，文本来自已存 `plainText`）；它的 `contentPersisted` 走与分页相同的出口（`newItemIds` + `onPagePersisted`）。

C. 接口序位（D5，同文件）

- `DouyinItemMeta` 加 `listCursor: string | null`、`listIndex: number | null`。头部段与续传段的页写 `page.nextCursor` 与该条在 `page.awemes` 里的下标；公开夹分页两个都写 `null`（偏移 cursor 不是同一个键）。
- `persist` / `ingestPage` 现在用 `folder: DouyinFolder | null` 区分「来自哪一种页」。加序位时改成一个判别参数，不要再叠第二个可空参数。
- `narrowDouyinMeta` / `DouyinItem` 不加字段（零读者，排序不改）。

**测试（先红后绿）**

- `ingest.test.ts`：phase 5 中断后没轮到的条目停在 `'has_content'` **且** `plainText` 已在；下一次调用的 `textOf` 不认识它 → 被治愈并进 `healedItemIds` / `contentPersisted`（今天落 `'no_content'`）；成功入库的新条目正文只写一次；声明 `'chunked'` 但正文为空 → 直接 `'no_content'`、无 `item_contents` 行；现有幽灵用例（含「hopeless → `'no_content'`」）照过。
- `x-sync-service.test.ts`、`youtube-sync-service.test.ts`：各在自己的同步入口复现「第一次写正文中途断掉 → 第二次同步的 `textOf` 覆盖不到」，修复前红。是否中招用失败的测试证，不凭读代码下结论。
- `douyin-sync-service.test.ts`：一页写正文中途断掉 → 下次运行头部有新收藏（中断的那一页不重入库）→ 幽灵被治愈并经 `onPagePersisted` 派发；下次运行没有任何新收藏、也没有公开夹 → 仍被治愈并派发（D-g）；序位三条——列表页条目带 cursor 与下标、公开夹首见为 `null`、公开夹首见之后再出现在列表页仍为 `null`。
- 证伪：每处修复撤掉 → 对应用例变红 → 还原。

**验证**：`pnpm vitest run lib/ingest lib/douyin lib/x lib/youtube lib/zhihu lib/github lib/bookmarks lib/bilibili tests/lib-import-smoke.test.ts`；`pnpm compile`；`pnpm test`。

**回滚**：revert 即可。无迁移、无 schema 变化；新代码写下的正文行与 `listCursor` / `listIndex` 都是旧代码读得了的形状。

**判据**：§6 末「阻塞项」两条关闭；抖音 / X / YouTube 三处复现用例先红后绿；全量测试绿；上面列的文档同一次改动里更新。

**不做**：不改排序；不给 YouTube 加幽灵重拉（正文同事务落盘之后不需要）；不回填已有数据（扩展未上线，库里是测试数据）。

#### Step 2.5 落地记录（2026-10-04，代码 + 单测；已复核，未提交）

**做了什么**

- **A（`lib/ingest/ingest.ts`）**：入库事务新增 step 4b——本次新插入、声明 `'chunked'`、`textOf(pid).trim()` 非空的条目，`item_contents { itemId, plainText, subtitleSource: null }` 与 item 行同事务写入，批大小 `CONTENT_INSERT_CHUNK_SIZE = 20`（按 github 的 100 KB 上限算约 2 MB 一条语句；知乎正文没有长度上限，20 限的是行数）；正文为空的新条目直接以 `'no_content'` 入库。phase 5a 改走模块私有的 `chunkAndSettle`（重建 chunk 行 + 落定状态，不碰 `item_contents`）。sweep 的文本顺序不变：本次 `textOf` 仍经 `settleItemContent` 写入，已存 `plainText` 走 `chunkAndSettle` 原样重切。`persistItemContent` 收窄成只做 upsert，`settleItemContent` = `persistItemContent` + `chunkAndSettle`，对外语义不变。`IngestInput` / `IngestResult` 形状未动，x / youtube / zhihu / github / bookmarks / bilibili 的生产代码零改动。
- **B（`lib/douyin/douyin-sync-service.ts`）**：第 1 步的 `ingestCollection` 无条件执行并带 `content: { textOf: () => '', chunk }`；「`inserted` 计数 + `newItemIds` + `onPagePersisted`」抽成 `report(result)`，分页与这次清扫共用。
- **C（同文件）**：`DouyinItemMeta` 加 `listCursor` / `listIndex`；`persist` / `ingestPage` 的 `folder: DouyinFolder | null` 换成一个判别参数 `PageOrigin = { kind: 'list'; nextCursor } | { kind: 'folder'; folder }`。`narrowDouyinMeta` / `DouyinItem` / 排序未动。
- **测试**：`ingest.test.ts` +5、`x-sync-service.test.ts` +1、`youtube-sync-service.test.ts` +1、`douyin-sync-service.test.ts` +4（另改一处既有 `toEqual`）；新增只给测试用的 `tests/ingest-test-support.ts`（落地时放在 `lib/ingest/` 下，复核后挪到 `tests/`）。
- **文档**：`lib/ingest/ingest.ts` 头注释（GHOSTS 两条 → 三条）、`lib/ingest/CLAUDE.md`、`lib/douyin/CLAUDE.md`（删「已知缺陷」、第 1 步、D-g、`PageOrigin`、两个 meta 字段）、`lib/x/CLAUDE.md` 与 `lib/youtube/CLAUDE.md` 各一句幽灵描述、spec §4.6 的「Known defect」换成「Sweep at least once per run」、本文页头 / §4.3 / §6 / Step 2 记录里已过期的「未提交、未发布」/ Step 3 依赖。根 `CLAUDE.md` 由主会话改。

**与 Step 2.5 正文的偏离**

1. **新增 `tests/ingest-test-support.ts`**（「文件」一段没列；落地时放在 `lib/ingest/` 下，复核后挪到 `tests/`）。x / youtube / douyin 的同步入口注入不了 chunker，要在各自入口复现「写正文中途断掉」只能让写库失败：一个限定作用域的 PG 触发器让正文以 `CUT-SHORT` 开头的 chunk insert 抛错（照 `lib/bookmarks/bookmark-content-service.test.ts:251` 的写法）。三处要同一个东西，抽成一个 helper 而不是抄三份；运行时代码不 import 它。
2. **「正文只写一次」不是先红用例**。HEAD 上它本来就绿——HEAD 也只写一次，只是写在事务外。它守的是修复的后半句：事务内 insert 加上之后，5a 若仍走 upsert 才会红（证伪 F2）。
3. **`persistItemContent` 没删，收窄成只做 `item_contents` upsert**；新增私有 `chunkAndSettle`。正文只说「5a 只切块并落定状态」，没说怎么拆。留这个名字是因为根 `CLAUDE.md`、docs/29、docs/32 的记录都拿它指「不透明文本正文的写入方」，收窄后那些描述仍成立。
4. **`textOf` 只对本次新插入的条目在事务里求值**（`!preExisting.has(pid)`）——存量条目的声明状态本来就被 `onConflictDoNothing` 丢掉。副作用：`textOf` 抛错现在让整次入库回滚（此前是行已提交、5a 才抛）。（复核补：不只是 `textOf` 抛错——step 4b 的正文 insert 被数据库拒收同样回滚整次调用；唯一已知会被拒的输入是 NUL 字节，已在文本边界剔除，见下方「Step 2.5 复核」第 1 条。）
5. **sweep 的已存正文分支不再把 `subtitle_source` 重置为 `null`**（它不再写 `item_contents`）。带 `content` 的平台正文从来不是转录，该列本来就是 `null`；B 站不传 `content`，sweep 不跑。
6. **一处既有用例的夹具注释改了，逻辑一行未动**：「ghost sweep heals from textOf, then plainText, else settles no_content」原注释说 `'from-text'`「dies before any content write」，与事实不符——它是第一条、完整写完，随后被手工删掉 chunk 与正文来制造「修复前的幽灵」。`'hopeless'` 现在以 `'no_content'` 出生，再被夹具强行改成 `'chunked'`，结论不变。
7. **多一条正文没列的用例**：一次入库 45 条，跨过一个正文批次。
8. **spec §4.6 没有另写 D5**：任务只让替换「Known defect」那一条；`PageOrigin` 与两个字段的 owner 是 `lib/douyin/CLAUDE.md`。
9. 顺手把 `lib/ingest/CLAUDE.md` 里三处「6 个平台」改成 7（Step 2 漏改）。

**先红证据**（新测试 + 未改的生产代码）：`pnpm vitest run lib/ingest lib/x/x-sync-service.test.ts lib/youtube/youtube-sync-service.test.ts lib/douyin/douyin-sync-service.test.ts` → 10 failed | 59 passed (69)。

| 组 | 用例 | 红在哪 |
|---|---|---|
| ingest | 中断后没轮到的条目带着正文 | `item_contents` 行：期望 `text of unreached-3`，实得 `[]` |
| ingest | 从已存正文治愈的幽灵不重写 `item_contents` | sweep 的 upsert 撞上 `BEFORE UPDATE` 触发器（`forbidden write`） |
| ingest | 正文为空的新条目直接 `'no_content'` | `update "items" set "content_state"` 撞上 `BEFORE UPDATE` 触发器 |
| x | 中断后下一次同步治愈没轮到的推文 | `'72'`：期望 `'chunked'`，实得 `'no_content'` |
| youtube | 同上，视频 | `'vid-72'`：期望 `'chunked'`，实得 `'no_content'` |
| douyin | 中断页不再入库、头部有新收藏 | `'12'`：期望 `'chunked'`，实得 `'no_content'` |
| douyin | D-g：一页都不入库 | `'11'`：期望 `'chunked'`，实得 `'has_content'` |
| douyin | D5 列表页序位 / D5 公开夹首见 / 行映射 `toEqual` | 三例：`listCursor` / `listIndex` 是 `undefined` |

只做完 A 时再跑：ingest / x / youtube 全绿，douyin 剩 4 红（D-g 与 D5 三例）——「头部有新收藏」那条由 A 转绿，D-g 要等 B。

三个陷阱，写夹具时都踩得到：① 没正文的幽灵是 chunk 写失败那条**之后**的条目，不是失败的那条——修复前 `persistItemContent` 先 upsert 正文再写 chunk，失败的那条自己有正文、今天就能自愈；② X 的第二次同步只传比已知 id 更新的推文、YouTube 的第二次同步把已知视频只当 membership entry 传，这是在模拟生产路径的 `shouldStop` / `needsDetails`，不是偷懒；③ 抖音的 D-g 必须从 `backfillDone: true` 的增量头部造——全量走的断点写在入库之后，中断页下次必被重拉、靠那一页自己的 `textOf` 就能自愈，看起来像没有问题。

**证伪**（每次改一处、跑同一条命令、还原；全部对最终代码重跑过，还原后与备份逐字节相同）

| # | 改动 | 变红 |
|---|---|---|
| F1 | 去掉事务内 insert，5a 改回 `settleItemContent`（= 修复前的写法） | 5 例：ingest 持久正文、x、youtube、douyin 两例 |
| F2 | 保留事务内 insert，5a 改回 `settleItemContent` | ingest「只写一次」1 例 |
| F3 | sweep 的已存正文分支改回 `settleItemContent` | ingest「不重写」1 例 |
| F4 | 删掉 `else contentState = 'no_content'` | ingest 2 例（新增的「直接 `no_content`」+ 既有的「blank text settle at no_content」） |
| F7 | 只插入第一批正文 | ingest「45 条」1 例 |
| F5a | 抖音第 1 步改回 `if (folders.length > 0)` | D-g 1 例 |
| F5b | 第 1 步无条件但不带 `content` | D-g 1 例 |
| F5c | 第 1 步的结果不经 `report` | 2 例（两条中断用例的 `persisted` / `newItemIds` 少了治愈的 id） |
| F6a | 列表页不写序位 | 3 例（行映射、D5 两例） |
| F6b | 公开夹页也写 `listIndex` | D5 公开夹 1 例 |
| F6c | 续传段不传 cursor | D5 列表页 1 例 |

**验证**（2026-10-04）

- `pnpm vitest run lib/ingest lib/douyin lib/x lib/youtube lib/zhihu lib/github lib/bookmarks lib/bilibili tests/lib-import-smoke.test.ts`：39 文件 / 473 例全过。
- `pnpm compile`：通过（根 `tsc --noEmit` + `pnpm -r compile`）。
- `pnpm test`：根 223 文件 / 1914 例、`packages/*` 15 文件 / 263 例全过，无偶发超时。
- 没跑 `pnpm build`：无 manifest、无 app 侧改动。

**发现、未改的**

- **中断那一次调用里已经切完块的条目没人派发**。`ingestCollection` 在 5a 中途抛错，`contentPersisted` 随之丢掉：排在失败条目之前、已经 `'chunked'` 且有 chunk 行的条目不是幽灵，之后的清扫不会再报它们。embed lane 是整库 backlog drain，下一次成功同步会捡到；tag lane 只吃 id（`entrypoints/app/hooks/collection-processing-jobs.ts:108-109`），这些条目要等 LLM 配置保存触发的 tag backlog 才会打标。所有平台都这样，抖音每次中断至多一页减一条。Step 2.5 之前就有，不在范围内。
- **第 1 步的清扫排在 `collects/list` 请求之后**（正文写的是「Source upsert 调用」）。那次请求失败的运行不清扫，幽灵等下一次请求成功的运行；正文都在库里，不丢。
- **事务变大了**：一次入库的全部新正文现在在一个事务里。抖音每页 20 条无所谓；github / zhihu 首次同步可能是几千条（github 每条至多 100 KB，知乎没有上限）。数据量没变（此前是几千条独立的自动提交语句），实际耗时与内存没测 `[UNKNOWN]`。（复核补了一个下限数字与 RPC 期限的事实，见下方「Step 2.5 复核」第 5 条。）
- **调用不带 `content` 而声明 `'chunked'`** 仍以 `'has_content'` 入库且没有正文（正文明写「行为不变」）。今天没有平台这样调；有的话，「`'has_content'` ⇒ 正文已落盘」对它不成立。
- 根 `CLAUDE.md` 留给主会话：`lib/ingest` 索引行仍写「五平台 sync-service 共用」「`settleItemContent` 是不透明文本正文写入 + `content_state` 落定的唯一实现」（现在新条目的正文由入库事务写、状态由 `chunkAndSettle` 落定）；docs/33 条目仍写 Step 2「未发布」、Step 3 有两项阻塞。（复核时主会话已改这两行：索引行写「七个平台」「`settleItemContent` 是事务之外写正文并落定状态的唯一入口」，docs/33 条目写 Step 2 已提交已发布、Step 2.5 已落地。）

**Step 2.5 复核（2026-10-04，trellis-check；仍未提交）**

分两轮。第一轮只改了一处类型、几处注释与文档，把第 1、4 条作为待决定的发现报给主会话；主会话当天给了两个**默认决定（不是用户决策）**——第 1 条在入库的文本边界剔除 NUL（§1 的 D-h），第 4 条把 helper 挪到 `tests/`——第二轮照此落地。下面各条写的是落地后的状态。

1. **已修（D-h）：数据库拒收的正文曾让整次入库回滚**。Postgres 的 `text` 存不了 NUL 字节（`\u0000`）。第一轮用临时测试实跑（跑完已删）：三条新条目 `a` / `nul` / `c`，`nul` 的正文是 `'R\u0000E\u0000A\u0000D'`，两边都抛 `invalid byte sequence for encoding "UTF8": 0x00`，但——
   - HEAD（修复前）：错在 phase 5 那一条的 upsert，item 行已经提交：`a` = `'chunked'`、`nul` = `'has_content'`、`c` = `'has_content'`。
   - Step 2.5 落地时（剔除 NUL 之前）：错在 step 4b 的事务内 insert，`items` 里这个平台**零行**——这一次调用的 source / author / item / link 全部回滚，而且每次同步都如此。
   
   两边都是每次同步必失败，差别在失败范围：HEAD 上库里看得到条目，Step 2.5 落地时一条都没有。只在正文里、不在 `title` / `platform_meta` 里的文本才有这个差别（那两处含 NUL 本来就让事务失败，同样实跑过：`title` 报同一个错，jsonb 的 `platform_meta` 报 `unsupported Unicode escape sequence`，都是零行；x / 抖音的正文同时在 meta 里）：主要是 github README——`fetchReadme` 用 `res.text()` 按 UTF-8 解码原始字节（`lib/github/github-api.ts:232`），UTF-16 的 README 解出来满是 `\u0000`，一个这样的仓库就让整次 Stars 同步入不了库；其次是知乎正文、YouTube description 第 500 个字符之后的部分。当时全仓库没有任何地方清洗 NUL；落地记录偏离第 4 条只提了 `textOf` 抛错，没有这一种。三种做法里（在写入边界剔除；按批 savepoint 把失败范围收回到那一批；接受并记为已知限制）主会话选了第一种，理由见 D-h。

   **修法**（`lib/ingest/ingest.ts`）：模块私有的 `storableText(text)` = 剔除 U+0000 再 trim，用在不透明文本经本模块进 `item_contents` 的三处——step 3 里新条目的 `textOf` 结果、sweep 里本轮 `textOf` 的结果、`settleItemContent` 收到的文本。归一化先于任何判空：只剩 NUL 的正文是空正文，新条目直接 `'no_content'`，sweep 落到已存 `plainText` 分支。chunker 只见得到归一化后的文本。源码里只写转义 `'\u0000'`，没有字面 NUL 字符（三个文件按字节查过）。

   **两处已知缺口，没有处理**：`persistExistingItemContent` 不归一化（chunk 是调用方备好的，只洗正文会让 chunk 行照样带着 NUL）；`title` / `platform_meta` 里的 NUL 仍让入库事务整体失败（HEAD 上也是）。

   **先红**（新测试 + 未修的生产代码，`pnpm vitest run lib/ingest/ingest.test.ts`）：4 failed | 22 passed (26)，四例都红在 `invalid byte sequence for encoding "UTF8": 0x00`——

   | 用例 | 红在哪 |
   |---|---|
   | 三条新条目、中间一条正文带 NUL → 三行都在、`plainText` 是 `README`、`'chunked'` | step 4b 的三行 insert 被拒，整次调用抛错 |
   | 正文只有 NUL 的新条目 → 直接 `'no_content'`（任务没列，多加的一例：锁 step 3 的「先归一化再判空」） | 同上，单行 insert 被拒 |
   | `settleItemContent`（书签提取那条路）→ 存的与切的都是 `extracted text`；只有 NUL 的文本 → `'no_content'`、无正文行 | `persistItemContent` 的 upsert 被拒 |
   | 幽灵有已存正文、本轮 `textOf` 只返回 NUL → 从已存正文治愈 | sweep 把那串 NUL 当成正文，upsert 被拒 |

   **证伪**（每次改一处、跑 `pnpm vitest run lib/ingest lib/bookmarks`、还原；还原后 sha256 与修复后的文件一致）：

   | # | 改动 | 变红 |
   |---|---|---|
   | N1 | step 3 改回 `textOf(...).trim()` | 2 例（三条新条目、只有 NUL 的新条目） |
   | N2 | `settleItemContent` 改回 `text.trim()` | 1 例（`settleItemContent`） |
   | N3 | sweep 对未归一化的 `textOf` 判空（`fresh.trim()`） | 1 例（sweep：幽灵被落成 `'no_content'`，没从已存正文治愈） |
   | N4 | `storableText` 不剔除、只 trim | 4 例全红 |
   | N5 | `storableText` 先 trim 后剔除 | 2 例（只有 NUL 的新条目、`settleItemContent`——NUL 挡着的空白没被 trim 掉） |
2. **`lib/ingest/ingest.ts` 一处类型**：事务里的 `let contentState: string` 收紧成 `'pending' | 'no_content' | 'has_content'`。`NewItem['contentState']` 是 `string`（列是 `text` + CHECK），所以原写法能编译，但拼错一个状态要到运行期的 CHECK 约束才报。
3. **三处注释 / 两处相邻文档与代码不符，已改**：`CONTENT_INSERT_CHUNK_SIZE` 的注释与本记录原写「最坏约 2 MB」，只对有 100 KB 上限的 github 成立，知乎的 Markdown 没有上限；`IngestResult.inserted` 的注释「content persisted for these only」自幽灵清扫存在起就不成立；`lib/bookmarks/CLAUDE.md` 写「写正文 + 落定状态与 ingest phase 5 是同一个函数」，phase 5a 现在不经 `settleItemContent`，改成如实描述；`entrypoints/app/sections/douyin/CLAUDE.md` 的逐条派发一句补上「运行开头那次清扫治愈的条目也从 `onPagePersisted` 出来」；`lib/ingest/CLAUDE.md` 的已知 id 集合 builder 一句补上 douyin。
4. **已挪：测试 helper 现在是 `tests/ingest-test-support.ts`**（主会话 2026-10-04 的默认决定，不是用户决策；先例是 `tests/platform-env-guard-contract.ts`）。落地时它在 `lib/ingest/` 下，是 `lib/` 里第一个文件名不带 `.test` 的测试专用文件：当时扫描 `lib/**` 非测试文件的守卫里只有 `tests/http-fetch-deadline-guard.test.ts` 会读到它（无 `fetch(`，通过），运行时代码零 import、进不了任何 bundle，所以这是位置问题不是缺陷。三个引用方（x / youtube / douyin 的 sync-service 测试）改成 `@/tests/ingest-test-support`；`lib/ingest/CLAUDE.md` 的模块结构不再列它，只留一行指路。
5. **「事务变大了」补两个事实**：RPC 的 30 秒期限是**每次调用**一个（`lib/database/bridges/proxy-driver.ts:19`，`rpc-handler.ts` 在执行前校验 `deadlineAt`），不是每个事务一个，所以事务变长本身不会超时；受影响的是别的 context（Background 的只读代理、另一个 app.html 标签页）——事务开着时它们的请求在 handler 里排队，排过 30 秒就以 `expired before execution` 被拒。内存 PGlite 下量了一次下限（临时测试，已删）：3000 条新条目、正文共 4336 万字符（每条约 14 KB），从调用开始到事务提交约 1.2 秒。没量的是经 RPC 代理的序列化与提交时落 IndexedDB 的耗时。
6. **其余核对无出入**：落地记录的先红（10 failed | 59 passed (69)，拿 HEAD 的两份生产文件重跑）、「只做完 A」（4 红）、证伪 11 行全部按原样复现，每次还原后两份生产文件的 sha256 与改动前一致。X / YouTube 两条新测试的第二次同步与生产路径同形（`fetchAllBookmarks` 遇已知 id 即停且不含该条，`needsDetails` 对已知 id 为假、只剩 membership entry）。七个平台的调用里，bookmarks / bilibili 不传 `content`，路径没变；github / x / zhihu / youtube / douyin 的 `textOf` 都是 `Map` 查表，抛不了错。读 `'has_content'` 或 `item_contents` 的地方（处理策略的三组谓词、embed / tag 候选、Chat 的 `getItemContent`、Obsidian 导出、书签提取的恢复条件）都不因正文提前落盘而变：`'has_content'` 既不是 embed / tag 候选也不算正文完成，书签不传 `content`。文中新增的 `file:line` 引用（`bookmark-content-service.test.ts:251`、`collection-processing-jobs.ts:108-109`）都对得上；`npm view favbase version` 返回 `0.2.2`。
7. **验证**（第二轮，剔除 NUL 与挪 helper 之后）：`pnpm vitest run lib/ingest lib/douyin lib/x lib/youtube lib/zhihu lib/github lib/bookmarks lib/bilibili tests/lib-import-smoke.test.ts` 39 文件 / 477 例全过（第一轮 473，加「Storable text」四例）；`pnpm compile` 通过；`pnpm test` 根 223 文件 / 1918 例、`packages/*` 15 文件 / 263 例全过，无偶发超时（第一轮根 1914 例）。扫描 `lib/` 的守卫（fetch-deadline、sleep、env-constants、completeness contract、ui-vendor-boundaries、background-bundle-contract）另跑一遍，全过。

---

### Step 3 — 实机端到端验证（生产条件）

**目标**：在用户真实账号上确认整条链路在**生产条件**下成立，把 §6 的 `[UNKNOWN]` 逐条变成已知，按实测修正默认值。

**依赖**：Step 2 与 Step 2.5 已落地（§6 末「阻塞项」两条由 Step 2.5 关闭：正文与条目同事务落盘 + 每次运行至少清扫一次；接口序位已入库）；BrowserOS 已登录抖音。装进浏览器的构建必须含 Step 2.5——序位是首次入库时写的，用旧构建跑过全量就只能清库重拉。BrowserOS MCP 若连不上，用 CDP（端口见 `%LOCALAPPDATA%\BrowserClaw\User Data\.browseros\config.json` 的 `ports.cdp`）。先确认扩展是从哪个目录加载的（`chrome://extensions` target 里 `chrome.developerPrivate.getExtensionsInfo()` 的 `prettifiedPath`），装新构建前告诉用户。

**生产条件与 Step 0 实测的差别**：Step 0 的探测都在抖音标签页可能处于前台时做的；真实使用时 **app.html 在前台、抖音标签页在后台**，而且首次全量要 20 分钟。

**验证清单**（按顺序，每条记录结果）

1. **注入本身**：抖音标签页**放到后台**（另开一个前台标签页），从扩展发第一个注入请求——返回 `kind: 'response'`、`status_code: 0`，而不是 `ReferenceError` / `sdk-not-ready`。再把抖音标签页拖到另一个窗口重复一次。
2. **首次全量**：手动「立即获取」跑完全量（2299 条量级）：记录总耗时、每次休息、是否出现任何 F3–F9；入库条数 ≈ 收藏数 − 失效数；进度显示正常。
3. **app.html 也在后台**：全量期间把 app.html 切走超过 5 分钟，测实际页间隔——Chrome 对隐藏页的链式定时器有强节流（约 1 分钟一次），可能把 20 分钟拉成数小时。若成立，记为已知限制并评估对策（例如提示「同步期间保持本页在前台」），**不要**为它擅自加后台运行机制。
4. **签名计数分桶**：观察失败是否集中在同一页面生命周期约 140 次签名之后。若是，对策是给用户的「刷新抖音标签页后再获取」提示，**不是**自动 reload（D3 / 铁律 6）。
5. **增量**：再点一次「立即获取」——只翻 1–2 页就停。
6. **断点续传**：清库重来，全量进行到一半时关掉抖音标签页 → 页面显示错误、已入库条目保留；重新打开抖音标签页再获取 → 先补头部、再从断点续到底；隔天再试一次（cursor 跨天有效性，D-e 是否被触发）。
7. **无标签页**：关掉所有抖音标签页 → 空态 + 「打开抖音」按钮；每日自动同步静默跳过、Platform Sync Record 没有新的尝试。
8. **下游**：embed / tag lane 逐条在跑；Chat 能检索到抖音条目；Agent Bridge `favbase search "<收藏里有的关键词>" --platform douyin` 有结果。
9. **manifest**：已装扩展更新后没有要求重新授权之外的权限提示（`scripting` 无警告文案；`<all_urls>` 已覆盖抖音 host）。

**不做**：不故意触发风控；不在用户账号上压测阈值。

**回滚**：实测推翻某个默认值 → 只改对应 `VITE_DOUYIN_*` 默认值（同步 `EXPECTED_ENV_CONSTANTS` 与两个 env 文件）或修对应形态的分类，各自带测试；推翻路线（如后台注入不被接受）→ 停下来，回到 §1 找用户重新决策，不就地换路线。

**判据**：清单 1–9 全部有记录；§6 每条 `[UNKNOWN]` 标为「已证实 / 已证伪 / 仍未知 + 原因」；落地记录写进本文。

---

## 6. 未知与风险

| `[UNKNOWN]` | 影响 | 在哪一步解决 |
|---|---|---|
| 扩展 `executeScript` 注入的请求是否和 DevTools / CDP 一样被签名接受 | 路线成立与否 | Step 3 第 1 条 |
| 后台标签页产出的签名是否被接受 | 同上 | Step 3 第 1 条 |
| 页面内 fetch 的风控阈值、冷却时长 | 默认节奏是否够保守 | Step 3 第 2 条（只观察，不压测） |
| 隐藏 app.html 的定时器节流幅度 | 首次全量耗时 | Step 3 第 3 条 |
| a_bogus 签名计数分桶是否被打分 | 长时间运行的失败率 | Step 3 第 4 条 |
| 16 位 cursor 跨天是否有效 | 断点续传；D-e 兜底 | Step 3 第 6 条 |
| 收藏夹 `status` 0 / 1 映射（单源）、`states` / `is_normal_status` 语义 | 公开夹 chip | 用户建一公一私两个夹后实测（Step 3 可顺带） |
| 收藏接口上验证码 / 412 / `filter_list` 的真实样本 | 分类器覆盖面 | 错误消息带原始片段，出现时补测试 |
| 整页失效作品时是否 `aweme_list: []` + `has_more: 1` + 非空 `disabled_item_ids` | F8 的分支 | 出现时补测试（推断自实测 #6） |
| 抖音签名门禁规则继续变化（2026-08 → 09 至少变过两次） | 整条路线 | 持续：F3 的错误消息是第一信号 |

**阻塞项（Step 3 首次真实账号全量入库之前；insert-only，入库之后补不回来）——两条都已由 Step 2.5 关闭（2026-10-04）**

- **已解决**：新条目的正文与 item 行同事务落盘（D6），中断页没轮到的条目带着正文停在 `'has_content'`，之后任意一次清扫都能治愈；抖音每次运行开头无条件清扫一次（D-g）。抖音 / X / YouTube 各有一条在自己同步入口复现的测试，见 Step 2.5 落地记录。下面是修复前的事实，行号指修复前的 `ingest.ts`，留作记录。
- **已解决**：用户 2026-10-04 决定存（D5），`listCursor` / `listIndex` 在首次入库时写入 `platform_meta`。
- （修复前）**逐页入库会把中断页的条目永久落 `no_content`**（代码事实，复核时用临时测试实跑确认）。声明 `'chunked'` 的条目在入库事务里先以 `'has_content'` 插入（`lib/ingest/ingest.ts:364`），正文与切块在事务之外逐条写（`:434-440`）；中途断掉，该页还没轮到的条目没有 `item_contents.plainText`。之后任何一次带 `content` 的 `ingestCollection` 调用都清扫全平台幽灵（`:442-461`），文本只取本次调用的 `textOf` 与已存 `plainText`，都没有就落 `'no_content'`，且 `'no_content'` 不再被清扫（`:143-145`）、存量条目不进 5a（`:436-438`）。抖音的 `textOf` 只认本页（`lib/douyin/douyin-sync-service.ts:378`），所以：下次运行头部第一页若整页已知（不入库），幽灵暂时不动；只要头部有一条新收藏、或任一公开夹页入库，不在那一页的幽灵就永久无正文，之后再全量走也救不回。能自愈的只有一种情况：中断之后第一次带正文的调用恰好包含它（例如按断点重拉的正是那一页、且头部没有新收藏）。这一形态主要是逐页入库的问题：一次拉全量再入库一次的平台，下一次调用的 `textOf` 通常覆盖同一批条目。正文其实还在 `platform_meta.desc`，ingest 不读它。
- （修复前）Step 3 首次全量入库前由用户决定是否存接口序位（insert-only，事后只能清库重拉）。

---

## 7. 参考

- 调研：`.trellis/tasks/10-03-douyin-public-favorites-platform/research/` 下 `douyin-collects-web-api.md`、`douyin-request-signing.md`、`douyin-public-favorites-semantics.md`、`douyin-rate-limiting.md`、`douyin-live-probe-2026-10-03.md`
- 契约：`.trellis/spec/frontend/platform-onboarding.md`；ADR 0004（两份 descriptor）
- 先例：`lib/zhihu/`（login + 多 Source + `is_public`）、`lib/x/`（调用方传入认证、增量停止、限流锁）、`lib/bilibili/favorites-sync-runner.ts`（7 + 3 s 节奏）、`entrypoints/app/sections/bookmarks/use-bookmark-extraction.ts`（逐条 `enqueueCollectionProcessingItem`）
- 共享机制：`lib/http/{backoff,retry,response-body,fetch-with-deadline}.ts`、`lib/env.ts`、`lib/collections/sync-errors.ts`、`entrypoints/app/hooks/{platform-sync,use-countdown,use-daily-auto-sync,collection-processing-jobs}.ts`
- 发布规则：`packages/favbase/CLAUDE.md` Release 一节

---

## 附：迁自根 CLAUDE.md 的落地摘要（2026-10-06 快照）

> 这一段原先写在根 `CLAUDE.md` 的「关键文档」一节，每个会话都全量加载。2026-10-06 按 docs/36 精简根文件时
> 逐字迁到这里，之后不再同步维护；与正文冲突时以正文为准。

**抖音收藏接入手册（第 7 个平台）**（2026-10-03，**Step 0 已完成：调研 + 用户账号实测 + 决策；Step 1 / Step 2 已落地并提交 2026-10-03（CLI 0.2.2 已发布）；Step 2.5 已落地 2026-10-04（代码 + 单测，清掉 Step 3 的两项阻塞）；Step 3 待实施**，任务目录 `.trellis/tasks/10-03-douyin-public-favorites-platform/`）。三条从代码里看不出来的事实：① 自 2026-08-16/17 起抖音三个收藏接口都要求页面 SDK 签名，扩展直连 → `403 ArgusSecurityPlugin`，所以请求经 `chrome.scripting.executeScript({ world: 'MAIN' })` 注入用户**已打开**的 douyin.com 标签页、由页面 SDK 自动补签（D3 / D4，实测 22 次请求无一被签名门禁拒绝；`douyin-api` / `douyin-sync-service` 只认注入的 transport、加载图零 chrome，`chrome.*` 只在 `lib/douyin/douyin-tab.ts`）；② 用户原话「先只做公开收藏」在抖音上不可执行（只有收藏夹标公开 / 私密，全部收藏无逐条可见性，账号级开关读不到），**用户决定同步全部收藏、公开收藏夹作 Source**——这是对 B 站 / 知乎「私密夹视频不是 Collection Item」的有意偏离（D1）；③ 2026-08 曾有一版从未提交的抖音实现（SW 直连 + webRequest 捕获 msToken），它带的「禁止页面上下文降级」约束被 D4 有意推翻，`.env.local` 的 8 个 `VITE_DOUYIN_*` 死键是它的遗留，Step 1 替换。防限流：页大小 20（实测上限 30–39）、5 s + 0–3 s 页间隔、每 25 页休 1–3 min、逐页入库 + 断点续传 + 逐条派发处理 lane、403 / 429 不在请求层重试（§4）。Step 2 改 SKILL.md 平台清单 = 一次 CLI 发版（`packages/favbase/CLAUDE.md` Release），由用户决定当场发布还是暂不提交。**Step 1 落地要点（2026-10-03）**：`lib/douyin/` 领域层建成并测绿，判别符未翻；断点状态收成两个字段 `{ resumeCursor, backfillDone }`——手册的第三个字段 `restartBackfill` 删除（「全量走」= `!backfillDone && resumeCursor === null`，D-e 写回 `{ null, false }` 即可；按手册字面还会在「首页入库后、写回断点前中断」时让回填永远完不成），手册 6 处同步勘误；复核把 D-e 收窄为**仅续传段第一次请求**（携带存储断点的那次——之后的页用的是本次刚拿到的 cursor，被拒多半是真风控，清断点等于在被限流时安排一次全量重走），并经主会话决定把该请求的 F10（返回的 cursor 没越过断点 = 服务端没认它）也纳入 D-e，另补了 listcollection 非首页 cursor 回到 `0` 的 F10 与存储断点的边界校验；节奏器放进 `withRetries` 的 attempt（重试也计数、也等页间隔）；验证码检测的字符串值匹配不进入条目列表。偏离与证据在 docs/33 Step 1 落地记录。**Step 2.5 落地要点（2026-10-04，用户当日两项决定）**：D6——幽灵清扫的缺陷修在共享管线里，新条目的 `item_contents.plainText` 与 item 行同事务写入（`'has_content'` ⇒ 正文已落盘），phase 5 只切块并落定状态；此前写 chunk 中途断掉、下次同步的 `textOf` 又覆盖不到的条目会永久落 `'no_content'`，抖音（逐页入库）、X（遇已知 id 即停）、YouTube（已入库视频不再拉详情）都中招，三个平台各有一条在自己同步入口复现的测试，X / YouTube 的生产代码未改。D5——存接口序位、排序不改：`platform_meta` 加只写不读的 `listCursor` / `listIndex`。D-g（设计默认项）——抖音每次运行开头无条件清扫一次幽灵。D-h（复核时主会话的默认决定，不是用户决策）——正文经 `lib/ingest` 进 `item_contents` 之前先剔除 U+0000 再 trim，**对所有平台生效**：Postgres 的 `text` 存不了它，而正文进了入库事务之后，一条这样的正文会让整次入库回滚（github 的 UTF-16 README 是现成的触发源）；不覆盖 `persistExistingItemContent` 与 `title` / `platform_meta` 里的 NUL。执行任一 Step 前先读该文 §1–§3
