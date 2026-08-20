---
target: app.html 各页面（entrypoints/app）
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-08-20T08-53-17Z
slug: entrypoints-app
---
Method: dual-agent (A: design review sub-agent · B: detector sub-agent B1 + browser sub-agent B2; B2 hit MV3 CSP, final same-origin injection finished in parent after A completed)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Pipeline strip 好，但同一页三套分母互相矛盾（"4455 videos" / "1378/--" / "72/1352" / "0/71"），`--` 是开发者输出不是状态 |
| 2 | Match System / Real World | 2 | 国旗当语言符号；空态文案说 "Click Sync" 而按钮叫 "Fetch now"；LLM 卡片描述仍是 "for video content summarization" |
| 3 | User Control and Freedom | 2 | 会话删除一键无确认无撤销（chat-view.tsx:550）；切过一次主题开关后 `system` 模式在 UI 里不可回到；搜索/筛选不进 URL |
| 4 | Consistency and Standards | 2 | 同一分段 Tab 组件两套选中态（settings-tabs 白底 vs section-rail 珊瑚底）；B站卡标题单行 noWrap 而其它卡 clamp 2-3 行；B站卡不拉伸；"5023 items" vs "5,023" |
| 5 | Error Prevention | 2 | GitHub/YouTube 空态 "Go to Settings" 落到 AI Tab 而非 Connections（github-stars-view.tsx:113 → `navigate('/settings')`）；Max Tokens `valuemax=0`；Temperature 泄漏 0.30000001192092896 |
| 6 | Recognition Rather Than Recall | 3 | 聚合页 chips 无计数；书签 "Python/Python" 重名无路径；聚合页无排序 |
| 7 | Flexibility and Efficiency | 1 | 无 `/`、`⌘K` 聚焦搜索；24 条/页翻 210 页无分页大小；无排序、无批量打标；卡片是 `button` 不是 `a`，无中键/Ctrl 新标签 |
| 8 | Aesthetic and Minimalist Design | 2 | B站页六层控制带把首张卡压到 y≈610/900；每张卡都带灰色空标签图标；Settings>General 一项 rail+卡+label+select 全叫 Language |
| 9 | Error Recovery | 2 | Chat 未配置态是裸 Alert 无按钮，"New chat" 仍可点（chat-view.tsx:248）；X 缩略图破图无 `onError`（x-card.tsx:23-39），首页 7/39 |
| 10 | Help and Documentation | 2 | GitHub token 指南要 `repo`+`user` scope 过宽；"Auto Transcribe" 面板 idle 态零说明；Fetch/Extract/Embed/Tags 阶段名全程无定义 |
| **Total** | | **21/40** | **Acceptable（20-27）** |

## Design Specificity Verdict

**判定：mostly template。** 去掉珊瑚色就是原封不动的 Minimal UI / material-kit-react。灰阶 `#919EAB/#637381/#454F5B/#1C252E/#141A21`、info/success/warning/secondary 四色、暗色 surface（paper=grey800/default=grey900/neutral=#28323D）、card shadow `0 0 2px 0 …, 0 12px 24px -4px …`、dropdown `-20px 20px 40px -4px`、DM Sans+Barlow 配对、280/72 nav、16px Card、虚线 StateBox，全部是模板字节级原样。只动了 primary 和 error。

真正属于 favbase 的东西存在但稀少：Collections 子树的鱼骨连接线（nav.tsx:190-230）、带 tabular-nums 的 pipeline strip、主题开关的圆形揭示、狐狸 logo 复用为 chat 人格、Analytics 页用 hairline band 代替 stat card（overview-view.tsx:95-145，唯一不像 SaaS admin 的页面）、知乎卡（type chip+标题+摘要）是唯一按内容设计的卡片。

六个平台品牌色（B站粉、X 青、知乎紫、YouTube 红）和珊瑚主色并排无层级规则：`/` 的构成条是五种等权饱和色，珊瑚 "Analytics" nav pill 成了第六种。

