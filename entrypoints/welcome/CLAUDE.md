# welcome (welcome.html)

首装引导页（WXT unlisted page，目录内 `index.html` → 产物 `welcome.html`）。一条纵向叙事：Hero → 能力 pill 双行 → 三步 sticky 叠卡（收录 → 知识库 → 提问）→ Chat 主功能演示 → B 站 CS 面板演示 → 平台多选 + 进入 app.html。

## 触发与出口

- **触发**：`entrypoints/background.ts` 的 `onInstalled` 在 `details.reason === 'install'` 时调 `openWelcomePage()`（`lib/background/app-handlers.ts`）。**真正的闸门是 `onboardingStorage`**，不是 reason——unpacked 扩展每次 reload 都报 `'install'`，只看 reason 会在整个开发期反复弹标签页
- **出口**：`use-onboarding-exit.ts` 的 `exit(picked)` 先写 `onboardingStorage`（`{ completedAt, platforms }`），再 `location.replace(app.html + landingHash)`。用 `replace` 而非 `assign`：复用当前标签页且把 welcome 从 history 抹掉，返回键不会把用户重新拽回引导
- **没有独立跳过入口**：用户从平台选择区进入 app；零选择仍允许提交 `exit([])`，写完成记录并落到 Dashboard

## 平台选择的语义（重要）

`local:onboarding` 的 `platforms` 是 **Onboarding Platform Preference**（领域定义见根 `CONTEXT.md`），**只影响落地路由与 Collections 子叶优先级，不做任何 gating**：所有平台始终可见可用，`/collections` 聚合与 `useDailyAutoSync` 不读它。`app.html` 在首次 render 前由 `load-navigation.ts` 读取一次，`nav-config.tsx#createNavData` 按 registry 稳定分区为「选中在前、未选在后」，两组内部都保持 registry 顺序；不 watch、不修改全局 registry。

CTA 落地规则在 `landing.ts`（纯函数 + `landing.test.ts`）：

- `normalizePicks` — 去重 + 排成 registry 顺序（点击顺序是噪声）
- `WELCOME_READINESS_BY_PLATFORM` — 穷举声明 `credentials` / `login` / `local` 三种就绪形态；`needsCredentials(platform)` 与 picker readiness 都从此 Adapter 派生，新增平台不能静默落入默认分支
- `needsCredentials(platform)` — `github`/`youtube` 需要 token/key，其余靠浏览器登录态或本地读取
- `landingHash(picked)` — 首个（registry 序）选择需要凭证 → `#/settings`；否则 → `#/collections/<platform>`；零选择 → 裸 app.html（dashboard）

想加平台开关就得改 registry + nav + daily auto-sync 三处并给老用户默认全开，属于产品级改动，不在本页职责内。

## 模块结构

- `index.html` / `main.tsx` — 入口。`main.tsx` 复用 app 的 `ThemeProvider` + `global.css`（字体 + reset），再叠 `welcome.css`；外层 `MotionConfig reducedMotion="user"` 让全页 motion 组件统一尊重系统「减弱动效」。**它只管声明式 `animate`**：`style` 绑定的 MotionValue（scroll-linked parallax / scale）不受其约束，须在组件里用 `useReducedMotion()` 手动 gate（现有：capability-marquee、how-it-works）
- `welcome.css` — 只放 sx 表达不了的东西：`.fb-headline` 渐变裁字（`background-clip:text` 必须挂在画字的那个元素上）+ 两个 aurora 色值 CSS var（`[data-color-scheme='dark']` 覆盖，与 `public/theme-init.js` 的属性同源）+ `.fb-caret` 流式光标 keyframes + `scroll-behavior: smooth`（包在 `prefers-reduced-motion: no-preference` 里）
- `welcome-view.tsx` — 段落装配 + 顶部滚动进度条；并订阅 `useTranslation().locale` 同步 `document.documentElement.lang`（a11y。**只准在 welcome 入口做**——`lib/i18n` 共享给 Content Script，绝不能改宿主页的 lang）。根 Box 用 `overflowX: 'clip'` 而非 `hidden`：`clip` 不建立滚动容器，sticky 叠卡才活得下来
- `landing.ts` / `landing.test.ts` — 落地路由纯函数与穷举 readiness Adapter（见上）
- `use-onboarding-exit.ts` / `use-onboarding-exit.test.tsx` — 写记录 + 跳转，返回 `{ exit, leaving }`（`leaving` 禁用 CTA 防重复点）。写失败只 console.error 后照常跳转——记录写不上最多让引导多出现一次，不能把用户困在这页（此行为有测试守着）

### components/

