# docs/31 — app.html / welcome.html 对照 minimals.cc 的保真度整改（2026-09-27）

- 分支：`feat/minimal-ui-polish`（worktree `.claude/worktrees/minimal-ui-polish`，原因见 §6）
- 参考：app.html ↔ <https://minimals.cc/dashboard>，welcome.html ↔ <https://minimals.cc/>；源码 `$MIN` = `C:\Users\18368\Desktop\00_myCode\35_minimal\minimal-dashboard\minimal-dashboard v7.7.0\Vite.js (JavaScript，TypeScript)\minimal-vite-ts-main\src`
- 状态：**Step 1 已落地并补验完毕**（四处实现缺陷；首轮未验证的三项已于同日补验，见 §2「验证」）；**Step 2 已落地（2026-09-27）**——用户决定按 Minimal 原样移植深色 CTA 卡，替换点见 §4 Step 2，截图验收已按 §1 补完；**Step 3 已落地（2026-09-27）**——用户决定推翻 docs/28 D8，五个 section 标题换 Minimal `SectionTitle` 的中性写法、hero 保 coral，替换点见 §4 Step 3，截图验收已按 §1 补完，D-d 于 2026-09-28 按第一轮截图改为 Minimal 的 `inline-block`；**Step 4 已落地（2026-09-28）**——用户决定逐段对照 Minimal 源文件移植段落装饰线（`FloatLine` 一族 + `MotionViewport`），映射与替换点见 §4 Step 4，截图验收已按 §1 补完；**Step 5 已落地（2026-09-28）**——用户决定 Dashboard KPI 数字整体照搬 Minimal 的 `h4`（字体、字重、行高、字号四项，不只是原写法的放大字号），生成的 CSS 已在测试环境核对，实机截图验收已补完（用户改从 worktree 的 `.output` 加载扩展之后），顺带验出侧栏断点与 Minimal 不同，记在 §3；**Step 6 已落地（2026-09-28）**——本文原本没有 Step 6，用户说「完成 step6」后问过，选定 §3 的侧栏断点一项：dashboard shell 照 Minimal 在 `lg` 而不是 `md` 切换，Chat 卡片高度与历史 Drawer 两处隐藏耦合随之收掉，见 §4 Step 6，实机量值与 minimals.cc 同点一致

## §0 结论

docs/25（app.html，Step 0–10）与 docs/28（welcome.html）已经把 Minimal 的骨架、主题与段落语言移植完。逐页对照后，剩下的差距**不是缺设计，而是移植时引入的实现缺陷**：四处，每处都能指到一行根因（§2）。更大的视觉改动（§4）每一条都会推翻或扩展一条已记录的决定，所以写这份文档时只列出、不动手，逐条等用户决定；Step 2–5 此后已由用户逐条决定并落地，§3 的侧栏断点一项随后被用户定为 Step 6 并落地。

## §1 对照方法（可复现）

BrowserOS neo 的 MCP 工具驱动不了扩展页：`tabs new` 打开 `chrome-extension://` 后页面 id 立刻变成 `Unknown page`（标签其实还开着，每重试一次漏一个标签）。改走同一浏览器的原始 CDP。

1. **CDP 端口**：`%LOCALAPPDATA%\BrowserClaw\User Data\.browseros\config.json` 的 `ports.cdp`（本次为 `9110`）。`GET /json/list` 列目标，`PUT /json/new?<url>` 开标签，`GET /json/close/<id>` 关标签。
2. **截图脚本**：Node 22 自带 `WebSocket`，发 `Emulation.setDeviceMetricsOverride`（1440×900）→ `Page.navigate` → `Page.captureScreenshot` 即可，零依赖。
3. **截图前必须 `Page.bringToFront`**：后台标签没有 rAF，welcome.html 的 `motion` hero 与 whileInView 淡入永远停在初始帧，整页看起来是空白。CSS 过渡同理：只发 `Runtime.evaluate` 不会把标签提到前台（可能是 `visibilityState: hidden`），折叠 Chat rail 后立刻量宽度，读到的仍是 320。量尺寸前先截一张图（截图会顺带提到前台），再量。
4. **welcome.html 不能整页截图**：它是滚动驱动的（hero 钉住层、叠卡、淡入），整页截图只得到大片空白。改为 `window.scrollTo` 逐屏截（本次 12 个等距位置）。
5. **暗色模式**：`Emulation.setEmulatedMedia prefers-color-scheme` 对 app.html 无效——模式存在页面 `localStorage` 的 `favbase-color-mode`（`public/theme-init.js`），要点 Header 的 `ThemeModeButton`。这个 key 是所有扩展页共用的，按 MUI 的实现，用户开着的扩展页大概率会经 `storage` 事件跟着变暗（[UNKNOWN] 本次未实测），所以先记下原值、截完立刻点回去。
6. **装载分支构建**：扩展从主 checkout 的 `.output/chrome-mv3` 以 unpacked 方式加载。在 worktree 里 `pnpm build`，把主 checkout 的 `.output/chrome-mv3` 改名为 `chrome-mv3.main-backup`，再把 worktree 的 `.output/chrome-mv3` 拷过去。
7. **重载扩展**：在任一 app.html 目标里 `Runtime.evaluate` `chrome.runtime.reload()`。它会关掉**所有**扩展页（包括用户自己开着的），之后要重新 `/json/list` 找目标、并把用户的标签重新打开。**只换页面资源时不必重载扩展**（Step 3 截图时实测）：新构建与已装的构建只差页面 chunk 时，把文件同步进 `.output/chrome-mv3`（删掉旧 chunk，保留 Chrome 生成的 `_metadata/`），再对自己那个标签发 `Page.reload`（`ignoreCache: true`），页面就加载新 chunk，用户的扩展页不受影响。manifest 与 background 变了仍要 `chrome.runtime.reload()`。
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
- **（已解决，2026-09-28 转为 Step 6 落地，见 §4 Step 6；下文是原记录，只把 [UNKNOWN] 改成查到的来源）侧栏在 900px 就展开，Minimal 是 1200px**（2026-09-28 Step 5 截图验收时量到）。favbase `entrypoints/app/layouts/dashboard/layout.tsx:44` 的 `layoutQuery` 默认 `md`；Minimal 的 `nav-vertical.tsx` 默认值虽也是 `md`，但 `$MIN/layouts/dashboard/layout.tsx:59` 把 `lg` 传给 header（`:104`）、nav（`:171`）与 main（`:185`），所以 minimals.cc 在 900–1199 是汉堡菜单 + 满宽内容。favbase 在这一段多出 300px 侧栏，Dashboard 的 `md: 3` KPI 行就被挤扁：900 宽卡宽 118（Minimal 约 191），标题逐词折行、「1 / 6」折三行、卡高 248；1024 宽卡宽 149、仍折两行；1199 宽 193 才正常；≥1200 两边一致（卡宽约 185）。`layouts/CLAUDE.md:11` 只描述了「header 高度在 `layoutQuery`=md 切换」，docs/25 里查不到选 `md` 的理由，所以是移植偏离还是有意为之 ~~**[UNKNOWN]**~~——**已查明**（Step 6）：有意为之，且早于 Minimal 移植。首个提交 `ba3c942`（2026-06-20，Material Kit 时代）是 `lg`，`defdf00`（2026-07-06）把它降成 `md`，理由只有 commit message 里一句「Lower nav breakpoint lg->md so desktop sidebar shows at 900px」；docs/23 / docs/25 移植 Minimal 时都没有重新审视它，所以 docs/25 里找不到。改它会同时移动 header 高度切换、`NavToggleButton` 的显隐与 mobile drawer 的出现宽度（三者共用这一个 `layoutQuery`；`layout.test.tsx` 只在 `:229` 的注释里提到它，没有按具体宽度的断言），所以要单独决定，不属于 Step 5，只记在这里。

## §4 设计步骤（Step 2–6 均已落地）

每一条都会推翻或扩展一条已记录的决定，所以不自作主张。Step 2 的两条冲突与 Step 3 的 D8 冲突已由用户 2026-09-27 决定推翻；Step 4 无冲突，用户 2026-09-28 决定了映射方式；Step 5 与 docs/25 D8 的冲突由用户 2026-09-28 决定只开一处例外（D8 本身是 PRD 默认，主题字阶不变）；Step 6 不是本节原有的一条，而是 §3 的未定性项，推翻的是 `defdf00` 的 `md`，用户 2026-09-28 决定照 Minimal。

### Step 2 — welcome 结尾改成 Minimal 的深色 CTA 大卡（已落地 2026-09-27）

