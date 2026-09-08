# welcome (welcome.html)

首装引导页（WXT unlisted page，目录内 `index.html` → 产物 `welcome.html`）。一条纵向叙事：Hero → 能力 pill 双行 → 三步 sticky 叠卡（收录 → 知识库 → 提问）→ Chat 主功能演示 → B 站 CS 面板演示 → 平台多选 + 进入 app.html → 页尾 Footer。

外壳自 2026-09-08 起是 Minimal v7.7.0 默认路由（`MainLayout` + `HomeView`）的移植：`layout.tsx` 吃 `app/layouts/core` 三件套，Hero 换 Minimal 的负 margin 几何 + 钉住淡出 + 四层视差，`components/animate/` 是移植进来的 motion 原语层。**决策与拒绝清单在 `docs/28`**——「为什么没抄 HeroBackground / LazyMotion / AnimateText」这类问题在那里有答案，别对着参考源重问一遍。

## 触发与出口

- **触发**：`entrypoints/background.ts` 的 `onInstalled` 在 `details.reason === 'install'` 时调 `openWelcomePage()`（`lib/background/app-handlers.ts`）。**真正的闸门是 `onboardingStorage`**，不是 reason——unpacked 扩展每次 reload 都报 `'install'`，只看 reason 会在整个开发期反复弹标签页
- **出口**：`use-onboarding-exit.ts` 的 `exit(picked)` 先写 `onboardingStorage`（`{ completedAt, platforms }`），再 `location.replace(app.html + landingHash)`。用 `replace` 而非 `assign`：复用当前标签页且把 welcome 从 history 抹掉，返回键不会把用户重新拽回引导
- **没有独立跳过入口**：用户从平台选择区进入 app；零选择仍允许提交 `exit([])`，写完成记录并落到 Dashboard

## 平台选择的语义（重要）

`local:onboarding` 的 `platforms` 是 **Onboarding Platform Preference**（领域定义见根 `CONTEXT.md`），**只影响落地路由与 Collections 子叶优先级，不做任何 gating**：所有平台始终可见可用，`/collections` 聚合与 `useDailyAutoSync` 不读它。`app.html` 在首次 render 前由 `load-navigation.ts` 读取一次，`nav-config.tsx#createNavData` 按 registry 稳定分区为「选中在前、未选在后」，两组内部都保持 registry 顺序；不 watch、不修改全局 registry。

CTA 落地规则在 `landing.ts`（纯函数 + `landing.test.ts`）：

- `normalizePicks` — 去重 + 排成 registry 顺序（点击顺序是噪声）
- `WELCOME_READINESS_BY_PLATFORM` — 三种就绪形态 `credentials` / `login` / `local`，自 docs/26 Step 2 起由 `lib/collections/platform-descriptor.ts` 的 `readiness` 派生（`WelcomeReadiness` 是 `PlatformReadiness` 的别名，导出名不变）；`needsCredentials(platform)` 与 picker readiness 都从此 Adapter 读，新增平台不能静默落入默认分支
- `needsCredentials(platform)` — `github`/`youtube` 需要 token/key，其余靠浏览器登录态或本地读取
- `landingHash(picked)` — 首个（registry 序）选择需要凭证 → `#/settings`；否则 → `#/collections/<platform>`；零选择 → 裸 app.html（dashboard）

想加平台开关就得改 registry + nav + daily auto-sync 三处并给老用户默认全开，属于产品级改动，不在本页职责内。

## 模块结构