**确定性扫描（静态，entrypoints/app）：** 3 条告警。`layout-transition` ×2（layout.tsx:126 `padding-left`，nav.tsx:52 `width, padding`，侧栏 pin/unpin 一次性过渡，真阳性但代价低）；`side-tab` ×1（chat-markdown.tsx:80 blockquote 左边线，**误报**，是 markdown 引用块的标准样式）。检测器以 regex 降级模式运行（解析模块缺失），且 `em-dash-overuse`/`marketing-buzzword`/`aphoristic-cadence` 三条文本规则对 `.tsx/.ts` 结构性不执行，所以静态 3 条是**低估**。机械补扫：主题外硬编码色 23 处（19 处是 GitHub linguist 语言色，合法数据；真正的漏网是 header-actions.tsx:48 `#5C6BC0` 靛蓝和 use-jobs-badge.ts:10 `#FFAB00` 复制 warning.main）；圆角 6 种倍率（0.5/0.75/1/1.25/1.5/2）+ 11px/50% 离群；主题外 fontSize 字面量 9 处（0.6875rem/0.75rem/0.85em/0.9rem）；`boxShadow` 全部走 customShadows（干净），但 `'box-shadow 0.2s'` hover 模式在六个平台卡文件里逐字复制（DRY 候选）；locale 文件 en.ts 60 处破折号、zh-CN.ts 25 处，集中在 `settings.*` 的 "Status — detail" 结构和 welcome 叙事文案。

**浏览器端扫描（真实页面，1440×900，亮色）：** `/` 6 条、`/collections` 10 条、`/collections/bilibili/*` 24 条、`/settings` 11 条、`/chat` 5 条。跨页共性：`layout-transition` ×3-4（侧栏 + header 高度 + legend）、`clipped-overflow-container`（MuiSwitch 主题开关，误报；B站页 LinearProgress ×4 同理误报）、`first-viewport-column-overflow`（内容列 144%-254% 视口高，首屏折叠深）、`low-contrast` 白字/珊瑚 `#FC7E5B` 按钮 2.5:1（需 4.5:1）、`text-overflow` h6.subtitle2.noWrap 溢出 34-793px（B站卡标题单行截断，聚合页 4 处、B站页 14 处）、`skipped-heading`（`/` h3→h6 缺 h4；`/settings`、`/chat` h4→h6 缺 h5）。检测器与人工审查在三点重合：珊瑚对比度、B站卡标题截断、标题语义断层。检测器漏掉而人工抓到的：控制带堆叠、破图、死胡同空态、深链错 Tab。

**Overlay：** 同源注入成功，`[Human] favbase critique` 标签页（当前停在 `#/chat`）上有检测器叠加层；临时脚本已从 `.output/chrome-mv3/` 删除，reload 后 overlay 消失。

## Overall Impression

底盘比外观好：FOUC 守卫、CSP 合规、主题化 selection/caret/scrollbar/focus ring、View Transition 降级——管线工程是认真做的。但用户看到的是一个合格的 MUI admin 壳，不是知识库。最大的单一机会：平台页把"找到一条收藏并打开"这个主任务埋在六层状态/配置带之下，而卡片（产品的原子单元）在破图、截断、参差高度、空标签图标上全面失守。

## What's Working

1. **Analytics 页构图**（overview-view.tsx:95-211）：hairline band 代替 stat card，全页 `tabular-nums`，单一构成条，`aria-labelledby` section + `role=tabpanel` 接线正确。
2. **Pipeline strip 作为状态原语**（pipeline-progress-strip.tsx）：紧凑、idle 可见、语义 progressbar、只在活动时上珊瑚、只在失败时上红。思路对，只是喂进去的数字不一致。
3. **主题与浏览器面工程**：外部 `theme-init.js` 防 FOUC，`MuiCssBaseline` 一处统管 selection/caret/scrollbar/focus-ring，圆形揭示带 `prefers-reduced-motion` 回退。

## Priority Issues

1. **[P0] 平台页六层控制带埋掉内容。** *Why:* 主任务是找到并打开一条收藏；`/collections/bilibili` 首张卡从 y≈610/900 开始（08-bilibili-light-1440.jpeg），"Configuration required" 带是 `role=alert aria-live=assertive`，每次加载都向读屏器抢播。浏览器检测器同时报 `first-viewport-column-overflow` 228%。*Fix:* pipeline + 闸门 + 配置提示合并成一行 40px 状态行（左 strip，右一个 "2 steps need setup" chip 点开 popover）；auto-transcribe 面板降级进 strip 的 Transcribe 段；排序移入标题栏。文件：`components/collection/collection-page-scaffold.tsx:322-361`、`components/configuration-blocker/collection-configuration-notice.tsx`（去 `role=alert`）、`sections/bilibili/auto-transcribe-bar.tsx`。*Command:* **distill**。

