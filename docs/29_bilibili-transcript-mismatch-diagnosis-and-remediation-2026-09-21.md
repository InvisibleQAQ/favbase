# B 站转录字幕串行：诊断与修复方案（2026-09-21）

状态：诊断完成；**2026-09-23 运行时复核（§9.6）：修复后串行已消失**——E1 在本账号复现 C1（`v2` 外来 5/8、`wbi/v2` 原始轨自有 8/8），全库导出里修复后落库的 123 条 B 站正文零扇入、零超时长、标题正文 123/123 吻合；同时暴露 Step 1 规则把本视频的机器翻译轨（裸 32 位 hex 文件名）误判为外来，**Step 1b 已落地 2026-09-23**（裸名放行 + 整表校验，否决了 E1 预案的「降为仅日志」）；**Step 0 的 E2 / E4 已由用户跑完 2026-09-22**（§9.5：E2 = 分支 L，SW 默认就带 jar cookie；E4 本账号 39 个夹全公开、无私密样本），E1 已跑（2026-09-23），E3 未判读即随 Step 3 清空（清掉 1228 条）；**Step 1 已落地 2026-09-22**（代码与单测；运行时复核五步中 1/2/4 已过，2026-09-23 第 3 条只跑了 1 个视频、第 5 条的 app.html 半边由全库导出代替抽样，面板半边未回报，见 Step 1「2026-09-23 追加」）；**Step 4 已落地 2026-09-22**（代码与单测；2026-09-23 运行时复核：临时私密夹 `attr: 3` 证实 bit0 规则，app.html 是否真把它隐藏了 `[UNKNOWN]`；手动转录失败，用户指示不追查）；**Step 3 已改为一次性手工清理、Step 6 已取消**（用户 2026-09-21：扩展尚未上线，库里全是测试数据，见 §8 Q1）；**Step 5 已落地 2026-09-24**（由独立任务 `09-24-transcript-origin-column` 完成：`item_contents.subtitle_source` + 迁移 v006，修 C6；代码与单测，运行时复核待用户，见 Step 5）；**§8 Q5 已答（用户 2026-09-22）：收藏夹 API 并入 Step 4，且 favbase 只做公开收藏夹**；**2026-09-22 勘误**：C5「SW 路径未登录」由结论降级为 `[UNKNOWN]`，E2 裁决（§1 F21–F25、§3 C5）——同日 E2 裁决为分支 L（F26）
范围：`lib/bilibili/bilibili-api.ts`、`lib/bilibili/bilibili-transcription-adapter.ts`、`lib/cache/`、`entrypoints/bilibili-video.content/hooks/`
前置：`.trellis/tasks/09-17-bilibili-transcripts-land-on-the-wrong-items/prd.md`（及其 `research/` 四份材料）、commit `4dad4df`

---

## 0. 结论先行

PRD 的 H4 **找对了毒源，找错了入口**。

| PRD 的说法 | 核实结果 |
|---|---|
| B 站非 wbi 的 `x/player/v2` 会返回别的视频的 AI 字幕 | **外部证实**（yt-dlp #11708、bilibili-api #841 原文已核对），本仓库确实在调这个端点（`bilibili-api.ts:18-19`）。今天对本账号是否仍成立 `[UNKNOWN]`，见 Step 0 / E1 |
| 收藏页批量转录（SW 路径）很可能未登录，「正是错乱最严重的场景」 | **两半都不成立**。未登录拿到的是**空列表，不是随机字幕**（本次实测，§9.1），「未登录 = 错乱最严重」的因果是反的；而 SW 路径**是登录态**——E2（2026-09-22，§9.5）显示 SW 连 init 都不传就已带上 jar cookie（F26）。**所以 Step 1 之前 SW 批量转录就是 H4 的第二个入口**，本文初稿断言「不可能是入口」是过度推断（2026-09-22 勘误，E2 已裁决为分支 L）。Step 1 覆盖两个入口：它们走同一个 `fetchSubtitle` |
| 用落库的 `source` 字段确认错配是否全为 official | **无法执行**。`item_contents` 只有四列，**没有 `source`**（`lib/database/entities/item-contents.ts`）。`source` 只进了一行 `console.info`（`bili-sync-service.ts:169-171`）。（2026-09-24：Step 5 已加 `subtitle_source` 列，此后的转录正文可以这样查；这里说的旧正文仍是 NULL，不回填） |
| 09-17「ASR 路径也在错配」 | 仅凭「无标点」判读，**站不住**。09-21 有两条错配正文逐字相同（3074 字）——两段不同音频不可能转出逐字相同的文本。该冲突大概率不存在 |
| `♪ 音乐 ♪` 是独立问题（H3，转录截断） | **大概率是同一个 bug**。同一个视频 09-17 是 `♪ 音乐 ♪`、09-21 变成 LOL 采访/兴趣快问快答——它只是随机池里的又一条外来字幕（一个纯音乐视频的 AI 字幕），不是截断 |

**真正的链条（H5）**：毒从两个入口进来。下图是 **Content Script 的字幕面板**那一条——每一环都读到了源码；另一条是转录管线自己（SW 批量路径，已登录 + 非 wbi，E2 裁决为分支 L，见上表第二行与 C5），它不经过缓存，直接把 B 站给错的字幕交给 pipeline 落库。

```
用户在 B 站看视频（已登录）
  → CS 面板 useSubtitle 的 API 降级（useSubtitle.ts:135）
  → fetchSubtitle：已登录 + 非 wbi x/player/v2          ← C1 根因
  → B 站返回别的视频的 subtitle_url，status:'ok'
  → CACHE_SUBTITLE 以【正确的 bvid】为键写入共享缓存     ← C2 入口
     （且 resolved=true 把之后到达的正确拦截结果丢掉）   ← C3 放大器
用户收藏该视频 → app.html 转录
  → pipeline.ts:88 cacheGet 命中，cached:true            ← C4 投递
  → videoId 全程自洽，4dad4df 门控放行 → 落库
```

这解释了 09-17 的静态审查为什么「全部正确」：审的是**转录链**（SW → pipeline → DB），那条链本身确实没错——即便 SW 也是登录态（分支 L），它也只是在忠实搬运 B 站给错的数据，代码依然「全对」。字幕展示链这条入口当时没人把它算作转录路径的一部分。

另外一条独立线索（C5）：SW 侧显式拼的 `Cookie` header 按 Fetch 规范是 forbidden header，它是否生效曾是 `[UNKNOWN]`。**E2 已裁决（2026-09-22）**：host permission 让 SW 的 fetch 默认附带 jar cookie，SW 路径是登录态（分支 L），也就是 H4 的第二个入口；显式 header 是冗余，是否真被发出分不开也无须分开。C5 不是缺陷，Step 4 的字幕半边是零行为变化的显式化。

方案：**止血所需的代码改动只有 Step 1（换端点 + 归属校验）**，Step 4 是独立的还债 PR；旧缓存不写失效机制，开发机手工清一次（Step 3）——扩展尚未上线，不存在装着脏缓存的用户。**但清缓存这一步不能省**：不清，`pipeline.ts:88` 永远先命中脏条目，修好的代码根本执行不到，验证时症状原样复现。wbi 签名、rows 指纹、cid 进协议、缓存 rev 失效四条路径已评估并否决（§4）。

---

## 1. 事实核对

证据等级：**[实测]** 本次亲手验证；**[源码]** 逐行读过；**[外部]** 第三方来源原文已核对；**[推论]** 由前几类推出，未直接观测。

| # | 事实 | 等级 | 位置 / 来源 |
|---|---|---|---|
| F1 | 字幕列表端点是非 wbi 的 `x/player/v2` | 源码 | `lib/bilibili/bilibili-api.ts:18-19` |
| F2 | `fetchSubtitle` 取到 `subtitle_url` 后直接拉 CDN，不校验该 URL 属于谁 | 源码 | `bilibili-api.ts:179-187` |
| F3 | 有 auth 时 `buildFetchInit` 只塞 `headers.Cookie`，**不设 `credentials`** | 源码 | `bilibili-api.ts:143-146` |
| F4 | `fetchWithDeadline` 只透传 init，不补 `credentials` | 源码 | `lib/http/fetch-with-deadline.ts:74` |
| F5 | Chrome 对扩展 SW 的 `fetch()` 静默丢弃 `Cookie` header | 外部（**与仓内 F21 冲突**） | 一个实测过 Chrome for Testing 146 的开源扩展为此专门写了 DNR shim（`ai-ecoverse/slicc` `fetch-proxy-shared.ts`）；Fetch 规范 forbidden request-header |
| F6 | DNR 静态规则只改 `bilivideo` 的 Referer/Origin，不碰 `api.bilibili.com`；全仓库无动态/会话规则 | 源码 | `public/rules.json`；`declarativeNetRequest` 全仓 grep 仅此一处 |
| F7 | **未登录**请求 `x/player/v2` 与 `x/player/wbi/v2`：`code 0`、`login_mid 0`、**`need_login_subtitle: true`**、`subtitles: []`，多次请求结果稳定 | **实测** | §9.1。含 yt-dlp issue 里那个确定有 AI 字幕的视频 |
| F8 | 无签名请求 `x/player/wbi/v2` 返回 `code 0`（未被 -352/-403 拒绝） | **实测** | §9.1 |
| F9 | yt-dlp 现行 master 对 `x/player/wbi/v2` **不签名**，并读 `data.need_login_subtitle` | 外部 | `yt_dlp/extractor/bilibili.py:263-269` |
| F10 | yt-dlp #11708 三份样本的 URL 全部是 `…/ai_subtitle/prod/{aid}{cid}{md5}`——**错的两条同样符合此结构，只是 aid/cid 是别人的**。2026-09-22 补证：另一独立来源（2026-03）6 份已知 aid/cid 的正确样本同样成立，合计 **7/7**；文件名无 `.json` 后缀、恰为前缀 + 32 位 hex；错 #1 的 md5 以数字开头 | 外部 | 正确：`113470703931990`+`26731938624`+hash；错 #1：`113384720701738`+`26504398541`+hash；错 #3：`113265099146606`+`26182422278`+hash。补证与逐条验算见任务 `research/ai-subtitle-url-ownership-evidence.md` |
| F11 | CS 的 API 降级在 Content Script 里调 `fetchSubtitle(bvid, cid)`（无 auth → `credentials:'include'` → **已登录**） | 源码 | `useSubtitle.ts:135`、`bilibili-api.ts:145` |
| F12 | 降级成功即 `CACHE_SUBTITLE` 写缓存，键是正确的 bvid，`source:'official'` | 源码 | `useSubtitle.ts:153-161` → `cache-handlers.ts:20` |
| F13 | 降级一旦成功置 `resolved = true`，其后到达的拦截结果在入口被丢弃 | 源码 | `useSubtitle.ts:139`、`:94` |
| F14 | pipeline 第一步就是 `cacheGet`，命中即返回，不再请求任何东西 | 源码 | `lib/transcription/pipeline.ts:88-92` |
| F15 | `fetchSubtitle` 全部调用方只有两个：SW adapter（带 auth）与 CS `useSubtitle`（不带） | 源码 | `bilibili-transcription-adapter.ts:25`、`useSubtitle.ts:135` |
| F16 | 拦截通道抓的是**页面自己**发起的 CDN 请求（由 `triggerCC()` 主动点开字幕触发），并有 generation / 页面元数据一致性 / URL 漂移 / reemit 四层守卫 | 源码 | `lib/bilibili/inject/state.ts:118-161`、`interceptors.ts` |
| F17 | `item_contents` 无 `source` 列（2026-09-24 起不再成立：Step 5 加了 `subtitle_source`，迁移 v006） | 源码 | `lib/database/entities/item-contents.ts` |
| F18 | 同仓库 zhihu 从扩展上下文用 `credentials:'include'` + host permission 打登录态 API，且 PRD 实测其正文全部正确 | 源码 + PRD | `lib/zhihu/zhihu-api.ts:412` |
| F19 | `lib/bilibili/bilibili-api.ts` 与 `lib/cache/video-cache.ts` **均无单测文件** | 源码 | `lib/bilibili/*.test.ts` 九个文件里没有 api；`lib/cache/` 零测试 |
| F20 | AI 总结读的是同一份字幕缓存，总结缓存按字幕 `rawHash` 寻址 | 源码 | `lib/summary/summary-service.ts:41`、`:91` |
| F21 | **app.html 上下文**：不传 `credentials` 时显式 `Cookie` header **生效**；传 `credentials:'omit'` 反而让 Chromium 丢掉它（2026-07 X 平台根因记录，原话「extension contexts with host permission may set forbidden headers」） | 源码（仓内实测） | `lib/x/x-api.ts:493-497` |
| F22 | 仓内另一处记载：「host 权限 fetch 默认携带用户 cookie，故提取 fetch 必须 `credentials:'omit'`」 | 源码（是否实测过未知） | `lib/bookmarks/CLAUDE.md:23` |
| F23 | **SW 上下文**：fetch 自设的 `Referer` 被 Chrome MV3 剥离，只能靠 DNR——同为 forbidden header，但 Referer 与 Cookie 在 Chromium 里的处理不同，**不能类推** | 源码（仓内实测，`public/rules.json` 是产物） | `lib/background/CLAUDE.md:25` |
| F24 | 收藏夹同步（app.html 上下文，同样只靠显式 `Cookie` header）今天能拉到 494 条；而**未登录**打 `list-all?up_mid=` 对 7 个大号全返回 `code 0, list: []` | 实测 + 推论 | `bili-sync-service.ts:69/86/113`；§9.1 追加。⇒ app.html 发出的收藏夹请求**大概率是登录态** |
| F25 | 两条外部资料称 host permission 下扩展 fetch 默认附带该域 cookie，其中 chromium-extensions 讨论组同一帖里也有相反报告 | 外部，互相矛盾 | §11 |
| F26 | **SW 上下文**：`credentials:'omit'` → `login_mid 0`；**不传 init**、只塞 `Cookie` header、`credentials:'include'` 三种写法**全是登录态**，`code` 全 0（无签名 `wbi/v2` 不被风控） | **实测**（用户，E2） | §9.5。⇒ F22/F25 对 SW 成立，分支 L（jar 默认附带） |
| F27 | 登录态 `list-all` 对本账号返回 39 个夹，`attr` 仅 0/2/22、bit0 全 0；匿名请求 `list-all` 返回 `data: null`，而覆盖这三种取值的四个夹 `fav/folder/info` / `resource/list` 匿名可读（⇒ 全为公开夹，按 attr 取值推及其余 35 个） | **实测**（用户 E4 + 本机匿名 curl） | §9.5。私密侧无本账号样本，`attr & 1` 靠 8 个独立开源实现 + 1 份真实私密样本（§9.5） |