- `index.html` / `main.tsx` — 入口。`main.tsx` 复用 app 的 `ThemeProvider` + `global.css`（字体 + reset），再叠 `welcome.css`；外层 `MotionConfig reducedMotion="user"` 让全页 motion 组件统一尊重系统「减弱动效」。**它只管声明式 `animate`**：`style` 绑定的 MotionValue（scroll-linked parallax / scale）不受其约束，须在组件里用 `useReducedMotion()` 手动 gate（现有：hero、capability-marquee、how-it-works）
- `welcome.css` — 只放 sx 表达不了的东西：两个 aurora 色值 CSS var（`[data-color-scheme='dark']` 覆盖，与 `public/theme-init.js` 的属性同源；它们是 `radial-gradient` 的 stop，由 `background` 消费）+ `.fb-caret` 流式光标 keyframes + `scroll-behavior: smooth`（包在 `prefers-reduced-motion: no-preference` 里）。**标题渐变已不在这里**——`.fb-headline` 与它那两套硬编码 hex 的 CSS var 于 2026-09-08 删除，改由 `section-shell.tsx` 的 `headlineGradient(theme)` 吃 palette token
- `layout.tsx` — **页面外壳，顶栏与 Footer 的 owner**。`LayoutSection`（无 sidebar 分支，它自带）+ `HeaderSection`（`leftArea` = `BrandMark tagline`、`rightArea` = `TopBarActions`）+ `MainSection` + `footerSection`，外挂 `ScrollProgress`（`zIndex: appBar + 2`，压在 header 的 `--layout-header-zIndex` = appBar+1 之上）与 `BackToTopButton`。按叶 import `@/entrypoints/app/layouts/core/*`（该目录无 barrel）。`disableElevation` 跟 app.html 一致：静止透明、滚动后淡入 blur + divider、无椭圆阴影——用户从 welcome 点进 app 是连续动作，顶栏不该变。**无 Skip Intro 入口**（有测试守着）；Minimal 的 `SignInButton`/`Purchase`/`SettingsButton`/`NavDesktop`/`NavMobile` 全部不移植，理由见 docs/28 §2.1。`LayoutSection` 顺带修掉一个现存 bug：它注入 `html { scroll-padding-top: var(--layout-header-*-height) }`，Hero 那两个锚点 CTA 跳过去不再被顶栏压掉 64px，`TOP_BAR_HEIGHT` 手算常量随之删除
- `footer.tsx` — 页尾。照 Minimal `HomeFooter` 的形状（居中、`py: 5`、品牌 + 一行 caption），caption 是 `v{version} · GPL-3.0`。**这两项全产品零露出**，footer 停印就是彻底消失（有测试守着）。版本读 `browser.runtime.getManifest().version`（模块作用域读一次）。**刻意零新外链**——repo 链接本页已两处（header `GithubButton` + `PlatformRequest` 的 issue 按钮）
- `welcome-view.tsx` — 段落装配，包在 `WelcomeLayout` 里；并订阅 `useTranslation().locale` 同步 `document.documentElement.lang`（a11y。**只准在 welcome 入口做**——`lib/i18n` 共享给 Content Script，绝不能改宿主页的 lang）。Hero 之后的段落**必须**包在 `position: relative` + `bgcolor` 的 Box 里：Hero 的内层在 `md+` 是 `position: fixed`，没有这层它会浮在下方内容之上（Minimal `HomeView` 用 `Stack` 做同一件事）
- `layout.test.tsx` — 外壳契约：无 Skip Intro（picker 是唯一出口且接受空选择）+ footer 印着版本与许可
- `landing.ts` / `landing.test.ts` — 落地路由纯函数与派生 readiness Adapter（见上）
- `use-onboarding-exit.ts` / `use-onboarding-exit.test.tsx` — 写记录 + 跳转，返回 `{ exit, leaving }`（`leaving` 禁用 CTA 防重复点）。写失败只 console.error 后照常跳转——记录写不上最多让引导多出现一次，不能把用户困在这页（此行为有测试守着）

### components/

