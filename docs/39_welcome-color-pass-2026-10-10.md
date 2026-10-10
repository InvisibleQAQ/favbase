# docs/39 — welcome.html 对照 minimals.cc 的色彩整改（2026-10-10）

- 参考：welcome.html ↔ <https://minimals.cc/>（Minimal v7.7.0 默认路由 `MainLayout` + `HomeView`）；源码 `$MIN` 同 docs/28。
- 起因：用户 2026-10-10「welcome.html 基本都是黑白画面，很难看，请参考 minimals.cc 优化」。
- 证据：BrowserOS 里装的扩展截 welcome 16 屏（CDP，docs/31 §1）、neo MCP 截 minimals.cc 各段；
  5 组段落各一个审计 agent 逐行对照 `$MIN` 源文件，每组再由一个独立 agent 反驳式核验事实与既有决定。
- 执行：一步一个对话、一步一个 commit。状态写在每个 Step 的标题行。

## §0 结论

页面发灰，不是因为少移植了 Minimal 的段落。Minimal 首页本身大部分是中性灰阶（`home-minimal` 的图表图都是灰的），
色相集中在少数几处。favbase 在这几处恰好换成了中性，或者实现有 bug：

| Minimal 的色源 | favbase 现状 | 性质 |
|---|---|---|
| `home-highlight-features` 的 sticky 舞台：coral 渐变 → 5 个 preset 渐变 → neutral | `product-tour.tsx` 用的是 `home-hugepack-elements` 的中性坡道，舞台是灰的 | 替换 7（见 Step 2）的前提「welcome 没有对应物」不成立：app.html 设置抽屉开放的正是这 5 个 preset（`settings-drawer.tsx:42`） |
| `home-integrations` 插图里的全彩品牌 logo | OrbitCore、marquee、picker 三处平台字形写死 `text.primary` | 主题早有 `palette.platform[id]`，app 侧栏在用（`nav-item.tsx:237`），welcome 没接 |
| `home-hero` 品牌词的 primary↔warning 流动渐变 | 两行整行铺静态 `grey.800 → coral`，而且铺在 7 列的列框上：zh 首行「把收藏」只占列宽约 40%，整行停在灰段，**没有一点 coral** | 没移植 + 实现 bug |
| `hero-svg.tsx` 的 5 颗彩球 | 无 | 随 `HeroBackground` 整体被 docs/28 D5 拒绝 |
| `home-for-designer` 深色带 + 渐变标题 | 无 | docs/31 Step 4 把它的位置映射给了 marquee，未移植 |

## §1 决策（用户 2026-10-10）

| # | 决策 |
|---|---|
| Q1 | 画廊舞台**完整轮换**（照 `home-highlight-features.tsx:144-157` 的 8 个 stop）+ 两处可读性偏离：副标题改 `text.primary`；暗色加一层 `grey.900` 60% 压暗层 |
| Q2 | 平台字形上品牌色，OrbitCore / marquee / picker **三处都上**；picker 选中态照 app nav 先例 |
| Q3 | Hero 标题做 Minimal 的三级层次，首行取可读下限：首行 `text.secondary` 实色（不用 Minimal 的 `opacity: 0.24`，1.63:1），次行墨色，品牌词流动渐变 |
| Q4 | 可选项三项都做：Hero 浮动彩球、OrbitCore 内圈彩点、agent-skills 改 ForDesigner 深色带 |

可读性偏离的先例是 docs/31 Step 3 Q2「形照搬，色取可读下限」。

## §2 步骤

### Step 1 — 平台字形品牌色 + 可读性缺陷（已落地并完成浏览器验收 2026-10-10；见本步「落地记录」）

**着色**（只上字形；label、pill 底、边框不着色，`palette.ts:86`）：

- `components/orbit-core.tsx:145` 芯片字形 `text.primary` → `theme.vars.palette.platform[platform.id]`。
- `sections/capability-marquee.tsx`：`Pill` 加 `platform?: CollectionPlatform` 只用于着色，**手写的 `icon` 字面量保留**。
  docs/26 D5（用户决定）「marquee 不从 registry 派生」的字面覆盖图标来源，所以不改从 `PLATFORM_META` 取图标。
  覆盖守卫 `platform-completeness-contract.test.ts` 只读 `labelKey`，加字段不影响。