**2026-09-22 勘误**：本文初稿在此处写了三级推论（F5+F3+F4+F6 ⇒ SW 未登录 ⇒ 拿不到官方字幕 ⇒ 库里的 official 正文只能来自 CS）。它**只采信了 F5 这一条外部记载**，没有对照仓内 F21–F24。证据指向两种互斥的可能：

- **分支 U（SW 未登录）**：F5 + F23 成立、F22/F25 对 SW 不成立。SW 字幕请求既无 header cookie 也无 jar cookie → 只落 ASR → 库里的 official 正文只能来自 CS 缓存。C5 是真缺陷。
- **分支 L（SW 登录态）**：F21 的「扩展上下文可设 forbidden header」也适用于 SW，**或** F22/F25 的「host permission 默认附带 jar cookie」成立——任一成立即够。SW 批量转录直接命中 C1，是 H4 的**第二个入口**；C5 不成立（`Cookie` header 是死代码但无害，或根本没死）。

F24 已把 app.html 上下文定为分支 L；SW 上下文只有 F23 一条反向证据且不能类推。**E2 一次实验分辨两个分支。Step 1 对两个分支同样有效**（F15：两个入口走同一个 `fetchSubtitle`），所以这条勘误改变的是诊断叙述与 Step 4 的定位，不改变止血方案。

**E2 结果（2026-09-22，F26）：分支 L**，且是「jar 默认附带」那一行——连 init 都不传就已登录。F23 的「SW 剥离自设 forbidden header」对 Referer 成立、与 Cookie 是否被发出无关：jar cookie 走的是浏览器自己的附带路径，不经过 header 白名单。

---

## 2. 根因链（H5）

### 2.1 毒是怎么产生的

CS 面板的 `useSubtitle` 有三个数据来源，按优先级：缓存 → 拦截通道 → API 降级。

- **拦截通道是对的**（F16）。它抓的是播放器自己走 `wbi/v2` 拿到的响应。
- **API 降级是错的**（F1 + F11）。它是全仓库**确定**处于「已登录 + 非 wbi」组合的调用点（CS 的 `credentials:'include'` 无歧义），正好踩中外部报告的那个组合。SW adapter 的那个调用点是否同样已登录，见 C5 / E2。

### 2.2 为什么降级经常赢

时间线（SPA 切视频，源码常量）：

| 时刻 | inject（Main World） | CS `useSubtitle` |
|---|---|---|
| 0 ms | `resetForRoute` | 收到 `BILI_ROUTE_SWITCH` |
| 800 ms | 发 handshake，`startAutoTrigger` | 拿到 (bvid, cid)，effect 启动，3000 ms 计时开始 |
| 2800 ms | **第一次** `triggerCC()` | — |
| 2800 ms + 网络 | 播放器拉 CDN → 拦截 → `BILI_SUBTITLE_DATA` | — |
| 3800 ms | — | **API 降级开火** |

拦截通道只有约 1 秒余量，而 `triggerCC()` 失败一次就 +1000 ms（`state.ts:74`，最多 10 次）——**一次重试即耗尽全部余量**。

更糟的一类：视频在 `wbi/v2` 下本来就**没有字幕轨**（播放器没有 CC 按钮）。拦截永远不会触发，降级是唯一通道，而非 wbi 端点照样可能塞给它一条别人的字幕（yt-dlp 的三份样本来自**同一个视频的三次请求**：外来 / 空 / 外来）。这就是「没字幕的视频也被挂上了正文」的来源。

### 2.3 为什么一路畅通到 DB

`resolved = true`（F13）让错的结果锁死在面板里；`CACHE_SUBTITLE`（F12）让它进入共享缓存；`pipeline.ts:88`（F14）让 DB 路径把缓存当事实。4dad4df 的门控比的是请求回显的 `videoId`，这条链上 `videoId` 从头到尾都是对的。

### 2.4 逐项对证

| PRD 记录的现象 | H5 的解释 |
|---|---|
| N:1 扇入（一段正文挂 2-4 个 item；`♪ 音乐 ♪` 挂 8 个） | 同一条外来 URL 被分给多次请求 |
| 外来正文不在收藏集内 | 来自 B 站侧的公共池。PRD 把它读成「浏览过但未收藏的视频」——那是推断，观测到的只是「不在收藏集内」 |
| 只有 bilibili | 只有 bilibili 有字幕端点 |
| DB 重建后同一段外来字幕再现（「兴趣爱好快问快答」） | 池在服务端，本地状态清空与它无关 |
| 同一视频两次内容不同、甚至时对时错 | 重装清空了 `chrome.storage.local`，缓存条目重掷了一次 |
| 约 50% 错配率 | 对的 = 拦截赢了竞态 / 降级碰巧抽中自己 / 走了 ASR；错的 = 降级赢了且抽中别人 |
| 两条错配正文逐字相同（3074 字） | 同一条外来 URL。ASR 不可能产出这个结果，且 `assertAudioNotReused` 会拦 |
| 4dad4df 上线后仍错配 | 门控够不到这一层，commit message 自己也写了 |
| 静态审查「全部正确」 | 审的是转录链；毒从字幕展示链进来 |

### 2.5 这个理论怎么被证伪

下面任何一条成立，H5 就是错的或不完整的，**必须停下来重新诊断**：

1. E1 显示非 wbi 端点对本账号**稳定返回属于自己的字幕** → C1 今天不成立。
2. E3 显示某条错配 item 的缓存条目是 `source:'asr'` → ASR 路径确实在错配，存在第二个根因。
3. 某条错配 item 对应的视频，用户**确定从未在装着本扩展的浏览器里打开过** → 存在 CS 之外的入口（E2 落在分支 L 时这是预期，不算证伪）。
4. E2 显示 SW 路径是登录态（分支 L）→ H5 **不完整而非错误**：SW 批量转录是第二个入口，PRD H4 关于入口的判断对了一半。Step 1 仍覆盖，§0 / §3 C5 按分支 L 回写。**——已触发（E2 2026-09-22，F26），§0 / C5 已回写。**

第 2 条已无法检验：用户按 Step 1 验证顺序清缓存时 E3 表的 `source` 列没有被读出，条目随之删除（§9.5）。第 1 条**未触发**（E1 2026-09-23：`v2` 的 `ai-zh` 8 轮里外来 5 次、空 2 次、自有 1 次，§9.6）。

---

## 3. 缺陷清单

编号用 C，避开任务里已有的 D1-D5 / R1-R3 / H1-H4。

### C1 — 调的是已被 B 站废弃语义的端点（根因）

`ENDPOINTS.playerV2` → `x/player/v2`。已登录请求大概率拿到别的视频的 AI 字幕。B 站网页端自己用的是 `x/player/wbi/v2`。

### C2 — 共享缓存有一个不设防的写入方（入口）

`CACHE_SUBTITLE` 接受 CS 送来的任何 rows，以 CS 声称的 bvid 为键落盘。缓存随后被 DB 路径当作事实消费。**缓存的可信度等于它最不可信的那个写入方。**

### C3 — 错的结果赢了竞态还会锁死（放大器）

见 §2.2。**不单独修**，理由见 Step 2。

### C4 — `fetchSubtitle` 对响应零归属校验

F2。B 站在 URL 里写明了这条字幕属于谁（F10），代码没看。

### C5 — SW 侧显式 `Cookie` header 是否生效（独立线索，非错配根因；2026-09-22 由「缺陷」降级为「待裁决」，同日 E2 裁决为**分支 L，不是缺陷**）

**裁决（E2，F26）**：SW 的 fetch 不传 init 就已带 jar cookie。下面「分支 L」那一条成立：SW 批量路径在 Step 1 之前同样命中 C1，是错配的第二个入口；Step 4 的字幕半边是零行为变化的显式化，commit message 不得写「修复」。以下保留裁决前的两分支分析备查。

F3 只塞 header 不设 `credentials`。它是否让 SW 请求带上登录态，仓内外记载互相矛盾（F5/F23 说剥离，F21/F22/F25 说生效或默认附带）；本文初稿只采信 F5 就把它写成了确定缺陷。**E2 裁决**，两个分支的后果：

- **分支 U（未登录）**：批量转录拿不到官方字幕——B 站明确回 `need_login_subtitle: true`（「有字幕，但你没登录」），代码把它当 `no_subtitle` 静默降级 ASR，每个本可免费的视频都在烧 Groq 日额度；覆盖率卡在 27/489 可能与此有关。真缺陷，Step 4 修。
- **分支 L（登录态）**：SW 批量路径同样命中 C1，是错配的第二个入口；`Cookie` header 没死（或死了但 jar cookie 补上了）。Step 4 退化为「把靠 Chromium 扩展特例成立的登录态写成显式 `credentials:'include'`」——行为不变，意图变得可读、可测。

两个分支下 Step 4 的代码改动**相同**，只是 commit message 里「修复」与「显式化」的措辞不同。

**已确定的部分**：`lib/bilibili/CLAUDE.md` 的「需要认证的 API 手动拼 `Cookie: SESSDATA=xxx` header」把一个依赖 Chromium 扩展特例（F21）的做法写成了通用机制，且没说它在 SW 上下文是否成立——无论 E2 结果如何，这句都要改写（§10）。

**收藏夹路径（app.html 上下文）已由 F24 定为分支 L**：`fetchFavFolders` / `fetchFavVideos` 是登录态请求。这带来一个与错配无关、但被用户 2026-09-22 的产品决定点名的问题——登录态下 `list-all` 对夹主返回**全部**创建的夹，私密夹折叠在 `attr` 位里 `[UNKNOWN，E4 核实]`，而代码里 `attr` 只被原样存进 `platformMeta`（`favorites-sync.ts:122`），**没有任何过滤**。「只做公开收藏夹」今天没有代码承载。归入 Step 4（§8 Q5）。（2026-09-22 Step 4 落地后：`fetchFavFolders` 按 `attr & 1` 在 API 层过滤；E4 的结论见 §6 E4「结果」与 §9.5。）

### C6 — 正文来源不落库

F17。`persistContentChunks` 的第三个参数 `source` 是个摆设。库里无法区分 official / asr，也就无法圈定受影响范围。PRD 的排查步骤正是栽在这里。

（2026-09-24：**已由 Step 5 修复**。`source` 经 `persistExistingItemContent` 的必填第 6 参落进 `item_contents.subtitle_source`。上面描述的是修复前的事实；v006 之前写入的行不回填，仍是 NULL。）

### 连带影响

