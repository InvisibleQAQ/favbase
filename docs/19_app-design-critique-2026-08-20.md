# app.html 设计审查与整改计划（2026-08-20）

> 对象：Extension Page `app.html`（`entrypoints/app/**`），MUI v7 dashboard。
> 方法：impeccable `critique`（Operate 模式）。两个互相隔离的评估：A = 设计总监视角源码 + 真实页面审查（亮/暗双模式，1440/1024/500 三档宽度，40 余张截图）；B = 静态检测器 `detect.mjs` + 浏览器端检测器同源注入（真实数据页，5,023 条）。
> 评分：**21/40（Acceptable 档，20-27）**。判定：**mostly template**。
> 快照：`.impeccable/critique/2026-08-20T08-53-17Z__entrypoints-app.md`（impeccable 归档，供 `$impeccable polish` 读取）。
> 本文是整改的单一事实源。实施分阶段进行，每阶段一个 Trellis 任务。

---

## 0. 结论先行

1. **底盘好于外观。** FOUC 守卫、MV3 CSP 合规、`MuiCssBaseline` 一处统管 selection/caret/scrollbar/focus-ring、View Transition 主题切换带 reduced-motion 回退、pipeline strip 语义 progressbar。工程层没有大问题。
2. **外观是 material-kit-react 原样。** 灰阶、四个语义色、暗色 surface、card/dropdown 阴影公式、DM Sans + Barlow 配对、280/72 nav、16px Card、虚线 StateBox 全部字节级沿用模板，只改了 primary（珊瑚 `#FC7E5B`）和 error。用户看到的是一个合格的 MUI admin 壳，不是知识库。
3. **两个 P0 都在"找到一条收藏并打开"这条主路径上：** 平台页六层控制带把首张卡压到视口 2/3 以下；卡片（产品原子单元）在破图、截断、参差高度、空标签图标、局部 hover 上全面失守。
4. **珊瑚主色被当成文字色用，2.5:1。** 这是可访问性缺陷，也是视觉语言重做时必须一并解决的 token 问题。
5. **决策（已确认）：** 视觉语言这次顺带重做。顺序必须是 **Phase 0 先锁 token 层（色板/灰阶/圆角/阴影/字阶/暗色 surface），P0 的统一卡片外壳在新 token 上施工**，否则卡片要做两遍。

---

## 1. 设计健康分（Nielsen 十项，0-4）

| # | Heuristic | 分 | 关键问题 |
|---|-----------|----|---------|
| 1 | 系统状态可见性 | 3 | Pipeline strip 好，但同页三套分母互相矛盾（"4455 videos" / "1378/--" / "72/1352" / "0/71"），`--` 是开发者输出不是状态 |
| 2 | 贴近真实世界 | 2 | 国旗当语言符号；空态文案 "Click Sync" 而按钮叫 "Fetch now"；LLM 卡片描述仍是 "for video content summarization" |
| 3 | 用户控制与自由 | 2 | 会话删除一键无确认无撤销（`sections/chat/chat-view.tsx:550`）；切过主题开关后 `system` 模式 UI 里回不去；搜索/筛选不进 URL |
| 4 | 一致性与标准 | 2 | 同一分段 Tab 两套选中态（`settings-tabs.tsx:40` 白底 vs `section-rail.tsx:51` 珊瑚底）；B站卡标题单行 noWrap 而其它卡 clamp 2-3 行；B站卡不拉伸；"5023 items" vs "5,023" |
| 5 | 错误预防 | 2 | GitHub/YouTube 空态 "Go to Settings" 落 AI Tab 而非 Connections（`github-stars-view.tsx:113` 裸 `navigate('/settings')`）；Max Tokens `valuemax=0`；Temperature 泄漏 `0.30000001192092896` |
| 6 | 识别而非回忆 | 3 | 聚合页 chips 无计数；书签 "Python/Python" 重名无路径；聚合页无排序 |
| 7 | 灵活与效率 | 1 | 无 `/`、`⌘K` 聚焦搜索；24 条/页翻 210 页无分页大小；无排序、无批量打标；卡片是 `button` 非 `a`，中键/Ctrl 无效 |
| 8 | 美学与极简 | 2 | B站页六层控制带首张卡 y≈610/900；每张卡带灰色空标签图标；Settings>General 一项 rail+卡+label+select 全叫 Language |
| 9 | 错误恢复 | 2 | Chat 未配置态是裸 Alert 无按钮，"New chat" 仍可点（`chat-view.tsx:248`）；X 缩略图破图无 `onError`（`x-card.tsx:23-39`），首页 7/39 |
| 10 | 帮助与文档 | 2 | GitHub token 指南要 `repo`+`user` scope 过宽；"Auto Transcribe" 面板 idle 态零说明；Fetch/Extract/Embed/Tags 阶段名无定义 |
| | **合计** | **21/40** | |