- `sections/platform-picker.tsx:94-97` 图标格：未选中 = 品牌字形 + `background.neutral` 底（换底是硬要求：现在的
  `grey.500@0.1` 底上 YouTube 暗色只有 2.99:1）；选中 = `text.accent` 字形 + `primary` 0.08 洗底，照 app nav 激活态
  （`nav-section/styles/css-vars.ts:29-30`）。现状的 coral 字形在 12% 洗底上只有 2.28:1，0.12 也不在主题的 0.08 / 0.16 阶梯上。
- GitHub / X / 抖音的 palette 是 `ink`，照旧是墨色；其余平台有色相（以 `PLATFORM_META.palette` 为准）。

**默认决定**：

- D1-a chat 演示的来源字形**不着色**：app 真实的来源卡片（`sections/chat/source-card.tsx`）用 `text.secondary`，mock 跟真界面走。
- D1-b how-it-works 步骤 01 的图标 `solar:bookmark-bold-duotone` 就是书签平台的字形，着色后它在别处是琥珀、在这里是
  coral，同一字形两种含义。换成一个已注册的非平台字形（只能用 `icon-sets.ts` 里已有的名字，否则 tsc 报错、运行时被 CSP 拦）。

**可读性缺陷**（同一步修，都不需要决定）：

| 位置 | 问题 | 改法 |
|---|---|---|
| `agent-skills.tsx:232` 需求说明、`platform-picker.tsx:231` 隐私脚注、`chat-showcase.tsx:193-202`「Sources」小标题、`footer.tsx` 版本行 | 可读文字用 `text.disabled`：亮 2.7:1、暗 3.2–3.6:1 | `text.secondary`（同 docs/31 Step 3 修 `SectionCaption`） |
| `bilibili-showcase.tsx:293` 播放键 | 白字压 92% coral，2.5–2.7:1 | `primary.contrastText`（墨色，约 6.7:1，`theme-config.ts:56-57`） |
| `bilibili-showcase.tsx:67-69`、`platform-picker.tsx:80-82` 焦点环 | 局部覆盖成亮色 `primary.main`，2.5:1，低于 3:1 | 对齐全局 baseline（`css-baseline.tsx:31`：亮 `primary.darker`、暗 `primary.main`） |

**文档卫生**（同一步）：

- `entrypoints/welcome/CLAUDE.md`「`MotionConfig reducedMotion="user"` 只管声明式 `animate`」不准：它只停 transform / layout，
  opacity、颜色、`backgroundPosition` 照跑（context7 motion.dev 核实；`main.tsx:15-16` 的注释是对的）。改写这一条。
- 平台数量与 ink 清单过时：`theme/core/palette.ts:23`「six-platform」、`collection-platform-registry.ts:19-22`、
  `palette.test.ts:12/:93`、`.trellis/spec/frontend/ui-design-system.md:174` 只点名 github / x 是 ink，漏了抖音。

**验收**：1440×900 亮暗 × en / zh-CN 截 hero、marquee、picker（选中与未选中各一）；量字形 computed color 等于对应
`--palette-platform-*`；四处可读文字与焦点环量色值。

#### 落地记录（2026-10-10）

**改动**（路径相对 `entrypoints/welcome/`，行号为改后）：

- 着色：`components/orbit-core.tsx:146`；`sections/capability-marquee.tsx:15-22`（`Pill`）、`:76-81`（字形 sx），
  `icon` 字面量全部保留；`sections/platform-picker.tsx:84-101` 图标格按上文两态。
- D1-b：`sections/how-it-works.tsx:42` 步骤 01 换成 `solar:folder-with-files-bold-duotone`。已注册，与步骤 02 同为
  duotone；app 里它是「文件夹 / 收藏夹」维度的字形（`analytics-dimension-ranking.tsx:36-38`），不是平台字形。
  `solar:bookmark-bold-duotone` 仍有消费者（registry、marquee），注册表不动。