- **AI 总结也在总结别人的视频**（F20）。好在总结缓存按字幕 `rawHash` 寻址，字幕缓存一旦被 Step 3 失效并重取，hash 变了，旧总结自然不再命中，无需单独清理。
- CS 面板里显示的字幕本身就是错的——这是用户每天都能看到、但没人当成线索的症状。
- **依赖里还有一个休眠的「非 wbi」调用点**（2026-09-22 Step 1 落地时发现）：`defuddle@0.19.1` 的 `BilibiliExtractor.fetchTranscript`（`node_modules/defuddle/dist/extractors/bilibili.js:275-291`，请求 helper `fetchPlayerV2` 在 `:255-274`）先打 `wbi/v2`，**无轨道时依次回退 `x/player/v2?bvid=` 与 `?aid=`**，且带 `credentials:'include'`——正是 C1 的组合，而「wbi 下无轨道」恰是最容易拿到外来字幕的那类视频（§2.2）。它随书签提取被打进 app.html 的 chunk，但只有异步入口 `parseAsync()` / `fetchAsyncVariables()` 会调 `extractAsync`（同步 `parse()` 走的 `extract()` 不发请求）；`lib/bookmarks/bookmark-content.ts:73-74` 只调同步 `parse()`，并已有注释禁止 `parseAsync`（理由是站点 extractor 会打第三方 API），仓内也无 `fetchAsyncVariables` 调用，所以**今天不可达**。哪天书签提取改用任一异步入口，B 站书签的正文就会重新踩中 C1。

---

## 4. 已否决的路径

| 路径 | 否决理由 |
|---|---|
| 实现 wbi 签名（`w_rid`/`wts` + mixin key） | 不需要。F8 实测无签名 `code 0`，F9 yt-dlp 长期不签名。E1 若出现 -352/-403 再议 |
| D2：给官方字幕路径加 rows 指纹校验；D3：指纹 LRU 持久化 | 它只能在**第二次**撞上同一段外来字幕时报警，第一次照样落库。源头修对 + URL 归属校验之后，它守的东西已经不存在。过度设计 |
| R1：把解析出的 cid 盖进响应 + 成功路径打日志 | 它要抓的是 cid 串位。cid 从来没错过 |
| 删掉 CS 的 API 降级 | 破坏现有功能：CC 自动触发失败的视频会失去字幕面板 |
| 改 `resolved` 的竞态语义（让拦截结果覆盖降级结果） | 见 Step 2：源头对了，两个通道给的是同一份内容，竞态不再有正确性含义。动它只会引入面板闪烁 |
| 整体换 cache 命名空间（丢弃全部旧缓存） | 会把花了 ASR 额度换来的 `source:'asr'` 条目一起扔掉，而它们没有嫌疑 |
| 把收藏夹请求改成 `credentials:'omit'`，让服务端替我们只回公开夹 | §9.1 追加实测：未登录 `list-all` 对 7 个账号全返回空列表——大概率**根本不回任何夹**。「只做公开夹」只能在客户端按 `attr` 过滤（Step 4 第 3 条），收藏夹请求必须保持登录态 |
| 给缓存条目加 `rev` 字段 + 读时失效旧 official 条目（**本文初稿的 Step 3**） | 它保护的是「已上线用户浏览器里的脏缓存」。**扩展尚未上线，这类用户数为零**（用户 2026-09-21 确认）。初稿默认存在存量用户而未核实，是给零个人写的迁移机制。Step 1 之后不再产生新毒，存量脏条目只在开发机上，一行 Console 命令即可清掉 |
| 用 `source` 列圈定脏数据 | 没有这一列（C6）。2026-09-24 Step 5 加了 `subtitle_source`，但 v006 之前写入的行是 NULL、不回填，这批脏数据依然圈不出来 |

---

## 5. 方案分级

| 阶段 | 内容 | 性质 |
|---|---|---|
| A 止血（必做） | Step 1 换端点 + 归属校验（唯一的代码改动）；Step 3 开发机手工清一次缓存（零代码） | 修 C1/C2/C4，满足 PRD 全部 Acceptance Criteria |
| B 还债（强烈建议，独立 PR） | Step 4 登录态显式化（字幕/pagelist/收藏夹四个函数）+ 「只做公开收藏夹」过滤 | E2 = 分支 L ⇒ C5 的显式化（非修复）；落实用户 2026-09-22 的产品决定；E2 + E4 已过（§9.5） |
| C 独立任务（**已落地 2026-09-24**） | Step 5 正文来源落库 | 不在本任务范围，后由独立任务 `09-24-transcript-origin-column` 落地，修 C6；见 Step 5 与 §8 Q3 |

**顺序约束**：先合 Step 1，**再**清缓存，然后才验证。先清后合没用——下次打开视频页缓存立刻被旧代码重新下毒；合了不清也没用——脏条目在 `pipeline.ts:88` 永远先命中。

---

## 6. 分步实施

### Step 0 — 运行时验证（不改代码，**不能跳过**）

我没有、也不应该去拿用户的 B 站 cookie，所以「已登录 + 非 wbi 会返回外来字幕」这一条**今天对本账号是否成立**只能由用户在自己的浏览器里验。三个实验，每个两分钟以内，全部只读。

**E1 — 复现 C1，同时验证 URL 归属规则**
在任意 B 站视频页（已登录）的 DevTools Console 里跑。建议换 5 个以上视频各跑一次，其中至少一个是 UP 主自己上传 CC 字幕的视频，至少一个是非中文原声的视频（Step 1b 的 `[UNKNOWN]`）。

```js
const bvid = location.pathname.match(/BV\w+/)[0];
const get = (u) => fetch(u, { credentials: 'include' }).then((r) => r.json());
const cid = (await get(`https://api.bilibili.com/x/player/pagelist?bvid=${bvid}`)).data[0].cid;
const owner = (url, aid) => {
  url = url?.trim(); // 代码先 trim 再校验
  if (!url) return 'EMPTY';
  const name = /\/bfs\/ai_subtitle\/prod\/([^/?]+)/.exec(url)?.[1]; // 逐字即 bilibili-api.ts 的 AI_SUBTITLE_NAME
  if (!name) return 'NOT-AI-URL';
  if (/^[0-9a-f]{32}$/i.test(name)) return 'UNCLAIMED'; // 裸 md5 = 机器翻译轨，不声明归属，代码放行（Step 1b）
  const own = `${aid}${cid}`; // 与 ownsSubtitleUrl 同一判据：前缀 + 恰好 32 位 hex
  return name.startsWith(own) && /^[0-9a-f]{32}$/i.test(name.slice(own.length)) ? 'OWN' : `FOREIGN(${name})`;
};
for (let i = 0; i < 8; i++) {
  for (const ep of ['v2', 'wbi/v2']) {
    const j = await get(`https://api.bilibili.com/x/player/${ep}?bvid=${bvid}&cid=${cid}`);
    const subs = j.data?.subtitle?.subtitles ?? [];
    console.log(i, ep.padEnd(6), 'code', j.code, 'mid', j.data?.login_mid,
      subs.map((s) => `${s.lan}:${owner(s.subtitle_url, j.data.aid)}`).join(' ') || '(none)');
  }
  await new Promise((r) => setTimeout(r, 1500));
}
```

预期：`v2` 行里 `FOREIGN` / `EMPTY` / `OWN` 混杂；`wbi/v2` 行恒为 `OWN` / `UNCLAIMED`（或 `NOT-AI-URL`、`(none)`）。
- `v2` 恒为 `OWN` → §2.5 第 1 条，**停**。
- `wbi/v2` 出现 `FOREIGN` → **停**，先看那条文件名：它在多次请求、两个端点之间是否不变，是否出现在已知正确的响应里。如果是，那就是本视频自己的轨，规则判错了，改规则；如果不是，才是端点本身给错。（初稿这里写的是「硬拒收降为仅记录日志」。2026-09-23 实际触发的是翻译轨误判，用户选择改规则而不是降级，见 Step 1b。）
- `wbi/v2` 返回 -352/-403 → 需要 wbi 签名，§4 第一行作废。

2026-09-22 勘误：初稿的 `owner()` 只比前缀，比 Step 1 落地的判据宽——前缀对上、尾巴却不是 32 位 hex 的 URL 会在 E1 里显示 `OWN`、在代码里被拒。现与代码逐字同一判据，E1 验证的才是真正上线的那条规则。（同日复核补：对齐后的版本仍用 `/ai_subtitle/prod/` 判 AI 形状、用 `split('/').pop()` 取名，比代码的 `AI_SUBTITLE_NAME` 少了 `/bfs` 前缀——不带 `/bfs` 的 URL 在 E1 里会被判归属、在代码里却按上传者 CC 放行。现直接用同一条正则。）（2026-09-23 再改：加了 `UNCLAIMED` 分支，对齐 Step 1b 的裸名放行；原版把翻译轨报成 `FOREIGN`。同时补上代码一直有的 `trim()`：少了它，尾部带空白、又没有查询串的 URL 在 E1 里会误报 `FOREIGN`。）

**结果（用户 2026-09-23，一个中文视频，原始数据见 §9.6）**：`v2` 的 `ai-zh` 在 8 轮里有 5 轮 `FOREIGN`（每次都是单条轨，文件名前缀是别的视频的 `{aid}{cid}`，5 个前缀互不相同），2 轮六条轨全 `EMPTY`，1 轮 `OWN`——那一轮返回的六语轨表与 `wbi/v2` 完全一致。`wbi/v2` 的 `ai-zh` 8/8 `OWN`，`code` 16 行全 0。**C1 在本账号复现，§2.5 第 1 条未触发，H5 成立。**但 `wbi/v2` 的 `ai-en`/`ja`/`es`/`ar`/`pt` 被当时的 `owner()` 判成 `FOREIGN`：它们的文件名是裸 32 位 hex、没有 `{aid}{cid}` 前缀，16 次请求里恒定不变，与 `v2` 那一轮正确响应里的逐字相同——它们是本视频的机器翻译轨，只是文件名里不写归属。Step 1 的代码只校验选中的中文轨，中文原声视频因此不受影响；非中文原声视频的中文翻译轨会被误拒 `[推论]`，修复见 Step 1b。本轮只跑了一个视频（建议是 5+），上传者 CC 样本仍然没有。

**E2 — 裁决 C5 的分支（U / L），并确认 Step 4 的机制可行**
`chrome://extensions` → favbase → 检查视图「Service Worker」的 Console。四行分别是：基线（明确不带）、Chromium 默认（不传 `credentials`、不传 header）、生产代码今天的做法（只塞 header）、Step 4 的做法：

```js
const u = 'https://api.bilibili.com/x/player/wbi/v2?bvid=BV1XN416DEeR&cid=41389916397';
const probe = async (init) => {
  const j = await (await fetch(u, init)).json();
  const d = j.data ?? {};
  return { code: j.code, login_mid: d.login_mid, need_login_subtitle: d.need_login_subtitle, subs: d.subtitle?.subtitles?.length ?? 0 };
};
const s = await chrome.cookies.get({ url: 'https://www.bilibili.com', name: 'SESSDATA' });
console.table({
  'A baseline: credentials omit': await probe({ credentials: 'omit' }),
  'B default: no init':           await probe({}),
  'C today: Cookie header only':  await probe({ headers: { Cookie: `SESSDATA=${s.value}` } }),
  'D fix: credentials include':   await probe({ credentials: 'include' }),
});
```

C 行逐字复刻生产代码。读法（`login_mid` 为你的 uid 即登录态）：

| A | B | C | D | 结论 |
|---|---|---|---|---|
| 0 | 0 | 0 | uid | **分支 U**：C5 是真缺陷，Step 4 是修复；F22/F25 对 SW 不成立 |
| 0 | 0 | uid | uid | **分支 L（header 生效）**：F21 也适用于 SW；F5/F23 的「剥离」不适用于 Cookie |
| 0 | uid | uid | uid | **分支 L（jar 默认附带）**：F22/F25 成立；C 行的 header 是死代码但无害 |
| 0 | * | * | 0 | Step 4 的 `credentials:'include'` 在 SW 里带不上 cookie → 走 §7 预案 |

**先看 `code` 列**（2026-09-22 补）：Step 1 起 SW 批量转录也走这个无签名的 `wbi/v2`，而 F8 的「无签名不被拒」是 curl 带 B 站 `Referer` 测的，SW 的请求带不上 B 站页面的 `Referer`（自设会被剥离，F23）。任一行 `code` 非 0（如 -352 风控）→ SW 上下文被拒，Step 1 之后 SW 路径的官方字幕全部落 `error` → 重试两次后降级 ASR（功能不坏、烧额度），§4 第一行「不做 wbi 签名」需复议。初稿的 `probe` 在 `data` 为 null 时直接抛 TypeError，看不到这个信号。

