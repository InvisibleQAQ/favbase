# docs/31 — app.html / welcome.html 对照 minimals.cc 的保真度整改（2026-09-27）

- 分支：`feat/minimal-ui-polish`（worktree `.claude/worktrees/minimal-ui-polish`，原因见 §6）
- 参考：app.html ↔ <https://minimals.cc/dashboard>，welcome.html ↔ <https://minimals.cc/>；源码 `$MIN` = `C:\Users\18368\Desktop\00_myCode\35_minimal\minimal-dashboard\minimal-dashboard v7.7.0\Vite.js (JavaScript，TypeScript)\minimal-vite-ts-main\src`
- 状态：**Step 1 已落地并补验完毕**（四处实现缺陷；首轮未验证的三项已于同日补验，见 §2「验证」）；Step 2–5 是设计项，**待用户决定**，未开始

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

## §4 待决步骤（需用户决定，未开始）

每一条都会推翻或扩展一条已记录的决定，所以不自作主张。

### Step 2 — welcome 结尾改成 Minimal 的深色 CTA 大卡

- **Minimal**：`$MIN/sections/home/home-advertisement.tsx`（179 行）：`grey.900` 底 + 36px 网格底纹 + `borderRadius: 3` + 插图 + 两个按钮，标题后半句是白色淡出渐变。
- **favbase 现状**：`entrypoints/welcome/sections/platform-request.tsx`，居中标题 + 描述 + outlined 按钮。
- **冲突**：① docs/28 §3.4 **明确拒绝过** `Advertisement`（与 Pricing/Testimonials 等一起，理由是「销售页段落」）；② `platform-request.tsx` 的注释写明该段「刻意低调（outlined、无光晕），不和上方 picker 的『进入 favbase』主 CTA 抢」。深色大卡正好会跟主 CTA 抢。
- **如果要做**：只借外壳（深底 + 网格底纹 + 圆角），文案和按钮不变；需先推翻上面两条，并决定主 CTA 与它的主次关系。
- **验收**：滚动截图里主 CTA 仍是视觉第一；亮暗两种配色都看。

### Step 3 — section 标题换成 Minimal 的样式

- **Minimal**：`$MIN/sections/home/components/section-title.tsx`：`overline` 小号说明文字 + 标题后半截 `text.primary` → 20% alpha 的灰阶淡出（再叠 `opacity: 0.4`）。
- **favbase 现状**：`Eyebrow` 药丸 + `headlineGradient(theme)` 的珊瑚渐变（`entrypoints/welcome/components/section-shell.tsx`）。
- **冲突**：docs/28 **D8 是用户决定**：「结构取、颜色留，保 coral 品牌色，`Eyebrow` 药丸保留」。做这一步等于推翻 D8。
- **如果要做**：改 `headlineGradient` 这一个 owner 即可（`Headline` 与三步叠卡的大号数字共用它），药丸换 `overline` 文字。

### Step 4 — 段落装饰线（虚线 + 「+」标记）

- **Minimal**：`$MIN/sections/home/components/svg-elements.tsx`（289 行）的 `FloatLine` / `FloatPlusIcon` 等，`$MIN/sections/home/` 的 11 个段落文件里 9 个用了它们（`home-hero` 与 `home-for-designer` 没用）；它们**只在 ≥1440px 显示**（`baseStyles` 里 `breakpoints.up(1440)`），描边 `grey.500`、`opacity: 0.24`，进入视口时线条从 0 画到 100%。
- **favbase 现状**：没有。
- **冲突**：无直接冲突——docs/28 D5 / §3.1 只拒绝了 hero 的 `HeroBackground`（理由是同心圆虚线与 `OrbitCore` 打架），没有对段落装饰线下结论。
- **如果要做**：移植 `FloatLine` + `FloatPlusIcon` 两个到 `entrypoints/welcome/components/`（`m` 改 `motion`，按 CLAUDE.md 铁律不引 `LazyMotion`）；hero 段不加，避免重新引入 D5 拒绝的那种语汇冲突。

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