- `text.disabled` → `text.secondary`：`agent-skills.tsx:232`、`platform-picker.tsx:234`、`chat-showcase.tsx:196`、
  `footer.tsx:33`，另加 `hero.tsx:80`（见偏离 2）。
- 播放键：`bilibili-showcase.tsx:292` → `primary.contrastText`。
- 焦点环：删掉 `bilibili-showcase.tsx` TabButton 与 `platform-picker.tsx` 卡片上的局部 `.Mui-focusVisible` 覆盖，
  不是照抄 baseline 的值。依据：welcome 的 `ThemeProvider` 挂的是同一个 `CssBaseline`；`ButtonBase` 渲染 `<button>`；
  MUI 9.4 的 `isFocusVisible` 就是 `element.matches(':focus-visible')`，所以 `.Mui-focusVisible` 与 `:focus-visible`
  同时成立；baseline 的 `button:focus-visible`（特异性 0,1,1）压过 `ButtonBase` 根上的 `outline: 0`（单类 0,1,0），
  暗色那条生成为 `*:where([data-color-scheme="dark"]) button:focus-visible`，`:where` 零特异性，同为 0,1,1。
  app 侧先例 `components/collection/collection-card.tsx:316` 也只改 offset、颜色靠 baseline。
- 文档：`welcome/CLAUDE.md`（marquee 那条、新增「色彩」节、`MotionConfig` 那条按 motion-dom 12.42.2 源码
  `positionalKeys` 改写）；`app/theme/core/palette.ts:23`；`app/collection-platform-registry.ts:18-29`；
  `app/theme/core/palette.test.ts:12-14`、`:94-99`；spec `ui-design-system.md` §4「Platform identity」；
  spec `platform-onboarding.md` 两行（偏离 3）；本节 :46 的平台数量。

**与上文计划的偏离**：

1. `Pill` 不是加一个可选的 `platform?`，而是两态联合：平台 pill 必带 `icon` + `platform`，能力 pill 两者皆无。
   可选字段会留出「有图标、没平台色」的第三态，新平台的 pill 漏写 `platform` 也编译通过。
2. 多修一处 `text.disabled`：`hero.tsx:80` ScrollHint 的「Scroll」标签，计划漏列，同一缺陷、同一改法。
3. 多改 spec `platform-onboarding.md`：§2 守卫表 marquee 行（pill 的形状变了）、descriptor 字段表 `palette` 行
   （ink 清单只写 github / x，且引用早已不存在的 `PLATFORM_PALETTE_LIGHT` / `_DARK`）。
4. `palette.test.ts` 的 ink 断言改成从 descriptor 取 ink 品牌逐个断言（原来写死 github / x，抖音没测到），附非空断言防空转；
   `collection-platform-registry.ts` 的「all six checks」改成「every check」（验证器每个底只有五项检查），
   验证文档路径改到它归档后的位置。
5. 实测值与上表估值不同：播放键白字压在 92% coral 上、底下是 `#1c252e → #28323d` 渐变，合成后是 2.85–2.89:1
   （表里 2.5–2.7 是按纯 coral 算的）；`contrastText` 是 5.93–6.00:1（表里约 6.7 同理）。结论不变。
6. （check 阶段）上文「覆盖守卫只读 `labelKey`，加字段不影响」只对了一半：`platform` 与 `labelKey` 是冗余的两份事实，
   抄一行改了 `labelKey` / `icon` 却漏改 `platform`，字形就刷上别家的品牌色，tsc 和原守卫都不报。
   `tests/platform-completeness-contract.test.ts` 加一条：每个带 `platform` 的 pill，`PLATFORM_META[platform].title`
   必须等于它的 `labelKey`；读法从只取一列的 `arrayFieldValues` 换成按元素取全部字符串字段的 `arrayStringFields`。
   变异验证：zhihu pill 改成 `platform: 'youtube'`、删掉抖音 pill，各报红一次，还原后全绿。spec `platform-onboarding.md`
   §2 守卫行与 `welcome/CLAUDE.md` marquee 那条同步。