**结果（用户 2026-09-22）**：A `0` / B `uid` / C `uid` / D `uid`，`code` 四行全 0，B/C/D 均 `need_login_subtitle:false, subs:1` → 读法表第三行，**分支 L（jar 默认附带）**。原始数据见 §9.5。

**E3 — 看缓存里的来源（替代 PRD 那条无法执行的「查 source」）**
同一个 SW Console：

```js
const all = await chrome.storage.local.get(null);
console.table(Object.entries(all).filter(([k]) => k.startsWith('vc:bilibili:')).map(([k, v]) => ({
  key: k, source: v.source, rows: v.rows?.length,
  updatedAt: new Date(v.updatedAt).toLocaleString(),
  head: (v.rows ?? []).slice(0, 3).map((r) => r.text).join(' ').slice(0, 60),
})));
```

拿 PRD 09-21 表里的 8 条错配对 `key`（bvid 小写）。预期：全部 `source:'official'`，`head` 就是库里那段外来正文。
- 任一错配条目是 `source:'asr'` → §2.5 第 2 条，**停**。
- 分支 L 下，`official` 条目可能来自 CS 面板也可能来自 SW 批量转录，E3 分不开——不需要分，Step 1 对两者一视同仁。

**结果（用户 2026-09-22）**：用户回报「E3 输出 1228」，按 Step 3 清缓存脚本的返回值（`keys.length`）理解为清掉 1228 条；E3 表本身（尤其 `source` 列）没有回报。条目已删，§2.5 第 2 条从此无法检验 `[UNKNOWN]`。

**E4 — 收藏夹端点：登录态是否返回私密夹、未登录是否返回公开夹（Step 4 收藏夹半边的依据）**
在 bilibili.com 任意页（已登录）的 DevTools Console：

```js
const mid = document.cookie.match(/DedeUserID=(\d+)/)[1];
const u = `https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}`;
const list = async (init) => ((await (await fetch(u, init)).json()).data?.list ?? [])
  .map((f) => ({ id: f.id, title: f.title, attr: f.attr, privateBit: f.attr & 1, count: f.media_count }));
console.table(await list({ credentials: 'include' }));
console.table(await list({ credentials: 'omit' }));
```

对照你自己知道哪些夹是私密的。预期：`include` 列出全部夹且私密夹 `privateBit === 1`；`omit` 只列公开夹或为空（§9.1 追加的 7 个大号未登录全为空，所以「未登录只回公开夹」本身就 `[UNKNOWN]`）。
- `privateBit` 与你的私密夹**对不上** → attr 位规则不成立，Step 4 的过滤改按 E4 观察到的真实字段写。
- `include` 也不返回私密夹 → 「只做公开夹」今天已天然成立，Step 4 的过滤仍加（把事实变契约），但它是零行为变化。

**结果（用户 2026-09-22 + 本机匿名探测）**：`include` 返回 39 个夹，`attr` 只有 0 / 2 / 22，`privateBit` 全 0；`omit` 行未回报，也没有建临时私密夹。匿名 curl 补上了 `omit` 那半边：`list-all` 返回 `data: null`（**未登录一个夹都不给**，§4 否决 `credentials:'omit'` 的理由由推断变实测），而 `attr` 0 / 2 / 22 的夹 `fav/folder/info` 匿名可读 ⇒ 全是公开夹。**这是「本账号没有私密夹」，不是「`include` 不返回私密夹」**——第二个分支不适用，过滤对本账号零行为变化。私密侧没有本账号样本，规则 `attr & 1` 取自外部多源证据（§9.5）；判错的最坏后果是私密夹照旧可见（= 今天），不会误删公开夹（44 个公开样本 bit0 全 0：本账号 39 个 + bilibili-API-collect `list-all` 样例 5 个）。

### Step 1 — 换端点 + 归属校验（修 C1、C4）

**文件**：`lib/bilibili/bilibili-api.ts`，新建 `lib/bilibili/bilibili-api.test.ts`（F19：今天零单测）

**改法**

1. `ENDPOINTS.playerV2` 指向 `https://api.bilibili.com/x/player/wbi/v2`，不签名（落地时键名改为 `playerWbiV2`，免得将来被当成笔误「改回」非 wbi）。
2. `fetchSubtitle` 选定轨道后、拉 CDN 之前校验归属：

```ts
const AI_SUBTITLE_NAME = /\/bfs\/ai_subtitle\/prod\/([^/?]+)/;
/** What follows `{aid}{cid}` in an AI subtitle file name. */
const MD5_HEX = /^[0-9a-f]{32}$/i;

/** AI subtitle files are named `{aid}{cid}{md5}`; any other prefix is another video's track. */
function ownsSubtitleUrl(url: string, aid: unknown, cid: number): boolean {
  const name = AI_SUBTITLE_NAME.exec(url)?.[1];
  if (!name) return true; // uploader CC lives at /bfs/subtitle/<hash>.json and names no owner
  const owner = `${aid}${cid}`;
  return name.startsWith(owner) && MD5_HEX.test(name.slice(owner.length));
}
```

   `aid` 取同一响应的 `playerData.data.aid`（§9.1 实测它是请求的回声，但测到的只是未登录、字幕块为空的响应；字幕块给错时 aid 是否仍是回声没有观测——yt-dlp 样本只贴了 `subtitle` 块。安全性不依赖它：`cid` 取请求参数，外来轨道的 `{aid'}{cid'}` 无论 aid 取自哪里都对不上，aid 不是回声的最坏后果只是自有轨道被误拒）；`cid` 用请求参数，不用响应里的。`aid` 缺失时前缀必然对不上 → AI 形态的 URL 一律拒收，**天然 fail-closed，不需要额外分支**。不去解析 `^\d+` 再切——md5 可能以数字开头（F10 错 #1 就是），贪婪匹配有歧义；只做前缀 + 尾巴形状比较。

   **2026-09-22 勘误**：初稿写的是 `const MD5_HEX_LENGTH = 32` + 总长比较。这个常量放进 `lib/bilibili/` 会让 `tests/platform-env-constants-guard.test.ts` 锁 1 变红（平台目录禁止模块级 SCREAMING_CASE 裸数值常量，白名单是文件级的）；该守卫自己的注释把正则列为刻意不走 env 的协议常量，所以尾巴改用正则。两者等价（剩余部分恰为 32 位 ⇔ 总长 = 前缀 + 32），正则还多校验了 hex。没有走「把 `bilibili-api.ts` 加进白名单」——文件级白名单会让这个文件将来的调参常量也一并逃过守卫。
3. 校验失败返回现有的 `{ status: 'error', … }`，并 `console.error` 打出「请求的 aid+cid / URL 声称的前缀」。不新增状态成员：SW adapter 对 `error` 重试两次后落 ASR，CS 对 `error` 重试后显示转录按钮——**错判的代价是一次 ASR，漏判的代价是数据损坏**，所以硬拒收。

**测试（先红后绿）**：在全局 `fetch` 边界 stub（初稿写「mock `fetchWithDeadline`」；落地时改为边界 stub，真实的 `fetchWithDeadline` 照跑）

| 用例 | 今天 | 修后 |
|---|---|---|
| player 响应的 `subtitle_url` 前缀是别的 `{aid}{cid}` → 不产出 rows，且**不请求 CDN** | 红（返回外来 rows） | 绿 |
| 请求的 URL 是 `https://api.bilibili.com/x/player/wbi/v2?bvid=…&cid=…`（全等，顺带锁住不签名） | 红 | 绿 |
| 前缀匹配 → 正常返回 rows | 绿 | 绿 |
| 前缀匹配、md5 以数字开头（第二来源样本）→ 正常返回 rows | 绿 | 绿 |
| `/bfs/subtitle/<hash>.json`（UP 主 CC）→ 放行 | 绿 | 绿 |
| `data.aid` 缺失 + AI 形态 URL → 拒收 | 红 | 绿 |
| 请求的 `{aid}{cid}` 恰是自有文件名的严格前缀（尾巴 35 位）→ 拒收 | 红 | 绿 |

第一例就是 PRD Acceptance Criteria 的「根因被一个先红后绿的测试锁住」。夹具是真实的一组：yt-dlp PR 请求的 `BV1hcmhY8EbB` / aid `113470703931990` / cid `26731938624`，自有 URL 取 wbi 返回的那条，外来 URL 取旧端点对**同一请求**真实返回过的 #1（F10）；数字开头样本取第二来源；上传者 CC 与前缀碰撞两例是合成的。最后一例是落地时补的：前五例只比 `startsWith` 也能全绿，只有它锁住尾巴那一半（变异检查：改成只比前缀，恰好它一例变红）。

**验证**（顺序不能乱，见 §5）：
1. 重新加载扩展，确认跑的是含 Step 1 的构建；
2. Step 3：清 `vc:bilibili:*`（**清之前先跑 E3**：E3 读的正是这一步要删的条目，删完证据就没了；Step 3 自己的验证「重跑 E3 应为空表」也假定 E3 先跑过）；
3. E1 的 `wbi/v2` 半边在 5+ 个视频上恒为 `OWN` / `UNCLAIMED` / `NOT-AI-URL` / `(none)`（E1 判据已与代码同一条；`UNCLAIMED` 自 Step 1b 起）；
4. E2 的 `code` 列全为 0——Step 1 起 SW 批量转录也走无签名的 `wbi/v2`，这一条确认 SW 上下文没被风控；
5. 打开 5 个视频，面板字幕与视频内容一致；app.html 抽样转录，标题与正文匹配（PRD AC 第 5 条）。

**回滚**：单文件 revert。

**落地记录（2026-09-22）**：改动只有 `lib/bilibili/bilibili-api.ts` + 新建 `bilibili-api.test.ts`（7 例）+ 两份目录 CLAUDE.md。红态在改实现之前跑：`3 failed | 3 passed (6)`，外来前缀那例的失败输出就是 bug 本身（别的视频的字幕以 `status:'ok'`、`source:'official'` 返回）；补上第 7 例后在原实现上重跑为 `4 failed | 3 passed (7)`。绿态 7/7。`pnpm compile`、`pnpm test`（200 文件 / 1544 例 + `packages/favbase` 10 / 56）、`pnpm build`（background graph 13 modules，无 PGlite 标记）全绿；产物里新端点与拒收日志同时出现在 SW 引用的 chunk 与 `content-scripts/bilibili-video.js`，两个调用方（F15）都带上了修复。运行时复核（上面 1-5）待用户执行。

**运行时复核进度（2026-09-22 晚）**：第 1 条已由产物核对——`.output/chrome-mv3` 构建于 16:32 UTC（`b9a0a40` 提交后 12 分钟），`content-scripts/bilibili-video.js` 与 SW 引用的 `chunks/format-*.js` 同时含 `x/player/wbi/v2` 与拒收日志，`x/player/v2?` 只剩 defuddle 的休眠回退（`chunks/use-bookmark-extraction-*.js`，见 Step 1 末段）；用户确认该构建已装入 Chrome。第 2-5 条全部要在浏览器控制台里做（本会话无浏览器自动化，Bridge 的四个 Knowledge Tool 也只读），待用户执行；第 5 条的 app.html 半边由用户触发转录、经 CLI `get` 比对标题与正文。

**2026-09-22 再追加**：第 2 条已做（清掉 1228 条，但 E3 未判读，见 E3「结果」）；第 4 条已过（E2 `code` 四行全 0）。第 3 条（E1）与第 5 条（重新抽样）仍待用户。

**2026-09-23 追加（§9.6）**：第 3 条已跑，只跑了 1 个视频：原始轨符合预期，翻译轨暴露出 Step 1b。第 5 条的 app.html 半边已由全库导出完成，而且比抽样更强——数据库在 2026-09-23 11:36 UTC 整库重建过（怎么重建的 `[UNKNOWN]`，导出里所有行的 `createdAt` 都不早于这个时刻），因此导出里的 123 条 B 站正文全部写于重建之后：零扇入，零「字幕结束时刻超过视频时长」，标题与正文逐条比对 123/123 吻合；09-17 的错配样本 `BV1XN416DEeR` 现在是它自己的正文。面板半边用户没有单独回报。重建时装在 Chrome 里的是哪个构建，用户没有回报（扩展的加载路径没有核对）；但 123/123 这个结果本身就排除了旧代码 `[推论]`：旧代码的 SW 批量路径走的是已登录的 `v2`，E1 实测它 8 次里有 5 次给外来轨道，这个比率下 123 条全对的概率可以忽略。