认知负荷清单 8 项失 6 项：单一焦点、≤4 分块、视觉层级、一次一件事、≤4 可见选项、工作记忆。超 4 选项的决策点：侧栏展开 11 个链接；`/collections` chip 行 7；header 5 个控件；Settings 4 Tab + 3 rail = 7；B站页首屏 17 个可交互目标在第一张卡之前；分页 9。

---

## 2. 模板感判定

**Minimal UI 原样的部分（theme 层）**
- 灰阶 `#919EAB / #637381 / #454F5B / #1C252E / #141A21`（`theme-config.ts:77-88`）
- info/success/warning/secondary `#00B8D9 / #22C55E / #FFAB00 / #8E33FF`（`theme-config.ts:37-68`）
- 暗色 surface paper=grey800 / default=grey900 / neutral=`#28323D`（`core/palette.ts:75-79`）
- card shadow `0 0 2px 0 …, 0 12px 24px -4px …`，dropdown `-20px 20px 40px -4px`（`core/custom-shadows.ts:40-41`）
- DM Sans + Barlow（Minimal v6 自带配对）
- 280/72 nav、`borderRadius: 0.75` pill、primary 8% tint、16px Card、虚线 StateBox、sticky header blur

**真正属于 favbase 的（保留，作为新视觉语言的种子）**
- Collections 子树鱼骨连接线（`layouts/dashboard/nav.tsx:190-230`）
- pipeline strip + tabular-nums 计数（`components/collection/pipeline-progress-strip.tsx`）
- 主题开关圆形揭示（`layouts/dashboard/header-actions.tsx:81-104`）
- 狐狸 logo 复用为 Chat 人格
- Analytics 页 hairline band 代替 stat card（`sections/overview/overview-view.tsx:95-145`）
- 知乎卡（type chip + 标题 + 摘要）是唯一按内容设计的卡

**色彩层级缺失**：六个平台品牌色（B站粉、X 青、知乎紫、YouTube 红、GitHub 黑、书签黄）与珊瑚主色并排无规则；`/` 的构成条五种等权饱和色，珊瑚 nav pill 成第六种。
→ 2026-08-21 Analytics 平台架与 Collections 侧栏平台叶子已按「品牌色 = 身份、珊瑚 = 选中」落地：`theme.vars.palette.platform[platform]`（`theme-config.ts` 四个经 dataviz 验证器再染色的品牌色 + github/x = 墨）只落在图标字形与该平台自己的份额条；侧栏平台 ID 从 `collectionPlatformRegistry` 传递，active 仍由共享导航样式覆盖为珊瑚。聚合页 chips、卡片印章、welcome 平台选择仍未使用平台身份色。

---

## 3. 优先问题（P0-P2）

### P0-1 平台页六层控制带埋掉内容

> **2026-08-20 处置**：用户否决结构改动，2026-08-20 恢复原堆叠；首屏压缩目标作废，仅保留 `role=status` 与色彩。下文「修法」中的三行状态行 / 印章 chip / 排序并入标题栏已实施后被回退；`configurationNotice` 回到搜索框之后的全宽横幅（`role=status`），排序回到独立一行。唯一留下的结构项是 Auto Transcribe idle 不占行（位于搜索框之下，用户未要求恢复）。