- **Minimal**：`$MIN/sections/home/home-advertisement.tsx`（179 行）：`grey.900` 底 + 36px 网格底纹 + `borderRadius: 3` + 插图 + 两个按钮，标题后半句是白色淡出渐变。
- **favbase 原状**：`entrypoints/welcome/sections/platform-request.tsx`，居中标题 + 描述 + outlined 按钮。
- **冲突**（已推翻）：① docs/28 §3.4 **明确拒绝过** `Advertisement`（与 Pricing/Testimonials 等一起，理由是「销售页段落」）；② `platform-request.tsx` 的注释写明该段「刻意低调（outlined、无光晕），不和上方 picker 的『进入 favbase』主 CTA 抢」。深色大卡正好会跟主 CTA 抢。
- **用户决定（2026-09-27）**：**按 Minimal 原样移植**，只在 Minimal 的内容 favbase 没有对应物的地方替换。本节原先的建议「只借外壳，文案和按钮不变」作废（用户先选过它，随即更正为按 Minimal）。docs/28 §3.4 的 Advertisement 行已改注（划掉并注明移植日期，不删行），`platform-request.tsx` 的头注释改写为移植说明。
- **照搬**：外壳全部同值（grey.900 底且两种配色都是、`bgGradient` 两条 `grey.500` 4% 的 1px 线织成 36px 网格、`py 8 / px 5`、`borderRadius 3`、grey.800 边框、`overflow hidden`、md 起图左文右并左对齐 / xs 纵排居中）；右上光斑（`opacity 0.4`、`maxWidth 420`、`zIndex 7`）；火箭（宽 360、`aspectRatio 1/1`、`y [-20, 0, -20]` 4s 无限漂浮）；标题白字 + 尾词白 → 40% 白淡出；`Stack spacing 5`；动画方向与距离（图 inUp 120 即 `varFade` 默认距离、标题 inDown 24、按钮 inRight 24），用 `FadeIn` 表达（docs/28 D6：本页有意节奏走 `FadeIn`，没有另建 `MotionViewport`。Step 4 起本页有了 `MotionViewport`，但它只驱动装饰线，本段内容的动画仍归 `FadeIn`）；间距——Minimal 这段是 `section` + `Container`、自身零纵向 padding（上方是前一段的底部留白，下方直接接 footer 的 `py: 5`），本段照此**不再走 `WelcomeSection`**，改成自己的 `section` + `Container maxWidth="lg"`、无 padding，不在页面的纵向节奏里。
- **间距勘误（截图后，2026-09-27）**：首版以为本段的 `pt: 0` 在生效，只保留它与原 `pb`。1440×900 实测本段 `padding-top` 是 160px：`WelcomeSection` 的 `py: {xs:10, md:20}` 在 md 起是媒体查询规则，调用点的标量 `pt: 0` 只落进 base 规则，被它盖掉——自 99526f5 加这段起在 md 以上就没生效过，picker 的脚注与卡片之间空出 320px。修法是消掉覆盖（离开 `WelcomeSection`），而不是把覆盖改成带 `md` 键的响应式形状；`WelcomeSection` 的 JSDoc 与 `entrypoints/welcome/CLAUDE.md` 随之写明「覆盖 `py`/`pt`/`pb` 必须带 `md` 键」。
- **替换点**：
  - **描述段**：Minimal 没有。保留在标题下，固定 `grey.500`（#919EAB on #141A21 ≈ 6.4:1）；不用 `text.secondary`，它随配色变，卡片不变。
  - **按钮**：一个，不是两个。issue 外链改 `contained primary size large`（Minimal「Purchase now」的形），保留 `eva:diagonal-arrow-right-up-fill` 外链图标（Minimal 那个按钮没图标，但它也不是外链），不加 `ctaGlowShadow`（Minimal 没有）。本段只有这一个动作，docs/28 D9 也定了本页零新外链。
  - **标题**：字号仍由 `Headline` 的 clamp 出，不换 `variant h1/h2`（docs/28 E2）。`section-shell.tsx` 的 `Headline` 新增 `ink="white"` 形态（纯 `common.white`，品牌渐变从 grey.800 起笔，亮色下落在 grey.900 上看不见）与只有该形态收的 `tail`（尾词淡出）。i18n 拆成 `welcome.request.heading`（zh「没找到你的」/ en「Don't see your」）+ 新增 `welcome.request.headingTail`（「平台？」/「platform?」）；两段之间 en 一个空格、zh 不加，拼接归 `Headline`、两个翻译都不带分隔符。没用 Minimal 的 `ml: 1`：中文里它多出一道缝，英文换行落在两段之间时行首会留 8px 缩进。
  - **火箭**：`$MIN` 同级的 `public/assets/illustrations/illustration-rocket-large.webp` 原字节拷到本仓库 `public/assets/illustrations/`（9372 字节，`cmp` 一致；保留 Minimal 路径便于溯源），是仓库第一张 Minimal 位图资源。Minimal 是付费模板、本仓库 GPL-3.0 公开，这张图的再分发许可 **[UNKNOWN]**，已向用户说明，用户接受。纯装饰，`alt=""`，不出英文硬编码 alt。`MotionBox` 的类型是 div、收不了 `src`/`alt`，所以 `<img>` 嵌在漂浮层里，而不是像 Minimal 那样自己就是 `m.img`。漂浮是声明式 `animate`，由全页 `MotionConfig reducedMotion="user"` 管。
  - **未抄**：Minimal 卡片 `sx` 里的 `spacing: 5`——写在 Box 的 `sx` 里，输出的是无效 CSS，在 Minimal 里本来就不生效；`renderLines`（`FloatLine` / `FloatPlusIcon`）归 Step 4，Minimal 挂在 `Container` 上的 `position: relative` + `zIndex: 9` 只为让卡片压过这些线，随它们一起归 Step 4（2026-09-28 已随 Step 4 补上）。
- **验收**：原验收「滚动截图里主 CTA 仍是视觉第一」**随用户决定作废**——按 Minimal 移植后，这张深色大卡的视觉分量不再让位于上方 picker 的主 CTA，这是选「按 Minimal」的直接后果。现验收：亮暗两种配色、1440 宽与 md 以下各截图，与 minimals.cc 首页 advertisement 同形（外壳、横排、标题尾部淡出、按钮形态）；深底上标题、描述、按钮在两种配色下都可读。
- **验证**：新增 `entrypoints/welcome/components/section-shell.test.tsx` 锁首尾拼接（en 有空格 / zh 无；把条件反过来两例都红，已验证）。`pnpm compile` 通过；`pnpm test`：主仓库 201 个文件 / 1570 例，`packages/*` 15 个文件 / 267 例，全部通过。主仓库前两次整跑各有一例 5 s 超时（`lib-import-smoke` 的 bilibili 冷导入，单跑即过），本改动之前的 HEAD 整跑同样有一例超时（`lib/database/db.test.ts`），是本机 CPU 争用下的既有抖动，第三次整跑全绿。`pnpm build` 后火箭落在 `.output/chrome-mv3/assets/illustrations/`（`cmp` 一致），与 Vite 自己产出的 `assets/` 同目录并存、不冲突。间距勘误改完后重跑：`pnpm compile` 通过；`pnpm test` 首次整跑 4 例 5 s 超时（`lib/bilibili/transcribe-utils.test.ts` 2 例，第二例是连带失败——第一例超时后它的 `BV-PROCESSING-RUNS` 转录仍在跑，发出的 `item-content-updated` 落进了第二例的监听，失败值正是 `['BV-PROCESSING-RUNS', 'BV-CONTENT-EVENT']`；`lib/database/proxy-db.test.ts`、`tests/lib-import-smoke.test.ts` 各 1 例，都是冷导入），这三个文件单跑 27/27 通过，第二次整跑全绿（主仓库 201 / 1570，`packages/*` 15 / 267）；`pnpm build` 通过，火箭仍 `cmp` 一致。
- **截图验收（2026-09-27，§1 流程，分支构建装进 BrowserOS）**：1440×900 亮暗两种配色、960（md 横排）、390（xs 纵排），en 与 zh-CN 各看一遍，与 minimals.cc 首页 advertisement 同形。量值：本段 `padding` 为 0，卡片顶边紧贴 picker 的底边（间距即 picker 的 160px 底部留白），卡片底边即 footer 顶边（footer `padding-top` 40px）。暗色下卡底与页面同为 #141A21，只靠 grey.800 边框、网格与右上光斑区分——Minimal 暗色本来就是这样，照搬，不算缺陷。xs 下火箭固定 360 宽，窄于约 440px 时被卡片 `overflow: hidden` 裁掉左右一点，与 Minimal 相同。zh 标题「没找到你的平台？」两段之间无缝，en 窄屏折行落在两段之间时第二行行首无缩进。
- **顺带看到、不在本步范围**：picker 的「进入 favbase」主 CTA 是墨色实心（`MuiButton` 默认 `color: 'inherit'`，docs/25 Step 1 起如此），所以现在全页唯一的 coral 实心按钮是这张卡的。这是「按 Minimal」与既有主题默认叠加的结果，记在这里，不改。

### Step 3 — section 标题换成 Minimal 的样式（已落地 2026-09-27）