2. **[P0] 卡片作为原子单元失守。** *Why:* X 缩略图破图（首页 7/39，暗色下是白色方块，21-collections-dark-1440.jpeg）；`pre-wrap` + 3 行 clamp 留下孤立的 "…" 行（x-card.tsx:97-114）；日期截成 "9:09 P…"；B站卡不拉伸（video-card.tsx:87 缺 `height: 1`）导致聚合页行高参差；hover 只染 `CardActionArea`，标签行留白（03-collections-card-hover.jpeg）；每张卡都渲染灰色空标签图标；B站标题单行 noWrap 被检测器报 14 处 text-overflow。*Fix:* 在 `components/collection/` 建一个 `CollectionCard` 外壳统管 `height:1`、整卡 hover、footer grid（stats 左 / date 右 `flexShrink:0 noWrap title`）、media slot 带 `onError` → 平台图标占位、tag row 为空时不渲染；推文正文 `replace(/\n{2,}/g,'\n')` 并去掉 clamp 内的 `pre-wrap`；B站标题改 2 行 clamp；六个卡文件的 `'box-shadow 0.2s'` hover 一并收进外壳。*Command:* **harden**。

3. **[P1] 珊瑚 `#FC7E5B` 当文字用，2.5:1。** *Why:* 白底上 2.54:1——active nav 文字、"View platform collection"、"Configure Embedding/LLM"、"Create a token on GitHub →"、选中 rail tab、分页；contained 按钮白字/珊瑚底也是 2.5:1（检测器在 `/collections`、B站页各报一次）；`text.disabled` 2.73:1 用在卡片日期；warning/info/success 做 outlined chip 文字 1.9-2.4:1（"CC Official"）。*Fix:* 引入 `primary.dark` `#C4502E`（4.6:1）作为文字/链接 token，应用于 nav.tsx:131,253、section-rail.tsx:52、overview-view.tsx:277、collection-configuration-notice.tsx；contained 按钮文字改 `primary.darker` 或底色改 `primary.dark`；日期从 disabled 升 `text.secondary`；彩色 outlined chip 改 soft filled。*Command:* **colorize**（可访问性向）。

4. **[P1] 死胡同空态/阻塞态。** *Why:* Chat 无 LLM 时是纯文本 Alert 无按钮，"New chat" 照常可点；GitHub/YouTube "Go to Settings" 打开的是 AI Tab（settings-view.tsx:62 只解析 `section`，不解析 `tab`）；文案 "Click Sync" vs 按钮 "Fetch now"。*Fix:* settings-view.tsx 支持 `?tab=connections&section=github` 深链，github-stars-view.tsx:113 和 youtube-view 改用；chat 的 Alert 换成 `StateBox` + `Button component={RouterLink} to="/settings?section=llm"`，`!configured` 时禁用 rail 的 New chat；en/zh 两份 locale 的 `githubStars.emptyDesc / x.emptyDesc / youtube.emptyDesc` 与 `pipeline.fetchNow` 对齐。*Command:* **onboard**。

5. **[P2] 标题语义与可访问名断裂。** *Why:* 全站零 `<h1>`（浏览器扫描五路由确认）；页标题是 h4/h5；每张卡的作者/标题是 h6（`subtitle2` 默认映射 h6），`/collections` 一页 24+ 个 h6；检测器报 `skipped-heading` 三处；侧栏 toggle / 移动菜单按钮无名（layout.tsx:79-92）；API key / WebDAV 密码眼睛按钮无名；24 个同名 "Edit tags"；Iconify 按钮名里夹零宽空格。*Fix:* 页标题 `component="h1"`；卡片副标题与数字 `component="p"/"span"`（或在 typography.ts 设 `variantMapping`）；补 `aria-label`；tag-row.tsx:48 的按钮名带上条目标题。*Command:* **audit**。

## Persona Red Flags

**Alex（急躁的高手）**：进 `/collections` 先滚过 56px 搜索框 + chip 行，5,023 条只给 24 条且无排序、无密度切换、无键盘聚焦快捷键，翻到第 210 页；搜索不进 URL，前进后退丢状态；卡片是 `button` 走 `window.open`（x-card.tsx:57），中键/Ctrl 点击无效；日期 "8/19/26, 9:09 PM" 而非相对时间；Settings 四 Tab × 单子项 rail，任何字段至少两次点击，"Get Key"/"Fetch Models" 与其作用的字段分离。

**Sam（读屏/键盘）**：无 h1，每页 24 个 h6；passive 提示用 `role=alert aria-live=assertive` 每次加载抢播；侧栏 toggle、移动菜单、两个眼睛按钮无名；卡片按钮名是整条推文正文 + 无标签数字（"404 64 6"）；Tab 顺序跳过侧栏与 header 直落 settings rail（26-focus-ring-dark.jpeg）；焦点环珊瑚 48% alpha，在珊瑚底选中 tab 上几乎不可见；"Show 559 more" 一次展开 559 个按钮进 Tab 序列且无收起。