- `motion-box.tsx` — `MotionBox` / `MotionButtonBase` 唯一定义处。React 的 `onDrag`/`onAnimationStart` 等 DOM handler 类型与 motion 同名 props 冲突，故用 `MotionSafe<P>` 把它们从 MUI 侧 Omit 掉；`MotionSafeBoxProps` 导出给 `FadeIn` 复用。**新段落要动画元素就 import 这里，别再各自 `motion.create(Box)`**
- `animate/` — **从 Minimal `components/animate/` 移植的 motion 原语层**（314 行）：`variants/`（`varFade` 十方向全表 / `varContainer` 固定 stagger / `transitionEnter`·`transitionExit` 曲线）+ `MotionContainer`（挂载即播的 stagger 父，用于 Hero 首屏）+ `ScrollProgress`（只有 linear，见下）+ `BackToTopButton`。三条统一改动：`framer-motion` → `motion/react`、`m` → `motion`（**不上 `LazyMotion`**——`bilibili-showcase` 的 `layoutId` 逼 `domMax`，总收益 1.4 KB，docs/28 §3.2 有数字）、`Box component={m.div}` → `MotionBox`。`ScrollProgress` 裁掉了 circular / portal / RTL / 调用方传 `progress`（本仓库无 `direction` 支持，进度来源只有文档滚动一处）。**`motion` 只允许 `entrypoints/welcome/**` import**，守卫 `tests/ui-vendor-boundaries.test.ts` 的 `VENDOR_RULES`
- `brand-mark.tsx` — 图标 + wordmark，`tagline` opt-in。header 传 `tagline`、footer 不传（否则页尾重复页首）
- `fade-in.tsx` — `FadeIn`（`whileInView` + `once: true`，接 delay/duration/x/y）。曲线与默认时长吃 `animate/variants/transition` 的 `transitionEnter()`，与 `varFade` 同源不会漂（`WELCOME_EASE` 已删）。`x`/`y` **刻意保持自由取值**：`varFade` 是固定方向 + 单个 distance，表达不了「向上且向左」，套一层 `(x,y) → 方向` 映射比这两个内联对象更多代码（docs/28 §4 E1）。**有意节奏的段落用它**（hero 的 0.1/0.2/0.34/0.46 阶梯、两个 showcase 的分镜）；同质列表该用 `MotionContainer` + `varContainer`（固定 50ms，加删元素不用手算）
- `feature-list.tsx` — `FeatureList({ items: LocaleKeys[], startDelay? })`：✓ 打头的要点列表，从左侧依次滑入。chat 与 bilibili 两个 showcase 共用，**别再各自手抄一遍 FadeIn + checkmark + Typography**
- `animated-text.tsx` — 逐字滚动点亮段落。按空白切词、每个词包 `inline-block`：拉丁词不会断在字母中间，中文没有空格自成一「词」、占满行宽后按字自然折行
- `magnet.tsx` — 磁吸指针跟随（spring 回弹）。偏移量存 `useSpring` MotionValue 而非 React state：pointermove 每帧都来，用 state 会把被包裹的整棵子树（Hero orbit ≈20 个 motion 节点）每帧重渲一次。`useReducedMotion()` 为真时直接不订阅 pointermove——「跟着鼠标跑」没有可降级的静态版本
- `orbit-core.tsx` — Hero 主视觉：六个平台 chip 绕本地数据库核心公转。纯 DOM/SVG 零图片，自动跟随明暗主题。旋转层与 chip 内层**同周期反向自转**（`SPIN_SECONDS`）保证图标始终正立；chip 位置全靠 `--fb-orbit-r`（写成显式断点块而非 sx 响应式对象——自定义属性不在 sx 已知 style key 里）；平台元数据直接吃 `collectionPlatformRegistry`，加平台自动进环
- `section-shell.tsx` — `WelcomeSection`（统一纵向节奏 `py: {xs:10, md:20}` + Container）/ `Eyebrow`（小标签胶囊，**刻意不换成 Minimal 的裸 overline**）/ `Headline`（`hero` 与 `section` 两档 **clamp** 字号；**默认渲染 `h2`** 保文档大纲，传 `component` 改层级或降为 `span`；字距/行高按 locale 分档——zh `letterSpacing:0` + `lineHeight:1.12`，en 保持 `-0.03em`/`0.98`，避免满框的 CJK 字形被负字距挤压、在 overflow-hidden reveal 下被裁边）/ `headlineGradient(theme)` / `ctaGlowShadow(theme)`（后两个都是「定义一次，别再手写」的共享外观 helper）
  - **`Headline` 的字号不许换成 `variant="h1"/"h2"`**：本仓库的 typography 在 docs/25 Step 1 移植时刻意压小并去掉了 `responsiveFontSizes`（h1 是平的 28px、h2 平的 24px，对 dashboard 标题栏正合适，对 landing 大标题远远不够）。Minimal 自己的 h1 跑 40→64px，正是这两个 clamp 已经在近似的东西。换过去会把 section 标题压掉 25–57%（docs/28 §4 E2）
  - **`headlineGradient(theme)` 是标题渐变的唯一 owner**：`Headline` 与 `how-it-works` 的步骤大号数字共用。它取 palette token（light `grey.800`→`grey.700`→`primary.main`，dark 经 `applyStyles` 换成 `common.white`→`grey.400`→`primary.light`），取代了 `welcome.css` 时代的 `.fb-headline` class + 六个硬编码 hex。**那两处分开写正是它们能漂的原因**——步骤数字当时就是直接挂 class、绕过组件的。Minimal 的 section 标题渐变是**灰阶淡出**（`text.primary` → 20% alpha），因为它是中性 UI kit；favbase 有品牌色，保 coral

### sections/

