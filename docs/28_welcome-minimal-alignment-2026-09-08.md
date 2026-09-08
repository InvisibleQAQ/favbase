# welcome.html 向 Minimal v7.7.0 默认路由看齐 — 决策记录

2026-09-08。一次做完，一个 commit。本文不是分步手册（docs/25 那种八段格式是为 11 个跨会话 Step 写的，本改造规模到不了），只记**从代码里看不出来的部分**：决策、适配矩阵、拒绝清单、执行时发现的勘误。

参考源：`$MIN = C:\Users\18368\Desktop\00_myCode\35_minimal\minimal-dashboard\minimal-dashboard v7.7.0\Vite.js (JavaScript，TypeScript)\minimal-vite-ts-main\src`

「Minimal 的 welcome 页」= 默认路由 `/`，即 `routes/sections/index.tsx` 的 `MainLayout` 包 `pages/home.tsx` → `sections/home/view/home-view.tsx`（11 段营销叙事 + `ScrollProgress` + `BackToTopButton`，`sections/home/` 共 2627 行）。

---

## §1 决策记录

十条，全部经用户在 grill 中逐条确认（2026-09-08）。

| # | 决策 | 来源 |
|---|---|---|
| D1 | 档位 = **骨架 + 语言**。移植 layout 与 animate 原语层、Hero 换 Minimal 几何、段落逐段换节奏；**段落清单不变**（仍是 favbase 自己的七段） | 用户决定 |
| D2 | 骨架落 `entrypoints/welcome/layout.tsx`（welcome 私有），按叶 import `app/layouts/core/*`。不建 `app/layouts/main/`——app.html 只有 dashboard 布局，永不消费 MainLayout | 用户决定 |
| D3 | 顶栏行为**跟 app.html 一致**：`disableElevation`，静止透明 / 滚动后淡入 blur + divider / 无椭圆阴影。不跟 Minimal home（它两个 prop 都不传，多一层 `z8` 椭圆阴影） | 用户决定 |
| D4 | Hero **保留 Grid 左文右 OrbitCore 分栏**，不改居中单列栈。Minimal 用居中栈是因为它没有产品主视觉可放（只能堆星级、头像、平台小图标） | 用户决定 |
| D5 | Hero 背景**保留 Aurora**，不移植 `HeroBackground` | 用户决定 |
| D6 | animate 层**按内容分**：`FadeIn` 保签名（57 处调用点不动）内部换实现；同质列表用 `MotionContainer` + `varContainer` 固定 stagger；有意节奏处保手排 delay | 用户决定 |
| D7 | animate 原语落 `entrypoints/welcome/components/animate/` + `VENDOR_RULES` 加 `motion` 守卫 | 用户决定 |
| D8 | section 语言**结构取、颜色留**：渐变实现从 CSS class 换成 `theme.mixins.textGradient`，但**保 coral 品牌色**；`Eyebrow` 药丸保留；`py` md 16→20 | 用户决定 |
| D9 | Footer = 品牌块 + `v{version} · GPL-3.0`，**零新外链**（repo 链接本页已两处：header `GithubButton` + `PlatformRequest` 的 issue 按钮） | 用户决定 |
| D10 | 一次做完 + 本文精简决策记录，不写八段 Step 手册 | 用户决定 |

**不写 ADR**：三条件里「难以逆转」不成立（每条都是改 import 或改 sx 即可回退）。`CONTEXT.md` **不改**：本次全在 UI 实现层，无新领域术语，`Onboarding Platform Preference` 等既有定义未受影响。

---

## §2 适配矩阵

### 2.1 Layout（`$MIN/layouts/main/`）

| Minimal | favbase | 说明 |
|---|---|---|
| `layouts/core/{layout-section,header-section,main-section}` | 已在仓库（docs/25 Step 1 移植） | `LayoutSection` **自带无 sidebar 分支**，无需伪造；它注入 `html { scroll-padding-top: var(--layout-header-*-height) }` |
| `MainLayout` slots：`MenuButton` / `NavMobile` / `NavDesktop` | **删** | 单页无路由导航 |
| `SignInButton` / `Purchase` | **删** | 无账号体系、无商店 |
| `SettingsButton` | **删** | 它 reach 到 settings context，welcome.html 刻意不挂（`IMPORT_BOUNDARY_RULES` 守着） |
| `Logo` | `components/brand-mark.tsx` | 图标 + wordmark，`tagline` opt-in（header 带、footer 不带） |
| `HomeFooter`（Logo + 一行 caption，`py: 5` 居中） | `footer.tsx` | caption 换成版本 + 许可 |
| 186 行大 `Footer`（socials + 三列 LINKS + 订阅） | **不移植** | Minimal 自己的 home 页也没用它 |