**Jordan（首次用户）**：落地 Analytics 看到 `5,023 / 0 / 0`，没人解释标签是什么；Chat 一个蓝色信息框无按钮；连 GitHub 被丢到 LLM 表单，得自己发现 Connections Tab，token 指南要 `repo`+`user` 看着吓人；B站页第一眼是黄色 "Configuration required"，然后是无解释的 "Auto Transcribe"，然后 "Fetch 1378/--"。

## Minor Observations

- nav 顺序 Collections → Analytics → Chat → Settings，但 `/` 是 Analytics，落地路由是第二项（nav-config.tsx:31-68）。
- `#5C6BC0` 靛蓝硬编码在开关轨道与月亮（header-actions.tsx:34-48）；月牙在暗色 header 上几乎不可见（23-github-empty-dark-1440.jpeg）。
- `#FFAB00` 硬编码在 hooks/use-jobs-badge.ts:10，复制了 `warning.main`，改色会漂移。
- video-card.tsx:114 用 `grey[100]` 做无封面占位、auto-transcribe-bar.tsx:62,74 用 `grey.200`，暗色不反转。
- 圆角词汇 0.5/0.75/1/1.25/1.5/2 倍 + 11px + 50%，无 token 名；LinearProgress root 4px、分段条 4px、转录条 8px。
- 主题外字号：`'0.6875rem'`（tag-row.tsx:43）、`'0.75rem'` 封面角标、`'0.85em'` chat markdown。
- SectionTitleBar 标题 h5（18/19px），Analytics/Settings/Chat 标题 h4（20/24px），两套页标题尺寸。
- `"{{count}} items"` 渲染 "5023 items" 而 `/` 上是 "5,023"。
- 书签文件夹 chips 重名 "Python/Python" 无父路径。
- X 首次全量同步后 caption "1943 new this sync" 是噪音；知乎 "924 favorites" 对 "599 waiting for embeddings" 的 325 差额无解释。
- `/collections/bilibili` 静默重写到 `/collections/bilibili/<folderId>`，书签该 URL 每次可能落到不同视图。
- 搜索框 56px 高且全宽出现在每个列表页；chip 行在 1024 和 500 宽换两行（31-/41-collections）。
- Settings rail 标签 1024 宽换行（"ASR Transcription" 两行图标上挂，33-settings-light-1024.jpeg）；500 宽顶部 Tab "AI Config" 换两行。
- 暗色下分段 Tab 选中态（`background.paper` 在 grey-8% 轨道上）与兄弟无法区分（25-settings-dark-1440.jpeg）。
- 暗色卡用纯黑阴影（custom-shadows.ts:53）在 `#1C252E` 上叠 `#141A21`，边缘消失；暗色应加 1px `divider` 边。
- 语言菜单：珊瑚圆点 + MUI `selected` 背景，两套选中信号。
- 后台任务 chip 在 1440 宽就截断（"…don't close this p…"）。
- "Pause library build" 在 strip 最右、与次要动作同权重，却是页面唯一带破坏性的控件，无确认无 toast。
- Temperature `0.30000001192092896`；Max Tokens `valuemax=0`。
- "Get Key" small outlined 浮在 56px 输入框旁，"Fetch Models" 被强制 `height: 56`，一张表单两种按钮高度。
- export-card.tsx 放在 `sections/overview/` 却只在 Settings 渲染，命名漂移。
- `document.title` 恒为 "favbase"，无逐路由标题，历史/标签搜索失效。
- nav 是 `position: fixed` 而非布局网格内 sticky（全页截图可见覆盖内容）。
- 六个卡文件逐字复制 `boxShadow: card → hover z8 + 'box-shadow 0.2s'`（无 easing，与别处 `theme.transitions.create` 不一致）。

## Questions to Consider

1. 产品承诺是"向你的收藏提问"，为什么 Chat 是第三个导航项、被设置表单挡着，而落地页展示的是标签统计而不是一个搜索框？
2. 每个平台页无论有没有任务在跑都渲染同样六条带；如果 pipeline 是一行、只在有话说时才长高，页面会长什么样？
3. 系统已经知道每条的平台、文件夹、作者、语言、标签，为什么聚合页只给一个文本框和一个平台 chip，5,023 条按 24 条分页而不是虚拟滚动？