- `top-bar-actions.tsx` — 顶栏右侧三控件（由 `layout.tsx` 作为 `HeaderSection` 的 `rightArea` 消费），**全部是共享叶**，按叶文件 import `@/entrypoints/app/layouts/components/{theme-mode-button,language-popover,github-button}`，**不走 barrel**（barrel 带 `settings-button` → settings context → storage，welcome 不该被拖进去）。**这条有守卫**：`tests/ui-vendor-boundaries.test.ts` 的 `IMPORT_BOUNDARY_RULES`（barrel 与 `app/components/settings` 双禁、叶文件放行，并反向断言 welcome 确实按叶消费着控件）。本文件只剩一个 flex Box 的装配。
  沿革：最早直接复用 dashboard 的 `HeaderActions`；docs/25 Step 4 app.html 把主题控制搬进外观抽屉（需要 welcome 刻意不挂的 `SettingsProvider`），主题药丸只好落成本文件私有的 `styled(Switch)`；2026-09-05 light/dark 回到 app Header，药丸随之删除、换成共享的 `ThemeModeButton`（单个图标按钮，与相邻两个控件同尺寸同 hover），`favbase-color-mode` 键与 View Transition 圆形揭示都没变；2026-09-08 顶栏壳本身换成移植的 `HeaderSection`，本文件从「被 `top-bar.tsx` 挂在右侧」变成「被 `layout.tsx` 填进 slot」，内容未动
- `hero.tsx` — 100vh 首屏，几何取自 Minimal `home-hero`：`md+` 用 `mt: calc(var(--layout-header-desktop-height) * -1)` 把顶栏那行吃回来（所以是真 100vh，没人需要手算高度）+ `height:100vh`/`minHeight:760`/`maxHeight:1440`，**内层 `position: fixed`** 让内容钉在视口、随滚动 `opacity` 淡出，另有四层 spring 视差（y1 = eyebrow+h1、y2 = 副文案、y3 = CTA 行、y4 = OrbitCore）。布局**保留 Grid 左文右 orbit 分栏**，不改 Minimal 的居中单列栈——它用居中栈是因为没有产品主视觉可放，`OrbitCore` 是 favbase 唯一一眼说清产品形状的东西。视差与淡出只在 `mdUp && !reduceMotion` 生效。内容：aurora 双色斑（motion 慢漂）+ 文案 stagger + `OrbitCore` + 滚动提示（`ScrollHint` 必须在钉住层**内**，否则它会与它指向的内容分离）。两个 CTA 是纯 `href="#welcome-picker"` / `"#welcome-flow"` 锚点（本页无 router，交给 CSS 平滑滚动 + `LayoutSection` 注入的 `scroll-padding-top`）。标题是全页**唯一的 h1**：外层 `Box component="h1"`，两行各自 `FadeIn component="span"`（reveal mask）包 `Headline component="span"`——渐变留在每行，挂到 h1 上会横跨两行改变观感，且 background-clip:text 在 transformed 子元素上有渲染 glitch
  - **`spent` gate 不是可选的**：`percent >= 100` 时钉住层加 `visibility: 'hidden'`。fixed 之后元素永远 onscreen，Aurora 那两个 `filter: blur(48px)` 大圆与 orbit 约 20 个动画节点会**持续参与合成**；`visibility: hidden` 让浏览器跳过整棵子树，`opacity: 0` 不会。Minimal 不付这个代价是因为它的 hero 背景是静态的（docs/28 §5）
  - `useScrollPercent` 的 `Math.floor` 是承重的：它把每个滚动帧收敛成「每整数百分点最多一次 setState」，整屏约 100 次 re-render 而非每帧一次