7. （check 阶段）spec `ui-design-system.md` §10 两处「six legend rows」与 §16「six legend tabs」是同一种过期的平台数量，
   改成不写数（运行时探针 `app-runtime-check.mjs` 本来就只断言 `> 0`）。`capability-marquee.tsx` 里重复旧说法
   「reducedMotion only governs declarative `animate`」的注释按 motion-dom 源码改准。

**验证**：

- 对比度（WCAG，按 hex 计算）：picker 未选中图标格 `background.neutral` 底，亮 / 暗：bilibili 5.42 / 3.89、
  bookmarks 3.44 / 4.69、zhihu 4.16 / 4.15、youtube 5.19 / 3.25（原 `grey.500` 10% 底暗色 2.99）、ink 品牌 14.3；
  选中 `text.accent` 在 8% 洗底上 9.19 / 7.13。`text.secondary` 对 `background.default` 4.88 / 6.41、对 paper
  4.88 / 5.68（`text.disabled` 为 2.73 / 3.18–3.58）。焦点环：亮 `primary.darker` 对 default 9.87、暗 `primary.main` 6.90。
- 生成的 CSS（happy-dom 下渲染 OrbitCore、marquee、picker、bilibili 段，读 emotion 输出，探针跑完即删）：三处每个
  平台各一条 `color: var(--palette-platform-<id>)`；picker 图标格底 `var(--palette-background-neutral)`；
  播放键 `color: var(--palette-primary-contrastText)`；welcome 不再生成任何 `.Mui-focusVisible` 的 outline 规则，
  只剩 baseline 的亮暗两条。
- `pnpm compile` 通过；focused `pnpm vitest run entrypoints/welcome entrypoints/app/theme tests/ui-vendor-boundaries.test.ts
  tests/i18n-no-hardcoded.test.ts tests/platform-completeness-contract.test.ts` 13 个文件 / 145 例通过；`pnpm test`
  首次整跑全绿，主仓库 238 个文件 / 2096 例、`packages/*` 15 个文件 / 263 例；`git diff --check` 干净。
- check 阶段复核：上面的对比度按 hex 重算一致（选中 `text.accent` 亮色重算 9.21，差在 8% 洗底的取整）；生成的 CSS
  重新探针一次，结论同上，且 picker 卡片与 bilibili TabButton 渲染出来都是 `<button>`；`palette.test.ts` 的 ink
  断言做了变异（ink 解析成 `text.secondary`）后亮暗两例都红。偏离 6、7 之后 `pnpm compile` 与上面那组 focused 测试
  （13 个文件 / 145 例）仍全绿；主会话随后 `pnpm test` 整跑一次全绿（主仓库 238 / 2096、`packages/*` 15 / 263），
  `git diff --check` 干净。
- **构建**：主会话 `pnpm build`（bundle 契约 14 个模块 / 963,108 字节）。构建前后 `manifest.json`、`background.js` 的
  sha1 不变，77 个 chunk 里只有 welcome 入口换了名（`welcome-aa04CpfK.js` → `welcome-WFh-NrFH.js`），app.html 引用的
  chunk 全部同名，所以没有重载扩展，用户开着的扩展页不受影响。check 阶段之后源码只多一行注释，没有重新构建。