- **Minimal**：`$MIN/sections/home/components/section-title.tsx`：`SectionCaption`（`overline`、`text.disabled`）+ 标题主体实色、`txtGradient` 那半句 `text.primary` → 20% alpha 灰阶淡出（再叠 `opacity: 0.4`，`inline-block`）。hero 另是彩色（`home-hero.tsx:58-106` 品牌词流动渐变）。
- **favbase 原状**：`Eyebrow` 药丸 + `headlineGradient(theme)` 的珊瑚渐变，hero 与五个 section 标题共用一道（`entrypoints/welcome/components/section-shell.tsx`）。
- **冲突**（已推翻）：docs/28 **D8 是用户决定**：「结构取、颜色留，保 coral 品牌色，`Eyebrow` 药丸保留」。docs/28 的 D8 行、§2.4 矩阵 eyebrow / 标题渐变两行已改注（划掉被推翻的半句并注明日期，不删行），§4 E3 补一段更新。
- **用户决定（2026-09-27）**：
  - **Q1** hero 标题保 coral 渐变，只改五个 section 标题（flow / chat / agentSkills / bilibili / picker）——正是 Minimal 自己「hero 彩色、section 中性」的分法。hero 的 caption 同样换 overline，全页 caption 一致。Minimal hero 余下的首行 24% 淡化 + 流动渐变不在本步。
  - **Q2** 形照搬，色取可读下限：caption 用 `text.secondary`（Minimal 是 `text.disabled`）；尾词去掉 Minimal 额外的 `opacity: 0.4`，只留 `text.primary` → 20% 的 `to right` 淡出。favbase 的尾词是含义词（「knowledge base」「while you watch」），不是装饰。
  - **Q3** 五个标题拆 `heading` + `headingTail`，文案一字不改：zh 两半直接相接、en 加一个空格，都等于原句。
- **默认决定**（最终确认时告知用户）：
  - **D-a** 步骤大号数字跟 section 语言走，吃与尾词同一个淡出 helper，不再吃 `headlineGradient`。
  - **D-b** caption 无图标（Minimal 的 `SectionCaption` 没有图标）：chat / agentSkills / bilibili 三个图标随之消失。三个图标在 app.html 仍有消费者，icon 注册表不动。
  - **D-c** `Eyebrow` 保留，只剩 how-it-works 卡内提示一个消费者，不改名。**勘误**：任务 PRD 写的理由「overline 的大写会把整句英文变全大写」不成立——`Eyebrow` 的 label 自己就是 `textTransform: uppercase`，卡内提示在英文下一直是全大写。它留下只因为卡内提示不是 section caption。
  - **D-d**（**2026-09-28 用户决定推翻，见下文截图验收**）：中性尾词照 Minimal `SectionTitle` 用 `inline-block`；白色尾词照 Minimal `home-advertisement` 保持 inline（那里是 inline + `ml: 1`，不是 inline-block）。原先的默认决定是中性尾词也用 `inline`，理由是 inline-block 在标题行里是一个原子，en 两三个词的尾词接不上前半句时会整块掉到下一行，而 inline 能逐词折行。第一轮截图表明逐词折行的代价更大：inline 的背景按 `box-decoration-break: slice` 在各行片段间接续铺开，折下去的那一截只分到渐变末段，单独成行、接近 20% 的收笔色。整块掉行反而是 Minimal 想要的形。**勘误**：任务 PRD 写的「只能整块掉行或溢出」后半句不对——inline-block 宽度以容器宽为上限（shrink-to-fit），超过整行时在自身内部折行，不会溢出。
  - **D-e** caption → 标题间距 `mt: 2.5` → `mt: 3`（= Minimal `SectionTitle` 的 `gap: 3`；caption 从约 30px 高的药丸变成 18px 一行字，2.5 是按药丸调的）。标题 → 描述间距、`FadeIn` 方向与延迟不动（docs/28 D6）。
  - **D-f**（主会话决定，改 D-c 原定的「API 不变」）：`Eyebrow` 的无图标分支（6px 圆点）原本只服务 section caption，caption 换走后零消费者，直接删掉而不是记成待清理的债；`icon` 改必填。
- **对比度**（WCAG 相对亮度，记录，不再重问）：
  - caption `text.secondary` 12px overline：亮 `#637381` on `#FFFFFF` ≈ 4.9:1、暗 `#919EAB` on `#141A21` ≈ 6.4:1；Minimal 原色 `text.disabled` 亮 ≈ 2.7:1、暗 ≈ 3.6:1，都不过 4.5。
  - 尾词：起笔 `text.primary`（亮 `#1C252E` on 白 ≈ 15.5:1），收笔 20%（亮 ≈ 1.5:1、暗 ≈ 1.9:1）；Minimal 原样（再叠 0.4）起笔 ≈ 2.4:1、收笔 ≈ 1.2:1。步骤数字落在叠卡的 `background.paper` 上（亮同为白、暗 `#1C252E`），收笔同为约 1.9:1。
- **替换点**（`section-shell.tsx` 是唯一 owner，调用点不用 sx 覆盖）：
  - **`SectionCaption`**（新增）：`typography: 'overline'` + `text.secondary`，无药丸、无图标、无 motion（入场仍归调用点的 `FadeIn`，docs/28 D6）。渲染成块，不是 Minimal 的 `span`：Minimal 那里它是 flex item、被 blockify；本页它在 `FadeIn` 的块级 div 里，inline span 会吃父级的行高 strut、比自己的 18px 更高，D-e 的间距就不再是 Minimal 的间距。
  - **`Headline` 的 `ink` 改三态，默认 `neutral`**：`neutral` = `text.primary` 实色 + `tail` 走淡出、`inline-block`（D-d）；`brand` = `headlineGradient`、不收 `tail`（hero 专用：品牌渐变整句铺开，尾词淡出叠在上面没有定义）；`white` = Step 2 原样。三态收成一张 `INKS` 表（每种墨色一对 head / tail 样式），组件里没有墨色分支；`HeadlineInk` 联合在编译期挡住 `brand` + `tail`。首尾拼接两种收 tail 的墨色共用同一段。
  - **`fadeTextGradient(theme)`**（新增并导出）：`text.primary` → 20% 的 `to right` 淡出，走 palette 变量、暗色无需分支；neutral 尾词与步骤数字共用（docs/28 E3 的教训：两处不许各写一遍）。
  - **`headlineGradient`** 只剩 `INKS.brand` 一个消费者，改为模块私有、不再导出；注释删掉「favbase 有品牌色，所以保 coral」，改记 hero 彩色 / section 中性是 Minimal 自己的分法。
  - **调用点**：`hero.tsx` 两行 `Headline` 显式 `ink="brand"`（默认已变）、caption 换 `SectionCaption`；五个 section 的 caption 换 `SectionCaption`、`Headline` 加 `tail`、间距 `mt: 3`；`how-it-works.tsx` 步骤数字换 `fadeTextGradient`，卡内 `<Eyebrow icon="eva:checkmark-fill">` 不动；`platform-request.tsx` 不动。
  - **i18n**：`welcome.{flow,chat,agentSkills,bilibili,picker}.heading` 改为前半句，新增 `.headingTail`，两半都不带分隔符（拼接归 `Headline`，同 Step 2）。caption 的 key 仍叫 `welcome.*.eyebrow`，不改名。
