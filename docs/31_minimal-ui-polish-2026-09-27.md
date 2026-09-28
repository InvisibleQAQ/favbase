# docs/31 — app.html / welcome.html 对照 minimals.cc 的保真度整改（2026-09-27）

- 分支：`feat/minimal-ui-polish`（worktree `.claude/worktrees/minimal-ui-polish`，原因见 §6）
- 参考：app.html ↔ <https://minimals.cc/dashboard>，welcome.html ↔ <https://minimals.cc/>；源码 `$MIN` = `C:\Users\18368\Desktop\00_myCode\35_minimal\minimal-dashboard\minimal-dashboard v7.7.0\Vite.js (JavaScript，TypeScript)\minimal-vite-ts-main\src`
- 状态：**Step 1 已落地并补验完毕**（四处实现缺陷；首轮未验证的三项已于同日补验，见 §2「验证」）；**Step 2 已落地（2026-09-27）**——用户决定按 Minimal 原样移植深色 CTA 卡，替换点见 §4 Step 2，截图验收已按 §1 补完；Step 3–5 是设计项，**待用户决定**，未开始

## §0 结论

docs/25（app.html，Step 0–10）与 docs/28（welcome.html）已经把 Minimal 的骨架、主题与段落语言移植完。逐页对照后，剩下的差距**不是缺设计，而是移植时引入的实现缺陷**：四处，每处都能指到一行根因（§2）。更大的视觉改动（§4）每一条都会推翻或扩展一条已记录的决定，所以只列出、不动手。

## §1 对照方法（可复现）

BrowserOS neo 的 MCP 工具驱动不了扩展页：`tabs new` 打开 `chrome-extension://` 后页面 id 立刻变成 `Unknown page`（标签其实还开着，每重试一次漏一个标签）。改走同一浏览器的原始 CDP。

1. **CDP 端口**：`%LOCALAPPDATA%\BrowserClaw\User Data\.browseros\config.json` 的 `ports.cdp`（本次为 `9110`）。`GET /json/list` 列目标，`PUT /json/new?<url>` 开标签，`GET /json/close/<id>` 关标签。
2. **截图脚本**：Node 22 自带 `WebSocket`，发 `Emulation.setDeviceMetricsOverride`（1440×900）→ `Page.navigate` → `Page.captureScreenshot` 即可，零依赖。
3. **截图前必须 `Page.bringToFront`**：后台标签没有 rAF，welcome.html 的 `motion` hero 与 whileInView 淡入永远停在初始帧，整页看起来是空白。CSS 过渡同理：只发 `Runtime.evaluate` 不会把标签提到前台（可能是 `visibilityState: hidden`），折叠 Chat rail 后立刻量宽度，读到的仍是 320。量尺寸前先截一张图（截图会顺带提到前台），再量。
4. **welcome.html 不能整页截图**：它是滚动驱动的（hero 钉住层、叠卡、淡入），整页截图只得到大片空白。改为 `window.scrollTo` 逐屏截（本次 12 个等距位置）。
5. **暗色模式**：`Emulation.setEmulatedMedia prefers-color-scheme` 对 app.html 无效——模式存在页面 `localStorage` 的 `favbase-color-mode`（`public/theme-init.js`），要点 Header 的 `ThemeModeButton`。这个 key 是所有扩展页共用的，按 MUI 的实现，用户开着的扩展页大概率会经 `storage` 事件跟着变暗（[UNKNOWN] 本次未实测），所以先记下原值、截完立刻点回去。
6. **装载分支构建**：扩展从主 checkout 的 `.output/chrome-mv3` 以 unpacked 方式加载。在 worktree 里 `pnpm build`，把主 checkout 的 `.output/chrome-mv3` 改名为 `chrome-mv3.main-backup`，再把 worktree 的 `.output/chrome-mv3` 拷过去。
7. **重载扩展**：在任一 app.html 目标里 `Runtime.evaluate` `chrome.runtime.reload()`。它会关掉**所有**扩展页（包括用户自己开着的），之后要重新 `/json/list` 找目标、并把用户的标签重新打开。
8. **Minimal 对照截图**：在自己新开的标签里截 `/dashboard`、`/dashboard/analytics`、`/dashboard/chat`、`/dashboard/user/account`、`/dashboard/job` 与首页滚动序列；不碰用户开着的 minimals.cc 标签。