- **浏览器验收**（§5，BrowserOS 里装的扩展 `ifnlocdg…`，自己新开的标签，页面实际加载的正是 `welcome-WFh-NrFH.js`；
  亮暗与中英用 header 自己的按钮切，`setItem` / `chrome.storage.local.set` 在本标签吞掉那两次写入，截完读回共享存储仍是
  `light` / 未设置），1440×900 亮 en、暗 en、暗 zh-CN、亮 zh-CN 四组，量 computed style：
  - OrbitCore 七个芯片字形、marquee 七个平台 pill 字形、picker 七个未选中图标格字形，逐个等于把
    `var(--palette-platform-<id>)` 解析出的颜色（亮：bilibili `rgb(194,24,91)`、bookmarks `rgb(184,118,10)`、zhihu
    `rgb(26,115,232)`、youtube `rgb(198,40,40)`、ink 三家 `rgb(28,37,46)`；暗：`rgb(232,73,127)` / `rgb(191,138,16)` /
    `rgb(59,139,234)` / `rgb(217,64,64)` / 白）。marquee 的 label 仍是 `text.primary`，pill 底 / 边框不变。
  - picker 未选中图标格底 = `background.neutral`（亮 `rgb(244,246,248)`、暗 `rgb(34,43,52)`）；点选两张后选中格字形
    = `text.accent`（亮 `rgb(122,39,20)`、暗 `rgb(253,164,138)`），底 `rgba(252,126,91,0.08)`；再点一次取消，没有离开本页。
  - 焦点环（picker 卡片 `focus({ focusVisible: true })`，`:focus-visible` 为真）：亮 `rgb(122,39,20) solid 2px`、
    暗 `rgb(252,126,91) solid 2px`，offset 2px，即 baseline 的值。
  - 页面上剩下的 `text.disabled` 色文字只有一处：亮色下 platform-request 深色卡的描述。那是 docs/31 Step 2 定的固定
    `grey.500`（亮色 `text.disabled` 恰好同值，在 grey.900 底上约 6.4:1），不是缺陷；暗色下零处。
  - 截图（hero / marquee / picker / picker 选中，四组配置）与上面的量值一致；书签的 duotone 字形有一半是 0.4 不透明度，
    在白底芯片上读起来偏淡，与 app 侧栏现状相同。

**顺带发现、未修**（不在本步计划内）：

- `bilibili-showcase.tsx:68` TabButton 选中态与 `:103` TimeChip 的文字是 `primary.main`，压在 12% 洗底上亮色 2.28:1
  （13px / 11px 文字）。
- `chat-showcase.tsx` ToolCallRow 的结果文字是 `success.main`，压在 `grey.500` 10% 洗底上亮色 2.09:1。

### Step 2 — 产品画廊彩色舞台（未开始）

- `sections/product-tour.tsx:283-297` 换回源文件的 8 个 stop：`'transparent'`；
  `linear-gradient(180deg, primary.light, primary.dark)`；preset1..5 的 light → dark，取叶文件
  `@/entrypoints/app/theme/with-settings/color-presets` 的 `primaryColorPresets`（已经经 `create-theme.ts` 打进 welcome
  bundle，`IMPORT_BOUNDARY_RULES` 不拦）；末尾 neutral。
- stop 必须是 hex：渐变里的 `var()` 让 motion 退到 `mixImmediate` 硬切，`background-color` 过渡对 `background-image` 无效。
  primary 与 preset 的色阶两种配色共用（`theme/CLAUDE.md:23`），用 hex 不冻结任何东西。
- **末尾 neutral 不照抄 `theme.palette.background.neutral`**：主题开了 CSS 变量且 `theme-provider.tsx` 没传
  `forceThemeRerender`，`theme.palette` 永远是默认 light 方案（`@mui/system` `createCssVarsProvider.mjs:119-121`），
  暗色下会刷出一道浅灰带。Minimal 自己就有这个 bug。改用 `useColorScheme().colorScheme` 取
  `theme.colorSchemes[scheme].palette.background.neutral`，挂载前 `colorScheme` 是 undefined，回退 light。
- 可读性偏离（Q1）：副标题 `text.secondary` → `text.primary`（暗色压暗层之上 `text.secondary` 仍只有 2.1–3.4:1，不能省）；
  `ScrollContainer` 加 `theme.applyStyles('dark', { '&::before': grey.900 @ 0.6 })`，内容 `position: relative; zIndex: 1`。
  压暗层也会让暗色下的 neutral 段与截图投影变暗。
- 照搬的已知代价：`transparent` → 渐变那一步混不了色，进度一过 0 就硬切成满幅 coral（Minimal 相同）；
  favbase 跑道约 4454px、Minimal 约 8364px，色相轮换速度约为 Minimal 的 2.1 倍；4 张截图都是 coral 界面，会叠在蓝 / 紫舞台上。
- 记录同步：删掉文件头的替换 7（`:78-79`）；改写 `welcome/CLAUDE.md` 关于 stop 用 CSS 变量的那条（结论对、机制写错了：
  不是「冻在渲染那一刻」，而是永远是 light 方案）；docs/35 §1 补注。