- **验证**：`entrypoints/welcome/components/section-shell.test.tsx` 扩到 6 例——默认（neutral）墨色的首尾拼接两例（en 空格 / zh 无，与 white 共用同一段）；一例锁默认墨色就是 `neutral`：默认与 `ink="neutral"` 渲染出同一个 emotion class、与 `ink="brand"` 不同（相对比较，不快照样式；后一半同时防止两个空 class 让前一半空转）；一例 `brand` + `tail` 的 `@ts-expect-error` 编译期断言（`pnpm compile` 覆盖测试文件）。先红后绿三处都验过：把拼接条件反过来，white 与 neutral 四例全红（`expected 'headtail' to be 'head tail'` 及其反向）；把默认墨色改回 `brand`，默认墨色那例红（两个 class 不等）；把 brand 的 `tail?: never` 放宽成 `ReactNode`，`tsc` 报 `TS2578: Unused '@ts-expect-error' directive`。最终（D-f 之后）：focused `pnpm vitest run entrypoints/welcome` 5 个文件 / 29 例通过；`pnpm compile` 通过；`pnpm build` 通过；`git diff --check` 干净；`pnpm test` 首次整跑 1 例 5 s 超时（`lib/database/proxy-db.test.ts` 冷导入，单跑 3/3 通过），第二次整跑全绿：主仓库 201 个文件 / 1574 例，`packages/*` 15 个文件 / 267 例。实现阶段另有四次整跑每次 1–2 例同类超时（`lib/database/db.test.ts`、`proxy-db.test.ts`、`tests/lib-import-smoke.test.ts`），逐个单跑全过，`--testTimeout=15000` 整跑全绿——失败只在时限，是 Step 2 已记录的本机 CPU 争用抖动。D-d 改成 `inline-block` 之后（2026-09-28）：focused 5 个文件 / 29 例通过，`pnpm compile`、`pnpm build` 通过。`pnpm test` 两次整跑分别有 1 例、2 例 5 s 超时（`tests/lib-import-smoke.test.ts` 的 bilibili 冷导入两次，`lib/database/db.test.ts` 一次），同样只在时限：`lib-import-smoke` 单跑 17/17 通过，`vitest run --testTimeout=15000` 整跑 201 个文件 / 1574 例全绿，`pnpm -r test` 15 个文件 / 267 例全绿。这条改动没有加单测：它只改尾词的 `display`，由下面第二轮截图验收量到的 computed style 覆盖。
- **截图验收（§1 流程，两轮）**：每个标题滚进视口、等 `FadeIn` 播完，再量 computed style，并截 caption + 标题区域。页面实际加载的 chunk 每轮都核对过，与 worktree `.output` 逐文件一致。
  - **第一轮（2026-09-27，D-f 之后的构建，`welcome-BkSV96Xj.js`，中性尾词 `inline`）**：1440×900 亮暗、zh-CN 1440、960（md 栏宽）、390（xs）。其余各项都符合预期（量值与第二轮相同，见下），唯一的问题在尾词折行：inline 尾词确实逐词折行（1440 的 agentSkills「what ▏you saved」，960 的「what you ▏saved」，390 的「knowledge ▏base」「while you ▏watch」「collect ▏first?」），但 inline 背景按 `box-decoration-break: slice` 在各行片段间接续铺开，折下去的那一截只分到渐变末段，颜色明显更淡。最显眼的是 zh 1440 的 bilibili 标题：「看视频时，右边多 ▏一块」，「一块」单独一行、接近 20% 的收笔色。用户看过后决定（2026-09-28）改回 Minimal 的 `inline-block`（D-d）。
  - **改动**：`section-shell.tsx` 的 `INKS.neutral.tail` 加 `display: 'inline-block'`，`fadeTextGradient` 本身不带 display（步骤数字是块级元素，不需要）；白色尾词不动。两轮之间只有 welcome 的 chunk 与 `welcome.html` 不同，按 §1 第 7 条只同步文件、刷新自己的标签，没有重载扩展。
  - **第二轮（2026-09-28，`welcome-WEh1h_5z.js`，中性尾词 `inline-block`）**：1440×900 亮暗、zh-CN 1440、zh-CN 390、960、390，没有验出问题。量值：
    - **caption**（五个 section）：块级、高 18px、12px / 600 / uppercase、无底色无边框、零 `svg`；色亮 `rgb(99, 115, 129)`、暗 `rgb(145, 158, 171)`；caption 底边到标题顶边六组都是 24px（D-e）。hero 的 caption 只在第一轮亮色 1440 量过，数值相同（色、字号、18px、24px 间距）；暗色 hero 只看了截图。
    - **尾词**：中性尾词 `display: inline-block`，白色尾词 `inline`；都是 `background-clip: text`、`opacity: 1`。中性尾词的 `background-image` 亮 `linear-gradient(to right, rgb(28, 37, 46), rgba(28, 37, 46, 0.2))`、暗 `rgb(255, 255, 255)` → `rgba(255, 255, 255, 0.2)`。en 首尾之间是一个空格文本节点，zh 没有文本节点。
    - **D-a 同源**：三个步骤数字的 `background-image` 与尾词逐字相同（六组都是）。
    - **hero**：两行仍是 `112deg` 品牌渐变，亮以 `rgb(252, 126, 91)`（primary.main）收笔、暗以 `rgb(253, 164, 138)`（primary.light）收笔。
    - **折行**：接不上前半句的尾词整块换行、渐变完整。1440 下「Chat with your ▏knowledge base」「Let Claude Code search ▏what you saved」「An extra panel ▏while you watch」「看视频时，▏右边多一块」；960 同 1440；390 下另有「What should we ▏collect first?」；zh 390 下「让 Claude Code 查 ▏你的收藏」。没有单独成行的淡色孤字。各宽度下所有标题 `scrollWidth - clientWidth` 都是 0，没有溢出。
    - 暗色下步骤数字落在叠卡的 `background.paper` 上，白色起笔、淡出可辨；卡内 `Eyebrow` 提示（带 ✓）照旧是药丸。

### Step 4 — 段落装饰线（Minimal `FloatLine` 一族）（已落地 2026-09-28）

- **Minimal**：`$MIN/sections/home/components/svg-elements.tsx`（289 行）的七个组件——`FloatLine` / `FloatPlusIcon` / `FloatXIcon` / `FloatTriangleLeftIcon` / `FloatTriangleDownIcon` / `CircleSvg` / `FloatDotIcon`——由 `$MIN/components/animate/motion-viewport.tsx`（42 行）触发；`$MIN/sections/home/` 的 11 个段落文件里 9 个用了它们（`home-hero` 与 `home-for-designer` 没用）。除 `CircleSvg` 外都**只在 ≥1440px 显示**（`baseStyles` 的 `breakpoints.up(1440)`），色 `grey.500`、虚线 `strokeDasharray: 3`、线 `opacity: 0.24`。视觉上是左侧 gutter `left: 80` 一条逐段首尾相接的竖向脊线，每段段首一个标记（`+` 与横线交叉、三角、圆点列），进入视口时线从 0 画到 100%；结尾 advertisement 卡处脊线在卡片中线收束成一条横线。结构在每个段落文件里都一样：`section（position: relative）> MotionViewport > renderLines() + Container`，线是 Container 的兄弟。
- **favbase 原状**：没有。
- **冲突**：无——docs/28 D5 / §3.1 只拒绝了 hero 的 `HeroBackground`（同心圆虚线与 `OrbitCore` 打架），没有对段落装饰线下结论。docs/28 §3.1 已补注（`HeroBackground` 的拒绝不变）。
- **用户决定（2026-09-28）**：「完成 step4」，映射选**逐段对照 Minimal 源文件**。本节原先的「如果要做」（只移植 `FloatLine` + `FloatPlusIcon`、五段同一种标记）**被这条决定取代**。线照 Minimal 只在 ≥1440px 显示，1366 / 1280 的笔记本上整步不可见，已向用户说明，用户接受。映射（依据：布局——左文右图 / 居中标题 / 标题 + 滚动内容——与**顶部留白**最接近的 Minimal 段。Minimal 的标记偏移是按各段 padding 调的：`py 20`（160px）的段用「top 80 横线 + `+`」（home-minimal / highlight-features），`pt 10`（80px）的段把标记放在 top 64–80、与 caption 齐平。favbase 的 `WelcomeSection` md 起是 160px，how-it-works 是 `pt md 12`（96px）≈ HugePack 的 80px）：

  | favbase 段 | Minimal 源文件 | `renderLines`（逐值照搬） |
  |---|---|---|
  | `hero.tsx` | `home-hero` | 无（Minimal 也无） |
  | `capability-marquee.tsx` | HugePack 的滚动画廊 / ForDesigner 满宽带 | 无：Minimal 不在满宽滚动内容上画线（HugePack / HighlightFeatures 的 `ScrollRoot` 是 `zIndex: 9` + sticky 不透明底，把脊线盖住） |
  | `how-it-works.tsx` | `home-hugepack-elements` | 左三角 `top 80, left 80, opacity 0.4` + 竖线 `top 0, left 80` |
  | `chat-showcase.tsx` | `home-minimal` | `+` `top 72 / bottom 72, left 72` + 横线 `top 80 / bottom 80, left 0` + 竖线 |
  | `agent-skills.tsx` | `home-testimonials` | `Stack spacing 8`（`top 64, left 80, translateX(-50%)`）里两个下三角：`opacity 0.12`、`30×15 opacity 0.24`；+ 竖线 |
  | `bilibili-showcase.tsx` | `home-integrations` | `Stack spacing 8`（`top 64 … bottom 64, left 80, zIndex 2, translateX(-50%)`，`'& span': { position: static, opacity: 0.12 }`）里圆点 12 / 14 / 弹性空白 / 14 / 12；+ 竖线 |
  | `platform-picker.tsx` | `home-highlight-features` | `+` `top 72, left 72` + 横线 `top 80, left 0` + 竖线 |
  | `platform-request.tsx` | `home-advertisement`（唯一真有源文件的一段） | `+` `left 72, top 50%, mt -1` + 竖线 `top 0, left 80, height calc(50% + 64px)` + 横线 `top 50%, left 0`；Container 补 `position: relative` + `zIndex: 9` |