### Step 1b — 裸名翻译轨放行 + 整表校验（修 Step 1 的误拒；**2026-09-23 已落地**）

**起因**：E1（§9.6）里，`wbi/v2` 给出的本视频机器翻译轨（`ai-en`/`ja`/`es`/`ar`/`pt`），文件名是裸 32 位 hex、不带 `{aid}{cid}`，被当时的规则判成了外来轨。规则的本意是比对文件名里声明的归属，结果把「没声明」读成了「声明了别人」。Step 1 的代码只校验选中的中文轨，所以中文原声视频不受影响（§9.6 的 123/123）。非中文原声视频的中文翻译轨会被误拒：SW 批量路径重试两次后落 ASR，CS 面板显示失败 `[推论]`。

**决策（用户 2026-09-23）**：改规则，**否决** E1 预案里的「降为仅日志」。降级会让归属校验的拦截能力归零，而证据只说明「没声明」被判错了，对「声明了归属」的判断没有问题。任务：`.trellis/tasks/09-23-bilibili-machine-translated-ai-subtitle-tracks-are-refused-as-foreign/prd.md`。

**改法**（`lib/bilibili/bilibili-api.ts`）：
1. `ownsSubtitleUrl`：文件名恰好是 32 位 hex 的，与上传者 CC 一样视为不声明归属，放行（`if (!name || MD5_HEX.test(name)) return true`）。其余规则一字不改：前缀加尾巴形状，`aid` 缺失时凡声明了归属的名字一律 fail-closed。
2. `fetchSubtitle`：选轨之前先对**每一条**轨校验（`subtitle_url` 为空的跳过），任一条声明属于别的视频就整批拒收，日志点名那条轨。只校验选中轨不够：第 1 条放行裸名之后，外来响应里被选中的中文轨可能恰好是不声明归属的翻译轨，只有旁边的原始轨能说出这批轨道是谁的。选轨规则不变。E1 没有检验到这一条：`v2` 的 5 次外来响应都是**单条**带外来前缀的 `ai-zh`，被选中的就是那条声明了外来归属的轨，只校验选中轨也拒得掉。「外来响应会带上那条有前缀的原始轨」是 `[推论]`，没有观测过，见下面的「残留」。

**测试**（`bilibili-api.test.ts`；夹具是两份真实数据的拼接：裸名取自 E1，原始轨沿用 yt-dlp 那组，合成的 `auth_key` / `lan_doc` 在文件头注释里逐项标明）

| 用例 | 今天 | 修后 |
|---|---|---|
| A：选中的中文轨是裸名翻译轨，旁边是自有的英文原始轨 → 放行，并向 CDN 请求这条中文翻译轨 | 红 | 绿 |
| B：E1 的真实形态，自有 `ai-zh` 加五条裸名翻译轨 → 放行 | 绿 | 绿 |
| C：外来的英文原始轨加裸名中文翻译轨 → 拒收，不碰 CDN，日志点名外来轨、不带 `auth_key` | **红** | 绿 |

C 的「今天」在任务 PRD 里预测为绿，理由是旧代码也会拒收，只是拒错了理由。实际是红：断言要求日志点名外来轨，而旧代码点名的是那条裸名中文轨。这正是它能区分「拒对了」与「拒错了理由」的地方。

**落地记录（2026-09-23）**：
- 红态（只加测试、实现不动）：`2 failed | 14 passed (16)`，红的是 A 和 C。绿态 16/16，原有 13 例一例未改。
- 变异检查（每次只改一处、跑完还原）：去掉裸名豁免 → `2 failed | 14 passed`（A、B 红）；只校验选中轨 → `1 failed | 15 passed`（只有 C 红，外来响应被放行）。
- `pnpm compile` 通过；`pnpm test` 200 文件 / 1555 例（Step 4 之后是 1552，+3），加上 `packages/favbase` 10 / 56，首次全量即全绿；`pnpm build` 的 background graph 为 13 modules / 946552 bytes，无 PGlite marker。整表校验与裸名豁免同时出现在 SW 引用的 chunk 和 `content-scripts/bilibili-video.js` 里，两个调用方（F15）都覆盖到了。

**附带的行为变化**（都符合上面的规则）：
- 选中轨 URL 为空、而另一条轨声明外来归属时，以前返回 `no_subtitle`，现在返回 `error`。
- `aid` 缺失、而表里只有裸名轨时，现在放行，因为没有任何轨声明归属。
- 拒收日志打印的是原始的 `//aisubtitle…` 形式，不再补 `https:`。

**残留（放行裸名的代价）**：一张表里没有任何轨声明归属（只有裸名轨，或裸名轨加上传者 CC）时，整批放行，外来的也照收，而且不打日志。这是代码的实际行为，不是推论。会不会真的发生是 `[推论]`：E1 里 `v2` 的外来响应都是单条 `ai-zh`；如果外来池对非中文原声视频也只给它的 `ai-zh`，那条就是裸名翻译轨，表里没有别的轨能说出它是谁的。它只在端点本身给错时才会发生，而 `wbi/v2` 在 E1 里 8/8 是自有的。收紧的办法：要求表里至少一条 AI 轨声明本视频的 `{aid}{cid}`，否则连裸名一起拒收。代价是：如果非中文原声视频的 `wbi/v2` 不带原始轨，这类视频会被全部误拒，而这一点没有观测过。先跑下面那次 E1，**是否收紧由用户决定**（§7）。

**仍然 `[UNKNOWN]`**：非中文原声视频的轨道表长什么样没有观测过——是否原始轨带前缀、中文翻译轨是裸名，以及中文翻译轨的 `lan_doc`。下次跑 E1 时挑一个非中文原声的视频，预期是 `ai-<原语言>:OWN`，`ai-zh:UNCLAIMED`；`wbi/v2` 的表里有没有那条带前缀的原始轨，决定上面的「残留」能不能收紧。
**回滚**：单 commit revert。回滚后回到「中文原声视频不受影响、非中文原声视频的中文翻译轨被误拒」。

### Step 2 — 不动竞态（对 C3 的处置）

**不改 `useSubtitle.ts`。**

C3 之所以有害，是因为两个通道给的内容不一样、而错的那个先到。Step 1 之后两个通道给的是同一份字幕，谁先到都一样。这是「修对数据源，让特殊情况消失」，而不是给竞态再加一层仲裁。

改 `resolved` 语义（允许后到的拦截结果覆盖）会让面板在 3-4 秒处重渲染一次，是对现有体验的无谓改动。

### Step 3 — 开发机手工清一次旧缓存（零代码；PRD Decision 1 的「cache 必须清」）

**初稿在这里设计了 `rev` 字段 + 读时失效 + 新测试文件，已否决**（§4 末行）：扩展尚未上线，装着脏缓存的浏览器只有开发机这一台。不为它写代码。

**时机**：Step 1 合入并重新加载扩展**之后**、验证**之前**（顺序约束见 §5）。

**做法**（二选一）：

- **保留设置，只清字幕缓存**（推荐）。`chrome://extensions` → favbase → 「Service Worker」Console：

  ```js
  const keys = Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('vc:bilibili:'));
  await chrome.storage.local.remove(keys);
  keys.length; // 清掉的条数
  ```

  SW 的内存缓存会跟着清——`initCacheStorageListener` 在条目被删时执行 `memoryCache.delete`（`video-cache.ts:238`），不需要重启 SW。AI 总结缓存（`vs:`）不用管，它按字幕 `rawHash` 寻址，字幕重取后旧总结自然不再命中（F20）。
  按 H5 只有 `source:'official'` 的条目有嫌疑，但既然旧数据一概不要（§8 Q1），没必要挑，全清。

- **整个重来**：移除扩展重装。缓存、脏正文、旧总结一次清空；代价是 API key 等设置要重填、Agent Bridge 要重新配对。

**验证**：重跑 E3 应为空表；随后打开一个曾错配的视频页，E3 出现新条目且 `head` 与视频内容相符。
**回滚**：无。被删的就是要丢的。

### Step 4 — 把 B 站 API 的登录态写成显式意图，并让「只做公开收藏夹」成为代码（独立 PR；前置 E2 + E4，**2026-09-22 均已满足**：E2 = 分支 L，E4 见其「结果」）

**用户 2026-09-22 决定**：(a) 收藏夹 API 并入本步（§8 Q5）；(b) favbase 暂不做私密收藏夹，只针对公开夹。

**文件**：`bilibili-api.ts`、`bilibili-transcription-adapter.ts`、`useSubtitle.ts`、`useVideoDetect.ts`（后两个只是实参不变的编译对齐）、`bilibili-api.test.ts`（Step 1 新建）

**改法**

1. **字幕 + pagelist（SW 与 CS 共用）**：`buildFetchInit(auth?)` 删除，两个函数恒用 `{ credentials: 'include' }`。`auth?` 对请求已无影响——**从 `fetchSubtitle` / `fetchCidByPageList` 的签名里删掉**，CS 与扩展页两条分支合成一条；`prepareBiliTranscription` 不再调 `getBiliAuth()`。改签名须同步全部调用点（F15 已列全）。同仓库先例：zhihu（F18）。E2 落在分支 L → 零行为变化的显式化；分支 U → 修复。
2. **收藏夹（app.html）**：`fetchFavFolders` / `fetchFavVideos` 的 `headers: { Cookie }`（`bilibili-api.ts:87`、`:119`）同样换成 `{ credentials: 'include' }`。**必须保持登录态**：§9.1 追加实测显示未登录 `list-all` 返回空，不能靠 `credentials:'omit'` 让服务端只回公开夹（§4 已否决）。`getBiliAuth()` 保留——`up_mid` 需要 `auth.mid`，且 `-101` → `BiliAuthError` 分支（`bili-sync-service.ts:60` 与两个 app hook 在消费）继续有意义。
3. **只做公开收藏夹**：`fetchFavFolders` 返回前过滤掉私密夹（私密位规则以 E4 观察为准，社区记忆是 `attr & 1`）。放在 API 层而不是 sync-service：「favbase 看得见哪些夹」是平台事实，`fetchAndSyncFolders` 与 `fetchFavoriteVideosPage` 都不该再看到私密夹。已同步进 DB 的私密夹条目不追溯（Decision 4：旧数据不管；insert-only 也不会删）。

`need_login_subtitle: true` 目前被当成 `no_subtitle`。本步只加一行 `console.warn`，**仍然降级 ASR**（与今天行为一致）。是否在 UI 上提示是产品决策，见 §8 Q4。

**行为变化**：
- 分支 U：批量转录开始拿到官方字幕，ASR 调用大幅减少，新正文来源从 asr 变 official。请求量不变。
- 分支 L：字幕/pagelist 零变化。
- 两个分支共同：若你的账号有私密夹，它们从收藏夹列表消失——这正是产品决定要的结果。

**测试（先红后绿）**：`bilibili-api.test.ts` 断言四个函数的 init 都是 `credentials:'include'` 且 headers 不含 `Cookie` key；`need_login_subtitle` 响应 → `no_subtitle`；`list-all` 夹具含私密位置位的夹 → 不出现在返回值里，未置位的保留（具体 attr 取值以 E4 观察为准，写进夹具注释）。
**验证**：分支 U 下 app.html 手动转录一个有 AI 字幕的视频，Console 出现 `[bili-sync] Persisted … (source=official)`；两个分支下 B 站收藏页重新同步后私密夹不再出现。
**回滚**：单 PR revert。字幕半边回到今天的状态（分支 U 下即「全走 ASR」）；收藏夹半边回到「私密夹可见」。

**落地记录（2026-09-22）**：E2 = 分支 L，所以字幕/pagelist 半边是零行为变化的显式化，commit message 不写「修复」；唯一的行为变化是私密夹从收藏夹列表消失（本账号无私密夹，对它零变化）。