## §2 Step 1 — 四处实现缺陷（已落地）

| # | 现象 | 根因 | 改法 | 文件 |
|---|---|---|---|---|
| 1 | 侧栏收展按钮只剩右半个圆 | `NavToggleButton` 与 rail 都是 `position: fixed` + 同一个 `--layout-nav-zIndex`，按钮在 DOM 里排在 rail **之前**，rail 后绘制盖住左半。Minimal 把按钮放在 rail 里面，本仓库因 rail 的 `overflow: hidden` 改成兄弟节点时漏了绘制顺序 | 按钮挪到 `NavRoot` 之后，注释写明原因 | `entrypoints/app/layouts/dashboard/nav-vertical.tsx` |
| 2 | Chat 会话 rail 的灰底与右边框只到内容高度，卡片下半截空着 | rail 缺 Minimal 原版的 `flex: '1 1 auto'`；父级 `LayoutNav` 是纵向 flex，原有的 `flexShrink: 0` 管的是**高度**，会话一多会溢出卡片而不是滚动；`background.neutral` 底色是 Step 9 移植时从旧实现带过来的，Minimal 没有、偏离清单也没记 | 换成 Minimal 的 `minHeight: 0` + `flex: '1 1 auto'`，删 `flexShrink: 0` 与 neutral 底色 | `entrypoints/app/sections/chat/chat-nav.tsx` |
| 3 | welcome「Three steps」每张卡约 800px 高，内容只占上面约 250px | 卡片的外层槽是 `height: 84vh` 的 flex 容器，默认 `align-items: stretch` 把卡片拉满 | 槽加 `alignItems: 'flex-start'`：84vh 只当叠卡的滚动跑道，卡片保持内容高度 | `entrypoints/welcome/sections/how-it-works.tsx` |
| 4 | Settings 的「Get Key」「Fetch Models」贴在 56px 输入框的顶部 | `alignSelf: 'center'` 写在 MUI v9 `Grid` 格子里，而格子不是 flex 容器，这条样式不生效 | 格子改 `display: flex; alignItems: center`，删掉无效的 `alignSelf` 和多余的包裹 `Box` | `sections/settings/llm-config-card.tsx`（两处）、`sections/settings/embedding/embedding-config-card.tsx` |

目录文档同步：`entrypoints/app/layouts/CLAUDE.md`（按钮必须排在 rail 之后）、`entrypoints/app/sections/chat/CLAUDE.md`（rail 尺寸照 Minimal、无底色）、`entrypoints/welcome/CLAUDE.md`（84vh 槽 + `flex-start`）。第 4 条是纯对齐调整，不改文档。

### 验证