- **默认决定**（最终确认时告知用户）：
  - **D-a** 只移植有消费者的五个：`FloatLine` / `FloatPlusIcon` / `FloatTriangleLeftIcon` / `FloatTriangleDownIcon` / `FloatDotIcon`（docs/28 §3.4 先例：零消费者不移植）。**`FloatXIcon` 不移植**：只有 `home-pricing`（Plus 套餐四角）用，映射里没有对应段。**`CircleSvg` 不移植**：它**不受 1440 门控**（`display: { xs: 'none', md: 'block' }`，md 起就显示），在 Minimal 里居中于 Container、落在文字栏与**裸图片**之间的空白处；搬进 chat / bilibili 会落在正文段落后面，另一半被不透明的 demo 卡盖住。docs/28 D5 的理由（与 hero 的 `OrbitCore` 同心圆打架）**不适用**于没有 orbit 的段落，不拿它当理由——理由是落点。
  - **D-b** `MotionViewport` 移植，删掉 `disableAnimate` + `useMediaQuery(smDown)` 分支：那个分支在 600px 处把渲染元素在 `m.div` 与 `div` 之间切换，React 视为不同元素类型、会**卸载并重建整段内容**——picker 会丢掉已选平台、chat demo 会重播。在 favbase 它本来就零效果：线在 1440 以下隐藏，而段落里除了线没有任何带 `variants` 的后代（`FadeIn` 的 `initial` / `whileInView` 是对象不是 variant label，不进 variant 树；motion 12 `VisualElement.mount` 只把「有 `variants` 且不自控」的节点挂到最近的 variant 父上，已读源码核实）。其余照搬：`initial="initial"`、`whileInView="animate"`、`variants={varContainer()}`、`viewport={{ once: true, amount: 0.3, ...viewport }}`，调用方 props 在后、可覆盖。用 `MotionBox`（本页「一个动画 Box」只有一个定义处），落 `components/animate/motion-viewport.tsx`，从 `animate/index.ts` 导出。
  - **D-c** 线的 `transition` 不重新声明：Minimal `svg-elements.tsx` 模块内的 `transition = { duration: 0.64, ease: [0.43, 0.13, 0.23, 0.96] }` 与 `transitionEnter()` 逐值相同，改为调用后者（docs/28 E1 收掉的就是这份重复）。
  - **D-d** 结构照 Minimal：`section > MotionViewport > renderLines() + Container`，线是 Container 的兄弟，定位基准是 `position: relative` 的 section（`MotionViewport` 是静态块、`varContainer` 不动画任何值，不建立包含块）。`WelcomeSection` 加 `lines?: ReactNode`，**始终**包 `MotionViewport`（四个消费者都传线，不留「有线 / 无线」两条分支）。`how-it-works.tsx` 照 HugePack：`MotionViewport` 只包线 + 标题 Container，叠卡 Container 留在外面，触发时机是「标题区 30% 可见」而不是「约 2800px 的整段 30% 可见」。`platform-request.tsx` 的 Container 补 `sx={{ position: 'relative', zIndex: 9 }}`。
  - **D-e** 每个段落文件自己一个模块级 `const renderLines = () => (<>…</>)`，写法与位置同各自的 Minimal 源文件（`platform-request.tsx` 照 `home-advertisement` 放在组件之后，其余放在组件之前）；不抽共享的「线配方」——每段不同，没有重复。
  - **D-f** 五个 `Float*` 的根元素默认 `aria-hidden`（Minimal 没有）：纯装饰、零视觉差；写在 `{...other}` 之前，是默认值而不是锁死。
  - **D-g** how-it-works 的脊线一路陪着叠卡：Minimal 两个滚动画廊的 sticky 底不透明、`zIndex: 9`，把脊线盖住；favbase 的 84vh 卡槽是透明的，竖线（`height: 100%` of section）贯穿约 2800px 的整段。接受（问用户时已说明）。
  - **D-h** 只搬线，不搬它们的「陪衬」：`home-minimal` 的 section `overflow: 'hidden'`（为 720px 宽的图片溢出）与 Grid 上的 `position: relative; zIndex: 9`（为压过 `CircleSvg` 与横线）都不带进 chat——图片不存在、`CircleSvg` 不移植，chat 的两条横线落在 160px 的上下 padding 里，不与内容重叠。**只有 platform-request 需要 `zIndex: 9`**（横线真的穿过卡片）。
- **照搬**：`baseStyles`（`zIndex 2`、`display none`、`grey.500`、`absolute`、`& line` 虚线 3 + `currentColor` 描边、`& path` 填充与描边 `currentColor`、`up(1440)` 起 `block`）；`FloatLine` 的 `width 1 / height 1px / zIndex 1 / opacity 0.24`（竖直换成 `1px × 1`）与 `x2` / `y2` `0% → 100%` 的 variants；四个标记的尺寸、`viewBox`、`path` 与 `scale` / `scaleX` / `scaleY` `0 → 1`；`sx` 数组合并写法；各段 `renderLines` 的全部偏移、尺寸与透明度（上表）。`baseStyles` 的返回类型照 Minimal 注成 `SxProps<Theme>`，`tsc` 通过，无需改类型。
- **替换点**：
  - **新文件** `entrypoints/welcome/components/svg-elements.tsx`（五个组件）。统一改动三条：`framer-motion` → `motion/react`、`m.*` → `motion.*`（不上 `LazyMotion`，docs/28 §3.2）、`transition` → `transitionEnter()`（D-c）；外加根元素 `aria-hidden`（D-f）。`FloatDotIcon` 是 `MotionBox component="span"`，props 类型取 `ComponentProps<typeof MotionBox>`（Minimal 是 `Box component={m.span}` + `BoxProps<'span'> & MotionProps`，本仓库「一个动画 Box」只在 `motion-box.tsx` 定义一次）；Minimal 靠 UMD 全局 `React.ComponentProps` 的写法改为 `import type { ComponentProps } from 'react'`。纯类型写法差异，值不变。
  - **新文件** `entrypoints/welcome/components/animate/motion-viewport.tsx`（D-b），props 类型 `ComponentProps<typeof MotionBox>`（对应 Minimal 的 `BoxProps & MotionProps`，拿到 `viewport` 做合并）。
  - **`section-shell.tsx`**：`WelcomeSection` 加 `lines`（D-d）。
  - **六个段落**：按上表接线；`hero.tsx`、`capability-marquee.tsx` 不动；`FadeIn` 的方向 / 延迟 / 距离一律不动（docs/28 D6）。`platform-request.tsx` 头注释里「`renderLines` 与 `zIndex: 9` 留给 Step 4」那条改写为已移植的说明。
- **一处看起来像偏离、其实是照搬**：`home-integrations` 的圆点列里，两个 14px 圆点自己写了 `opacity: 0.24`，但 Stack 的 `'& span': { position: 'static', opacity: 0.12 }` 是后代选择器（特异性 0,1,1），压过圆点自己的 emotion class（0,1,0）——所以在 Minimal 里四个圆点**全是 0.12**，那一对只是更大、不更亮（同一条规则也是把它们的 `position: absolute` 改成 `static` 的原因）。照搬，不修：Minimal 源码里是同一条规则，线上 minimals.cc 的 integrations 段也量到四个 0.12（见下面的截图验收）。截图量 `opacity` 时这是预期值，不是回归。
- **测试**：没有新增单测。线是纯装饰、没有逻辑分支，覆盖由截图验收的 computed style 量值承担（同 Step 3 D-d 的处理）。考虑过给 `WelcomeSection` 加一例「线是 Container 的兄弟」——锁不住任何东西：MUI `Container` 没有 `position`，线放在 Container 里面或旁边，包含块都是 section。兄弟 / 子节点的区别只在 `platform-request.tsx` 成立（它的 Container 是 `position: relative; zIndex: 9`），那由截图验收的「横线被卡片压住」覆盖。
- **验证**：focused `pnpm vitest run entrypoints/welcome tests/ui-vendor-boundaries.test.ts tests/i18n-no-hardcoded.test.ts` 7 个文件 / 39 例通过（`motion` 仍只在 `entrypoints/welcome/**`，新文件零 CJK）；`pnpm compile` 通过（`styled(motion.svg)`、`baseStyles` 的 `SxProps<Theme>` 展开、SVG `x2` / `y2` variants 都照 Minimal 原样过了类型检查，没有类型层面的偏离）；`pnpm test` 首次整跑即全绿，主仓库 201 个文件 / 1574 例、`packages/*` 15 个文件 / 267 例，本次没有出现 5 s 冷导入超时；`pnpm build` 通过（background 契约 13 个模块 / 946,270 字节，welcome chunk `welcome-DJSuNu2W.js`）；`git diff --check` 干净（两个新文件经 `git add -N` 一并检查后撤回）。
- **截图验收（2026-09-28，§1 流程，分支构建装进 BrowserOS）**：新构建与已装构建只差 welcome 的 chunk（`welcome-DJSuNu2W.js`）与 `welcome.html`，按 §1 第 7 条只同步文件、在自己新开的 welcome 标签里加载，没有重载扩展；页面实际加载的正是这个 chunk。整页先逐屏滚一遍让每段的 `MotionViewport` 触发，再量 computed style；1440×900 亮色逐段截图、暗色截 chat / bilibili / request 三段，与 minimals.cc 首页同一宽度的截图对照同形，没有验出问题。量值：
  - **门控**：21 个装饰元素（4 个 `+`、1 个左三角、2 个下三角、4 个圆点、10 条线）在 1439 宽全部 `display: none`，1440 宽全部 `block`。
  - **线**：`opacity` 0.24、`stroke-dasharray` 3px、色 `rgb(145, 158, 171)`（grey.500，亮暗相同）。
  - **画线动画确实经 variant 传播触发（两态读数）**：JSX 里 `x2` / `y2` 本来就写着 `100%`，所以只量「滚过之后是 100%」分不清「画进来了」和「variant 没传到、线从第一帧起就是静态的」。改为重载页面、停在顶部不滚，读视口外 request 与 chat 两段：线 `x2` / `y2` 全是 `0%`，`+` 的 `transform` 是 `matrix(0, 0, 0, 0, 0, 0)`（`scale(0)`）；滚到 request 进入视口、等 1.2 s 再读：线全是 `100%`，`+` 是 `none`。chat 这次没停留也画完了，是因为 `welcome.css` 的 `scroll-behavior: smooth` 让 `scrollTo` 平滑滚动、途经了它。
  - **标记**：偏移与上表逐值相同（段内坐标）——how-it-works 左三角 (80, 80)、10×20、0.4；chat 两个 `+` 在 (72, 72) 与 (72, 段高 − 88)，两条横线在 80 与段高 − 81；agent-skills 下三角 20×10 在 y 64、30×15 在 y 138（= 64 + 10 + 64），`opacity` 0.12 / 0.24；bilibili 圆点列 12 / 14 / 14 / 12，四个都是 0.12；picker `+` (72, 72)、横线 80；request `+` 在 237（= 50% − 8）、横线在 245（= 490 的 50%）、竖线高 309（= 245 + 64）。
  - **脊线首尾相接**：how-it-works 1097 起、高 2651 → chat 3748 → agent-skills 4525 → bilibili 5405（竖线从 1px 上边框之内起画，止于 1px 下边框）→ picker 6157 → request 7172，逐段下一段的顶边等于上一段竖线的底端，六处接缝没有断口。
  - **层叠**：六个 `MotionViewport` 都是 `position: static`、`transform: none`、无内联 `style`，不是包含块；request 卡片中线处 `elementFromPoint` 命中的是卡片正文，左右 gutter 命中的是横线——横线在卡片之下、只从两侧露出，同 Minimal。
  - **`FadeIn` 不受影响**：六个包了 `MotionViewport` 的段里，每个 `h2` 连同祖先的累计 `opacity` 都是 1。
  - **D-b**：picker 点选两个平台（CTA 变成「Enter favbase」）后，把视口缩到 500 宽再放回 1440，仍是 2 个 `aria-pressed="true"`、CTA 不变——跨 600px 没有重建。
  - **minimals.cc 对照**：integrations 段四个圆点量到 `opacity` 0.12 / 0.12 / 0.12 / 0.12，与本页一致（上文「看起来像偏离」那条）。
  - 暗色是点 Header 的 `ThemeModeButton` 切的，原值 `light`，截完立刻切回，`favbase-color-mode` 读回 `light`。