**修掉一个现存 bug**：原 `hero.tsx:98` 手算 `pt: TOP_BAR_HEIGHT + 40`，全页无 `scroll-padding-top`，Hero 的两个锚点 CTA（`#welcome-picker` / `#welcome-flow`）跳过去时目标段落顶部被 fixed 顶栏压掉 64px。`LayoutSection` 白送修掉，`TOP_BAR_HEIGHT` 常量随 `sections/top-bar.tsx` 一起删除。

### 2.2 Hero（`$MIN/sections/home/home-hero.tsx`）

六个可分离特征：

| # | 特征 | 处理 |
|---|---|---|
| 1 | `mt: calc(var(--layout-header-desktop-height) * -1)` + `md+` `height:100vh`/`minHeight:760`/`maxHeight:1440` + 内层 `position: fixed` | **取** |
| 2 | `opacity` 随滚动百分比 1→0（仅 mdUp） | **取**，另加 `useReducedMotion` gate |
| 3 | 五层 spring 视差 y1..y5 | **取四层**（favbase 左列三块 + 右列 orbit）：y1 = eyebrow+h1，y2 = 副文案，y3 = CTA 行，y4 = OrbitCore |
| 4 | 居中单列栈 | **不取**（D4） |
| 5 | `h1` 吃 `typography:'h2'` + lg 断点 72/90px；首行 `opacity:0.24`；品牌词 `textGradient` + 20s `backgroundPosition` 往复 | **部分取**：渐变实现取，字号不取（见 §4 勘误 E2） |
| 6 | `HeroBackground` | **不取**（D5，理由见 §3） |

### 2.3 animate 原语（`$MIN/components/animate/`）

取（实际 314 行，低于预估 404——见 §4 勘误 E3）：

| 文件 | 行 | 落点 |
|---|---|---|
| `variants/fade.ts` | 92 | `components/animate/variants/fade.ts` |
| `variants/container.ts` | 31 | 同上目录 |
| `variants/transition.ts` | 18 | 同上目录 |
| `motion-container.tsx` | 29 | `components/animate/` |
| `scroll-progress/`（137 + 31） | 75 | `components/animate/scroll-progress.tsx`（单文件，见 §4 E3） |
| `back-to-top-button.tsx` | 57 | `components/animate/` |

统一改动：`framer-motion` → `motion/react`；`m` → `motion`（D6 配套，理由见 §3）；`Box component={m.div}` → `MotionBox`（本页「一个动画 Box」只有一个定义处）。

### 2.4 section 语言（`$MIN/sections/home/components/section-title.tsx`）

| | favbase 现状 | Minimal | 结果 |
|---|---|---|---|
| eyebrow | `Eyebrow` 药丸胶囊 | `SectionCaption` 裸 overline | **保留药丸**（D8） |
| 标题渐变 | `.fb-headline` CSS class + 两套 CSS var + 六个硬编码 hex | 只给 `txtGradient` 那半句上灰阶淡出（`text.primary` → 20% alpha + `opacity: 0.4`） | **实现换成 `theme.mixins.textGradient`，颜色保 coral**（D8） |
| 字号 | `clamp()` 两档 | `variant="h2"` 主题阶梯 | **保 clamp**（§4 E2） |
| `py` | `{xs:10, md:16}` | `{xs:10, md:20}` | **取 20** |

渐变的 hex → token 映射（`theme-config.ts` 对账）：`#1C252E`→`grey.800`、`#454F5B`→`grey.700`、`#FC7E5B`→`primary.main`；dark 侧 `#FFFFFF`→`common.white`、`#C4CDD5`→`grey.400`、`#FDA48A`→`primary.light`。

---

## §3 拒绝清单

**这一节是本文存在的主要理由。** 每条都是「Minimal 有、favbase 刻意没抄」，不写下来，下次对着参考源就会重问一遍。

### 3.1 `HeroBackground`（619 行 + 360 KB webp）

`$MIN/sections/home/components/hero-background.tsx` + `hero-svg.tsx`（330）+ `svg-elements.tsx`（289），资源 `background-3.webp` 15 KB + dark 专用 `hero-blur.webp` 345 KB。

拒绝理由，按强度排序：