- **改动**：`bilibili-api.ts`（删 `buildFetchInit`；五个请求——player、字幕 CDN、pagelist、`list-all`、`resource/list`——一律 `{ credentials: 'include' }`；`fetchSubtitle(bvid, cid)`、`fetchCidByPageList(bvid, pageNum = 1)` 删 `auth?`；`fetchFavVideos(mediaId, …)` 删 `auth`；`fetchFavFolders(auth)` 保留 `auth` 并经 `isPublicFolder`（`(attr & 1) === 0`，注释指向 §9.5）过滤；`need_login_subtitle` 一行 `console.warn`）、`bilibili-transcription-adapter.ts`（不再调 `getBiliAuth()`）、`bili-sync-service.ts`（两处 `fetchFavVideos` 调用去掉 auth，`await checkAuth()` 作为无网络的登录门保留）、两个测试文件。`useSubtitle.ts` / `useVideoDetect.ts` 本就不传 auth，**未改**，`tsc` 通过即对齐。
- **红态**（先写测试、在原实现上跑）：`bilibili-api.test.ts` `4 failed | 9 passed (13)`，`bili-sync-service.test.ts` `1 failed | 3 passed (4)`。红的五例：`fetchFavFolders` / `fetchFavVideos` 的 credentials、公开夹过滤（返回了 `[1, 2, 3, 4, 5]`）、`need_login_subtitle` 的 warn、sync-service 对 `fetchFavVideos` 的调用实参（首参是 auth 对象）。**改前改后皆绿的三例及理由**：`fetchSubtitle` / `fetchCidByPageList` 的 credentials——CS 的调用形式本就不带 auth、早已走 `credentials:'include'`，SW 那一半的变化是签名删除，由 `tsc` 守；sync-service 新增的「未登录即拒、零请求」——锁的是保留下来的 `await checkAuth()`，它不再产出被消费的值，看上去像死代码。绿态 17/17。
- **变异检查**（各自单独改一处、跑、还原）：过滤改成 `attr & 2` → 只有夹具那一例红（`1 failed | 12 passed`）；给 `fetchFavVideos` 在 `credentials:'include'` 旁再塞 `headers: { Cookie }` → 只有它那一例红，且红在 `Cookie` 断言上——证明断言按调用方写下的 header 名读、没被 happy-dom 的 `Headers` 吞掉 forbidden `Cookie`；删掉 `syncAllFavoriteVideos` 的 `await checkAuth()` → 只有登录门那一例红（`1 failed | 3 passed`）。
- **验证**：`pnpm compile` 0；`pnpm test` 200 文件 / 1551 例（Step 1 时 1544，+7）+ `packages/favbase` 10 / 56 全绿——第一次全量跑有 8 个 PGlite 套件在 `beforeAll` 超时（10 s，并行负载，与本改动无关，单独重跑 8/8 文件 78 例全绿），第二次全量全绿；`pnpm build` 通过，background graph 13 modules / 946495 bytes、无 PGlite 标记。产物里 `need_login_subtitle` 同时出现在 SW 引用的 `chunks/format-*.js` 与 `content-scripts/bilibili-video.js`，`SESSDATA=` 全产物零命中；`grep -rn Cookie lib/bilibili` 只剩注释、测试散文与 `getBiliAuth` 的局部变量名，零 header 构造。
- **与计划的出入**：(1) 无参的 `createFetchOfficialSubtitle()` 不留——一个什么都不捕获的工厂只是间接层，改成模块级函数 `fetchOfficialSubtitle` 直接挂进返回值，重试逻辑逐字不变；(2) 测试多了一例（登录门，理由见上）；(3) credentials 断言是一个 `it.each` 覆盖四个函数、五个请求，而非四个独立用例。
- **trellis-check 追加（2026-09-22）**：(1) `bili-sync-service.test.ts` 补 `fetchFavoriteVideosPage` 的登录门一例——`lib/bilibili/CLAUDE.md` 写的是「两个调用方」的 `await checkAuth()` 都被锁住，实际只锁了 `syncAllFavoriteVideos`；而浏览页这道门更要紧：公开夹的 `resource/list` 匿名可读（§9.5），删掉它，登出用户照样看到内容且 hook 报 `logged_in`。门在 Step 4 之前就在，所以改前改后皆绿；变异（删掉该 `await checkAuth()`）→ 只有它红（`1 failed | 4 passed`）。(2) credentials 断言的 `writtenHeaderNames` 原来只做 `Object.keys`：`[['Cookie', …]]` 读成 `['0']`、`new Headers({ Cookie })` 读成 `[]`，两种写法都让断言空转；改为读三种 `HeadersInit` 形状。原注释「happy-dom 的 `Headers` 可能吞掉 `Cookie`」不成立（测试环境实测 `new Headers({ Cookie, Accept }).keys()` 为 `['Cookie', 'Accept']`），已改。变异（CDN 请求分别塞数组形、`Headers` 形 `Cookie`）→ 各自只红 `fetchSubtitle` 那一例。(3) 过滤 / pagelist 另做了三处变异复核（`isPublicFolder` 恒真、CDN 请求塞对象形 `Cookie`、pagelist 去掉 `credentials`），各自只红目标用例。合计：`bilibili-api.test.ts` 13 + `bili-sync-service.test.ts` 5 = 18/18；`pnpm compile` 0；`pnpm test` 200 文件 / 1552 例 + `packages/favbase` 10 / 56，首次全量即全绿；`pnpm build` background graph 13 modules / 946495 bytes、无 PGlite 标记，过滤 `(e.attr&1)==0` 在 SW 引用的 `chunks/format-*.js` 里。
- **运行时复核（待用户）**：建一个临时私密夹 → B 站收藏页重新同步 → 它不出现（这是「确实拦住私密夹」这一侧唯一的本机证据，§7）；app.html 手动转录一个有 AI 字幕的视频 → Console 出现 `[bili-sync] Persisted … (source=official)`。
- **运行时复核结果（用户 2026-09-23，§9.6）**：用户建了临时私密夹「测试私密文件夹」，登录态 `list-all` 返回它的 `attr: 3`，也就是 bit0（私密）+ bit1（非默认夹），与 bilibili-API-collect 的位表一致。这是 `attr & 1` 规则在本账号上的**第一份私密样本**，它成立。app.html 收藏夹页里这个夹是否真的被隐藏，用户的回报（「成功检测到了」）无法区分，记为 `[UNKNOWN]`；按上面的规则与 `isPublicFolder` 的单测，它应当被滤掉。手动转录那一条没有做成：用户回报 B 站页面上的插件转录失败，并指示不追查（不在本任务范围）。如果当时 Console 里出现针对非中文视频的 `Refusing subtitle`，那就是 Step 1b 修掉的误拒，否则是另一个问题。

### Step 5 — 正文来源落库（修 C6；**2026-09-24 已落地**，独立任务 `09-24-transcript-origin-column`）

原文（当时不在本任务）：给 `item_contents` 加来源列需要一个迁移。它能让下次排查不再栽在 C6 上，但对本次修复不是必需。见 §8 Q3。

任务：`.trellis/tasks/09-24-transcript-origin-column/prd.md`。任务 slug 里的 origin 是被否决的叫法（见下面第 2 条），目录归档后不改名。

**改法**：
- 新建迁移 `lib/database/migrations/v006-subtitle-source.ts`：给 `item_contents` 加可空列 `subtitle_source TEXT` 和具名约束 `CONSTRAINT chk_subtitle_source CHECK (... IN ('official','asr'))`。`IF NOT EXISTS` 保证幂等。
- `lib/database/entities/item-contents.ts`：加 `subtitleSource: text('subtitle_source').$type<SubtitleSource>()`，并用 `check('chk_subtitle_source', …)` 再声明一次。
- `lib/ingest/ingest.ts`：`persistExistingItemContent` 加必填第 6 参 `subtitleSource: SubtitleSource | null`，insert 与 `onConflictDoUpdate.set` 都写它。`persistItemContent` 的 insert 与 set 都显式写 `subtitleSource: null`。
- `lib/bilibili/bili-sync-service.ts`：`persistContentChunks` 把已有的 `source` 参数透传为第 6 参。原来的 `console.info` 保留。

**从代码里看不出来的决策**（用户 2026-09-24）：
1. **只覆盖转录正文。** 其余五个平台各自只有一种正文来源（README、推文、知乎正文、YouTube 简介、网页提取），平台本身就能推出来，存进库里就是冗余数据。所以这一列可空，NULL 表示「不是转录」。否决的方案：六个平台都用 NOT NULL 声明来源，那要改 `IngestInput` 和六个 sync-service。
2. **列名沿用 source，否决 origin。** 代码里这个概念已经有 20 多处叫 source：类型、缓存字段、消息协议、i18n 的 `source.*`、卡片的 `sourceCC`/`sourceASR`。如果库里叫 origin，同一个概念就在库里和 TS 里用两个词。它和收藏夹、播放列表那种 **Source** 不是一回事，`CONTEXT.md` 的 Flagged ambiguities 已加一条说明。
3. **seam 必填、可为 null、无默认值。** 如果是可选参数，漏传的调用方只会静默写 NULL，而 C6 本身就是一个被静默丢掉的来源。如果类型不允许 null，这个通用 seam 就只能给转录用。
4. **不变量：每次写 `plain_text` 都同时写 `subtitle_source`。** 三条写入路径都遵守：B 站转录，以及经 `persistItemContent` 的 ingest phase 5、ghost sweep、bookmarks 提取。所以旧的来源活不过它所描述的正文。
5. **旧行不回填**（沿用 §8 Q1）。B 站正文全是转录，所以「B 站 + NULL」只可能是 v6 之前写入的行，不会和「不是转录」混淆。要干净数据就重建库。
6. **读取方只有数据库导出。** 导出的列由 schema 派生，加列后自动带上。卡片 CC/ASR 徽标改读 DB、Knowledge Tool 暴露这一列，都记为后续，不在本任务。
7. **不记录缓存命中**（`cached: true`）。Step 1 之后两个入口走同一个 `fetchSubtitle`，缓存是谁写的已经没有诊断价值。

**红态**（实现回到 HEAD，测试不动）：`ingest.test.ts` `5 failed | 10 passed (15)`，`bili-sync-service.test.ts` `2 failed | 5 passed (7)`，`export-schema-sync.test.ts` `1 failed | 3 passed (4)`，合计 `8 failed | 18 passed (26)`。红因逐条核对过：
- ingest 前四例（记录 asr、再写替换、写 null、`persistItemContent` 清空）：旧实现照样写入成功（JS 忽略多出的实参），四例都红在回读上，PG 报 `42703 column "subtitle_source" does not exist`。这说明它们在旧代码上只能证明「列不存在」，分不开彼此；分开它们靠下面的变异检查。
- CHECK 一例：报错是 `column "subtitle_source" of relation "item_contents" does not exist`，不匹配 `/chk_subtitle_source/`，红的理由是对的。
- bili-sync 的 `it.each` 两例：mock 只收到 5 个实参，缺第 6 个。
- export 一例：表头是 `[itemId, plainText, createdAt, updatedAt]`，没有 `subtitleSource`。

恢复实现后 26/26。

**变异检查**（每次只改一处，跑完还原）：
- 删掉 `persistExistingItemContent` 的 `set` 里的 `subtitleSource`：`1 failed | 25 passed`，只有「replaces the subtitle source together with the text」红。
- 删掉 `persistItemContent` 的 `set` 里的 `subtitleSource: null`：`1 failed | 25 passed`，只有「persistItemContent clears a subtitle source」红。
- 删掉 `persistItemContent` insert `values` 里的 `subtitleSource: null`：26/26 绿，符合预期。它和列的默认值 NULL 等价，保留它只是为了把不变量写明，不为它加测试。
- `persistContentChunks` 固定传 `null`：`2 failed | 24 passed`，`'official'`、`'asr'` 两例都红。

**验证**：
- `pnpm compile` 通过（exit 0）。
- `pnpm test`：200 文件 / 1568 例，加上 `packages/favbase` 14 / 140，首次全量即全绿。1568 的来历：Step 1b 时是 1555；docs/27 Step 6（`71899a3`）在主仓库测试里净增 5 例（按新增、删除的 `it(` 行数算，与 1568 对得上），所以 HEAD 是 1560；本任务 +8。`packages/favbase` 从 10 / 56 变成 14 / 140 来自 docs/27 Step 6 与 Step 2（`b0072c0`），与本任务无关。
- `pnpm build`：background graph 13 modules / 947103 bytes，无 PGlite marker。entity 经 `lib/chat/tools.ts` 的 schema leaf 进了 SW 引用的 `chunks/protocol-*.js`。`SubtitleSource` 是 type-only import，编译后擦除；`check`/`sql` 在 `items.ts` 里本来就在用。
- v006 的 SQL 在 PGlite 里连跑两次，仍只有一个 `chk_subtitle_source` 约束；写入 `'foo'` 会被这个具名约束拒绝。
- 顺带发现：v001 的 `content_state` CHECK 是行内匿名写法，库里实际叫 `items_content_state_check`，和 entity 声明的 `chk_content_state` 对不上。任务 PRD 决策 6 说 v006「按它的先例」写，实际 v006 在 SQL 里具名，两边同名，没有沿用这一点。v001 不改。

**运行时复核（待用户）**：重新加载扩展，确认 `_migrations` 里有 version 6。然后在 app.html 手动转录一个视频，导出数据库，看那一行的 `subtitleSource`。