### Step 5 — Analytics KPI 数字照搬 Minimal 的 `h4`（已落地 2026-09-28）

- **Minimal**：`$MIN/sections/overview/analytics/analytics-widget-summary.tsx:118` 的数值是 `typography: 'h4'`。`$MIN/theme/core/typography.ts:96-101` 的 h4 有四项：不带 `fontFamily`（继承根上的 primary，Public Sans；Barlow 在 Minimal 里只给 h1–h3）、700、行高 1.5、20px，`md`（900px，`createTheme()` 默认断点）起 24px。线上 minimals.cc `/dashboard/analytics` 实测（2026-09-28，§1 第 8 条，四张卡都量）：1440 宽 `"Public Sans Variable"` 24px / 700 / 行高 36px，800 宽 20px / 行高 30px，与源码一致。
- **favbase 原状**：`entrypoints/app/sections/overview/analytics-widget-summary.tsx` 用 `variant="h3"`，四项全不同：Barlow、600、行高 1.3、固定 20px。本节初稿只记了字号一项。
- **冲突**：docs/25 D8「保留 Favbase 固定 type scale（不移植 Minimal 的 responsive font sizes）」。D8 是 PRD 默认，不是用户决定。
- **用户决定（2026-09-28）**：**整体照搬 Minimal `h4`**——DM Sans（favbase 里对应 Public Sans 的 primary）、700、行高 1.5、20px → md 起 24px。本节初稿的「如果要做：只在 `kpi-value` 这一处加 `fontSize: { md: 24 }`」只照搬了字号，被这条决定取代；它的另一半「不动主题阶梯」保留。docs/25 D8 行不划掉（主题阶梯仍固定），只追加例外说明；docs/25 Step 6 第 1 条的「数值 `h3`」划掉改注。
- **默认决定**：
  - **D-a 写法**：favbase 自己的 `variant="h4"` 本来就是 DM Sans / 行高 1.5（16px / 600，同样不带 `fontFamily`），调用点只把字重换成 `fontWeightBold`、字号换成 `pxToRem(20)` → md `pxToRem(24)`。组件里不写 `fontFamily`（spec §5「No component-local font family」仍成立）；`component="p"`（数字不是标题，大纲 `[1, 2, 2, 3, 2]` 不变）与 `data-slot="kpi-value"`（测试与 `docs/ui-baseline/app-runtime-check.mjs` 读它）不变。
  - **D-b 例外只写在调用点**：主题不加变体、不改任何数值、不恢复 `responsiveFontSizes`。spec §5 加一条只点名 `[data-slot="kpi-value"]` 的窄例外，写明不作先例。**口径**是「页面调用点里唯一随视口变字号的」，两种更宽的说法都不成立：不是「全 app 唯一」——主题层的输入框也随断点变（`core/components/text-field.tsx` 的 `INPUT_TYPOGRAPHY`，15px、`down('sm')` 起 16px，docs/25 Step 1 照搬 Minimal 的主题内部规则）；也不是「唯一越出 28/24/20/16/14/12 字阶的」——nav subheader 11px、mini nav 10px、设置抽屉与 snackbar 13px 都是移植原语自带的字号。
  - **D-c 加载骨架**：`analytics-loading.tsx` 的数字行原来是 `height={30}`（与 h3 的 26px 行盒本来就对不上），改为跟新行盒走：xs 30 / md 36。`Skeleton` 的 `height` prop 落成内联 style（MUI 源码 `style: { width, height, ...style }`），会压过 `sx`，所以删掉 prop、写进 `sx`。
  - **D-d 不加单测**：只改样式值、没有逻辑分支，同 Step 3 D-d 与 Step 4 的处理。
- **替换点**：
  - `analytics-widget-summary.tsx`：数字 `variant="h4"` + `sx={(theme) => ({ mt: 1, fontWeight: theme.typography.fontWeightBold, fontSize: { xs: theme.typography.pxToRem(20), md: theme.typography.pxToRem(24) } })}`，上方注释写明这是 Minimal 的 `h4`、主题阶梯不动。
  - `analytics-loading.tsx`：数字骨架 `sx={{ mt: 1, height: { xs: 30, md: 36 } }}`，无 `height` prop。
  - `theme/core/typography.ts` 只改块注释（数值零 diff）；spec `ui-design-system.md` §5 窄例外 + §10 KPI 描述；`sections/overview/CLAUDE.md`、`theme/CLAUDE.md`；docs/25 D8 行与 Step 6 第 1 条。
- **顺带看到、不在本步范围**：Minimal 这张卡与 favbase 还有四处不同——图标在左上 48×48、下接 `mb: 3`（favbase 在右上 `absolute`）；数字用 `fShortenNumber` 缩写（714k / 1.35m，favbase 打完整数字）；`shape-square.svg` 底纹；趋势百分比与 sparkline。都是 docs/25 Step 6 记录过的决定（后两项是 D17「不造数据」），不动。
- **验证**：focused `pnpm vitest run entrypoints/app/sections/overview` 3 个文件 / 15 例通过；`pnpm compile` 通过；`pnpm build` 通过（background 契约 13 个模块 / 946,270 字节，与 Step 4 相同）；`git diff --check` 干净。`pnpm test` 三次整跑：前两次各 1 例 5 s 超时（`tests/lib-import-smoke.test.ts` 5046 ms、`lib/database/proxy-db.test.ts` 6160 ms，都是冷导入，单跑 17/17、3/3 通过；这两次根目录失败挡住了 `pnpm -r test`，单独补跑 15 个文件 / 267 例通过），第三次全绿：主仓库 201 个文件 / 1574 例、`packages/*` 15 个文件 / 267 例。
- **CSS 核对（测试环境，代替截图的部分证据）**：在 `ThemeProvider` 下用 happy-dom 渲染组件、导出 emotion 生成的规则（探针测试跑完即删）。数字元素是 `<p class="MuiTypography-root MuiTypography-h4 …">`，基础规则 `font-family:"DM Sans Variable",…;font-weight:600;font-size:1rem;line-height:1.5;…;font-weight:700`，其后 `@media (min-width:0px){font-size:1.25rem}`、`@media (min-width:900px){font-size:1.5rem}`——同一规则里 700 在 600 之后生效，`min-width:0px` 排在基础规则之后，盖掉 h4 自带的 16px。骨架的内联 style 只剩 `width: 72px`，高度来自 `@media (min-width:0px){height:30px}` 与 `(min-width:900px){height:36px}`。主题的 `MuiTypography` 覆盖只有 `variantMapping`；MUI 9.4 的 `createTypography` 只在字体是默认 Roboto 时才加字距，所以两边都没有 `letterSpacing`。
- **实机截图验收（2026-09-28，§1 流程）**：往主 checkout 的 `.output/chrome-mv3` 拷新构建这一步被本会话的权限规则判为改共享资源、拦下了，没有绕过；之后用户改为直接从 worktree 的 `.output/chrome-mv3` 加载扩展（新扩展 id，见 §6）。先核对页面实际加载的是新入口 `chunks/app-CLu4uzDw.js`，再在自己新开的 `app.html#/` 标签里量 `[data-slot="kpi-value"]`，四张卡都量：
  - **改动前**（旧构建 `app-BhTim0Ph.js`，1440）：`MuiTypography-h3`、Barlow 20px / 600 / 行高 26px，卡高 126。
  - **改动后**（1440）：`MuiTypography-h4`、`"DM Sans Variable"` 24px / 700 / 行高 36px，卡高 136（+10，正是行高 26 → 36 的差）；元素仍是 `<p>`。线上 minimals.cc 同宽是 Public Sans 24px / 700 / 36px，字体之外逐项相同。
  - **断点**：900 宽 24px / 36px，899 与 800 宽 20px / 700 / 30px（minimals.cc 800 宽同为 20px / 30px）。`document.fonts` 里 `DM Sans Variable 100 1000` 已加载，`fonts.check('700 24px "DM Sans Variable"')` 为 true，不是回退字体。
  - 截图：1440 四卡一行、800 两列，与 minimals.cc 同宽截图对照同形。暗色与 zh-CN 没截：本步只改字形，数字的颜色（`<color>.darker`）与内容不随配色和语言变。加载骨架是瞬态，没截，由上面的 CSS 核对覆盖。
  - **验出一个不属于本步的问题**：900 宽时卡片高 248。原因是 favbase 在 900 宽就展开 300px 侧栏，四张卡各只剩 118px 宽，扣掉 `p: 3` 与给图标让位的 `pr: 8` 后文本栏只有几像素，标题逐词折行，「1 / 6」折成三行（1024 宽卡宽 149、仍折两行；1199 宽 193 才一行）。这在改动前就存在——文本栏窄到每个空格都断行，与字体无关；本步只是让每行从 26px 变成 36px。Minimal 在 900 宽**没有侧栏**（汉堡菜单），卡宽约 191；1200 宽两边都展开侧栏，卡宽都约 185。根因记在 §3，本步不动。