1. **视觉语汇冲突**。`Circles()` 画同心圆、`Lines(strokeCount=12)` 画网格线，全用 `--hero-*-stroke-color`（grey 500/600 低透明度细虚线）。而 `orbit-core.tsx:92-114` 画的是 `<circle stroke={divider} strokeDasharray="2 7">` 虚线圆轨道 + `strokeDasharray="3 6"` 的 primary 动画圆弧——**同一种语汇**。Minimal 敢铺满是因为它 hero 中间只有文字栈、四周是空的，且有径向 mask 把边缘淡掉；favbase 右侧 5/12 列已被 OrbitCore 的同心圆占了，叠两层同心圆分不出主次。
2. **`Texts` 的 CJK 缺陷**。`hero-svg.tsx:188` 是 `const TEXT = 'Minimal Design System'`，换 favbase 文案要走 i18n，而 SVG `<text>` 的 `stroke` 描边在 CJK 密集字形上会糊成一团。标 `[UNKNOWN]`——没实测过，但换文案的成本已经足够劝退。
3. 619 行纯装饰、零信息量。

**体积不是理由**：360 KB 对已经 17.5 MB 的 zip（`public/ffmpeg` 32 MB 未压缩占主体）是 +2%。别把它当论据。

### 3.2 `motion-lazy.tsx` / `LazyMotion`（15 行）

硬数字（context7，motion.dev 官方文档）：

- 全量 `motion` 组件 = **~34 KB**（预打包全部 features）
- `LazyMotion` + `m` = 初始 4.6 KB，`domAnimation` **+18 KB**，`domMax` **+28 KB**
- motion 12 里 `m` 的路径是 `import * as m from "motion/react-m"`；`strict` 下渲染全量 `motion` 组件**抛运行时错误**

`bilibili-showcase.tsx` 用 `layoutId`（tab 滑动胶囊），那是 **layout animation，只在 `domMax` 里**。所以 favbase 必须 `domMax` = 4.6 + 28 = **32.6 KB** vs 全量 34 KB — **总收益 1.4 KB**。

代价：改 5 个现有文件的 `motion` → `m`（含 `motion-box.tsx` 的 `motion.create(Box)` → `m.create`，而 `m` 是 namespace import，`m.create` 是否存在本身是 `[UNKNOWN]`），且 `strict` 下漏一处就运行时炸。welcome 本来就是独立 chunk，不影响 app.html。

**结论：不上 LazyMotion，移植时 `m` 一律改 `motion`。**

### 3.3 `animate-text.tsx`（174 行）

`animate-text.tsx:129-147` 是 `line.split(' ')` 按空格切词、再 `word.split('')` 切字符，**每层都 `inline-block`**。中文一整句没有空格 → 整句成为一个 `inline-block` 的 word → **不可折行，溢出容器**。

favbase `components/animated-text.tsx`（77 行）只切到词层正是为此（该文件注释与 `entrypoints/welcome/CLAUDE.md` 都记着这条）。移植过去是回归，不是选择。

### 3.4 其他

| 拒绝 | 规模 | 理由 |
|---|---|---|
| `animate-count-up.tsx` | 90 行 | 本页约定禁数字——首装时数据库是空的，任何统计数字都是假的 |
| `animate-border.tsx` / `animate-logo.tsx` | 271 + 134 行 | 零用例 |
| 其余 9 个 variants（zoom/flip/scale/rotate/bounce/path/background/actions/slide） | ~658 行 | 零消费者，且每个都是独立概念。`varFade` 的 10 个方向保留全表——那是**一个正交 API**，裁剪会让「为什么只有 inUp 和 inLeft」变成需要解释的特殊情况 |
| Minimal home 的 Pricing / Testimonials / FAQs / ZoneUI / Advertisement | ~1200 行 | 销售页段落。Testimonials 会逼出编造的用户评价，`renderRatings` 的星级 + AvatarGroup + "160+ Happy customers" 同理 |
| `renderIcons`（"Available For" + 平台图标行） | — | favbase 已有**三处**在列六平台清单：`OrbitCore`（Hero 右侧公转）、`CapabilityMarquee`（`ROW_TOP`/`ROW_BOTTOM` 含全部六个平台名 + 图标）、`PlatformPicker`。再加一处是第四次，且与紧接其后的 marquee 直接重复 |
| `ScrollProgress` 的 `circular` 变体 / `portal` / RTL 镜像 / 调用方传 `progress` | ~100 行 | 零消费者；仓库无 `direction` 支持（docs/25 Step 2 去掉了 Minimal 的 direction 数据层）；挂点无 transformed 祖先；进度来源只有文档滚动一处 |
| `BackToTopButton` 的 `renderButton` escape hatch | — | 零消费者 |
| `MotionContainer` 的 `action`/`animate` 开关 | — | 驱动 Minimal 的 dialog/menu 入场，welcome 无调用方在 animate 与 exit 之间翻转 |