**回滚**：代码可以单 commit revert，但迁移只要在开发机上跑过一次，revert 就撤不掉它，见 §7 末行。

### Step 6 — ~~修复已落库的脏正文~~（已取消）

用户 2026-09-21 决定：不管旧数据（§8 Q1）。库里的脏正文是测试数据，需要时移除扩展重装即可，不为它设计修复路径。PRD Definition of Done 里的「数据修复路径对用户可见、可回滚」随之不再适用。

---

## 7. 风险与回滚

| 风险 | 影响 | 处置 |
|---|---|---|
| `{aid}{cid}{md5}` 规则来自外部样本（初稿 3 份，其中正确的只有 1 份；2026-09-22 补到 7 份正确样本、两个独立来源，7/7 成立，F10） | 规则不普适时，正确字幕被拒收 → 多花一次 ASR，**不会损坏数据** | E1 在 5+ 视频上复核；不成立则降为仅日志。**2026-09-23**：E1（1 个视频）确认原始轨规则成立，但发现机器翻译轨是裸 32 位 hex、不带前缀，被误判为外来；改规则（Step 1b），而不是降级 |
| AI 字幕 URL 换了形状（不在 `/bfs/ai_subtitle/prod/` 下，或 `subtitle_url` 改成 `subtitle_url_v2` 那种混淆串） | `ownsSubtitleUrl` 把它当作无归属信息的上传者 CC 放行，归属校验**静默失效**、不打任何日志（2026-09-22 复核探针实测：`/bfs/ai_subtitle/test/<外来名>` 与 `//subtitle.bilibili.com/<混淆串>` 都放行）；换端点那一半不受影响 | E1 的 `NOT-AI-URL` 计数突增就是信号。收紧有两档：「含 `ai_subtitle` 却不合形状即拒收」是一行改动，只堵前一种；连混淆串也堵就得改成「只放行已知的上传者 CC 形状」，而上传者 CC 的真实 URL 样本一份都没有（任务 research 证据文件 §6）。7/7 样本都是 `prod` 形状，今天没有证据需要收紧——**是否收紧由用户决定** |
| 外来响应里没有任何轨声明归属：只有裸名轨，或裸名轨加上传者 CC（Step 1b 起裸名放行） | 外来正文照收，不打日志。会不会发生是 `[推论]`：E1 里 `v2` 的外来响应都是单条 `ai-zh`，如果外来池对非中文原声视频也只给 `ai-zh`，那条就是裸名 | 只在端点本身给错时发生，`wbi/v2` 在 E1 里 8/8 自有。收紧办法与代价见 Step 1b「残留」，**是否收紧由用户决定** |
| B 站日后对 `wbi/v2` 强制签名；或 SW 上下文今天就被拒（没有 B 站页面 `Referer`，F8 只测过带 Referer 的 curl） | 字幕请求 -352/-403 → `error` → 降级 ASR，功能不坏 | E2 的 `code` 列先验 SW 上下文（**2026-09-22 已过：四行全 0**）；届时再实现签名；`fetchSubtitle` 已检查 `code !== 0` |
| ~~SW 里 `credentials:'include'` 带不上 cookie（E2 D 列为 0）~~ **已排除：E2 D 列为 uid** | Step 4 字幕半边无效 | 预案二选一：DNR 会话规则补 `cookie` header（F5 那个项目的做法，DNR 的 `cookie` 在 append 白名单内）；或把官方字幕请求挪到 app.html 发（F18 已证明扩展页可行）。**现在不设计，E2 失败再说** |
| 合了 Step 1 但验证前忘了清本机缓存 | `pipeline.ts:88` 命中脏条目，症状原样复现，**会被误判成「修复无效」** | §5 顺序约束；Step 3 的验证第一步就是 E3 为空表 |
| 将来上线后才发现又有一类脏缓存 | 届时才有真实用户需要保护 | 到那时再写失效机制。现在写是给零个人写的 |
| 私密夹的 `attr` 位规则来自社区记忆，未经本机验证 | 过滤漏掉私密夹或误删公开夹 | E4 用你自己的夹对照后再写夹具，夹具注释记下观察到的取值。**2026-09-22**：「误删公开夹」一侧已排除（44 个公开样本 bit0 全 0：本账号实测 39 个 + bilibili-API-collect `list-all` 样例 5 个）；「漏掉私密夹」一侧本账号无样本，靠 8 个独立实现 + 1 份真实私密样本（§9.5），落空时退回今天的行为。Step 4 运行时验证请用户建一个临时私密夹复核。**2026-09-23**：用户建的临时私密夹 `attr: 3`，bit0 置位，「漏掉私密夹」一侧有了本机样本；app.html 是否真把它隐藏了仍 `[UNKNOWN]`（§9.6） |
| 分支 L 下 Step 4 的字幕半边是零行为改动 | 无风险，但 commit message 不得写「修复」 | E2 结果决定措辞——**已定：分支 L** |
| Step 5 的代码被 revert，但迁移 v006 已在开发机上跑过（2026-09-24 追加） | 列和约束留在库里。它们无害：Drizzle 按 entity 的显式列名 select，导出也由 entity 派生，都看不见这一列。但 `_migrations` 仍记着 version 6，而 runner 只按版本号跳过（`lib/database/migrations/index.ts` 的 `applied.has(m.version)`）。之后如果另写一个不同的 v6，在这台机器上会被静默跳过 | 扩展未上线，只影响开发机：重建 DB 即可。不写 down 迁移 |

Step 1–4 的代码步骤都是单 PR revert 可回滚，没有迁移，也没有不可逆的数据写入。Step 5（2026-09-24）是例外：它带迁移 v006，revert 代码撤不掉已经执行过的迁移，见上表末行。

---

## 8. 待用户决策

**Q1 — Decision 1（不动已污染的 DB 数据）要不要复议？** **已答（用户 2026-09-21）：不用管旧数据，只是测试，插件还未上线。**
Decision 1 维持，Step 6 取消。这个回答的影响超出 Q1 本身：**「尚未上线」推翻了初稿里所有以「保护存量用户」为前提的设计**——Step 3 的缓存 `rev` 失效机制（已改为手工清理，§4 末行）、Step 4 排除收藏夹 API 的理由（已作废，见 Q5）。初稿推荐「复议并重转录」的论证同样建立在「这些数据值得救」上，一并作废。

**Q2 — Decision 2（`♪ 音乐 ♪` 不纳入本任务）的前提要不要更正？** 按推荐处理：**更正前提，范围不变。**
证据指向它就是本 bug 的一种表现（§0 表格末行），大概率随 Step 1 自动消失，不需要单独的工作量。E1 里若看到非 wbi 端点发出只含 `♪ 音乐 ♪` 的字幕，即告证实。修复后若仍出现，再另立任务。

**Q3 — Step 5（来源落库）做不做？** 按推荐处理：**本任务不做。** 它的用途是圈定脏数据范围，而脏数据已决定不管。「下次排查不再栽在 C6 上」是真实价值，但不属于本任务，留作独立小任务。
（2026-09-24：后续由独立任务 `09-24-transcript-origin-column` 落地，见 Step 5。）

**Q4 — 未登录时要不要在 UI 上提示？** 按推荐处理：本任务不做，只打 `console.warn`。

**Q5 — `fetchFavFolders` / `fetchFavVideos` 要不要并进 Step 4？** **已答（用户 2026-09-22）：并入；且 favbase 暂不做私密收藏夹，只针对公开夹。**
落地见 Step 4 改法第 2、3 条。两点说明：
- 初稿建议的「两分钟实验：建一个私密夹看 favbase 能不能看到」**方向反了**——它假定收藏夹请求未登录（C5 的推论），而 F24 表明 app.html 的收藏夹请求是登录态，私密夹**大概率今天就在被同步**。实验改为 E4，直接看端点在两种 credentials 下返回什么。
- 「只做公开夹」今天没有任何代码承载（`attr` 只被存进 `platformMeta`），是产品决定先于实现。Step 4 把它写成 API 层一行过滤 + 一例测试（**已落地 2026-09-22**）。zhihu 已有同类先例（`is_public` 过滤，`lib/zhihu/CLAUDE.md`）。已记入 `CONTEXT.md` Flagged ambiguities。

---

## 9. 实测记录

### 9.1 未登录端点行为（2026-09-21，本机 curl，无任何 cookie）

带浏览器 UA 与 `Referer: https://www.bilibili.com/`，请求间隔 1.5-2 秒。

| 视频 | 端点 | 次数 | 结果 |
|---|---|---|---|
| `BV1XN416DEeR` / cid `41389916397`（09-17 样本里的错配条目） | `x/player/v2` | 6 | 全部 `code 0, login_mid 0, subtitles []` |
| 同上 | `x/player/v2`、`x/player/wbi/v2` 各 1 | 2 | 均 `need_login_subtitle: true`，`aid 117177596379784` / `cid` 与请求一致 |
| aid `113470703931990` / cid `26731938624`（yt-dlp #11708 样本，确定有 AI 字幕） | `x/player/v2` | 5 | 全部 `subtitles []` |
| 同上 | `x/player/wbi/v2`（无签名） | 3 | 全部 `code 0, subtitles []` |

结论：未登录**稳定为空**，不出现随机字幕；无签名 wbi 不被拒。`x/web-interface/view` 对 curl 返回 HTML 风控页，未使用。

**2026-09-22 追加（收藏夹端点，未登录）**：`x/v3/fav/folder/created/list-all?up_mid=` 对 7 个 mid（208259 / 946974 / 122879 / 777536 / 517327498 / 37663924 / 1958703906）全部 `code 0, list: []`。无法区分「未登录不返回任何夹」与「这 7 个账号恰好没有公开夹」，7/7 为空让前者更可能；E4 用本人账号裁决。`resource/list` 因拿不到任何 `media_id` 未能测试。

### 9.2 外部来源核对

- yt-dlp #11708：原文已读。三份 `subtitle_url` 样本逐字拆解见 F10。维护者确认该端点无需签名；报告者确认「加 cookie 后 `/wbi/` 工作正常」。2026-09-22 用 `gh api` 复核原文：它是 **PR**（`[ie/bilibili] Fix subtitles and chapters extraction`，已关闭）而非 issue，编号无误；请求的视频 aid `113470703931990` 对应 bvid `BV1hcmhY8EbB`（av→bv 算法先在 6 份已知对上验证过）。
- `Cooper-X-Oak/LongYinMod_RisingFame` 的 `doc/bilibili/raw/subtitles/*.md`：front matter 同时记录 aid、cid、`subtitle_url`，6 份（2026-03）逐条验证归属规则成立。
- bilibili-api #841：原文已读。「获取到的大概率是其他视频的字幕，偶尔也能获取到正确的字幕」，网页端 `x/player/wbi/v2` 正常。issue 至 2025-02 仍 open。
- yt-dlp master `bilibili.py:255-276`：`_get_subtitles` 用 `x/player/wbi/v2`、不调 `_sign_wbi`、读 `need_login_subtitle`。
- `SocialSisterYi/bilibili-API-collect` 已 404，未采用其任何内容。（2026-09-22 补：§9.5 的 `attr` 位证据取自它的镜像——ShiranGit / pskdje，不是原仓库。）

### 9.3 本机只读采集

`favbase doctor`：扩展在线。`favbase coverage --platform bilibili`：acquisition 494，content 27/489，embedding 0/27，tagging 0/27，与 PRD 09-21 记录一致。
注意：blockers 里没有 `asr` **不说明 ASR 已配置**——Knowledge Tool 侧 `asrBlocked` 恒传 `false`（`lib/collections/CLAUDE.md`）。ASR 是否配置 `[UNKNOWN]`。

**2026-09-22 晚追加**（经 `favbase call getProcessingCoverage --args '{"platform":"bilibili"}'`；本机全局 CLI 0.1.0 没有 `coverage` 别名）：acquisition 1065，content 55/1047，embedding 0/55，tagging 0/55。较 09-21 多出 28 条正文，它们全部落库于 Step 3 清缓存之前，可能是脏缓存命中，按 Decision 1 不追溯；Step 1 验证第 5 条的抽样必须取**仍无正文**的条目，落库后再比对。

### 9.4 尚未证伪的 UNKNOWN