- **现象**：`/collections/bilibili/*` 从上到下：标题栏+Fetch now / pipeline strip+Pause / 56px 搜索框 / 黄色 "Configuration required"（`role=alert aria-live=assertive`）/ "Auto Transcribe" 面板 / 文件夹 chips / 排序行，首张卡从 y≈610/900 开始。浏览器检测器报 `first-viewport-column-overflow` 228%。其它平台页同构（少一两层）。
- **为什么重要**：主任务是找到并打开一条收藏。17 个可交互目标排在第一张卡之前。`aria-live=assertive` 让读屏器每次加载先听一段配置警告。
- **修法**：
  - pipeline + 闸门 + 配置提示合并为一行 40px 状态行：左 strip，右一个 "N steps need setup" chip 点开 popover（popover 内放现在的两条 Configure 链接）。
  - Auto Transcribe 面板降级进 strip 的 Transcribe 段（idle 时只剩一个段标签，有任务时展开）。
  - 排序（Recently favorited / Most played / Recently published）移入标题栏右侧，与 Fetch now 同排。
  - 配置提示去掉 `role=alert`（改 `role=status` 或无 role）。
- **文件**：`components/collection/collection-page-scaffold.tsx:322-361`、`components/configuration-blocker/collection-configuration-notice.tsx`（+ 对应 test 里 `role="alert"` 断言）、`sections/bilibili/auto-transcribe-bar.tsx`、`components/collection/section-title-bar.tsx`。
- **验收**：1440×900 下所有平台页首张卡顶边 ≤ 320px；配置提示不再是 live region；现有 `*.test.tsx` 全绿（断言按新结构调整，不删覆盖）。
- **impeccable 命令**：`distill`。

### P0-2 卡片作为原子单元失守

- **现象**：
  - X 缩略图破图，首页 7/39，暗色下是白色方块（无 `onError`，`sections/x/x-card.tsx:23-39`）。
  - `pre-wrap` + 3 行 clamp 留下孤立 "…" 行（`x-card.tsx:97-114`）。
  - 日期截成 "9:09 P…"。
  - B站卡不拉伸（`sections/bilibili/video-card.tsx:87` 缺 `height: 1`），聚合页行高参差。
  - hover 只染 `CardActionArea`，标签行留白。
  - 每张卡渲染灰色空标签图标（无标签时也画）。
  - B站标题单行 noWrap，检测器报 `text-overflow` 聚合页 4 处、B站页 14 处（溢出 34-793px）。
  - 六个卡文件逐字复制 `boxShadow: card → hover z8 + transition 'box-shadow 0.2s'`（无 easing，与别处 `theme.transitions.create` 不一致），DRY 违规。
- **修法**：在 `components/collection/` 新建 `CollectionCard` 外壳，统管：`height: 1`；整卡 hover（新 token 定义）；footer grid（stats 左 / date 右 `flexShrink: 0` + `noWrap` + `title`）；media slot 带 `onError` → 平台图标占位（暗色可用）；tag row 为空且不可编辑时不渲染。六个平台卡只保留内容装配。推文正文 `replace(/\n{2,}/g, '\n')`，去掉 clamp 内 `pre-wrap`。B站标题改 2 行 clamp。`video-card.tsx:114` `grey[100]` / `auto-transcribe-bar.tsx:62,74` `grey.200` 占位色换成两模式可用 token。
- **文件**：`components/collection/`（新外壳）、`sections/{bilibili,bookmarks,github-stars,x,zhihu,youtube}/*card*.tsx`、`components/tags/tag-row.tsx`。
- **验收**：六平台卡共用一个外壳；聚合页同一行卡等高；任何图片加载失败显示平台占位而非浏览器破图图标；无标签时无标签图标；`grep -rn "box-shadow 0.2s" entrypoints/app` 为 0；卡片 hover 整卡一致。
- **impeccable 命令**：`harden`。

### P1-1 珊瑚 `#FC7E5B` 当文字用，2.5:1

- **现象**：白底 2.54:1 的有 active nav 文字（`nav.tsx:131,253`）、"View platform collection"（`overview-view.tsx:277`）、"Configure Embedding/LLM"（`collection-configuration-notice.tsx`）、"Create a token on GitHub →"、选中 rail tab（`section-rail.tsx:52`）、分页；contained 按钮白字/珊瑚底 2.5:1（检测器 `/collections`、B站页各报一次）；`text.disabled` 2.73:1 用于卡片日期；warning/info/success 做 outlined chip 文字 1.9-2.4:1（"CC Official"）。
- **修法**：Phase 0 重做 token 时一并解决——定义"强调文字色"与"强调底色"两个角色，文字色对白底 ≥ 4.5:1（现 `primary.dark` `#C4502E` 是 4.6:1，可作过渡）；contained 按钮底/字对比 ≥ 4.5:1；卡片日期从 disabled 升 secondary；彩色 outlined chip 改 soft filled（底 `lighter`、字 `darker`）。
- **验收**：浏览器检测器 `low-contrast` 为 0；所有 `color: 'primary.main'` 文字用法替换为新文字 token。
- **impeccable 命令**：`colorize`。