---

## §4 执行时发现的勘误

方案（§1–§3 的 grill 结论）在实施中被代码推翻了三处，如实回写。

### E1 — `varFade` 装不进 `FadeIn`

**方案原话**（D6）：「`FadeIn` 内部改吃 `varFade` + `transitionEnter`」。

**实际**：`varFade` 的方向是固定枚举（`inUp`/`inLeft`…）+ 单个 `distance`，而 `FadeIn` 的 `x`/`y` 可同时非零、自由取值（`hero.tsx` 用 `y={-14}`、`y={38}`、`y={40}`，`feature-list` 用 x）。硬塞就得写一层 `(x,y) → 方向` 映射，比那两个内联对象更多代码。

**改法**：`FadeIn` 只吃 `transitionEnter()`（曲线 + 默认时长），`WELCOME_EASE`（零外部消费者）删除。真正收掉的重复是 **easing 曲线这一处**——两条动画路径（`FadeIn` 与 `varFade`）从此同一来源，不会漂。`varFade` 供 `MotionContainer` 的子元素用。

### E2 — 「改吃 variant 主题阶梯」不成立

**方案原话**（D8）：「字号换吃 `variant h1/h2` 主题阶梯」。

**实际**：

| | h1 | h2 |
|---|---|---|
| Minimal | 40 → 52/58/64px 响应式，`fontWeightExtraBold` | 32 → 40/44/48px 响应式 |
| **favbase** | **28px 固定** | **24px 固定**，`fontWeight: 700` |

favbase 的 typography 在 docs/25 Step 1 移植时**刻意压小并去掉了 `responsiveFontSizes`**（dashboard 页面标题不需要 64px）。而 `Headline` 的 clamp 是 32→56px（section）/ 40→88px（hero）。改吃 `variant="h2"` 会把 section 标题压掉 25–57%。

welcome 当初自造 clamp 正是因为 favbase 的 theme 没有 Minimal 那档大字号。**clamp 保留**，`fontWeight: 800` 也保留（favbase theme 无 `fontWeightExtraBold` token，是移植时的省略）。

### E4 — Hero Container 抄了 `display: flex` 却漏了 `flexDirection: column`

**症状**（用户截图，2026-09-08）：`md` 区间下 OrbitCore 的卡片区侵入左列，标题 `answerable` 与副文案被盖住。

**原因**：Minimal 的 hero Container 是 `display: flex` + **`flexDirection: 'column'`** + `justifyContent: 'center'`——它是居中单列栈，纵向排 heading/text/ratings/buttons/icons 五块。favbase 保留了分栏（D4），Container 里只有一个 `<Grid container>`。我抄了 `display: flex` 与垂直居中，漏了 `flexDirection: column`，于是 Grid 成了 **row** 方向的 flex item：宽度从 100% 收缩到内容宽度，7/5 分栏的百分比据此重算、两列都变窄，而 OrbitCore 的 chip 是绝对定位在固定半径 `--fb-orbit-r: 168px` 上、撑不动就溢出到左列上面。

改动前的 Container 是纯 block（Grid 是 block 子元素、宽度 100%），所以这是本次改造引入的回归，不是既有问题。

**改法**：Container 的 `md` 块用 `flexDirection: 'column'` + `justifyContent: 'center'`。column 方向下 Grid 是唯一 item、`align-items` 默认 stretch，宽度自然回到 100%。

**教训**（这条比修复本身重要）：**Minimal 的 hero 布局属性是为居中单列栈写的，逐条抄进一个保留分栏的 hero 时，每条都要问「它在 row/column 下的语义一样吗」**。`display:flex` 与 `alignItems:center` 在 column 栈里是「水平居中每一块」，在 row 分栏里变成「垂直对齐两列」并顺带毁掉子元素宽度——同样两行代码，语义完全不同。D4 决定了保留分栏，那一刻起 Minimal 的 hero 几何就只能按语义移植、不能按行移植。

### E3 — 漏掉一个 `.fb-headline` 消费者，顺手收成共享 helper

`how-it-works.tsx:224` 直接用了 `className="fb-headline"`（三步叠卡的步骤大号数字），**不走 `Headline` 组件**。删 CSS class 会让它静默失去渐变。