- 不加页面：用户指的 `docs/ui-baseline/2026-10-03/app-1440x900@2x/` 按 docs/35 §2 除现有四张外只有 settings-export /
  settings-general 可公开，信息量低。画廊仍是四张。

### Step 3 — Hero 标题（未开始）

- i18n：`welcome.hero.titleLine2` 改为前半（en「now」/ zh「变成」），新增 `welcome.hero.titleBrand`（「answerable」/「知识库」），
  两个 locale 同改；首尾拼接复用 `Headline` 现有的分隔逻辑（en 一个空格、zh 不加），不用 Minimal 的 `ml` 偏移（docs/31 Step 2 的理由）。
- 首行 `text.secondary` 实色（Q3）；次行前半 `text.primary` 实色；品牌词是自己的 span：
  `textGradient('300deg, primary.main 0%, warning.main 25%, primary.main 50%, warning.main 75%, primary.main 100%')`、
  `backgroundSize: '400%'`、`animate backgroundPosition '200% center'`、20s linear、无限 reverse（`home-hero.tsx:82-103`）。
  `backgroundPosition` 不受 `MotionConfig reducedMotion` 约束，必须 `useReducedMotion()` 手动 gate。
- 渐变只挂在品牌词 span 上，「铺在列框上」的 bug 不再存在，不需要 `width: fit-content` 之类的补丁。
- `section-shell.tsx`：`INKS.brand` 改成实色头 + 流动渐变尾；`headlineGradient` 失去消费者，删除；
  `section-shell.test.tsx` 里锁「brand 不收 tail」的 `@ts-expect-error` 随之改写。clamp 字号不动（docs/28 E2）。
- 对比度（如实记录，不再重问）：品牌词 coral 在白底 2.54:1、琥珀 1.9:1；Minimal 是绿 3.1 / 琥珀 1.9；现状行尾也是 2.54。
  favbase 的 primary 是 coral，coral ↔ amber 都是暖色、相距约 30°，流动感弱于 minimals.cc 的 green ↔ amber。
- 记录同步：docs/31 Step 3 Q1 推迟的「首行淡化 + 流动渐变」标为本步完成；docs/28 §2.2 #5 补注；`welcome/CLAUDE.md`「标题」节。

### Step 4 — Hero 浮动彩球 + OrbitCore 内圈彩点（未开始）

- **彩球**：移植 `$MIN/sections/home/components/hero-svg.tsx:242-330` 的 `Dot` / `Dots` 为 welcome 私有组件，挂在钉住层
  `<Aurora />` 旁、Container 之下。token 照搬（`palette[c].lighter → light` 135deg、inset 阴影亮 `main` / 暗 `dark`，
  error / warning / info / secondary / success；favbase 的 error 阶梯与 Minimal 不同，那颗会偏绯红）；漂移 6s；
  入场用对象形 `initial` / `animate` + `transitionEnter()`（hero 没有 `MotionContainer` 父级）。
  **坐标不能照抄**（docs/28 E4 的教训）：1440×900 下照抄，warning 落进副文案，info / secondary 落在 orbit 芯片上；
  orbit 46s 一圈，环内任何固定点都会撞芯片，所以必须放在 orbit 半径以外、避开文案列。
- docs/28 D5 拆开：`HeroBackground` 的同心圆 / 网格线 / 描边字仍拒绝，三条拒绝理由都不针对 `Dots`；
  `welcome/CLAUDE.md`「已拒绝、别再提」那行同步改写。
- **内圈彩点**：照 `illustration-integration.webp` 的语汇重绘（位图，无源码，色值从图里取样，token 是 [UNKNOWN]）：
  在辐条内段 r≈40–55 加一道无芯片的内圈放 6 个低透明度彩点，不是放在芯片所在的 r=76 环上。
  **开工前先拿 Step 1 的截图再确认一次**：平台组核验 agent 反对这一项——芯片换成品牌色后，再加一套语义色彩点会和
  「色相 = 平台」抢位置，success / error 色的点可能被读成状态。用户 2026-10-10 选了做，这条风险是事后才补告知的。

### Step 5 — agent-skills 改 ForDesigner 深色带（未开始）