- `capability-marquee.tsx` — 双行反向 pill 跑马灯，**由页面滚动驱动**（`useScroll` + `useTransform`）而非 CSS 无限循环：读者停下它就停，不跟正文抢注意力。行内容三倍复制保证两端不露白，两侧 `maskImage` 渐隐。`useReducedMotion()` 为真时不绑 `style={{x}}`，pill 行静止
- `how-it-works.tsx` — 三步 sticky 叠卡。`useScroll` 测整栈进度，每张卡 `1 - (total-1-index) * 0.04` 目标缩放做景深；卡内右侧 `StepGlyph`（rows / grid / bubble 三种抽象装饰）。sticky 在 `md+` 生效，窄屏退化为普通堆叠；reduce-motion 时不绑 `style={{scale}}`，卡片全尺寸堆叠
- `chat-showcase.tsx` — **主功能演示**。`useInView(once)` 触发脚本化播放：提问 → tool call（转圈 → ✓ 命中 N 条）→ 打字机流式作答 → 来源卡片 stagger。phase 常量 + 定时器数组，`useReducedMotion` 时直接跳到终态（流式动画没有「慢一点」的降级）。面板 `minHeight` 按终态尺寸给足，避免播放中把页面顶下去
- `bilibili-showcase.tsx` — B 站视频页 CS 面板演示：左侧播放器骨架 + 右侧面板 mock（字幕 / AI 总结双 tab，`layoutId` 让选中胶囊滑动）。入场 2.8s 后自动切到总结 tab 展示第二种能力，但 `pickedRef` 记录真人点击后不再自动切。tab 行 `role="tablist"`、`TabButton` 带 `role="tab"`/`aria-selected` + `Mui-focusVisible` 焦点环；播放器进度条动画走 `scaleX`（`transformOrigin: left`）而非 `width`，不逐帧 relayout
- `platform-picker.tsx` — 六平台多选卡（`collectionPlatformRegistry` 驱动）+ 就绪态标签（`readinessFor()`：需密钥 / 用登录态 / 开箱即用）+ 进入按钮。CTA 文案与 caption 随选择数变化（`welcome.picker.selected` 走复数 key）。卡片未选中态边框 `2px solid transparent`（选中亮 primary；宽度恒定防 layout shift），键盘焦点走 `Mui-focusVisible` 环；readiness 文字 `text.secondary` 保对比度
- `platform-request.tsx` — 页尾 Platform Request 引导（`welcome.request.*`）：Headline + 一句引导 + outlined 按钮外跳 `lib/repo.ts` 的预填 new-issue URL（`target="_blank"`）。刻意克制（outlined、无光晕）不抢上方 picker 主 CTA；它是动作外链不是平台，不进 registry（领域定义见根 `CONTEXT.md`）

### hooks/

- `use-typewriter.ts` / `use-typewriter.test.tsx` — `useTypewriter(text, active, msPerChar)` → `{ visible, done }`。`active` 变假会回卷；`useReducedMotion` 时一次到底；跑完清 interval（测试用 `vi.getTimerCount()` 断言不空转）

## 约定

- **文案全走 i18n**：`lib/i18n/locales/{zh-CN,en}.ts` 的 `welcome.*` 段。`tests/i18n-no-hardcoded.test.ts` 扫 `entrypoints/**/*.tsx` 拦 CJK 硬编码，新增段落必须双语补齐
- **跨入口复用写 `@/entrypoints/app/...`**（绝对路径）。本页是项目里第一个跨 entrypoint 引用 app 共享代码的地方（此前只有 `@/lib/...`）：从 `sections/` 用相对路径要写成 `../../app/...`，深度一变就得改，绝对路径更稳。方向单一——welcome → app，app 永不反向 import welcome
- 图标只用 `entrypoints/app/components/iconify/icon-sets.ts` 里注册过的名字——未注册会走网络加载，MV3 CSP 下直接不显示。移植 Minimal 组件时尤其要查：`BackToTopButton` 上游用的 `solar:double-alt-arrow-up-bold-duotone` 没注册，已换成 `eva:arrow-ios-upward-fill`
- **`motion` 只属于本入口**（根 `CLAUDE.md` 铁律，2026-09-08 起有守卫）：`tests/ui-vendor-boundaries.test.ts` 的 `VENDOR_RULES` 把 `motion` 的 owner 定为 `entrypoints/welcome`，app.html 与 Content Script 保持纯 MUI + CSS。构建后可复验——app.html 引用的 chunk 里 `framerAppearId`/`MotionConfigContext`/`createMotionComponent` 应零命中
- **向 Minimal 借鉴前先读 `docs/28`**：那里有逐条带理由的拒绝清单（`HeroBackground` 619 行 + 360 KB webp、`LazyMotion`、`AnimateText`、`animate-count-up`、九个未用 variants、Pricing/Testimonials/FAQs 那些销售页段落、`renderIcons` 的第四份平台清单）。**不看就照抄参考源，会把已经论证过不要的东西搬回来**
- 演示内容是**示意，不是真数据**：不要在这页放看起来像统计的数字（收藏数、用户数、准确率），首装时数据库是空的，任何数字都是假的
- 新增段落：`sections/` 加文件 → `welcome-view.tsx` 装配 → 动画元素从 `components/motion-box` 取 `MotionBox` → 文案补双语 key