### P1-2 死胡同空态 / 阻塞态

- **现象**：Chat 无 LLM 时是裸 `<Alert severity="info">`，无按钮，"New chat" 仍可点（`chat-view.tsx:248-252`）；GitHub/YouTube 空态 "Go to Settings" → `navigate('/settings')` 落默认 AI Tab（`settings-view.tsx:62-67` 只解析 `?section`，不解析 `?tab`）；文案 "Click Sync" vs 按钮 "Fetch now"（`en.ts:459,496,546` vs `pipeline.fetchNow`）。
- **修法**：`settings-view.tsx` 支持 `?tab=connections&section=github|youtube` 深链；`github-stars-view.tsx:113`、`youtube-view` 改用；Chat 的 Alert 换 `StateBox` + `Button component={RouterLink} to="/settings?tab=ai&section=llm"`，`!configured` 时禁用 New chat；en/zh 两份 locale 的 `githubStars.emptyDesc / x.emptyDesc / youtube.emptyDesc` 与 `pipeline.fetchNow` 对齐。
- **验收**：三个空态 CTA 都落到正确 Tab + section；chat 阻塞态有可点 CTA；`pnpm test` 的 i18n 守卫通过。
- **impeccable 命令**：`onboard`。

### P2-1 标题语义与可访问名断裂

- **现象**：五路由零 `<h1>`；页标题 h4/h5；卡片作者/标题全是 h6（`subtitle2` 默认映射），`/collections` 一页 24+ h6；检测器 `skipped-heading` 三处（`/` h3→h6、`/settings` h4→h6、`/chat` h4→h6）；侧栏 toggle / 移动菜单无 `aria-label`（`layouts/dashboard/layout.tsx:79-92`）；API key / WebDAV 密码眼睛按钮无名（`llm-config-card.tsx:189`、`webdav-sync-card.tsx:189`）；24 个同名 "Edit tags"（`tag-row.tsx:48`）；Iconify 按钮名夹零宽空格；Tab 顺序跳过侧栏与 header 直落内容；焦点环珊瑚 48% alpha 在珊瑚底选中态上不可见。
- **修法**：页标题 `component="h1"`；卡片副标题与数字 `component="p"/"span"`（或 `typography.ts` 设 `variantMapping`）；补 `aria-label`（i18n key）；tag-row 按钮名带条目标题；焦点环 Phase 0 换成两模式可见的 token。
- **验收**：每路由恰一个 h1；无跳级；所有 icon button 有可读名；Tab 首次落在侧栏。
- **impeccable 命令**：`audit`。

---

## 4. 检测器结果

### 4.1 静态 `detect.mjs --json entrypoints/app`

exit 2，3 条告警。regex 降级模式（解析模块缺失），且 `em-dash-overuse` / `marketing-buzzword` / `aphoristic-cadence` 对 `.tsx/.ts` 结构性不执行，**3 条是低估**。

| 规则 | 数 | 位置 | 判定 |
|------|----|------|------|
| `layout-transition` | 2 | `layouts/dashboard/layout.tsx:126`（`padding-left`）、`layouts/dashboard/nav.tsx:52`（`width, padding`） | 真阳性，侧栏 pin/unpin 一次性过渡，代价低，可接受 |
| `side-tab` | 1 | `sections/chat/chat-markdown.tsx:80` blockquote 左边线 | 误报，markdown 引用块标准样式 |

### 4.2 浏览器端（真实页面 1440×900 亮色，同源注入）

