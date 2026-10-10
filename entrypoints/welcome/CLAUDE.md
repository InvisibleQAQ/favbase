# welcome (welcome.html)

首装引导页（WXT unlisted page）：一条纵向叙事，末尾的平台选择是进入 app.html 的唯一出口。外壳、Hero 几何与 `components/animate/` 是 Minimal v7.7.0 默认路由（`MainLayout` + `HomeView`）的移植。

## 触发与出口（onboarding 闸门）

- 闸门是 `onboardingStorage`（`local:onboarding`）有没有记录，不是 `onInstalled` 的 reason：unpacked 扩展每次 reload 都报 `'install'`，只看 reason 会在开发期反复弹标签页。`openWelcomePage()`（`lib/background/app-handlers.ts`）有记录即 no-op。
- 记录只由 `use-onboarding-exit.ts` 的 `exit(picked)` 写（`{ completedAt, platforms }`），随后 `location.replace` 到 app.html：`replace` 把 welcome 从 history 抹掉，返回键不会回到引导。
- 写失败照常跳转（代价只是引导多出现一次），不能把用户困在本页。守卫 `use-onboarding-exit.test.tsx`。
- 没有 Skip 入口：picker 是唯一出口，零选择也能提交（`exit([])` → Dashboard）。守卫 `layout.test.tsx`。

## 平台选择的语义

- `platforms` 是 **Onboarding Platform Preference**（根 `CONTEXT.md`）：只决定落地路由与侧栏 Collections 子叶的先后，**不做任何 gating**。所有平台始终可见可用，聚合页与 daily auto-sync 不读它。
- app.html 只在首次 render 前读一次（`entrypoints/app/load-navigation.ts`），不 watch、不改全局 registry。
- 落地规则在 `landing.ts`：按 registry 序的首个选择需要凭据 → `#/settings`，否则 → `#/collections/<platform>`，零选择 → 裸 app.html。点击顺序是噪声。

## 约束

- `motion` 只许 `entrypoints/welcome/**` import（守卫 `tests/ui-vendor-boundaries.test.ts` 的 `VENDOR_RULES`）；app.html 与 Content Script 不加动画依赖。
- 不上 `LazyMotion`：`bilibili-showcase.tsx` 的 `layoutId` 逼 `domMax`，总收益只有 1.4 KB（docs/28 §3.2）。移植 Minimal 组件时 `m` 一律改 `motion`。
- 不得 import `app/layouts/components` 的 barrel 与 `app/components/settings`：welcome 刻意不挂 `SettingsProvider`。顶栏控件按叶文件 import（同一测试的 `IMPORT_BOUNDARY_RULES`）。
- 跨入口引用写绝对路径 `@/entrypoints/app/...`；方向只有 welcome → app，app 不反向 import welcome。
- 图标只用 `entrypoints/app/components/iconify/icon-sets.ts` 注册过的名字：未注册的走网络加载，MV3 CSP 下不显示。移植 Minimal 组件时逐个核对。
- 本页没有 `<Snackbar/>`（`sonner` 被锁在 app 侧）：反馈在本地做，如 `agent-skills.tsx` 的三态复制按钮。
- `document.documentElement.lang` 只在 `welcome-view.tsx` 同步；`lib/i18n` 与 Content Script 共用，不能碰宿主页的 lang。
- 演示内容是示意：不放看起来像统计的数字（首装时库是空的，任何数字都是假的）。唯一例外是 `product-tour.tsx` 的真实截图。
- 全页唯一可执行的出口是 `agent-skills.tsx` 那条可复制指令（内插 `lib/repo.ts` 的 `AGENT_SETUP_GUIDE_URL`）。不出示任何 `npm` / `favbase setup` 命令：配对要 Bridge Token，首装时还不存在（`docs/adr/0005`）。
- 版本号与许可（`v{version} · GPL-3.0`）全产品只在 `footer.tsx` 露出，守卫 `layout.test.tsx`。footer 刻意零新外链。
- `capability-marquee.tsx` 的平台 pill 是手写的（`icon` 也是字面量），刻意不从 registry 派生（docs/26 D5）；pill 的 `platform` 字段只给字形取身份色，别借它改成从 `PLATFORM_META` 取图标。漏平台、`platform` 与 `labelKey` 对不上（抄行没改色），都由 `tests/platform-completeness-contract.test.ts` 报红。
- Platform Request 是动作外链，不是平台，不进 registry（根 `CONTEXT.md`）。