- 分支构建装进 BrowserOS 后截图对照：按钮是完整圆（与 Minimal 同形）；rail 右边框贯通卡片全高；Settings 两个按钮与输入框垂直居中；叠卡保持内容高度，后一张盖住前一张，无大片空白。
- `pnpm compile` 通过；`pnpm test`：主仓库 200 个文件 / 1568 例，`packages/*` 15 个文件 / 267 例，全部通过。
- **补验（2026-09-27，同一构建，1440×900）**：首轮留下的三项未验证，全部用可量化判据补完，没有验出问题，代码未再改动。
  - **会话很多时 rail 能滚动**：库里没有会话，所以往 `[data-slot=chat-nav] .simplebar-content` 追加 40 个 72px 的假行（纯 DOM，不写 PGlite，刷新即消失）。展开态（320）：`.simplebar-content-wrapper` 的 `scrollHeight 2922 > clientHeight 692`，`scrollTop = 500` 读回 500，竖向滚动条可见；折叠态（96）：`2892 > 704`，`scrollTop = 700` 读回 700。两种形态下 nav 与卡片 `section` 都仍是高 800、底边 880，卡片没有被撑高，列表也没有溢出到被 `overflow: hidden` 裁掉。
  - **侧栏两种形态的按钮都完整**：按钮与 rail 都是 `position: fixed`、`z-index: 1201`，按钮的前一个兄弟节点就是 rail。在按钮左边缘内 3px、1/4、中心、3/4 四个点做 `document.elementFromPoint`，展开态（rail 右缘 300，按钮 287–313）与折叠态（rail 右缘 88，按钮 75–101）四个点都命中按钮本身——这是绘制顺序修复的直接证据，截图只是旁证。
  - **暗色模式**：rail 去掉 neutral 底后是透明的，落在卡片底色 `rgb(28, 37, 46)` 上；右边框 `1px solid rgba(145, 158, 171, 0.2)` 在暗色下仍贯通卡片全高（nav 与卡片都是 800）。按钮四点命中测试在暗色下同样全部命中按钮。Settings 按钮对齐与 welcome 叠卡跟配色无关，没有重截。
  - 顺带发现一个与 Step 1 无关的暗色问题，记在 §3。

## §3 未定性项

- **[UNKNOWN] 书签卡片的站点图标空白**（`localhost`、`github.com` 等行）。`bookmark-card.tsx` 用 MV3 `_favicon` 端点，它对未知站点也返回 200 的默认图，所以 `Avatar` 的兜底图标不会出现。这张默认图在真 Chrome 里是灰色地球还是空白，没有核实；BrowserOS 里是空白。核实前不算缺陷，也不算正常。
- **暗色下品牌图标是一块白底方块**（2026-09-27 补验暗色时看到）。app.html 有四处用 `/icon/128.png`（`nav-vertical.tsx`、`nav-mobile.tsx`、`chat-header.tsx`、`chat-message-list.tsx`），welcome 的 `BrandMark` 与 `bilibili-showcase.tsx` 用 `/icon/48.png`。`public/icon/` 下五张 PNG 都是 color type 2（RGB、无 alpha 通道、无 `tRNS`），128.png 四角实测 `rgba(255, 255, 255, 255)`。亮色下白底融进背景看不出来，暗色下就露出一块白方块（截图里看到的是侧栏与 Chat 标题两处；welcome 暗色没截，按文件格式推断相同）。这不是移植缺陷（资源本来就这样，Minimal 的 logo 是透明 SVG），而是缺一份应用内用的透明底 logo。修它要新资源，或决定暗色下给 logo 加底，所以不属于 Step 1，只记在这里。

## §4 待决步骤（Step 2 已落地；Step 3–5 需用户决定，未开始）

每一条都会推翻或扩展一条已记录的决定，所以不自作主张。Step 2 的两条冲突已由用户 2026-09-27 决定推翻。

### Step 2 — welcome 结尾改成 Minimal 的深色 CTA 大卡（已落地 2026-09-27）