### Step 6 — dashboard 侧栏断点 `md` → `lg`（已落地 2026-09-28）

- **来源**：本文原本没有 Step 6。用户说「完成 step6」后问过，从 §3 三个未定性项里选定侧栏断点一项（另两项——书签站点图标、暗色品牌图标白底——不在本步）。
- **Minimal**：`$MIN/layouts/dashboard/layout.tsx:59` `layoutQuery = 'lg'`，传给汉堡按钮的隐藏规则（`:114`）、header（`:171`）、nav（`:185`）与 `sidebarContainer` 的 `pl`（`:222`）。原语 `core/header-section.tsx:40`、`dashboard/nav-vertical.tsx:39` 的默认值是 `md`，被它覆盖；Minimal 的 `LayoutSection` 没有这个 prop。`MainLayout`（`layouts/main/layout.tsx:47`）是 `md`，所以 welcome 不在本步。Chat 历史 Drawer（`sections/chat/chat-nav.tsx:287-296`）的 paper 只设 `width`，没有 `left`。
- **favbase 原状**：`DashboardLayout` 默认 `md`；来源见 §3 该条（`defdf00` 有意降的，早于 Minimal 移植）。
- **冲突**：推翻 `defdf00` 的「侧栏在 900 就显示」。那条决定只有 commit message 里的一句话，没有写进任何文档或规范。
- **用户决定（2026-09-28）**：照 Minimal 改 `lg`。
- **默认决定**（最终确认时告知用户）：
  - **D-a 命名常量 `DASHBOARD_LAYOUT_QUERY`**：`layouts/dashboard/layout.tsx` 导出 `'lg'`，作 `layoutQuery` 默认值。理由不是品味：§3 预言的「改它会同时移动……」之外，还有一处**隐藏耦合真实存在**——`sections/chat/chat-view.tsx` 的卡片高度 `calc(100dvh - header)` 用字面量 `md` 判断 header 何时是 72。只改默认值，900–1199 的 Chat 卡片就会按 72 扣而 header 实为 64，底部多出 8px。常量把耦合变成编译期可见的依赖。它与 `DASHBOARD_CONTENT_QUERY`（内容 40px gutter）同为 `lg`，但是两个概念——Minimal 里也是两个独立的字面量默认值——不合并。`layoutQuery` prop 保留（Minimal 有，零调用方传）。
  - **D-b Chat 高度键**：`chat-view.tsx` 的 `md` 键改 `[DASHBOARD_LAYOUT_QUERY]`；同一 `sx` 里的 `pb: { xs, md }` 是内容留白、不跟 shell，不动。
  - **D-c 删 Chat 历史 Drawer 的 `left`**：`chat-nav-drawer.tsx` 的 `left: { xs: 0, md: 'var(--layout-nav-vertical-width)' }` 是为 900–1199「dashboard rail 在、chat rail 不在」写的。改后两者都在 `lg` 切换，Drawer 存在的宽度里没有 dashboard rail，偏移在任何宽度都不生效；Minimal 的 paper 本来也没有 `left`——这是照搬，不只是清死代码。
  - **D-d 原语默认值不动**：`HeaderSection` / `LayoutSection` / `NavVertical` 仍默认 `md`（前两者与 Minimal 原语一致，`LayoutSection` 的 prop 是本仓库为 `scroll-padding-top` 加的），welcome 也在用它们。
  - **D-e 一例守卫**：`layout.test.tsx` 把 `useMediaQuery` mock 成布尔值，吞掉了查询串，断点值零守卫（§3 原记录「没有按具体宽度的断言」）。mock 改为记录参数，新增一例断言整棵 shell 树只发出 `'@media (min-width:1200px)'`。只加这一条：rail / 收展按钮 / header 高度的 CSS `display` 规则在 happy-dom 里不可观测，而它们与汉堡的 JS 查询都从同一个 `layoutQuery` 派生，JS 查询是唯一能钉住它的点。先红后绿：改代码前跑，红态正是 `"@media (min-width:900px)"`，且集合里没有别的查询混入。
  - **D-f runtime check 不改**：`docs/ui-baseline/app-runtime-check.mjs` 的 `1024-dark-zh` 组（`mobile: false`）今后截到的是汉堡形态。它没有断言 rail 存在，不会红，只是截图的含义变了；侧栏收展的交互检查跑在 1440 组，不受影响。
- **替换点**：
  - `entrypoints/app/layouts/dashboard/layout.tsx`：新增并导出 `DASHBOARD_LAYOUT_QUERY`（JSDoc 写明 Minimal 默认值、为何导出、与 `DASHBOARD_CONTENT_QUERY` 的区别），默认值改用它。`dashboard/index.ts` 已 `export *`，不用改。
  - `entrypoints/app/sections/chat/chat-view.tsx`：经 `../../layouts/dashboard` barrel 导入常量，高度键改用它。
  - `entrypoints/app/sections/chat/chat-nav-drawer.tsx`：删 paper 的 `left`。
  - `entrypoints/app/layouts/dashboard/layout.test.tsx`：mock 记录查询串 + 一例断言。
  - 文档：`entrypoints/app/layouts/CLAUDE.md`（header 高度表的 md → lg、新增「Shell 断点」一条、Pin/Unpin 约定的「md 以下」、`layout.test.tsx` 锁的内容）、`entrypoints/app/sections/chat/CLAUDE.md`（高度按常量切换、Drawer 从 x=0 滑出）、spec `ui-design-system.md` §8（断点一段）与 §11 Chat（Drawer 从 x=0）、本文与根 `CLAUDE.md` 的 docs/31 条目。
- **验证**：focused `pnpm vitest run entrypoints/app/layouts entrypoints/app/sections/chat` 9 个文件 / 50 例通过；`pnpm compile` 通过；`pnpm test` 首次整跑即全绿，主仓库 201 个文件 / 1575 例（+1 为 D-e）、`packages/*` 15 个文件 / 267 例；`pnpm build` 通过，background 契约 13 个模块 / 946,270 字节与 Step 4/5 相同，只变了页面 chunk（`app-BhpBw8Kv.js`、`chat-AQLWqivh.js`）；`git diff --check` 干净。
- **实机验收（2026-09-28，§1 流程）**：扩展仍从 worktree 的 `.output/chrome-mv3` 加载（`chrome.developerPrivate.getExtensionsInfo()` 读回的 `prettifiedPath` 核对过），只变页面 chunk，按 §6 在自己新开的 `app.html` 标签里刷新，没有重载扩展；页面加载的入口是 `app-BhpBw8Kv.js`，它引用的 chat chunk 是 `chat-AQLWqivh.js`。视口高 900：
  - **切换点**：899 / 900 / 1024 / 1199 宽——rail `display: none`、有汉堡、收展按钮 `display: none`、header 64、`html` `scroll-padding-top` 64px、`sidebarContainer` `padding-left` 0；1200 / 1440 宽——rail `flex` 且宽 300、无汉堡、收展按钮显示、header 72、`scroll-padding-top` 72px、`padding-left` 300px。收展按钮 JSX 写的是 `inline-flex`，读回 `flex`，是 `position: fixed` 的块级化，不是错。
  - **minimals.cc 同点对照**（自己新开的标签，量完即关）：`/dashboard/analytics` 1199 宽 header 64、无 rail，1200 宽 header 72、rail 300，与本页逐项一致；Minimal 的 `html` 没有 `scroll-padding-top`（`auto`），那是本仓库自加的。
  - **Dashboard KPI 卡**（宽 × 高）：900 宽 193 × 176（改前 118 × 248，见 §3）、1024 宽 224 × 154、1199 宽 268 × 136、1200 宽 185 × 176、1440 宽 245 × 136；899 宽起两列 410。900 宽四个数字都是一行，「2 / 6」不再折行。标题在 185–193 宽时折成两行，是 favbase 图标在右上 `absolute` + 文本栏 `pr: 8` 的既有布局（Step 5「顺带看到」那条，docs/25 Step 6 的决定），1200 宽改前改后一样，不属于本步。
  - **Chat 卡片高度**：1024 / 1199 / 1200 / 1440 四个宽度，卡片 `section` 底边都是 880 = 900 − 20（`DashboardContent` 的 `pb`），差值 0，文档不出现滚动。1024 与 1199 是 D-a 说的那段宽度：若只改默认值、不改高度键，按 `calc` 推算这里会多出 8px（推算，未构建那个中间态实测）。
  - **Chat 历史 Drawer**：1024 宽点开，paper `left` 0、宽 320，从视口左缘滑出，与 Minimal 同。截图里 paper 右缘那道 2px 红褐色竖线是 `:focus-visible` 轮廓：CDP 里用 JS `.click()` 打开、没有指针事件，浏览器按键盘交互给 paper 画焦点环，与本步无关。
  - 截图：Dashboard 900 / 1024 / 1199 / 1200、Chat 1024 / 1200 / 1024 开 Drawer，亮色 en。暗色与 zh-CN 没截：本步只动断点，不动颜色与文案。