- `motion-box.tsx` — `MotionBox` / `MotionButtonBase` 唯一定义处。React 的 `onDrag`/`onAnimationStart` 等 DOM handler 类型与 motion 同名 props 冲突，故用 `MotionSafe<P>` 把它们从 MUI 侧 Omit 掉；`MotionSafeBoxProps` 导出给 `FadeIn` 复用。**新段落要动画元素就 import 这里，别再各自 `motion.create(Box)`**
- `fade-in.tsx` — `FadeIn`（`whileInView` + `once: true`，接 delay/duration/x/y）+ `WELCOME_EASE`。全页 stagger 都靠它的 `delay`
- `feature-list.tsx` — `FeatureList({ items: LocaleKeys[], startDelay? })`：✓ 打头的要点列表，从左侧依次滑入。chat 与 bilibili 两个 showcase 共用，**别再各自手抄一遍 FadeIn + checkmark + Typography**
- `animated-text.tsx` — 逐字滚动点亮段落。按空白切词、每个词包 `inline-block`：拉丁词不会断在字母中间，中文没有空格自成一「词」、占满行宽后按字自然折行
- `magnet.tsx` — 磁吸指针跟随（spring 回弹）。偏移量存 `useSpring` MotionValue 而非 React state：pointermove 每帧都来，用 state 会把被包裹的整棵子树（Hero orbit ≈20 个 motion 节点）每帧重渲一次。`useReducedMotion()` 为真时直接不订阅 pointermove——「跟着鼠标跑」没有可降级的静态版本
- `orbit-core.tsx` — Hero 主视觉：六个平台 chip 绕本地数据库核心公转。纯 DOM/SVG 零图片，自动跟随明暗主题。旋转层与 chip 内层**同周期反向自转**（`SPIN_SECONDS`）保证图标始终正立；chip 位置全靠 `--fb-orbit-r`（写成显式断点块而非 sx 响应式对象——自定义属性不在 sx 已知 style key 里）；平台元数据直接吃 `collectionPlatformRegistry`，加平台自动进环
- `section-shell.tsx` — `WelcomeSection`（统一纵向节奏 + Container）/ `Eyebrow`（小标签胶囊）/ `Headline`（`hero` 与 `section` 两档 clamp 字号 + `.fb-headline` 渐变；**默认渲染 `h2`** 保文档大纲，传 `component` 改层级或降为 `span`；字距/行高按 locale 分档——zh `letterSpacing:0` + `lineHeight:1.12`，en 保持 `-0.03em`/`0.98`，避免满框的 CJK 字形被负字距挤压、在 overflow-hidden reveal 下被裁边）/ `ctaGlowShadow(theme)`（hero 与 picker 主 CTA 共享的主色光晕阴影，别再手写）

### sections/

- `top-bar.tsx` — 固定顶栏：图标 + wordmark + tagline，右侧挂 `top-bar-actions.tsx`。无跳过按钮；导出 `TOP_BAR_HEIGHT` 供 Hero 留白
- `top-bar-actions.tsx` — 顶栏右侧三控件（docs/25 Step 4 起）：`太阳 | iOS 开关 | 月亮` 主题药丸（本文件自有，`custom:sun-color`/`custom:moon-color` 多色离线图标 + `useColorScheme()`，mounted 前回退读 `<html data-color-scheme>`，切换走 `@/entrypoints/app/theme/mode-transition` 的圆形揭示）+ **共享**的 `LanguagePopover` 与 `GithubButton`（按叶文件 import `@/entrypoints/app/layouts/components/{language-popover,github-button}`，**不走 barrel**——barrel 带 `settings-button` → settings context → storage，welcome 不该被拖进去）。
  之前这里直接复用 dashboard 的 `HeaderActions`；app.html 在 Step 4 把主题控制搬进了外观抽屉（需要 welcome 刻意不挂的 `SettingsProvider`），于是药丸落户在本文件——控件形态、`header.themeAria` 与 `favbase-color-mode` 键都没变
- `hero.tsx` — 100vh 首屏：aurora 双色斑（motion 慢漂）+ 文案 stagger + `OrbitCore` + 滚动提示。两个 CTA 是纯 `href="#welcome-picker"` / `"#welcome-flow"` 锚点（本页无 router，交给 CSS 平滑滚动）。标题是全页**唯一的 h1**：外层 `Box component="h1"`，两行各自 `FadeIn component="span"`（reveal mask）包 `Headline component="span"`——渐变留在每行，挂到 h1 上会横跨两行改变观感，且 background-clip:text 在 transformed 子元素上有渲染 glitch
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
- 图标只用 `entrypoints/app/components/iconify/icon-sets.ts` 里注册过的名字——未注册会走网络加载，MV3 CSP 下直接不显示
- 演示内容是**示意，不是真数据**：不要在这页放看起来像统计的数字（收藏数、用户数、准确率），首装时数据库是空的，任何数字都是假的
- 新增段落：`sections/` 加文件 → `welcome-view.tsx` 装配 → 动画元素从 `components/motion-box` 取 `MotionBox` → 文案补双语 key