- **Minimal**：`$MIN/sections/home/home-advertisement.tsx`（179 行）：`grey.900` 底 + 36px 网格底纹 + `borderRadius: 3` + 插图 + 两个按钮，标题后半句是白色淡出渐变。
- **favbase 原状**：`entrypoints/welcome/sections/platform-request.tsx`，居中标题 + 描述 + outlined 按钮。
- **冲突**（已推翻）：① docs/28 §3.4 **明确拒绝过** `Advertisement`（与 Pricing/Testimonials 等一起，理由是「销售页段落」）；② `platform-request.tsx` 的注释写明该段「刻意低调（outlined、无光晕），不和上方 picker 的『进入 favbase』主 CTA 抢」。深色大卡正好会跟主 CTA 抢。
- **用户决定（2026-09-27）**：**按 Minimal 原样移植**，只在 Minimal 的内容 favbase 没有对应物的地方替换。本节原先的建议「只借外壳，文案和按钮不变」作废（用户先选过它，随即更正为按 Minimal）。docs/28 §3.4 的 Advertisement 行已改注（划掉并注明移植日期，不删行），`platform-request.tsx` 的头注释改写为移植说明。
- **照搬**：外壳全部同值（grey.900 底且两种配色都是、`bgGradient` 两条 `grey.500` 4% 的 1px 线织成 36px 网格、`py 8 / px 5`、`borderRadius 3`、grey.800 边框、`overflow hidden`、md 起图左文右并左对齐 / xs 纵排居中）；右上光斑（`opacity 0.4`、`maxWidth 420`、`zIndex 7`）；火箭（宽 360、`aspectRatio 1/1`、`y [-20, 0, -20]` 4s 无限漂浮）；标题白字 + 尾词白 → 40% 白淡出；`Stack spacing 5`；动画方向与距离（图 inUp 120 即 `varFade` 默认距离、标题 inDown 24、按钮 inRight 24），用 `FadeIn` 表达（docs/28 D6：本页有意节奏走 `FadeIn`，没有另建 `MotionViewport`）；间距——Minimal 这段是 `section` + `Container`、自身零纵向 padding（上方是前一段的底部留白，下方直接接 footer 的 `py: 5`），本段照此**不再走 `WelcomeSection`**，改成自己的 `section` + `Container maxWidth="lg"`、无 padding，不在页面的纵向节奏里。
- **间距勘误（截图后，2026-09-27）**：首版以为本段的 `pt: 0` 在生效，只保留它与原 `pb`。1440×900 实测本段 `padding-top` 是 160px：`WelcomeSection` 的 `py: {xs:10, md:20}` 在 md 起是媒体查询规则，调用点的标量 `pt: 0` 只落进 base 规则，被它盖掉——自 99526f5 加这段起在 md 以上就没生效过，picker 的脚注与卡片之间空出 320px。修法是消掉覆盖（离开 `WelcomeSection`），而不是把覆盖改成带 `md` 键的响应式形状；`WelcomeSection` 的 JSDoc 与 `entrypoints/welcome/CLAUDE.md` 随之写明「覆盖 `py`/`pt`/`pb` 必须带 `md` 键」。
- **替换点**：
  - **描述段**：Minimal 没有。保留在标题下，固定 `grey.500`（#919EAB on #141A21 ≈ 6.4:1）；不用 `text.secondary`，它随配色变，卡片不变。
  - **按钮**：一个，不是两个。issue 外链改 `contained primary size large`（Minimal「Purchase now」的形），保留 `eva:diagonal-arrow-right-up-fill` 外链图标（Minimal 那个按钮没图标，但它也不是外链），不加 `ctaGlowShadow`（Minimal 没有）。本段只有这一个动作，docs/28 D9 也定了本页零新外链。
  - **标题**：字号仍由 `Headline` 的 clamp 出，不换 `variant h1/h2`（docs/28 E2）。`section-shell.tsx` 的 `Headline` 新增 `ink="white"` 形态（纯 `common.white`，品牌渐变从 grey.800 起笔，亮色下落在 grey.900 上看不见）与只有该形态收的 `tail`（尾词淡出）。i18n 拆成 `welcome.request.heading`（zh「没找到你的」/ en「Don't see your」）+ 新增 `welcome.request.headingTail`（「平台？」/「platform?」）；两段之间 en 一个空格、zh 不加，拼接归 `Headline`、两个翻译都不带分隔符。没用 Minimal 的 `ml: 1`：中文里它多出一道缝，英文换行落在两段之间时行首会留 8px 缩进。
  - **火箭**：`$MIN` 同级的 `public/assets/illustrations/illustration-rocket-large.webp` 原字节拷到本仓库 `public/assets/illustrations/`（9372 字节，`cmp` 一致；保留 Minimal 路径便于溯源），是仓库第一张 Minimal 位图资源。Minimal 是付费模板、本仓库 GPL-3.0 公开，这张图的再分发许可 **[UNKNOWN]**，已向用户说明，用户接受。纯装饰，`alt=""`，不出英文硬编码 alt。`MotionBox` 的类型是 div、收不了 `src`/`alt`，所以 `<img>` 嵌在漂浮层里，而不是像 Minimal 那样自己就是 `m.img`。漂浮是声明式 `animate`，由全页 `MotionConfig reducedMotion="user"` 管。
  - **未抄**：Minimal 卡片 `sx` 里的 `spacing: 5`——写在 Box 的 `sx` 里，输出的是无效 CSS，在 Minimal 里本来就不生效；`renderLines`（`FloatLine` / `FloatPlusIcon`）归 Step 4，Minimal 挂在 `Container` 上的 `position: relative` + `zIndex: 9` 只为让卡片压过这些线，随它们一起归 Step 4。