`$MIN/sections/home/home-for-designer.tsx`：满宽 `grey.700` 底叠 `135deg grey.900@0.8 → grey.900` 渐变，caption 白色淡出，
标题 `135deg warning.main → primary.main`，动作包在 `AnimateBorder` 里。用户 2026-10-10 选了做；开工时逐条问下面这些，
它们不是本文能替用户定的：

- 几何装不下：Minimal 是四分之一面板 + `minHeight 720` + 一张 favbase 没有对应物的 webp，agent-skills 有 prompt 卡、
  三条特性和需求说明，只能按语义移植配色。
- 标题墨色：favbase 下 warning → primary 是琥珀 → coral，同为暖色，远不如 Minimal 的琥珀 → 绿；这种渐变只在深底上可读
  （grey.900 上琥珀 9.2:1、coral 6.9:1；白底琥珀 1.9:1）。`Headline` 要加第四种墨色，且 agent-skills 标题已拆
  heading + headingTail（docs/31 Q3）。
- caption 白 → 20% 白在 12px overline 上收笔约 1.9:1，要取可读下限。
- `FeatureList` 没有颜色 API（继承 `text.primary`），bilibili 也在用。
- `AnimateBorder` 是 docs/28 §3.4 拒绝过的（零用例），还依赖 favbase 刻意没移植的 `mixins.borderGradient`（docs/25 Step 1）；
  Minimal 的按钮是 `variant="text"`，违反 `theme/CLAUDE.md:43`「主动作 = contained + primary」。
- 页尾会有两块深色区（本段与 platform-request），中间夹 bilibili 的深色播放器；这一段的脊线（docs/31 Step 4 照
  `home-testimonials`）要么去掉、要么照 for-designer 不画线，脊线会断。
- 推翻 docs/31 Step 3 Q1「hero 彩色、section 中性」与 Step 4 的段落映射。

## §3 不做

| 不做 | 理由 |
|---|---|
| 移植 `home-hugepack-elements` 的 bundle 拼图（4 张 webp） | 图里是 Minimal 自己的组件：假统计（12,987 Conversion、$9,990）违反本页「不放数字」，Facebook / Google / Office logo 违反 PRODUCT.md「不得捏造客户 logo」，再分发许可 [UNKNOWN]（火箭的接受只限那一张） |
| chat 演示来源字形上品牌色 | D1-a：跟 app 真实来源卡片走 |
| Pricing / Testimonials / FAQs / ZoneUI、`renderIcons`、`animate-count-up` | docs/28 §3 拒绝不变 |
| 画廊加页面 | 见 Step 2 末条 |

## §4 顺带发现、不在本轮

- `bilibili-showcase.tsx:281`、`:306` 播放器 mock 写死 `#1c252e` / `#28323d` / `rgba(255,255,255,0.24)`，违反
  `theme/CLAUDE.md:5-7` 与 spec §15（禁止裸 hex / rgba）。改 token 时注意暗色下层次：`grey.900@0.8` 起笔叠在 paper 上
  对卡片只有约 1.13:1，`grey.900` 实色更直接。
- picker 选中态的 2px coral 边框与 check-circle 在亮色 paper 上 2.54:1，低于非文本 3:1。Step 1 只改图标格，边框照旧。
- `orbit-core.tsx:179` 核心字形白色压在 coral 渐变上 1.93 / 2.54:1，与主题给 coral 选的墨色 contrastText 矛盾（装饰性）。
- app 侧 `sections/chat/source-card.tsx:102` 的焦点环同样局部覆盖成 `primary.main`。
- how-it-works 步骤 03 图标 `solar:chat-round-dots-bold` 是实心，01 / 02 是 duotone；duotone 版本未注册。

## §5 验证方法

照 docs/31 §1：扩展从主 checkout 的 `.output/chrome-mv3` 加载（id `ifnlocdg…`）。welcome 用 CDP（9110）在自己新开的标签里截，
`Page.bringToFront` 不够，要在页内 `chrome.tabs.update(id, {active: true})`；minimals.cc 用 neo MCP。`pnpm build` 会覆盖
已加载目录，用户开着的扩展页要刷新一次才能继续加载没打开过的路由（docs/35 §6）。