## 色彩

- 平台身份色（`theme.vars.palette.platform[id]`）只上字形：OrbitCore 芯片、marquee pill、picker 图标格。label、底、边框保持中性；ink 品牌由主题解析成墨色，本页不写平台分支。chat 演示的来源字形刻意不着色，跟 app 真实的 `sections/chat/source-card.tsx` 走（docs/39 D1-a）。
- picker 未选中图标格的底必须是 `background.neutral`：平台色的 3:1 只对 `background.default` / `neutral` 验证过（`app/theme/core/palette.test.ts`），原来的 `grey.500` 10% 洗底上 YouTube 暗色只有 2.99:1。选中态照 app nav 激活态：`text.accent` 字形 + `primary` 8% 洗底。
- 平台字形不拿来表达别的意思：书签的 `solar:bookmark-bold-duotone` 在本页是琥珀色，how-it-works 步骤 01 因此换成非平台字形（docs/39 D1-b）。
- 可读文字不用 `text.disabled`（亮色 2.7:1），用 `text.secondary`。
- 不写局部焦点环：`ButtonBase` 渲染 `<button>`，主题 CssBaseline 的 `button:focus-visible` 环（亮 `primary.darker`、暗 `primary.main`）已经覆盖；`.Mui-focusVisible` 与 `:focus-visible` 同时成立（MUI 的 `isFocusVisible` 就是 `matches(':focus-visible')`）。局部写 `primary.main` 在亮色只有 2.5:1。

## 向 Minimal 借鉴（先读 docs/28 §3 拒绝清单）

- 已拒绝、别再提：`HeroBackground`（同心圆虚线与 `OrbitCore` 的轨道圆打架）、`animate-text`（逐字 `inline-block`，无空格的中文整句会成为一个不可折行的词）、`renderIcons`（本页已有 OrbitCore / marquee / picker 三处在列平台）、`animate-count-up`、Pricing / Testimonials / FAQs 等销售页段落。
- `components/animated-text.tsx` 只切到词层，正是为了中文能按字折行，别换成 Minimal 的实现。
- 对 Minimal 的刻意偏离，别「对齐回去」：Hero 保留 Grid 左文右 `OrbitCore` 分栏而非居中单列栈（docs/28 D4）、背景保留 Aurora（D5）、顶栏跟 app.html 一样用 `disableElevation`（D3）。
- `platform-request.tsx` 是 Minimal `home-advertisement` 深色 CTA 卡的原样移植，视觉分量不再让位于 picker 的主 CTA（docs/31 Step 2 推翻了 docs/28 §3.4 对它的拒绝）。它不走 `WelcomeSection`、零纵向 padding，描述色固定 `grey.500`（深色卡不随配色变）。
- 火箭插图是 Minimal 资源的原字节拷贝，再分发许可 [UNKNOWN]，用户已知情接受。

## 标题（owner：`components/section-shell.tsx`）

- 标题着色只在这里定义：`Headline ink="brand"` 的 coral 渐变只给 hero；section 标题是中性实色 + 尾词淡出；`white` 只给 `platform-request.tsx` 的深色卡（docs/31 Step 3）。
- `how-it-works.tsx` 的步骤大号数字与中性尾词必须共用 `fadeTextGradient`；它与 `ctaGlowShadow` 都是定义一次的共享外观 helper，别再手写。
- 字号用 `clamp`，不许换成 `variant="h1"/"h2"`：本仓库的主题阶梯被刻意压小（h1 平 28px、h2 平 24px），换过去 section 标题会缩 25–57%（docs/28 §4 E2）。
- 中性尾词保持 `inline-block`，别改回 inline：inline 渐变按行切片，折到下一行的词只分到渐变末段，成了淡色孤字（docs/31 Step 3 D-d，用户看过截图后决定）。
- `fadeTextGradient` 去掉了 Minimal 叠的 `opacity: 0.4`，`SectionCaption` 用 `text.secondary` 而非 `text.disabled`：都是为对比度的刻意偏离。
- `Headline` 默认渲染 `h2`；全页唯一的 `h1` 在 `hero.tsx`，渐变留在每行的 `span` 上（挂到 h1 会横跨两行，且 `background-clip: text` 在 transformed 子元素上有渲染 glitch）。
- 调用点覆盖 `WelcomeSection` 的 `py`/`pt`/`pb` 必须带 `md` 键：标量只进 base 规则，md 起输给组件自己的媒体查询。