- **验收**：原验收「滚动截图里主 CTA 仍是视觉第一」**随用户决定作废**——按 Minimal 移植后，这张深色大卡的视觉分量不再让位于上方 picker 的主 CTA，这是选「按 Minimal」的直接后果。现验收：亮暗两种配色、1440 宽与 md 以下各截图，与 minimals.cc 首页 advertisement 同形（外壳、横排、标题尾部淡出、按钮形态）；深底上标题、描述、按钮在两种配色下都可读。
- **验证**：新增 `entrypoints/welcome/components/section-shell.test.tsx` 锁首尾拼接（en 有空格 / zh 无；把条件反过来两例都红，已验证）。`pnpm compile` 通过；`pnpm test`：主仓库 201 个文件 / 1570 例，`packages/*` 15 个文件 / 267 例，全部通过。主仓库前两次整跑各有一例 5 s 超时（`lib-import-smoke` 的 bilibili 冷导入，单跑即过），本改动之前的 HEAD 整跑同样有一例超时（`lib/database/db.test.ts`），是本机 CPU 争用下的既有抖动，第三次整跑全绿。`pnpm build` 后火箭落在 `.output/chrome-mv3/assets/illustrations/`（`cmp` 一致），与 Vite 自己产出的 `assets/` 同目录并存、不冲突。间距勘误改完后重跑：`pnpm compile` 通过；`pnpm test` 首次整跑 4 例 5 s 超时（`lib/bilibili/transcribe-utils.test.ts` 2 例，第二例是连带失败——第一例超时后它的 `BV-PROCESSING-RUNS` 转录仍在跑，发出的 `item-content-updated` 落进了第二例的监听，失败值正是 `['BV-PROCESSING-RUNS', 'BV-CONTENT-EVENT']`；`lib/database/proxy-db.test.ts`、`tests/lib-import-smoke.test.ts` 各 1 例，都是冷导入），这三个文件单跑 27/27 通过，第二次整跑全绿（主仓库 201 / 1570，`packages/*` 15 / 267）；`pnpm build` 通过，火箭仍 `cmp` 一致。
- **截图验收（2026-09-27，§1 流程，分支构建装进 BrowserOS）**：1440×900 亮暗两种配色、960（md 横排）、390（xs 纵排），en 与 zh-CN 各看一遍，与 minimals.cc 首页 advertisement 同形。量值：本段 `padding` 为 0，卡片顶边紧贴 picker 的底边（间距即 picker 的 160px 底部留白），卡片底边即 footer 顶边（footer `padding-top` 40px）。暗色下卡底与页面同为 #141A21，只靠 grey.800 边框、网格与右上光斑区分——Minimal 暗色本来就是这样，照搬，不算缺陷。xs 下火箭固定 360 宽，窄于约 440px 时被卡片 `overflow: hidden` 裁掉左右一点，与 Minimal 相同。zh 标题「没找到你的平台？」两段之间无缝，en 窄屏折行落在两段之间时第二行行首无缩进。
- **顺带看到、不在本步范围**：picker 的「进入 favbase」主 CTA 是墨色实心（`MuiButton` 默认 `color: 'inherit'`，docs/25 Step 1 起如此），所以现在全页唯一的 coral 实心按钮是这张卡的。这是「按 Minimal」与既有主题默认叠加的结果，记在这里，不改。