| 项 | 由谁消解 |
|---|---|
| ~~已登录 + 非 wbi 今天对本账号是否仍返回外来字幕~~ | **已消解**：是，`v2` 8 轮外来 5 次（E1 2026-09-23，§9.6） |
| `{aid}{cid}{md5}` 是否对全部 AI 字幕成立（外部 7/7 已成立，F10） | **半消解**：只对视频的**原始语言轨**成立（本账号 1 个视频 8/8）；**机器翻译轨是裸 32 位 hex，不声明归属**（同一视频 5 条，§9.6，Step 1b）。只测了一个中文视频：非中文原声视频的原始轨与中文翻译轨是否同样一个带前缀一个不带、中文翻译轨的 `lan_doc` 是什么，仍然 `[UNKNOWN]` |
| ~~SW 上下文的无签名 `wbi/v2` 是否被风控拒绝~~ | **已消解**：E2 `code` 全 0（F26） |
| ~~SW 字幕请求今天是否登录态（C5 分支 U / L）~~ | **已消解**：分支 L，jar 默认附带（F26） |
| ~~SW 里 `credentials:'include'` 是否带得上 B 站 cookie~~ | **已消解**：E2 D 列 = uid（F26） |
| 8 条错配的缓存条目是否全为 `official` | **永久 `[UNKNOWN]`**：E3 未判读，条目已随 Step 3 清空 |
| 09-21 那 8 条对应的视频，用户重装后是否都打开过 | 用户回忆；§2.5 第 3 条（分支 L 下它已不构成证伪：SW 批量转录本身就是入口） |
| ASR 是否配置；27/489 是否全部来自缓存命中 | 用户 |
| ~~登录态 `list-all` 是否返回私密夹；私密位是否是 `attr & 1`~~ | **已消解**：返回；用户建的临时私密夹 `attr: 3`，bit0 置位（2026-09-23，§9.6）。app.html 是否真把它隐藏了仍 `[UNKNOWN]` |
| ~~未登录 `list-all` 是否返回公开夹（还是一律为空）~~ | **已消解**：一律 `data: null`（§9.5 匿名探测，本账号有 39 个公开夹） |

### 9.5 Step 0 运行时实验结果（2026-09-22，用户浏览器 + 本机匿名 curl）

**E2（扩展 SW Console，`wbi/v2?bvid=BV1XN416DEeR&cid=41389916397`）**

| 行 | code | login_mid | need_login_subtitle | subs |
|---|---|---|---|---|
| A `credentials:'omit'` | 0 | 0 | true | 0 |
| B 不传 init | 0 | uid | false | 1 |
| C 只塞 `Cookie` header | 0 | uid | false | 1 |
| D `credentials:'include'` | 0 | uid | false | 1 |

**E3 / Step 3**：清掉 1228 条 `vc:bilibili:*`；E3 表未回报（见 §6 E3「结果」）。

**E4（bilibili.com Console，`include`）**：39 个夹。`attr` 分布：`0` × 1（默认夹）、`2` × 2、`22` × 36；`attr & 1` 全为 0。`omit` 行未回报。

**匿名 curl（无 cookie，带浏览器 UA + `Referer: https://www.bilibili.com/`，间隔 2 秒）**

| 请求 | 结果 |
|---|---|
| `fav/folder/created/list-all?up_mid=<本账号>` | `code 0, data: null` |
| `fav/folder/info` + `fav/resource/list`，`attr` = 2 的两个夹 | 均 `code 0`，返回夹信息与内容 |
| 同上，`attr` = 22 的一个夹、`attr` = 0 的默认夹 | 均 `code 0`，返回夹信息与内容 |

⇒ 未登录 `list-all` 一个夹都不给；`attr` 0 / 2 / 22 全是公开夹，2 与 22 相差的 bit2、bit4 与可见性无关。

**私密位的外部证据**（本账号无私密样本，这是规则 `attr & 1` 的全部依据）：
- 8 个互相独立的开源实现以 `attr & 1` 判私密：xfangfang/wiliwili（`player_collection.cpp`）、keleus/BewlyCat（`FavoritesPage.vue` 的 `isFavoriteFolderPrivate`）、synctv-org/synctv（`bilibili/client.rs`）、AktuelleKamera/BiliClassic（`FavoriteApi.java`）、VZRXS/bilikara（`bilibili.py`）、DiWu17/namida-bilibili-provider、yxyusage/BiliLearn-AI、alexliu07/toolbox-web（`Bilibili.vue` 的「私密」徽标）。检索方式：`gh search code "attr & 1" fav bilibili`。
- CSDN「网页脚本 bilibili001：计算自己收藏了多少视频」（2024-02）贴出的真实 `list-all` 响应里，私密的默认夹是 `attr: 1`。
- bilibili-API-collect 现行版 `attr` 表：bit0 = 私有、bit1 = 非默认夹。其历史上两位的表述对调过一次（ShiranGit 镜像 commit `1e007cc855` 改正），现行版与其自身样例（默认夹 0、公开夹 22）自洽，与本账号 39 个公开夹也自洽（二者合计即他处所说的 44 个公开样本）。

### 9.6 Step 1 / Step 4 运行时复核（2026-09-23，用户浏览器 + 全库导出）

**E1**（bilibili.com 视频页 Console，已登录；只跑了一个中文视频，§6 E1 的脚本，当时还没有 `UNCLAIMED` 分支）。16 行 `code` 全为 0，`login_mid` 全为本账号。

| 轮 | `v2` | `wbi/v2` |
|---|---|---|
| 0 | 单条 `ai-zh`，外来（前缀 `11326424351144726179537228`） | `ai-zh` 自有 + 5 条裸名翻译轨 |
| 1 | 与 `wbi/v2` 逐字相同的六语轨表 | 同上 |
| 2 | 单条 `ai-zh`，外来（`11333512724560726369261601`） | 同上 |
| 3 | 六条轨，`subtitle_url` 全空 | 同上 |
| 4 | 六条轨，`subtitle_url` 全空 | 同上 |
| 5 | 单条 `ai-zh`，外来（`11322627673704526385123092`） | 同上 |
| 6 | 单条 `ai-zh`，外来（`11337446981740926477857616`） | 同上 |
| 7 | 单条 `ai-zh`，外来（`11332168869751826329941039`） | 同上 |

- 五个外来文件名都是 26 位数字前缀加 32 位 hex，前缀两两不同。
- 裸名翻译轨：`ai-en` `0b4ca2ed012f2b3fbb9261cd124e0db9`、`ai-ja` `205c37a4087f2971fffbdaae6c6497f5`、`ai-es` `e27202f848d7f1f531cdc7b541b0376a`、`ai-ar` `e83b8ddad2cafc8b598ab08dfd519482`、`ai-pt` `11076f660a26f319a610c88a237db52c`，两个端点共 16 次请求恒定不变。
- 视频的 bvid、aid、cid 和完整 URL 没有采到，脚本只打印文件名。

**E3 计数**：`vc:bilibili:*` 共 112 条。脚本同时打印的 `source` 分布与时间范围没有回报。

**全库导出**（`favbase-export-2026-09-23.json`，导出于 11:55:17 UTC，不含向量；分析方法是用 node 脚本把 `items` × `item_contents` × `item_chunks` 连起来）：

- **整库在 11:36 UTC 重建过**：items 共 4082 条（bilibili 2380 / zhihu 924 / bookmarks 778），`createdAt` 全都不早于 11:36:41。同日早些时候经 CLI 读到过 bilibili 的 content 2595/4609、acquisition 4889，那批数据随重建丢失，没进导出，所以无从检验。
- bilibili 的 contentState：pending 2256 / chunked 123 / error 1（`BV1hJMV6jEX7`，已失效视频）。123 条正文全部写于 11:36–11:55 UTC。
- **扇入**（同一 `plainText` 挂在多个 item 上）：0 组。前 200 字相同的也是 0 组。
- **字幕超出视频时长**（chunk 的最大 `endSec` 超过 `duration` 加 5 s）：0/123。覆盖率（最大 `endSec` ÷ `duration`）122 条落在 0.91–1.00；1 条是 0.46（`BV1t18q6wEvq`，1447 s），它的正文与标题主题一致，是后半段没有字幕，不是错配。
- **标题对正文**逐条人工比对：123/123 吻合。`♪` 出现在 2 条里，都在正文中间，是配乐标注，属于正常 AI 字幕；「快问快答」0 条。
- 与任务 PRD / research 里出现过的 bvid 交叉：导出里有正文的只有 `BV1XN416DEeR`，现在是它自己的正文（「动画图解：Codex 的 Code Mode 沙箱」）。

**私密夹**：临时夹「测试私密文件夹」，`attr: 3`。

**第 5 步（手动转录）**：用户回报 B 站页面上的插件转录失败，指示不追查；原因 `[UNKNOWN]`。

---

## 10. 实施时须同步的文档

- `lib/bilibili/CLAUDE.md`：`bilibili-api.ts` 条目（端点、归属校验、`auth?` 删除、公开夹过滤）；「B 站认证」约定那条——「手动拼 Cookie header」改成 `credentials:'include'` 并注明它依赖的是 host permission 而非 forbidden-header 特例；「CID 获取…不需要 WBI 签名」旁补一句字幕端点同样不签名及依据；「收藏夹视频同步」约定补「只拉公开夹」。**Step 1 的部分已于 2026-09-22 同步**（端点、归属校验、字幕端点不签名、降级路径与主路径同源）；**Step 4 的部分已于同日同步**（`bilibili-api.ts` / adapter 条目的新签名与 `credentials:'include'`、「B 站认证」约定改写——依据写的是 E2 的 jar cookie，`getBiliAuth()` 只剩登录判定 + `mid`；「收藏夹视频同步」补「只拉公开夹」及两处已知残留）。
- `lib/transcription/CLAUDE.md`：转录总流程里 adapter 的碎片清单去掉「auth」。**已于 2026-09-22 随 Step 4 同步。**
- Step 1b（2026-09-23）：`lib/bilibili/CLAUDE.md` 的 `fetchSubtitle` 条目（裸名放行 + 整表校验）；本文 E1 脚本加 `UNCLAIMED` 分支，与代码保持同一判据；`.trellis/spec/guides/silent-failure-thinking-guide.md` Gotcha 3 清单里「标记缺失」那一条。
- `lib/cache/CLAUDE.md`：**无需改动**（Step 3 已改为零代码）。
- `entrypoints/bilibili-video.content/hooks/CLAUDE.md`：`useSubtitle` 三层数据流处注明 API 降级与拦截通道现在同源，以及为什么不动竞态。**已于 2026-09-22 同步。**
- 任务 `prd.md`：H5 取代 H4；更正 `source` 列那条；Decision 1/2 按 §8 的答复更新。
- `CONTEXT.md`：**已于 2026-09-22 追加**一条 Flagged ambiguity——Bilibili 的 Source 只含公开收藏夹，私密夹不是 Source（zhihu 已按 `is_public` 过滤，是先例）。Step 4 落地后，其中「代码尚未承载」改为「`fetchFavFolders` 在取夹列表处就丢掉私密夹」（**已于同日随 Step 4 改写**）。错配本身涉及的字幕缓存/端点/来源都是实现层概念，不进术语表。
- ADR：**不需要**。三条改动都易于回退，不满足「难以反悔」。
- Step 5（2026-09-24，独立任务 `09-24-transcript-origin-column`）同步了：`lib/database/migrations/CLAUDE.md`（v006 条目）、`lib/database/entities/CLAUDE.md`（item-contents 的新列、CHECK、NULL 的两种含义）、`lib/ingest/CLAUDE.md`（`persistExistingItemContent` 必填第 6 参，以及「`plain_text` 与 `subtitle_source` 总是一起写」的不变量）、`lib/bilibili/CLAUDE.md`（`persistContentChunks` 的 `source` 现在落库）、根 `CLAUDE.md` 的 docs/29 条目。`CONTEXT.md` 追加了一条 Flagged ambiguity：字幕语境里的 source 不是 **Source**。它不进术语表，上一条「来源是实现层概念」的判断不变；这一条只是为了区分两个同名的词。`lib/export/CLAUDE.md` 不用改：导出的表和列都由 schema 派生，新列自动带上，由 `tests/export-schema-sync.test.ts` 锁住。仍然不需要 ADR：扩展未上线，加列可以回退（代价见 §7 末行）。

## 11. 参考

- `.trellis/tasks/09-17-bilibili-transcripts-land-on-the-wrong-items/`：`prd.md`、`research/mismatch-survey.md`、`research/root-cause-investigation.md`、`research/incidental-defects-d1-d5.md`、`research/review-findings-r1-r3.md`
- https://github.com/yt-dlp/yt-dlp/issues/11708
- https://github.com/Nemo2011/bilibili-api/issues/841
- https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py
- F25 两条（互相矛盾，仅作线索）：https://boryssey.medium.com/cookie-based-authentication-for-your-browser-extension-and-web-app-mv3-4837d7603f54 ；https://groups.google.com/a/chromium.org/g/chromium-extensions/c/RMUtNEhR0R8