| 路由 | 数 | 命中 |
|------|----|------|
| `/` | 6 | layout-transition ×3、first-viewport-column-overflow 144%、clipped-overflow-container（MuiSwitch，误报；MuiTabs，误报）、skipped-heading h3→h6 |
| `/collections` | 10 | layout-transition ×4、first-viewport-column-overflow 254%、clipped-overflow-container（Switch，误报）、text-overflow ×4（B站卡 noWrap 标题）、low-contrast 白/珊瑚 2.5:1 |
| `/collections/bilibili/*` | 24 | layout-transition ×4、first-viewport-column-overflow 228%、clipped-overflow-container ×5（Switch + LinearProgress ×4，误报）、text-overflow ×12、low-contrast ×2 |
| `/settings` | 11 | layout-transition ×3 + legend max-width ×6（MUI OutlinedInput legend，误报）、clipped（Switch）、skipped-heading h4→h6 |
| `/chat` | 5 | layout-transition ×3、clipped（Switch）、skipped-heading h4→h6 |

与人工审查重合：珊瑚对比度、B站卡标题截断、标题语义断层。检测器漏、人工抓到：控制带堆叠、破图、死胡同空态、深链错 Tab。

### 4.3 机械补扫（grep，`entrypoints/app/**/*.{ts,tsx}` 非测试）

- 主题外硬编码十六进制色 23 处：`sections/github-stars/language-colors.ts` 19 处（GitHub linguist 语言色，合法数据）；**`layouts/dashboard/header-actions.tsx:48` `#5C6BC0` 靛蓝**（开关轨道 + 月亮，注释承认"无靛蓝 token"）；**`hooks/use-jobs-badge.ts:10` `#FFAB00`**（复制 `warning.main`，改色会漂移）。
- `borderRadius:` 49 处，倍率 0.5/0.75/1/1.25/1.5/2 + `11`px + `50%`，无 token 名。
- 主题外 `fontSize:` 字面量 9 处：`'0.85em'` ×4（chat-markdown）、`'0.75rem'` ×3（B站/YouTube 封面角标）、`'0.9rem'`（auto-transcribe-bar）、`'0.6875rem'`（tag-row）。
- `boxShadow` 18 处全部走 `customShadows`（干净）；`'box-shadow 0.2s'` 字面量 6 处（六个卡文件复制）。
- `!important` 0；`@keyframes` 0。
- 破折号：`lib/i18n/locales/en.ts` 60 处、`zh-CN.ts` 25 处，集中在 `settings.*` 的 "Status — detail" 与 welcome 叙事；`entrypoints/app` 内 UI 字符串仅 3 处（`embedding-stats-panel.tsx:52,56` 空值占位、`webdav-sync-card.tsx:270` 分隔），其余 205 处在注释。
- `sx={{` 密度 top：`overview-view.tsx` 42、`auto-transcribe-bar.tsx` 32、`chat-view.tsx` 26、`video-card.tsx` 26、`nav.tsx` 19。

---

## 5. 次要观察（按类分组，进 backlog）

**Token / 硬编码**
- `#5C6BC0`（header-actions）、`#FFAB00`（use-jobs-badge）见 4.3。
- `video-card.tsx:114` `grey[100]`、`auto-transcribe-bar.tsx:62,74` `grey.200` 占位色暗色不反转。
- 圆角词汇 6 种倍率 + 11px + 50%；LinearProgress root 4px、分段条 4px、转录条 8px。
- 主题外字号 4 种。
- SectionTitleBar 标题 h5（18/19px），Analytics/Settings/Chat 标题 h4（20/24px），两套页标题尺寸。

**暗色模式**
- 分段 Tab 选中态（`background.paper` 在 grey-8% 轨道上）与兄弟无法区分。
- 暗色卡纯黑阴影（`custom-shadows.ts:53`）在 `#1C252E` 叠 `#141A21` 边缘消失；应加 1px `divider` 边或换 surface 阶梯。
- 月牙图标在暗色 header 上几乎不可见。

**文案 / i18n**
- `"{{count}} items"` 渲染 "5023 items" 而 `/` 上 "5,023"（`allCollections.count` 未走 `formatCompactNumber`/`Intl`）。
- X 首次全量同步后 caption "1943 new this sync" 是噪音。
- 知乎 "924 favorites" 对 "599 waiting for embeddings"，325 差额无解释。
- LLM 卡片描述 "for video content summarization" 已过时（驱动 chat + tagging）。
- GitHub token 指南推荐 `repo` + `user` scope；读公开 star 至多 `read:user`。
- `document.title` 恒为 "favbase"，无逐路由标题。