### Step 3 — section 标题换成 Minimal 的样式

- **Minimal**：`$MIN/sections/home/components/section-title.tsx`：`overline` 小号说明文字 + 标题后半截 `text.primary` → 20% alpha 的灰阶淡出（再叠 `opacity: 0.4`）。
- **favbase 现状**：`Eyebrow` 药丸 + `headlineGradient(theme)` 的珊瑚渐变（`entrypoints/welcome/components/section-shell.tsx`）。
- **冲突**：docs/28 **D8 是用户决定**：「结构取、颜色留，保 coral 品牌色，`Eyebrow` 药丸保留」。做这一步等于推翻 D8。
- **如果要做**：改 `headlineGradient` 这一个 owner 即可（`Headline` 与三步叠卡的大号数字共用它），药丸换 `overline` 文字。

### Step 4 — 段落装饰线（虚线 + 「+」标记）

- **Minimal**：`$MIN/sections/home/components/svg-elements.tsx`（289 行）的 `FloatLine` / `FloatPlusIcon` 等，`$MIN/sections/home/` 的 11 个段落文件里 9 个用了它们（`home-hero` 与 `home-for-designer` 没用）；它们**只在 ≥1440px 显示**（`baseStyles` 里 `breakpoints.up(1440)`），描边 `grey.500`、`opacity: 0.24`，进入视口时线条从 0 画到 100%。
- **favbase 现状**：没有。
- **冲突**：无直接冲突——docs/28 D5 / §3.1 只拒绝了 hero 的 `HeroBackground`（理由是同心圆虚线与 `OrbitCore` 打架），没有对段落装饰线下结论。
- **如果要做**：移植 `FloatLine` + `FloatPlusIcon` 两个到 `entrypoints/welcome/components/`（`m` 改 `motion`，按 CLAUDE.md 铁律不引 `LazyMotion`）；hero 段不加，避免重新引入 D5 拒绝的那种语汇冲突。给 `platform-request.tsx` 加线时，同时给它的 `Container` 补上 Minimal 的 `position: relative` + `zIndex: 9`（Step 2 刻意没带，见上）。

### Step 5 — Analytics KPI 数字字号

- **Minimal**：`$MIN/sections/overview/analytics/analytics-widget-summary.tsx` 的数值用 `typography: 'h4'` = 20px，md 起 24px。
- **favbase 现状**：`entrypoints/app/sections/overview/analytics-widget-summary.tsx` 用 `variant="h3"` = 平 20px。
- **冲突**：docs/25 Step 1 刻意压小字号并去掉 `responsiveFontSizes`。
- **如果要做**：只在 `kpi-value` 这一处加 `fontSize: { md: 24 }`，不动主题阶梯。

## §5 拒绝（沿用既有决定，本次不再提）

- Hero 改居中单列栈、换 `HeroBackground`：docs/28 D4 / D5。
- Header 加搜索、账号、workspace、通知中心：`entrypoints/app/layouts/CLAUDE.md` 拒绝清单（docs/23 §11 仍生效部分）。
- Chat 页在卡片上方加独立页标题：docs/25 Step 9 定了 header 72 承载唯一 h1。

## §6 环境副作用与回退

- **worktree**：本次对话进行中，另一个会话往 `main` 提交了两次（`99cd013`、`3d4a6e7`）。如果在主 checkout 里直接切分支，那个会话的下一次提交会落到本分支上，所以用 worktree。worktree 存在期间，主 checkout 里 `git switch feat/minimal-ui-polish` 会被 git 拒绝；本分支的提交在 worktree 目录里做，合并后 `git worktree remove .claude/worktrees/minimal-ui-polish`。
- **`.env.local`**：拷了一份进 worktree，保证构建环境一致（在 gitignore 里，不进提交）。
- **已加载的扩展是本分支的构建**：`main` 的原构建在 `.output/chrome-mv3.main-backup`。回退：删掉 `.output/chrome-mv3`，把备份改回原名（或在 `main` 上重新 `pnpm build`），再重载扩展。