## 动画

- `MotionConfig reducedMotion="user"`（`main.tsx`）只把 transform 与 `width` / `height` / `top` / `left` / `right` / `bottom` 的声明式动画（motion-dom `positionalKeys`）和 layout 动画改成瞬时；opacity、颜色、`backgroundPosition`、`strokeDashoffset` 照跑，`style` 绑定的 MotionValue（滚动视差 / 缩放）完全不受它约束。要这些在 reduce 下停，必须在组件里用 `useReducedMotion()` 手动 gate。
- 动画元素从 `components/motion-box.tsx` 取 `MotionBox` / `MotionButtonBase`，别各自 `motion.create(...)`。
- 有意节奏的段落用 `FadeIn`（手排 delay，`x`/`y` 自由取值，`varFade` 装不进它，docs/28 §4 E1）；同质列表用 `MotionContainer` + `varContainer`。
- `MotionViewport` 不得恢复 Minimal 的 `smDown` 分支：它在 600px 处切换渲染元素类型，React 会卸载重建整段，picker 丢选择、chat demo 重播。
- 装饰线（`components/svg-elements.tsx`）只在 ≥1440px 显示，自身没有触发器，由外层 `MotionViewport` 的 variant 传播驱动，别给线挂 `whileInView`。
- 反过来，`MotionViewport` 里任何带 `variants` 的后代都会被它一起驱动；内容动画继续用 `FadeIn`（对象形 `initial`/`whileInView`，不进 variant 树）。
- 新段落要线：传 `WelcomeSection lines`；自带外层的段写成 `section（position: relative）> MotionViewport > renderLines() + Container`，线是 Container 的兄弟。
- 每段的 `renderLines` 写在本段文件里、偏移照对应的 Minimal 源文件，不抽共享（`product-tour` 与 `platform-picker` 的线相同，重复已知并接受）。`FloatXIcon`、`CircleSvg` 不移植（docs/31 §4 Step 4 D-a）。
- `hero.tsx` 的 `spent` gate（滚过后 `visibility: hidden`）不可删：钉住层是 `position: fixed`，`opacity: 0` 仍会让 Aurora 的 blur 圆与 orbit 动画节点持续合成（docs/28 §5）。`useScrollPercent` 的 `Math.floor` 同样承重。
- `hero.tsx` 的 `ScrollHint` 必须留在钉住层内：挪到层外它会随页面滚走，和它指向的（钉在视口的）内容分离。
- `how-it-works.tsx` 的 84vh 槽只是滚动跑道，必须 `alignItems: 'flex-start'`，否则卡片被 stretch 成大片空白。

## product-tour.tsx（真实截图画廊）

- 全页唯一出示产品本身而非 mock 的段落，Minimal `home-highlight-features` 的逐值移植。九处替换与三处几何偏离逐条写在文件头与落点注释里，封顶宽度的算术在 `stuckItemMaxWidth` 的注释。
- 三处几何偏离（钉住区在顶栏下方并按剩余高度封顶条目宽度 / 图标对齐标题行 / 宽度写在条目根上）修的是实测缺陷，别还原成源文件（docs/35 §7）。
- 只放仪表盘 / 全部收藏 / GitHub Stars / X 书签四页；哪些页面不能公开、怎么重截见 docs/35。图在 `public/assets/images/welcome/`，增删改名必须同步 `tour-images.ts`（守卫 `tour-images.test.ts`）。
- 代码不得依赖截图里有什么：图会按同名文件原位重截。
- section 根与 sticky 容器的任何祖先都不能加 `overflow: hidden / auto / scroll`，否则 sticky 失效（`layout.tsx` 根上的 `overflowX: 'clip'` 不建滚动容器，不在此列）。
- sticky 底色的 stop 是 CSS 变量，motion 在变量之间跳变、不插值，过渡靠 `ScrollContainer` 的 `transition`。别为了插值改成 `theme.palette.*` 的 hex，那会把配色冻在渲染那一刻。
- reduce-motion 分支是独立组件 `StackedContent`，不是同一组件里的条件：`useScroll` 的 target ref 一直不挂载会触发它的 invariant。

## 新增段落

`sections/` 加文件 → 装配进 `welcome-view.tsx` 里 Hero 之后那个 `position: relative` + 不透明底的 Box（Hero 内层在 md+ 是 `position: fixed`，出了这层会被它盖住）→ 文案补 `welcome.*` 双语 key。