**布局 / 响应**
- nav 顺序 Collections → Analytics → Chat → Settings，`/` 是 Analytics（第二项）。
- 搜索框 56px 高且全宽出现在每个列表页。
- 1024 宽：chip 行换两行；Settings rail 标签换行（"ASR Transcription" 图标上挂）。
- 500 宽：Settings 顶部 Tab "AI Config" 换两行。Chrome 最小窗宽 500，390 无法实测。
- 后台任务 chip 在 1440 宽即截断（"…don't close this p…"）。
- nav 是 `position: fixed` 而非布局网格内 sticky。
- 书签文件夹 chips 重名 "Python/Python" 无父路径。
- `/collections/bilibili` 静默重写到 `/collections/bilibili/<folderId>`，书签该 URL 每次可能落到不同视图。

**交互 / 行为**
- 语言菜单珊瑚圆点 + `selected` 背景，两套选中信号。
- "Pause library build" 与次要动作同权重，却是页面唯一破坏性控件，无确认无 toast。
- 会话删除无确认无撤销。
- Temperature `0.30000001192092896`；Max Tokens `valuemax=0`。
- "Get Key" small outlined 浮在 56px 输入框旁，"Fetch Models" 强制 `height: 56`，一张表单两种按钮高度。
- "Show 559 more" 一次展开 559 个按钮进 Tab 序列且无收起。
- 卡片用 `window.open`（`x-card.tsx:57`），中键/Ctrl 无效。
- 搜索/筛选不进 URL；切过主题开关后 `system` 模式不可回。

**结构**
- `sections/overview/export-card.tsx` 只在 Settings 渲染，命名漂移。

---

## 6. 人物红旗

- **Alex（急躁高手）**：进 `/collections` 先滚过 56px 搜索框 + chip 行；5,023 条只给 24 条，无排序、无密度切换、无键盘快捷键，翻到第 210 页；搜索不进 URL；卡片 `window.open` 中键无效；日期 "8/19/26, 9:09 PM" 而非相对时间；Settings 任何字段至少两次点击。
- **Sam（读屏/键盘）**：无 h1，每页 24 个 h6；passive 提示 `aria-live=assertive` 抢播；四个无名按钮；卡片按钮名是整条推文 + 无标签数字（"404 64 6"）；Tab 顺序跳过侧栏与 header；焦点环在珊瑚底上不可见；"Show 559 more" 无收起。
- **Jordan（首次用户）**：落地看到 `5,023 / 0 / 0` 无解释；Chat 蓝色信息框无按钮；连 GitHub 被丢到 LLM 表单；B站页第一眼是黄色警告 → 无解释的 "Auto Transcribe" → "Fetch 1378/--"。

---

## 7. 分阶段整改计划

每阶段一个 Trellis 任务；子代理只接当前阶段，不越界。每阶段结束：`pnpm compile` + `pnpm test` 全绿，改动目录的 `CLAUDE.md` 同步，`.trellis/spec/frontend/ui-design-system.md` 随 token 变化同步。

### Phase 0 — 视觉语言 token 层（决策 + 实施，与 Phase 1 同一任务）

**范围（只动 theme 目录 + 直接依赖它的布局壳，不动页面布局）：**
- `entrypoints/app/theme/theme-config.ts`：色板（主色与"强调文字色/强调底色"两个角色分离）、灰阶、暗色 surface。
- `theme/core/palette.ts`、`core/shadows.ts`、`core/custom-shadows.ts`：阴影公式换掉 Minimal 签名；暗色改 surface 阶梯 + 1px divider 而非纯黑阴影。
- `theme/core/typography.ts`：字阶与页标题统一（h1 给页标题用，卡片副标题 `variantMapping` 到 `p`）。
- `theme/core/components.tsx`：Card 圆角/边、Chip soft 变体、焦点环两模式可见、分段 Tab 选中态两模式可辨。
- 清理 `#5C6BC0`、`#FFAB00` 硬编码进 token。
- 六平台品牌色定一条层级规则（只在图标/构成条出现，不与主色同权重出现在文字/按钮）。

**不做：** 布局、nav 结构、页面 IA、字体替换（字体替换需单独评估包体与 CJK 回退，列为 Phase 0 的待决项）。

**决策方式：** impeccable `init`（PRODUCT.md，产品事实）→ `new-work` 方向轮（`concept-seed.mjs --scope direction --mode operate`，用户锁定一个方向）→ 方向写入本文 7.0.1 小节与 PRODUCT.md。DESIGN.md 在 Phase 1 完成后由 documenter 从已建成的系统生成，不预写。