**改法**：渐变抽成 `section-shell.tsx` 的 `headlineGradient(theme)`，`Headline` 与步骤数字共用——与该文件既有的 `ctaGlowShadow(theme)` 同一模式（`entrypoints/welcome/CLAUDE.md` 明写「别再手写」）。这比原方案更好：那两处本来就该同源，分开正是它们在 `welcome.css` 时代能漂的原因。

顺带：`scroll-progress` 裁成单文件后 animate 层实际 314 行，低于 §1 预估的 404。

---

## §5 hero 钉住层的合成开销

一条实施中修正的判断，记在这里因为它是 favbase 特有的、Minimal 不付的代价。

grill 中我说过「fixed 之后 Aurora/Orbit 持续动画的开销现状就有，只是从跳过绘制变成参与合成」。**这句是错的**：现状 Hero 不 fixed，滚出视口后浏览器跳过 offscreen 元素的绘制**与合成**；改 fixed 后元素永远 onscreen，Aurora 的两个 `filter: blur(48px)` 大圆（`clamp(320px, 46vw, 720px)`）与 OrbitCore 约 20 个动画节点会持续参与合成。这是真新增，不是从零到一之外的免费项。

Minimal 无感是因为它的 `HeroBackground` 是静态 SVG + 图片（`initial`/`animate` 只跑一次）。

**处理**：`hero.tsx` 的钉住层在 `percent >= 100` 时加 `visibility: 'hidden'`。`visibility: hidden` 让浏览器跳过整棵子树的绘制与合成；`opacity: 0` 不会。motion 的 JS 循环仍在跑（除条件渲染无法停，而条件渲染会让往回滚时重播入场），但 GPU 侧的 blur 合成停了。3 行代码。

`useScrollPercent` 的 `Math.floor` 是承重的：它把每个滚动帧收敛成「每整数百分点最多一次 setState」，整屏约 100 次 re-render 而非每帧一次。

---

## §6 守卫

`tests/ui-vendor-boundaries.test.ts` 的 `VENDOR_RULES` 从 2 行加到 3 行：

```ts
{ pkg: 'motion', owner: 'entrypoints/welcome' },
```

根 `CLAUDE.md` 的铁律「`motion` 12 **仅 welcome.html 用**」在此之前是**纯约定零守卫**。owner 是整个 entrypoint（不是单个组件目录）因为动画 section 各自直接 import。`importsPackage` 的正则支持 `pkg/sub`，所以 `'motion'` 抓得到 `from 'motion/react'`；`'framer-motion'` 不会误伤（引号后必须紧跟 `motion`）。表自带反向断言，规则不会空转。

**先红后绿已验证**：在 `entrypoints/app/utils/format-duration.ts` 临时加一行 `import { motion } from 'motion/react'`，`× 'motion' is imported only under 'entrypoints/welcome'`；`git checkout` 后 9 passed。

`entrypoints/welcome/sections/top-bar.test.tsx` → `entrypoints/welcome/layout.test.tsx`：断言语义不变（顶栏这一层不提供 Skip Intro——picker 是唯一出口且接受空选择），只是 owner 从 `TopBar` 换成 `WelcomeLayout`；另加一例锁 footer 的版本与许可（这两项全产品零露出，footer 停印就是彻底消失）。

## §7 验证

- `npx tsc --noEmit` 零输出
- `npx vitest run entrypoints/welcome tests/ui-vendor-boundaries.test.ts tests/i18n-no-hardcoded.test.ts` → 6 files / 33 tests passed
- `npx wxt build` 成功。`welcome-*.js` 175 KB / `app-*.js` 303 KB；`layout-section-*.js` 被拆成两入口共用的独立 chunk（不重复打包）
- **`motion` 未漏进 app.html**：逐个 grep app.html 引用的 20 个 chunk，`framerAppearId` / `MotionConfigContext` / `createMotionComponent` 零命中

## §8 未做 / 待观察

- **截图基线未挂**：Chrome 未带 `--remote-debugging-port`，与 docs/25 Step 10 同一处境。Hero 钉住层 + 淡出 + 四层视差的实机观感、`visibility` gate 的实际生效点，都需人工复核。
- `Texts` 描边字在 CJK 下的表现仍是 `[UNKNOWN]`（§3.1），因为整条被拒绝，没有实测的必要。
- `capability-marquee` / `platform-picker` / `feature-list` 这三处同质列表**尚未**换成 `MotionContainer` + `varContainer`（D6 的后半）。原语已就位、`FadeIn` 手排 delay 仍工作，是纯增量优化而非未完成的接线。留待下轮，或在有人真的往这三处加删元素时顺手做。