- **顺带看到、不在本步范围**：welcome 的 `WelcomeLayout` 仍是 `md`，与 Minimal `MainLayout` 一致，不是遗漏；Chat 自己的 rail / Drawer 断点 `lg` 是 docs/25 Step 9 的决定，本来就与新的 shell 断点相同。

## §5 拒绝（沿用既有决定，本次不再提）

- Hero 改居中单列栈、换 `HeroBackground`：docs/28 D4 / D5。
- Header 加搜索、账号、workspace、通知中心：`entrypoints/app/layouts/CLAUDE.md` 拒绝清单（docs/23 §11 仍生效部分）。
- Chat 页在卡片上方加独立页标题：docs/25 Step 9 定了 header 72 承载唯一 h1。

## §6 环境副作用与回退

- **worktree**：本次对话进行中，另一个会话往 `main` 提交了两次（`99cd013`、`3d4a6e7`）。如果在主 checkout 里直接切分支，那个会话的下一次提交会落到本分支上，所以用 worktree。worktree 存在期间，主 checkout 里 `git switch feat/minimal-ui-polish` 会被 git 拒绝；本分支的提交在 worktree 目录里做，合并后 `git worktree remove .claude/worktrees/minimal-ui-polish`。
- **`.env.local`**：拷了一份进 worktree，保证构建环境一致（在 gitignore 里，不进提交）。
- **已加载的扩展是本分支的构建**：`main` 的原构建在 `.output/chrome-mv3.main-backup`。回退：删掉 `.output/chrome-mv3`，把备份改回原名（或在 `main` 上重新 `pnpm build`），再重载扩展。
- **2026-09-28 起加载方式变了**（Step 5 截图验收前由用户操作）：BrowserOS 里唯一的 favbase 扩展改为直接从 **worktree** 的 `.output/chrome-mv3` 以 unpacked 方式加载，扩展 id 从 `ifnlocdg…` 变成 `ijhppmon…`，原来从主 checkout 加载的那个已不在扩展列表里。于是 §1 第 6/7 条的「拷进主 checkout」不再需要：worktree 里 `pnpm build` 之后刷新自己的标签即可（manifest 或 background 变了仍要重载扩展）。扩展数据按 id 隔离，新 id 看不到旧 id 的设置与知识库（这次截图时的 778 条书签是新扩展自己同步来的）。回退到 `main` 的构建，要在扩展页把加载目录换回主 checkout 的 `.output/chrome-mv3`。

---

## 附：迁自根 CLAUDE.md 的落地摘要（2026-10-06 快照）

> 这一段原先写在根 `CLAUDE.md` 的「关键文档」一节，每个会话都全量加载。2026-10-06 按 docs/36 精简根文件时
> 逐字迁到这里，之后不再同步维护；与正文冲突时以正文为准。

app.html / welcome.html 对照 minimals.cc 的保真度整改（**Step 1 已落地并补验 2026-09-27**：会话很多时 rail 滚动、侧栏两形态按钮完整、暗色三项都有量化证据；**Step 2 已落地 2026-09-27**：用户决定推翻 docs/28 §3.4 的拒绝，welcome 结尾 `PlatformRequest` 按 Minimal `home-advertisement` 原样改成深色 CTA 卡，替换点——保留描述段、只一个 contained 按钮、`Headline` 新增 `ink="white"` + `tail` 形态、i18n 拆 `headingTail`、火箭插图原字节拷进 `public/assets/illustrations/`（再分发许可 [UNKNOWN]，用户接受）、间距照 Minimal 离开 `WelcomeSection`（旧 `pt: 0` 被响应式 `py` 的 md 媒体规则盖掉，从未在 md 以上生效），原验收「主 CTA 仍是视觉第一」作废，亮暗/三档宽度/双语截图已验；**Step 3 已落地 2026-09-27**：用户决定推翻 docs/28 D8，五个 section 标题换 Minimal `SectionTitle` 的中性写法——`SectionCaption` 裸 overline（色取 `text.secondary`，Minimal 的 `text.disabled` 对比度不过 4.5）、主体 `text.primary` 实色、尾词走 `fadeTextGradient` 淡出且去掉 Minimal 叠的 `opacity: 0.4`；hero 保 coral（`Headline ink="brand"`，Minimal 自己也是 hero 彩色、section 中性）；`Headline` 墨色改三态、默认 `neutral`，步骤大号数字与尾词共用 `fadeTextGradient`，i18n 五个标题拆 `headingTail`；中性尾词照 Minimal 用 `inline-block`（用户 2026-09-28 看过截图后推翻默认的 inline：inline 渐变按行切片，折下去的词成了淡色孤字），亮暗/三档宽度/双语截图已验；**Step 4 已落地 2026-09-28**：用户决定逐段对照 Minimal 源文件移植段落装饰线——`components/svg-elements.tsx`（`FloatLine`/`FloatPlusIcon`/两个三角/`FloatDotIcon` 五个，逐值照搬、根元素加 `aria-hidden`；`FloatXIcon` 无对应段、`CircleSvg` 落点会压在正文后面，都不移植）+ `components/animate/motion-viewport.tsx`（删掉 Minimal 的 smDown 分支：跨 600px 会卸载重建整段，picker 丢选择）+ `WelcomeSection lines`，how-it-works / chat / agentSkills / bilibili / picker / request 各照一个 Minimal 段落文件的 `renderLines`，只在 ≥1440px 显示，request 的 Container 补 Minimal 的 `zIndex: 9` 让中线横线从卡片后面穿过；亮暗截图与 1439/1440 门控、六处脊线接缝、跨 600px 不重建都已量过；**Step 5 已落地 2026-09-28**：用户决定 Dashboard KPI 数字整体照搬 Minimal `h4`（DM Sans 700、行高 1.5、20px → `md` 起 24px；原为 Barlow h3 600 / 1.3 / 固定 20），写法是 favbase 自己的 `variant="h4"` 在调用点覆盖字重与字号、组件零 `fontFamily`、主题阶梯数值零改动，spec §5 加只点名 `[data-slot="kpi-value"]` 的窄例外（口径「页面调用点里唯一随视口变字号的」——主题层输入框 15/16px 也随断点变），骨架数字行跟着 30 / `md` 36 且走 `sx`（`height` prop 是内联 style 会压过 `sx`）；emotion 规则已在测试环境核对，实机截图已验（1440 DM Sans 24/700/36、899 起 20/30，与 minimals.cc 同值）；截图顺带验出 favbase 侧栏在 `md`（900）就展开而 Minimal 是 `lg`（1200），900–1199 的 KPI 卡被挤到 118–193px 宽，记在 docs/31 §3；同日起扩展改从 worktree 的 `.output` 加载，见 docs/31 §6；**Step 6 已落地 2026-09-28**：用户从 §3 选定侧栏断点，dashboard shell 照 Minimal `DashboardLayout` 在 `lg` 切换——`layouts/dashboard/layout.tsx` 导出 `DASHBOARD_LAYOUT_QUERY`（与内容 gutter 的 `DASHBOARD_CONTENT_QUERY` 同为 `lg` 但是两个概念），Chat 卡片高度改按它切换（原字面量 `md`，只改默认值会在 900–1199 多出 8px），Chat 历史 Drawer 的 `left` 偏移删掉（同 Minimal），`layout.test.tsx` 断言汉堡的媒体查询是 `min-width:1200px`；`md` 查明是 `defdf00`（2026-07-06，Material Kit 时代）有意降的，早于 Minimal 移植；实机 1199/1200 切换点与 minimals.cc 逐项一致）。结论：docs/25 / docs/28 之后剩下的是移植缺陷而非缺设计。Step 1 修四处，各有一行根因：侧栏收展按钮排在 rail 前面、同 z-index 被盖掉左半；Chat rail 缺 Minimal 的 `flex: '1 1 auto'` 且带了未记录的 neutral 底；welcome 叠卡被 84vh 槽 stretch 成大片空白；Settings 的 `alignSelf` 写在非 flex 的 Grid 格子里。§1 是用 BrowserOS 的 CDP（MCP 驱动不了 `chrome-extension://`）截扩展页的可复现步骤；§4 的四个设计项各自撞一条已记录决定（深色 CTA 卡被 docs/28 §3.4 拒绝过、灰阶标题推翻 D8、段落装饰线无定论、KPI 字号撞 docs/25 D8），四项均已由用户决定并落地，§3 的侧栏断点一项作为 Step 6 落地，只剩 §3 两个未定性项（书签站点图标空白、暗色下品牌图标白底方块），开工前先读