**验收：** 浏览器检测器 `low-contrast` 0；`grep` 主题外十六进制色只剩 `language-colors.ts`；亮/暗两模式截图对照无"消失的边缘"；现有测试全绿。

#### 7.0.1 已锁定方向（2026-08-20，impeccable seed key `30995f23`，用户选 IMPECCABLE'S PICK）

**目录卡片库**（豆瓣标记 / Readwise / Letterboxd 式个人媒体目录）。骰子指定的是候选 4「本地知识库工作台」，用户改选候选 1。两张 competitive 挑战者（会场目录网格、虹彩云边）与四张 declined（时刻表、站牌布、Nixie、雨园）的可兼容纪律并入本方向。

**世界（OWN-WORLD）**
- 色彩策略：Restrained。暖白纸面为地（亮色 ground 暖纸白，surface 纯白；暗色 ground 暖墨近黑，surface 暖炭），暖灰细线分区，**零卡片阴影**（只有 popover/dialog 一层柔暖阴影）。
- 珊瑚 `#FC7E5B` 是唯一的「印章 / 已选」色，**只做色块、从不做文字**：印章 = 珊瑚底 + 深墨字（对比 ≥ 6:1）；链接/强调文字用同色相深阶 `#7A2714`（纸面上 ≥ 9:1）；hover 用 `#FEE9E1` 淡洗。白字珊瑚底的小按钮不再存在；每屏只有一个反色元素（主按钮 = 深墨底白字）。
- 六平台品牌色只出现在平台图标字形与数据图形（构成条）里，不进文字/按钮/chip 底色。
- 字体绑定：DM Sans（UI）+ Barlow（页 h1 与大数字）。UI 字号只留 12 / 14 / 16，层级靠字重与颜色；所有会变的数字 `tabular-nums`。
- 圆角一套：4（印章/chip/输入）、12（条目与 dialog）。条目只声明一次立体感：细线框，无阴影（craft-floor：border 或 shadow 二选一，1px 边 + 软阴影是「幽灵卡」）。
- 动效：hover 淡洗 120ms；主题切换圆形揭示保留；无抬升动画。

**条目（catalog entry）**
- 统一外壳 `CollectionCard`：封面槽固定比例在左（无封面时用平台字形占位，两模式可用），右侧三行：标题（2 行 clamp）/ 作者 · 日期（日期 `noWrap` 右对齐不被挤压）/ 统计 + 平台印章。整卡同高、整卡 hover、细线框无阴影；标签行为空时不渲染。
- 网格：整格重排（来自会场目录），同一行等高；6 平台共用，不允许第七份复制。

**首屏（FIRST VIEWPORT，`/collections/<platform>`）** —— *用户否决结构改动，2026-08-20 恢复原堆叠；首屏压缩目标作废，仅保留 `role=status` 与色彩。以下三行契约仅存档。*
- 第一行：h1 页名 + 当前范围（收藏夹名）+ `tabular` 计数，右侧唯一主按钮（深墨）。
- 第二行：40px 状态行 = pipeline strip（左）+ 「N 项待配置」印章 chip（右，点开 popover 放 Configure 链接），不再是 `role=alert`。
- 第三行：40px 搜索 + 筛选印章行 + 排序，可并排。
- 条目顶边 ≤ 320px（1440×900）。

**签名交互**：珊瑚印章（选中 chip / 活动筛选 / 计数徽）+ 鱼骨导航（保留）+ 主题圆形揭示（保留）。

**诚实风险**：本品类大多数方案会落在这里；区别靠「印章」这一个动作做彻底，以及狐狸与 Barlow 数字。

DESIGN.md 在 Phase 1 完成后由 impeccable documenter 从建成的系统生成；本节是建成前的契约，方向契约同时以 HTML 注释写入 `entrypoints/app/index.html` body 首子节点。

### Phase 1 — P0-1 + P0-2（与 Phase 0 同一任务的后半）

见第 3 节 P0-1、P0-2。`CollectionCard` 外壳必须用 Phase 0 的 token 建。

**P0-1 状态（2026-08-20）**：用户否决结构改动，2026-08-20 恢复原堆叠；首屏压缩目标作废，仅保留 `role=status` 与色彩（任务 `08-20-app-restore-platform-page-header-rows`）。P0-2 卡片外壳不受影响。

### Phase 2 — P1-1 色彩用法迁移

第 3 节 P1-1 中 Phase 0 没覆盖到的"用法"部分：所有 `color: 'primary.main'` 文字替换、卡片日期 token、outlined chip 改 soft。

### Phase 3 — P1-2 空态与深链

第 3 节 P1-2。

### Phase 4 — P2-1 语义与可访问性

第 3 节 P2-1。

### Analytics 页「两个 0」（第 6 节 Jordan 红旗）— 2026-08-20 已落地

`#/` 重做为平台账本主从视图（任务 `08-20-analytics-page-redesign`）：摘要带改为 Items / Platforms in use / Tag coverage（零标签给一句解释而非裸 `0 / 0`）；平台构成即选择器（纵向 Tabs），删除 `PLATFORM_COLORS` 语义色当平台色；维度榜单加比例条；Top tags 空态不再渲染；`h1` 唯一、`h3` 数字走 Barlow。

### Backlog

Phase 0+1 收尾（2026-08-20 `trellis-check`）遗留、归 Phase 2：`text.disabled` 仍作正文色用于 `components/collection/no-matches-state.tsx:14`、`components/tags/tagged-item-grid.tsx:107`、`sections/bilibili/folder-chips.tsx:39`（改 `text.secondary`）；`sections/chat/chat-view.tsx:522`、`sections/chat/source-card.tsx:103` 各自写了 `outline: 2px solid primary.main` 本地焦点环（2.5:1，且与 `MuiCssBaseline` 全局环打架，应删除让全局规则生效）。Phase 0 实施时的已知偏离（见任务 prd 与子代理报告）：Auto Transcribe 只做到 idle 不占行（未并入 strip 段）；书签提取面板仍独占一行；空标签编辑入口改为 hover/focus-within 显现而非删除；Analytics/Settings/Chat 页标题仍是 h4（Phase 4）。纸面 `#F8F4EE` 触发浏览器检测器 `cream-palette` 提示——方向所选，若要规避可把纸面移向更中性的 `#F7F6F3` 并同步 grey ramp，属 token 微调。

第 5 节全部；第 1 节中 H3/H7 的交互项（会话删除确认、`system` 模式可回、URL 状态、快捷键、分页/虚拟滚动）按产品优先级另开任务。

---

## 8. 约束

- **Never Break Userspace**：所有路由、i18n key、`storage` key、测试契约（`tests/platform-completeness-contract.test.ts`、`tests/i18n-no-hardcoded.test.ts`、`tests/platform-env-constants-guard.test.ts`）不变。改签名同步所有调用点。
- **i18n**：新增文案进 `lib/i18n/locales/{zh-CN,en}.ts`，组件内零 CJK。
- **DRY**：六平台卡的重复样式必须收进外壳，不允许第七份复制。
- **文档即代码**：改 `theme/` 同步 `theme/CLAUDE.md` 与 `.trellis/spec/frontend/ui-design-system.md`；改 `components/collection/` 同步其 `CLAUDE.md`。
- **验证**：每阶段结束跑 `pnpm compile`、`pnpm test`；浏览器端检测器复扫（同源注入法：临时拷 `detect-antipatterns-browser.js` 到 `.output/chrome-mv3/`，`<script src=chrome.runtime.getURL(...)>`，读 console，扫完删）。
- **不 commit**：停在未提交状态供人工审阅。

---

## 附录

- 截图：`%LOCALAPPDATA%/Temp/claude/C--Users-18368-Desktop-00-myCode-24-cyberSquirrel-00-favbase/b57115df-f73a-4df3-9dcf-3c975556b02a/scratchpad/critique-a/`（会话级临时目录，40 余张，文件名含路由/模式/宽度）。
- impeccable 快照：`.impeccable/critique/2026-08-20T08-53-17Z__entrypoints-app.md`。
- 浏览器端注入限制：MV3 `script-src 'self' 'wasm-unsafe-eval'` 封死 `<script src=localhost>` / `eval` / `new Function`；CDP `evaluate_script` 传 390KB 源码不可行；同源临时文件是唯一不改源码的路径。
