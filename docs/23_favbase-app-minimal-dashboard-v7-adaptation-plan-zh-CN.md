# Favbase app.html 对齐 Minimal Dashboard v7.7.0 的前端 UI 重构计划

> 文档状态：Phase 0-4 已完成，Phase 5 已实施、待人工运行时审阅（后续 Phase 仍按计划推进；**仅限前端 UI** / UI-only）
> 目标入口：`entrypoints/app/index.html` 构建出的 `app.html`，以及其 React/MUI
> 界面代码 `entrypoints/app/**`  
> 参考项目：`minimal-vite-ts-main`，Minimal Dashboard v7.7.0  
> 基础方法：`docs/22_ai-ui-reference-adaptation-best-practices.md`  
> 日期：2026-08-26

## 0. 核心结论

**[DECISION] 这次只做 Favbase app.html 的前端 UI 重构，不做产品、业务、数据或
架构迁移。** Minimal v7 是视觉结构和组件规则的证据，不是 Favbase 的产品模型。

目标不是把 Minimal 的演示站复制进 Favbase，而是让 Favbase 在以下方面向
Minimal v7 的成熟 Dashboard 规范看齐：

- 统一的 MUI token 与组件默认值；
- 清晰稳定的侧栏、Header、内容区几何；
- 克制、可扫描的页面层级与间距；
- 一致的按钮、输入框、卡片、筛选器、状态和 overlay；
- 可验证的桌面、窄屏、移动端、深浅主题和键盘行为。

同时必须保留 Favbase 自己的产品事实：珊瑚品牌色、狐狸 logo、DM Sans +
Barlow、Hash Router、六平台 Collection、Chat、Settings、Pipeline、标签和
本地优先语义。

## 1. 回答前置检查

### 1.1 暴露假设

- 用户所说的“改造 app.html”指 WXT 源码入口 `entrypoints/app/index.html` 及其
  React UI，而不是直接编辑构建产物 `.output/**/app.html`。
- “朝 Minimal 的 UI 样式规范看齐”指对齐视觉系统、布局和组件状态，不是迁移
  Minimal 的路由、账号、工作区、通知、mock 数据或权限模型。
- 现有交互和数据契约继续有效；除非另开任务并批准，否则 UI 重构不得修改行为。

### 1.2 标记盲区

- **[RESOLVED]** 本文件是当前唯一的 Minimal v7 适配计划；Phase 0 的 reference/target
  运行时证据已经写入 `docs/reference-ui-audit.md`、`docs/target-ui-baseline.md`
  与 `docs/ui-baseline/2026-08-26/`。
- **[RESOLVED]** Phase 1 的 token、组件默认值和受基础圆角影响的局部值已通过源码
  契约测试、compile 与 WXT build；后续页面视觉迁移仍需按各 Phase 的运行时验收执行。
- **[UNKNOWN]** 390px 是移动验收视口，不代表 Chrome 桌面扩展页的最小可缩放
  宽度；它用于验证 reflow，不用于推断真实用户窗口分布。

### 1.3 挑战方向

“照着 Minimal 改”如果按文件复制执行，就是错误方向。它会带来第二套组件库、
模板业务概念、品牌漂移和大量页面级 `sx` 特例。正确方向是：**提取 Minimal 的
设计意图，写进 Favbase 已有 theme/layout/shared component owner，再让页面继承。**

## 2. 修改前三问

### 2.1 这是真问题还是臆想？

是真问题。当前 UI owner 已存在，但文档、实现和参考方向发生漂移：

- **[TARGET_FACT]** Phase 1 后主题保留珊瑚品牌色，采用 Minimal 冷灰 ramp，
  `shape.borderRadius = 8`；light Card 用低强度 card shadow，dark Card 用 divider
  hairline；见 `entrypoints/app/theme/**`。
- **[TARGET_FACT]** `.trellis/spec/frontend/ui-design-system.md` 已同步到当前实现，
  不再描述蓝色 Material Kit 或过期的 16px Card/overlay 半径。
- **[TARGET_FACT]** 页面中已有大量共享 owner，但仍存在页面密度、标题层级、
  状态呈现和局部 `sx` 不一致的问题；见
  `docs/19_app-design-critique-2026-08-20.md`。

因此，需要一份只谈 UI 且能指导执行的统一计划，而不是继续叠加局部补丁。

### 2.2 有更简单的方法或现成代码可复用吗？

有。Favbase 已有以下正确抽象，不应重建：

- `entrypoints/app/theme/`：MUI CSS-variable theme；
- `entrypoints/app/layouts/core/`：Layout/Header/Main 骨架；
- `entrypoints/app/layouts/dashboard/`：桌面/移动导航和内容容器；
- `entrypoints/app/components/collection/`：页面 scaffold、卡片、网格、状态；
- `entrypoints/app/components/tags/`：标签筛选与编辑；
- `entrypoints/app/components/iconify/`：离线图标注册；
- `entrypoints/app/collection-platform-registry.ts`：平台 UI 元数据。

重构应修改这些 owner，让六个平台和各页面继承，而不是复制 Minimal 组件。

### 2.3 会破坏什么？

UI 改动最容易误伤：

- Hash 路由和深链；
- 侧栏 active/展开/最长前缀判定；
- pin/unpin 持久化和移动 Drawer；
- Header 常驻任务提醒、语言与主题切换；
- Collection 的搜索、标签、分页、同步、Pipeline 和 8 阶段状态机；
- Chat 流式输出、来源、输入和滚动；
- Settings 保存、错误恢复和 deep link；
- light/dark、zh-CN/en、键盘和焦点恢复。

所以本计划把这些行为视为只读兼容边界，并为每阶段设置独立回滚点。

## 3. 五层分解

### 3.1 数据结构

**[DECISION] 不改数据结构，只改 UI 表达。**

数据查询、hook 返回值、组件 props、事件回调、路由参数和持久化 key 都保持不变。
UI 层只消费现有状态并改变 DOM 结构、MUI variant、token、布局和样式。若实现需要
给数据增加字段才能“做得像 Minimal”，说明映射错了，应拒绝该参考模式。

### 3.2 特殊情况

六个平台不应有六套视觉骨架。平台差异只允许通过现有 slot/adapter 表达：媒体、
平台字段、过滤维度、空态说明、操作按钮。标题栏、搜索、标签、网格、分页、状态、
卡片外壳和 Pipeline 的视觉规则必须归共享 owner。

### 3.3 复杂度

一句话概括：**先重构 token，再重构 shell，再重构共享组件，最后迁移页面。**

不得同时从六个平台页开始。那会把一个设计系统问题变成几十个局部样式问题。

### 3.4 破坏性

最高风险不是配色，而是壳层和共享组件：它们影响全部路由。实施顺序必须先做一个
可逆 vertical slice，检查行为与视觉，再扩展。公共 props 或行为一旦需要变化，
立即停下并单独评审，不得借 UI 重构夹带。

### 3.5 实用性

Favbase 是高频扫描、搜索、筛选和打开收藏的操作型工具，不是营销页。目标应是
安静、紧凑、可比较，而不是把每块内容包装成大卡片或引入装饰动画。用户每次打开
页面的主任务仍是“找到并打开保存过的内容”或“向本地知识库提问”。

## 4. 目标产品兼容契约

以下条目在本 UI 重构中不可改变。

### 4.1 品牌

- **[TARGET_FACT]** 品牌名始终写作小写 `favbase`。
- **[TARGET_FACT]** 保留狐狸 logo：`public/icon/128.png`。
- **[TARGET_FACT]** 保留珊瑚品牌色 `#FC7E5B` 的色相。
- **[TARGET_FACT]** 保留 DM Sans Variable + Barlow 字体组合。
- **[DECISION]** 珊瑚主色不得直接作为白底小字号文字；文字强调使用满足对比度的
  scheme-aware 深阶，珊瑚 main 主要用于图标、色块、计数和选中信号。

### 4.2 产品术语

严格沿用 `CONTEXT.md`：

- Dashboard 是只读 `Collection Analytics` 默认页；
- 收藏条目称 `Collection Item`；
- 数量区分 `Item Count` 和 `Membership Count`；
- 平台处理状态区分 `Processing Coverage` 和 `Pipeline Run`；
- Tag Drill-down 打开聚合 Collection；
- Chat Conversation 不是 Collection Item；
- Agent Bridge 不是平台。

不得用 Minimal 的 workspace、project、team、account、contacts 等术语替换。

### 4.3 路由和行为

- 保留 `createHashRouter`；
- 保留 `/`、`/collections`、`/collections/<platform>`、`/chat`、`/settings`
  及现有子路由；
- 保留 `collection-platform-pages.ts` 和 registry 驱动的平台装配；
- 保留所有搜索、筛选、分页、同步、暂停/继续、标签、Chat、Settings 行为；
- 保留 theme/locale/sidebar 的现有存储 key 与 watcher；
- 保留 Header 中跨路由常驻的后台任务提醒。

## 5. 证据摘要

### 5.1 Minimal v7 参考事实

| 参考事实 | 源码证据 |
| --- | --- |
| LayoutSection 组合 sidebar/header/main/footer | `[REFERENCE_FACT] src/layouts/core/layout-section.tsx` |
| Header 移动 64px、桌面 72px、blur 8px | `[REFERENCE_FACT] src/layouts/core/css-vars.ts` |
| 移动 Drawer 288px | `[REFERENCE_FACT] src/layouts/core/css-vars.ts` |
| 垂直导航 300px、mini 88px | `[REFERENCE_FACT] src/layouts/dashboard/css-vars.ts` |
| Dashboard 内容桌面水平 padding 40px | `[REFERENCE_FACT] src/layouts/dashboard/css-vars.ts` |
| CardHeader/CardContent 默认 padding 24px | `[REFERENCE_FACT] src/theme/core/components/card.tsx` |
| Button 高度 small/medium/large = 30/36/48px | `[REFERENCE_FACT] src/theme/core/components/button.tsx` |
| 默认字体 Public Sans + Barlow | `[REFERENCE_FACT] src/theme/theme-config.ts` |
| 主色为绿色 `#00A76F` | `[REFERENCE_FACT] src/theme/theme-config.ts` |
| 基础圆角 8px、Card 默认 16px | `[REFERENCE_FACT] src/theme/create-theme.ts`、`card.tsx` |
| 支持 semantic palette、MUI component override | `[REFERENCE_FACT] src/theme/core/palette.ts`、`components/*` |

### 5.2 Favbase 目标事实

| 目标事实 | 源码/文档证据 |
| --- | --- |
| 已有 MUI v7 CSS-variable theme | `[TARGET_FACT] entrypoints/app/theme/**` |
| 已有相同 LayoutSection/Header/Main 分层 | `[TARGET_FACT] entrypoints/app/layouts/core/**` |
| Header 已是 64/72px，移动 Drawer 已是 288px | `[TARGET_FACT] entrypoints/app/layouts/core/css-vars.ts` |
| 桌面导航计划前 280/72px（Phase 2 起 300/88px） | `[TARGET_FACT] entrypoints/app/layouts/dashboard/css-vars.ts` |
| 当前视觉是冷灰 surface、珊瑚印章、scheme-aware Card elevation | `[TARGET_FACT] entrypoints/app/theme/CLAUDE.md` |
| 共享 Collection scaffold 和 Card 已覆盖六平台 | `[TARGET_FACT] entrypoints/app/components/collection/**` |
| Dashboard 已用 hairline summary band，而非 KPI 卡堆 | `[TARGET_FACT] entrypoints/app/sections/overview/overview-view.tsx` |
| light/dark 与 zh-CN/en 均为现有支持面 | `[TARGET_FACT] PRODUCT.md`、theme、i18n |

## 6. Minimal → Favbase UI 适配矩阵

决策只允许：`保留`、`适配`、`拒绝`、`重实现`。

| Minimal 模式 | 设计意图 | Favbase 决策 | 目标 owner | 主要风险 | 二元验收 |
| --- | --- | --- | --- | --- | --- |
| semantic palette + channel | 全局一致、支持 alpha/dark | 保留 | `theme/core/palette.ts` | 页面硬编码绕过 token | 非数据色十六进制只出现在 theme/icon/data owner |
| 绿色 primary | 品牌动作与选中 | 拒绝 | `theme-config.ts` | 品牌丢失 | 页面不存在 Minimal 绿色品牌色 |
| Public Sans + Barlow | 清晰 UI + display 对比 | 适配 | `theme/core/typography.ts` | 字体漂移 | DM Sans + Barlow 保持，所有页面只用 theme variants |
| 300px vertical / 88px mini nav | 可读与紧凑双模式 | 适配 | `layouts/dashboard/css-vars.ts` | 内容宽度减少、长标签溢出 | 1440/1024 下无遮挡；中英最长标签不溢出 |
| 288px mobile Drawer | 移动导航可用 | 保留 | `layouts/core/css-vars.ts` | 触控目标过密 | 390px 下所有路由可达，控件目标不小于 40px |
| 64/72px sticky Header | 稳定全局操作区 | 保留 | `layouts/core/header-section.tsx` | 内容被遮挡 | 每条路由首个 heading 不被 Header 遮挡 |
| 40px desktop content gutter | 清晰页面节奏 | 适配 | `layouts/dashboard/content.tsx` | 1024px 有效宽度不足 | 1024px 无水平滚动；390px gutter 降为 16px |
| 可切换 vertical/mini/horizontal nav | 多布局选择 | 拒绝 horizontal；保留 pin/mini | `layouts/dashboard/layout.tsx` | 不必要设置复杂度 | 仅桌面展开/收起与移动 Drawer 两种模式 |
| account/workspace/contacts/notifications | SaaS 上下文和社交通知 | 拒绝 | 无 | 虚构产品模型 | app 中无此类入口和 mock 数据 |
| Card 统一 radius/shadow/padding | 建立表面层级 | 适配 | `theme/core/components.tsx` | 卡片泛滥、嵌套卡片 | 只有重复条目和真实工具可用 Card；无 Card 套 Card |
| 每个内容区用 Card | 快速模块化 | 拒绝 | page composition | 页面碎片化 | page section 使用 unframed layout 或 full-width band |
| CardHeader/CardContent 24px | 稳定内部节奏 | 适配 | theme + shared card | 高密列表过松 | 工具 Card 24px；CollectionCard 由共享 owner 给出紧凑规格 |
| Button 30/36/48px | 稳定操作层级 | 适配 | `theme/core/components.tsx` | touch target 太小 | small 只用于次级密集区；主要页面动作至少 36px |
| 丰富 soft/contained/outlined variants | 动作层级 | 适配现有 MUI variant | `theme/core/components.tsx` | variant 语义滥用 | 每个区块最多一个 primary contained 动作 |
| 大型响应式 display heading | 营销和展示层级 | 拒绝 | `theme/core/typography.ts` | Dashboard 浪费首屏 | route h1 不随 viewport 放大，保持操作型密度 |
| Nav active 颜色 + 淡洗背景 | 快速定位当前位置 | 适配 | `layouts/nav-active.ts` | 珊瑚文字对比度不足 | 文字用 text.primary/accent，珊瑚只作图标/洗底 |
| Header blur/elevation | 滚动后区分层级 | 适配 | `layouts/core/header-section.tsx` | 装饰性玻璃效果 | 未滚动时透明，滚动后只用必要 blur/divider |
| Dashboard KPI 卡和图表 | 快速扫描业务数据 | 重实现 | `sections/overview/overview-view.tsx` | 虚构指标、卡片堆叠 | 只显示真实 Collection Analytics，保留 hairline summary |
| Skeleton/empty/error/retry | 异步状态完整 | 保留并统一 | `components/collection/*` | 不同平台状态分叉 | 共享状态组件覆盖 loading/empty/error/no-match |
| Dialog/Popover/Tooltip defaults | overlay 一致 | 适配 | `theme/core/components.tsx` | 焦点和窄屏问题 | Escape、focus trap/restore、390px 宽度均通过 |
| demo motion/animate components | 提升演示感 | 拒绝 | 无 | 增包、干扰操作 | app.html 不引入 `motion`；只保留现有必要 CSS/View Transition |

## 7. 目标 UI 规范

### 7.1 视觉方向

**[DECISION] 采用“Minimal 的操作型 Dashboard 骨架 + Favbase 品牌和数据语义”。**

- 页面读取顺序：route title → primary controls/status → real content；
- 视觉层级依靠字号、字重、留白、surface 和 divider，不靠彩色装饰；
- 珊瑚只承担品牌与选择；平台色只承担平台身份；语义色只承担状态；
- 页面 section 不悬浮成卡片；Collection Item 可作为重复 Card；
- 禁止渐变、装饰光斑、营销 hero、虚构图表、套娃卡片。

### 7.2 Token 分层

使用三层 token：

1. primitive：原始色阶、字体、字号、间距、圆角、阴影、时长；
2. semantic：`text.*`、`background.*`、`divider`、`action.*`、`platform.*`；
3. component：只有 semantic token 无法表达时才新增，如 Card shadow、nav wash。

组件只消费 semantic/component token。不得把 Minimal 的 hex 值散落进页面。

### 7.3 色彩

**保留：**

- `primary.main = #FC7E5B`；
- Favbase 当前六平台 scheme-aware identity token；
- light/dark 双 color scheme。

**重构目标：**

- 基础中性色已采用 Minimal v7 的清晰灰阶和 surface 层次，并经过 Favbase
  light/dark 对比度检查；
- `background.default` 是页面画布；`paper` 只给 overlay、Card 和真实工具；
- `neutral` 只给 hover、输入辅助面和状态背景；
- `divider` 是默认分区手段；
- 小字号文本对背景至少 4.5:1，大文本至少 3:1；
- 图标、图表和 focus indicator 至少 3:1；
- `primary.main` 不直接作为白底正文或链接文字；链接使用 `text.accent`；
- 禁止 `color: '#...'`、`rgba(...)` 和 page-local `grey.*`。

### 7.4 Typography

**[DECISION] 保留 DM Sans Variable + Barlow，采用紧凑 Dashboard 字阶，不复制
Minimal 的 64px 响应式 display 字号。**

目标变体：

| 角色 | 建议变体 | 固定规格 | 用途 |
| --- | --- | --- | --- |
| route title | `h1` | Barlow 700 / 28px / 1.2 | 每路由唯一 h1 |
| section title | `h2` | Barlow 700 / 24px / 1.25 | 主区块标题 |
| metric/detail title | `h3` | Barlow 600 / 20px / 1.3 | 大数字或详情标题 |
| compact heading | `h4-h6` | DM Sans 600 / 16、14px | 面板内部层级 |
| body | `body1/body2` | 16、14px | 正文和列表元数据 |
| caption | `caption` | 12px | 次级说明，不能低于 12px |
| action | `button` | 14px / 600 | 按钮与 tab |

规则：

- 字号不随 viewport 放大；
- letter spacing 为 0；display 特例若保留必须不低于 `-0.02em` 且统一；
- 一条路由恰好一个语义 `h1`；
- Card title 不自动成为 heading；
- 所有动态数字使用 tabular numerals；
- CJK 与英文长文本必须在 390/1024/1440px 验证，不允许单词撑破容器。

### 7.5 Shape 与 elevation

**[DECISION] 向 Minimal 的 8px 基础圆角靠拢，但操作型 UI 的 Card/面板不超过
8px；pill 只用于 Chip、Switch、Badge 等天然胶囊控件。**

- `theme.shape.borderRadius = 8` 已锁定；
- Button、Field、MenuItem、Card、Dialog、Popover 默认不超过 8px；
- Collection media 保持稳定 aspect ratio，圆角继承共享 Card 规则；
- 亮色 Card 可使用一套低强度、有垂直偏移的 `customShadows.card`，不同时画完整
  border；
- 暗色优先用 surface + divider 区分，不用纯黑大阴影；
- Popover/Dialog 使用独立 dropdown/dialog shadow；
- 禁止 shadow + full border 的“幽灵卡片”。

### 7.6 Shell geometry

| Token | Minimal 参考 | Favbase 目标 |
| --- | ---: | ---: |
| Header mobile | 64px | 64px，保留 |
| Header desktop | 72px | 72px，保留 |
| Header blur | 8px | 8px，仅滚动后启用 |
| Mobile Drawer | 288px | 288px，保留 |
| Desktop nav expanded | 300px | 300px 候选，Phase 2 视觉验证后锁定 |
| Desktop nav compact | 88px | 88px 候选，Phase 2 视觉验证后锁定 |
| Desktop content gutter | 40px | 40px，1024px 不足时降为 24px |
| Mobile content gutter | - | 16px |
| Main bottom padding | 64px | 64px |
| Layout transition | 120ms | 120ms，统一 easing |

主内容区必须满足：

- 宽度变化时不出现水平滚动；
- Header、nav 和 main 的 scroll owner 唯一；
- sticky Header 不遮挡 route title、focus ring 或 anchor target；
- pin/unpin 不触发内容跳出 viewport；
- 1440×900 首屏可看到标题、主要控制和真实内容的开始位置。

### 7.7 Navigation

- 保留 registry 驱动的路由和平台叶子；
- 保留 Collections 父链接与 disclosure 作为两个 sibling controls；
- 保留最长前缀 active 判定和 Bilibili/Bookmarks 子路由归属；
- expanded nav row 44px，platform child row 40px；compact nav icon button 44px；
- active：`primary.lighter` wash + `text.primary` 600 + icon/stamp brand signal；
- hover、focus-visible、active、disabled 必须互相可区分；
- compact 模式必须有 Tooltip；
- 移动 Drawer 在 pathname 变化后关闭并恢复焦点；
- 禁止账号头像、workspace selector、upgrade 卡、contact、notification mock。

### 7.8 Header

Header 只承载全局状态和全局操作：

- 侧栏 toggle / mobile menu；
- Background Jobs Indicator；
- theme toggle；
- language menu；
- GitHub 外链。

不引入页面搜索、账号、workspace、通知中心。所有 icon-only button 必须有
Tooltip 和可读 `aria-label`。390px 下允许降低 gap，但控件不能重叠或被裁剪。

### 7.9 Button、Field、Tabs、Chip

- Button：small 30px、medium 36px、large 48px；主要页面动作使用 medium/large；
- IconButton：Header/nav 目标至少 40px，关键移动操作 44px；
- Search/Input：默认 48px，不再用 56px 大输入挤压内容；
- 同一区块最多一个 contained primary action；
- outlined/text action 使用 `text.accent` 或 `text.primary`，不直接用 coral main 文字；
- Tabs 的 selected、hover、focus 三态都必须清晰，不同时用多套选中信号；
- Chip 只用于过滤、状态、短标签；长 Source/Folder 名使用截断 + Tooltip；
- selected Chip 使用 coral block + 深墨对比文字，未选使用 divider/neutral；
- binary setting 使用 Switch/Checkbox，不使用文字按钮模拟开关。

### 7.10 Collection Card 和 Grid

`CollectionCard` 是六平台唯一条目外壳，平台 Card 只装配内容。

Card 要求：

- 同一 grid row 等高；
- 整卡 hover/focus 一致；
- link 区与 tag/footer 操作区语义分离；
- 缺图时显示平台 icon fallback，不显示浏览器破图；
- title 最多 2-3 行，使用真实 title tooltip；
- 日期、统计和 metadata 不挤压标题；
- 无 tag/footer 时不渲染空行；
- media 使用稳定 aspect ratio，加载状态不引发布局位移；
- disabled/invalid item 有清楚但可读的状态，不能把正文降到 disabled 对比度。

Grid 要求：

- 390px：1 列；
- ≥600px：2 列；
- ≥900px：3 列；
- ≥1200px：4 列；
- gap 24px 候选；
- skeleton 与真实 Card 使用同一轨道和稳定尺寸；
- Pagination 不改变网格宽度，单页时不占空白。

### 7.11 页面状态

所有页面至少覆盖：

- loading / skeleton；
- empty；
- no matches；
- partial data；
- error + retry；
- disabled；
- configuration blocker；
- pipeline running / pausing / paused / complete；
- missing media；
- long text / large numbers。

状态组件的文案必须说明“发生了什么”和“如何恢复”。配置缺失不是系统错误，不能
用 alarm 视觉抢占用户主任务。`resolveCollectionPhase` 的 8 阶段语义不得改变。

### 7.12 Dashboard 页面

Dashboard 保持只读 `Collection Analytics`：

1. route title + subtitle；
2. hairline SummaryBand；
3. 左侧 Platform Composition；
4. 右侧选中平台真实维度；
5. Used Tags drill-down。

禁止把三个 summary metric 包成三个浮卡，禁止增加无数据依据的折线图、增长率、
收入、用户数等模板指标。平台色仅用于平台 icon 和自身数据图形，选中仍由 Favbase
珊瑚信号表达。

### 7.13 Collections 与平台页

共享顺序保持：

1. route title / caption / primary action；
2. Pipeline + Library Gate；
3. sync error；
4. search；
5. configuration notice；
6. platform operation；
7. primary category；
8. tag filters；
9. secondary category；
10. content phase。

本计划不重新设计上述业务顺序。若运行时截图证明首屏被控制区挤占，应优先降低
密度和合并视觉层级；不能删除功能、隐藏状态或改变 scaffold phase 来换空间。

### 7.14 Settings、Chat 和 overlay

Settings：

- Tabs/section rail 保持现有信息架构；
- 同一 field group 使用一致 label、helper、error、action 高度；
- 密钥、权限、连接和危险操作不得因视觉重构失去解释与恢复入口；
- 避免 section Card 中再套 field Card。

Chat：

- 保持 conversation list、message stream、tool/source 状态和 composer；
- assistant markdown、用户纯文本、流式和停止行为不变；
- message 宽度、代码块/表格横向滚动、composer 固定尺寸必须在窄屏验证；
- 不引入聊天头像墙或 SaaS account 语义。

Overlay：

- Dialog、Drawer、Menu、Popover、Tooltip 统一从 theme 继承；
- Dialog 必须 focus trap，关闭后恢复焦点；
- Escape 行为、scroll lock、移动端 max width 可预测；
- 不能用 modal 承载无需打断的普通页面设置。

### 7.15 Motion

- app.html 不新增 `motion` 依赖；
- 保留主题切换的 View Transition，并尊重 `prefers-reduced-motion`；
- nav width/content padding 使用一套 120ms transition；
- hover 使用 120-160ms 的 color/background/shadow transition；
- loading 使用 MUI Progress/Skeleton；
- 禁止每张 Card 入场动画、滚动视差和装饰性 blur。

## 8. 改造范围

### 8.1 允许修改

- `entrypoints/app/theme/**`；
- `entrypoints/app/layouts/**`；
- `entrypoints/app/components/collection/**`；
- `entrypoints/app/components/tags/**`；
- `entrypoints/app/components/iconify/**`（只在需要现有 UI 图标时）；
- `entrypoints/app/sections/**` 的 TSX 视觉 composition；
- `entrypoints/app/pages/**` 的纯 UI wrapper；
- `entrypoints/app/global.css`；
- `entrypoints/app/index.html` 的设计契约注释或静态入口语义；
- 对应 UI tests、截图 fixture 和目录 `CLAUDE.md`；
- `.trellis/spec/frontend/ui-design-system.md`，但必须与实际已实施状态同步更新。

### 8.2 只读检查，不主动修改

- `entrypoints/app/main.tsx`；
- `entrypoints/app/collection-platform-pages.ts`；
- `entrypoints/app/collection-platform-registry.ts`；
- `entrypoints/app/hooks/**`；
- `entrypoints/app/sections/**/use-*.ts`；
- i18n locale 文件（只有新增/改变真实 UI 文案时才能修改，且双语同步）。

### 8.3 禁止修改

- `entrypoints/background.ts`、Background/Offscreen/Content Script；
- `lib/database/**`、schema、migration、query；
- `lib/**` 下平台 sync/ingest/embedding/tagging/transcription/agent bridge；
- manifest、权限、host permission、WXT build 配置；
- public API、组件业务 props、路由路径、storage key；
- `.output/**` 构建产物；
- 任何新运行时依赖。

一旦实现需要触碰禁止范围，说明任务已经不是 UI-only，必须停止并另立任务。

## 9. 具体实施步骤

每个 Phase 独立 review、验证和回滚。不得把全部阶段合成一个大提交。

### Phase 0：建立可复现视觉基线

**实施状态（2026-08-26）：已完成。** Accepted reference/target screenshots 和复现
元数据见 `docs/reference-ui-audit.md`、`docs/target-ui-baseline.md`。

**目标：** 先知道当前 target 和 reference 实际长什么样，避免只看源码猜视觉。

步骤：

1. 固定 Windows Chrome 版本、device scale、字体、locale、theme 和数据 fixture；
2. Favbase 采集 `/`、`/collections`、Bilibili、Bookmarks、`/chat`、`/settings`；
3. Minimal 采集对应的 Dashboard、list/grid、settings/form、overlay 参考页；
4. 视口至少：1440×900、1024×768、390×844；
5. 状态至少：default、hover、focus-visible、selected、disabled、loading、empty、
   error、menu/dialog open、long text、missing media；
6. 每张截图记录 route、viewport、theme、locale、fixture 和复现步骤；
7. 产出 `reference-ui-audit.md` 与 `target-ui-baseline.md`，证据使用本文标签。

**验收：** 每个计划采用的视觉结论都能指向 reference source 或 runtime evidence。  
**回滚：** 无代码修改。

### Phase 1：重构 theme token 和 MUI defaults

**实施状态（2026-08-27）：已完成。** `theme/` 现在是 primitive、semantic、component
token 的单一 owner；页面只保留因 4px→8px 基础单位换算而必要的局部半径。验证结果：
`pnpm compile`、`pnpm exec vitest run lib/chat entrypoints/app/sections/chat entrypoints/app/theme`
和 `pnpm build` 通过；完整 `pnpm test` 在默认并发下有既有的 5 秒时序超时（本次复现
为未修改的 `lib/database/db.test.ts`，此前一次复现为 Bilibili import-smoke），对应
测试单独运行通过，未触及本次 theme 调用链。

**目标文件：**

- `theme/theme-config.ts`；
- `theme/core/palette.ts`；
- `theme/core/typography.ts`；
- `theme/core/shadows.ts`、`custom-shadows.ts`；
- `theme/core/components.tsx`；
- `theme/create-theme.ts`、`extend-theme-types.d.ts`、`theme-provider.tsx`；
- `theme/CLAUDE.md`、`.trellis/spec/frontend/ui-design-system.md`。

步骤：

1. 列出 primitive/semantic/component token 映射；
2. 锁定中性色、surface、divider、action、text.accent 的 light/dark 值；
3. 保留 coral/platform token，重新验证对比度；
4. 锁定 compact typography 和单 h1 contract；
5. 锁定 8px 基础 shape 与 Card/overlay elevation；
6. 统一 Button、Card、Input、Chip、Tabs、Paper、Popover、Dialog、Tooltip、
   Skeleton、CssBaseline；
7. 清理 page-local 可由 theme owner 接管的颜色、圆角、阴影和字号；
8. 验证 `theme-init.js`、ThemeProvider 和 storage selector/key 不漂移；
9. 同步 theme CLAUDE 和 Trellis UI spec，消除蓝色 Material Kit 过期规范。

**验收：**

- palette/typography/theme tests 通过；
- light/dark 的 button/input/card/overlay state matrix 通过；
- 非数据色和 icon asset 中无 page-local hex；
- small text、focus、selected、platform graphics 对比度通过；
- 不改任何业务组件 props。

**回滚点：** 仅回滚 theme owner；页面尚未迁移，不产生半套页面状态。

### Phase 2：重构 shell、Header 和 Navigation

**实施状态（2026-08-28）：已完成，待人工审阅。** 已锁定的 shell 契约：桌面 nav
300px pinned / 88px compact（`NAV_VERTICAL_WIDTH`）、nav 行 44px / 平台子行 40px /
compact 方形目标 44px、content gutter 40px（lg+）/ 24px（sm–md）/ 16px（xs），Header
容器在同一断点用同一 `--layout-dashboard-content-px`；布局变量改挂 `:root`，`html`
`scroll-padding-top` 跟随 Header 高度；Header 滚动后 blur + `divider` hairline；
侧栏 toggle / 移动菜单按钮补齐 Tooltip + `aria-label`（`header.sidebarToggleAria`
/ `header.menuAria`，双语）；移动 Drawer 采用 Trellis spec §11 的 exit-focus 契约把
焦点交还菜单按钮（原实现用 `blur()` 绕开，焦点恢复实际失效）；鱼骨线消费 `divider`
token；active 行 hover 与静止 active 可区分。验证：`pnpm compile`、`pnpm test`
（166 文件 / 1224 用例 + packages 7 用例）通过；新增 `dashboard/css-vars.test.ts`
锁变量契约、`dashboard/layout.test.tsx` 锁 toggle aria/storage 与 Drawer 焦点归位；
Chrome 实机 1440/1024/390 截图见本节末尾「运行时证据」。`global.css`、
`main-section.tsx`、`nav-active.ts` 复核后无需改动。

**目标文件：**

- `layouts/core/css-vars.ts`、`layout-section.tsx`、`header-section.tsx`、
  `main-section.tsx`；
- `layouts/dashboard/css-vars.ts`、`layout.tsx`、`nav.tsx`、`content.tsx`、
  `header-actions.tsx`、`background-jobs-indicator.tsx`；
- `layouts/nav-active.ts`；
- `global.css`；
- `layouts/CLAUDE.md` 和相关 tests。

步骤：

1. 明确 body/root/sidebar/header/main 的 height、position 和 scroll owner；
2. 保留 64/72 Header、288 mobile Drawer；
3. 在 1440/1024/390 验证 300/88 nav 候选，再锁定 CSS vars；
4. 统一 content gutter、top/bottom padding 和 maxWidth；
5. 收敛 nav row、child row、icon slot、active、hover、focus 和 tooltip；
6. 保留鱼骨连接线，但让其颜色、间距和 active 规则消费 token；
7. 验证 pin/unpin storage、移动 Drawer、pathname 自动关闭和焦点恢复；
8. 验证 Header 所有控件在 390px 不重叠；
9. 保持 Background Jobs Indicator 跨路由常驻。

**验收：**

- 全部 Hash route/deep link 可达；
- back/forward 正常；
- 中英文最长 nav label 不溢出；
- pin/unpin 和 mobile Drawer 行为与实施前一致；
- 1440/1024/390 无水平滚动、遮挡和焦点裁剪。

**回滚点：** 先回滚 dashboard CSS vars，再回滚 nav/shell 样式；storage 与路由不动。

**运行时证据（2026-08-28，`docs/ui-baseline/2026-08-28/phase2-shell/`）：** 独立
profile 的 Chrome 149 经 CDP `Extensions.loadUnpacked` 装入 `pnpm build` 产物（Chrome
137+ 已移除 `--load-extension`），空数据库，`measurements.json` 为脚本量测原始值。

| 证据 | 路由 | Viewport | Theme | 量测结论 |
| --- | --- | ---: | --- | --- |
| `collections-bilibili-1440x900-dark-pinned.png` | `#/collections/bilibili` | 1440x900 | dark | nav 300；Header/content gutter 均 40；h1 x=340 与 toggle 图标同左缘；行 44/40；无水平滚动、无标签截断（zh/en） |
| `collections-bilibili-1440x900-dark-compact.png` | 同上 | 1440x900 | dark | nav 88；四个 44x44 图标目标 + Tooltip |
| `collections-bilibili-1024x768-light-pinned.png` | 同上 | 1024x768 | light | gutter 24；无水平滚动 |
| `collections-bilibili-390x844-light.png` | 同上 | 390x844 | light | Header 64、gutter 16、三个控件零重叠；`scroll-padding-top` 64 |
| `settings-390x844-light-drawer-zh.png` | `#/settings` | 390x844 | light | Drawer 288；点抽屉链接后 `document.activeElement` 回到「打开导航菜单」按钮 |

**[DECISION]** 300/88 锁定：88px 下 44px 方形目标两侧各留 22px，视觉上与 Minimal
mini 栏一致且不显空；72px 只省 16px 内容宽度，不值得偏离参考几何。

### Phase 3：重构共享 UI primitives

**实施状态（2026-08-28）：已完成，待人工审阅。** 落地的 primitive 契约：
`SectionTitleBar` = 路由唯一 `h1`（Barlow 700 / 28px）+ caption 堆叠在标题下
（`body2` secondary）+ 右侧一个 medium contained 动作（36px），`mb: 3`；标题栏、
pipeline 行、同步失败横幅、搜索框、chip 行统一以 24px 收尾；`SearchField` 由主题
48px 输入目标决定高度并把 placeholder 作为 `aria-label`；`CardGrid` 间距改
`CARD_GRID_SPACING = 3`（24px，断点表 `CARD_GRID_SIZE` 不变）；`CollectionCard`
内容块 `p: 3` 对齐 `MuiCardContent`，新增 `CollectionCardRow`（链接之外行——标签
行、B站 ActionBar——的唯一内边距 owner，替换 `TagRow` `px 1.5/pb 1` 与 B站 5 处
`px 2/pb 1.5`）与 `CollectionCardSkeleton`（同内边距/同媒体槽的骨架，六平台骨架
文件只传 `media/header/lines` 形态参数），disabled 卡片改 `data-disabled` + neutral
底 + 媒体去色 + 标题 `text.secondary`（去掉整卡 `opacity .45`），焦点环内缩 2px 避免
被 `overflow: hidden` 裁掉；`StateBox` 改 1px dashed `divider` + `subtitle1` 段落标题，
`NoMatchesState` 与 `TaggedItemGrid` 空态共用且不再用 `text.disabled`；`ErrorState`
图标 48px。`resolveCollectionPhase` 8 case、tag editor / link / footer 的 DOM 事件
边界、hooks、路由、i18n key 均未改。验证：`pnpm compile`、`pnpm build` 通过；
`pnpm test` 168 文件 / 1233 用例中 1232 通过，唯一失败是既有的
`tests/lib-import-smoke.test.ts` Bilibili 5 秒并发超时（Phase 1 已记录，未触及
`lib/**`，单独运行 16/16 通过）；新增 `section-title-bar.test.tsx`、
`state-box.test.tsx`、`search-field.test.tsx`，`collection-card.test.tsx` 增加
disabled / `CollectionCardRow` / 骨架槽位断言，原断言未删。

**运行时证据（2026-08-28，`docs/ui-baseline/2026-08-28/phase3-primitives/`）：**
按用户要求在**用户正在使用的 Chrome**（真实 cookie 与本地数据，`chrome-devtools`
MCP：`reload_extension` → `new_page` → `resize_page`/`emulate` → `take_screenshot`
/ `evaluate_script`）采集，只看 `/collections/bilibili` 与 `/collections/bookmarks`
（其余平台页同一套 scaffold 模板）。**[DECISION]** 不再用独立空 profile 的 Chrome
做 UI 验证——它没有数据，证明不了卡片/网格/pipeline；规则已写入 Trellis UI spec §15。

| 证据 | 路由 | Viewport | Theme | 量测结论 |
| --- | --- | ---: | --- | --- |
| `live-bilibili-1440x900-light.png` | `#/collections/bilibili/117865102` | 1440x900 | light | 单 h1 28px；caption「默认收藏夹 · 4458 videos」在标题下；「Fetch now」36px；pipeline 四段；搜索 48px；配置提醒；Folders / 排序 chip 行；首张卡片 y=565 |
| `live-bilibili-1440x900-light-cards.png` | 同上 | 1440x900 | light | 20 张卡片 5 行全部等高 299.8；卡宽 245、gap 24；内容 padding 24；标题 2 行 clamp；footer 行（CC Official / Transcribe）padding `0 24 16`、高 40；无水平滚动 |
| `live-bilibili-1440x900-dark-cards.png` | 同上 | 1440x900 | dark | 同几何；dark 卡片 divider hairline、无阴影 |
| `live-bookmarks-1440x900-dark.png` | `#/collections/bookmarks` | 1440x900 | dark | caption「778 bookmarks · Last synced …」；提取进度卡；Folders chips；24 张卡片 6 行等高 152 |
| `live-bookmarks-1440x900-dark-hover.png` | 同上 | 1440x900 | dark | hover 卡片底 `#222B34`（neutral）vs 闲置 `#1C252E`；右上浮动标签编辑按钮 opacity 1、paper 底 |
| `live-bookmarks-1440x900-light-cards.png` | 同上 | 1440x900 | light | light 卡片低强度 shadow；favicon+域名 header、标题、日期靠底 |
| `live-bookmarks-1024x768-light.png` | 同上 | 1024x768 | light | 3 列、卡宽 206.7、gap 24；动作按钮 110x36 |
| `live-bookmarks-390x844-light.png` | 同上 | 390x844 | light | 1 列、卡宽 358；有 caption 时动作按钮换到标题块下一行（y 147.6）；搜索 358 宽；无水平滚动 |

**[UNKNOWN]** `CollectionCardSkeleton` 只在首屏 DB 查询期间出现，实机未截到；由
`collection-card.test.tsx` 的槽位断言与源码复核保证同轨道。

**已知未收敛（留 Phase 5）：** `sections/collections/collections-view.tsx` 的
`CollectionsGridSkeleton` 仍自画 Card 骨架；github/youtube 配置门早退页面无 h1；
chip 行头部图标颜色由各 view 指定（多为 `primary.main`，图标对白底 2.6:1）。

**目标文件：**

- `components/collection/section-title-bar.tsx`；
- `search-field.tsx`、`chip-row.tsx`；
- `card-grid.tsx`、`collection-card.tsx`；
- `state-box.tsx`、`error-state.tsx`、`no-matches-state.tsx`；
- `pipeline-progress-strip.tsx`、`sync-now-button.tsx`；
- `components/tags/**`；
- 对应 tests 与 `CLAUDE.md`。

步骤：

1. 统一 route title/caption/action anatomy；
2. 统一 48px search field 与 filter/header 节奏；
3. 统一 1/2/3/4 CardGrid 与 24px gap 候选；
4. 让 CollectionCard 唯一拥有 media、fallback、title clamp、meta、date、stats、
   stamp、tags、footer、hover、focus、disabled；
5. 统一 loading/empty/error/no-match/configuration 状态密度；
6. 保留 `resolveCollectionPhase` 的 8 case，不复制到平台 section；
7. 保留 tag editor、link area 和 footer action 的 DOM/事件边界；
8. 三处以上重复的视觉意图必须回到 shared owner。

**验收：**

- 六平台 Card 都经 `CollectionCard`；
- 缺图、长标题、大数字、空 tag/footer、disabled 都通过；
- 同 row 等高；hover/focus 覆盖整卡但不吞掉 tag/footer 操作；
- 现有 component contract tests 不因删断言而“通过”。

**回滚点：** 按 primitive 独立回滚，不回滚平台 adapter 或 data hook。

### Phase 4：先行 Vertical Slice - Dashboard `/`

**实施状态（2026-08-28）：已完成，待人工审阅。** 起因：Phase 1 把字阶改为固定
28/24/20/16/14 后，Dashboard 仍用 `h4 component="h1"` / `h6 component="h2"`，实机量得
路由 h1 只有 16px、区块 h2 只有 14px（比 subtitle1 还小），与六平台页 `SectionTitleBar`
的 28px h1 不同轨。落地：路由标题改用共享 `SectionTitleBar`（title + caption=subtitle，
删除页面自画 `<header>`）；按 §7.4 区块标题 `h2`（Barlow 24）、summary 数字
`h3 component="p"`（Barlow 20，是数字不是标题）、榜单标题 `h6 component="h3"`（14），
大纲 `[1, 2, 2, 3, 2]` 由测试锁定；hairline 全部改读 `theme.vars.palette.divider`（删除
页面私有 `grey500` 0.2/0.16 alpha）；圆角按主题分档（tile/tab 行 0.75、条 0.5）；删除主题
已接管的 `textTransform`/`opacity`/`fontVariantNumeric` 覆写；loading 改 `role="status"`
+ 同几何骨架；空态图标统一 48px；份额条加 `data-slot="share-bar"` 便于断言。五段结构
（title → SummaryBand → PlatformShelf | PlatformDetail → TopTags）、hook、路由、i18n key、
registry 均未改；未加任何 KPI 浮卡、趋势或图表。

实机复核发现并修掉两个几何缺陷：(1) 1024 视口 pinned 300px 侧栏下内容区只有 676px，
`md` 起的 4/8 分栏把平台名截成「Bilibili F…」「Browser…」→ 分栏推迟到 `lg`（≥1200），
以下 shelf 与 detail 上下堆叠（hairline 分隔），detail 内榜单双列提前到 `md`；(2) 390
视口详情头部 48px tile + 标题 + 197px 按钮同行不折行，把 h2 挤成 81px 宽三行 → 头部行
`flexWrap`（与 `SectionTitleBar` 同规则），按钮换到下一行。

验证：`pnpm compile`、`pnpm build` 通过；`pnpm test` 169 文件 / 1238 用例中 1237 通过，
唯一失败仍是既有的 `tests/lib-import-smoke.test.ts` Bilibili 5 秒并发超时（未触及
`lib/**`，单独运行 16/16 通过）；`overview-view.test.tsx` 由 3 例扩到 6 例（10/10 含
hook 测试），新增：标题经 `SectionTitleBar` + caption、loading `role=status` 时仍单 h1、
heading 大纲无跳级、零份额无条 / 部分平台=0 时 tabpanel 空态、有数据无维度一句话、
零标签 caption 与 Top tags 不渲染，原断言未删。`git diff --check` 干净；实机 console
无 error/warn。Trellis UI spec §10 已按实际状态改写（原文「Summary 是 Card / 4-8 Grid
Cards」与 2026-08-20 起的 hairline 实现不符）。

**运行时证据（2026-08-28，`docs/ui-baseline/2026-08-28/phase4-dashboard/`）：** 在用户
运行中的 Chrome（`chrome-devtools` MCP，真实数据 4,330 条 / 3 平台在用 / 0 标签）采集，
`measurements.json` 为脚本量测原始值（六组 viewport × scheme）。

| 证据 | Viewport | Theme | 量测结论 |
| --- | ---: | --- | --- |
| `live-dashboard-1440x900-dark.png` | 1440x900 | dark | h1 28px Barlow 700（x=340，与 Phase 2 同左缘）；标题块 60 高、到 band 24；band 116 高、上下边 `divider` 0.24；h2 24px Barlow；数字 20px Barlow；shelf 321 / detail 674 并排；tab 行 62 高 6px 圆角，选中底 `#3A2A24`；tile 36 6px，选中珊瑚底 + 墨字形；份额条 117/35/41 品牌色，榜单条 `grey500` 0.64；「View platform collection」197x36 `text.accent`；无水平滚动 |
| `live-dashboard-1440x900-light.png` | 1440x900 | light | 同几何；选中底 `#FEE9E1`；tile 底 `#F4F6F8`、字形品牌色（github/x 为墨）；按钮 `#7A2714` |
| `live-dashboard-1440x900-light-tab-focus.png` | 1440x900 | light | 脚本聚焦选中 tab 后按 ArrowDown：焦点到 GitHub tab，`:focus-visible` 2px `#7A2714` outline offset 2；aria-selected 未变（manual activation）；可见 MUI 默认键盘 focus ripple（pulsate），与 nav 项同为 ButtonBase 默认，未单独处理 |
| `live-dashboard-1440x900-light-empty-platform.png` | 1440x900 | light | 按 Enter 选中 GitHub：tabpanel 切到 `dashboard-platform-panel-github`，h2「GitHub Stars」+「0 items」，`StateBox` 200 高 1px dashed `divider`「No content has been collected from this platform.」（部分平台=0 态） |
| `live-dashboard-1024x768-light.png` / `-dark.png` | 1024x768 | light / dark | nav 300 pinned、gutter 24（x=324，宽 668）；band 三格 223 宽；shelf 全宽堆叠在 detail 之上，六个平台名零截断；无水平滚动 |
| `live-dashboard-1024x768-dark-detail.png` | 1024x768 | dark | 滚到 detail：48 tile + h2 391x30 单行 + 按钮同行；榜单双列（x 350 / 704） |
| `live-dashboard-390x844-light.png` / `-dark.png` | 390x844 | light / dark | Header 64、gutter 16（宽 358）；band 三格纵向堆叠 92/93/115；tab 行 358 宽零截断；无水平滚动 |
| `live-dashboard-390x844-light-detail.png` | 390x844 | light | h2 294x30 单行，按钮换行到 x=16；榜单单列 |

**[UNKNOWN]** total=0 库空态、有数据无维度、error/loading 态实机无法在用户真实数据库上
复现，由 `overview-view.test.tsx` 断言覆盖。Chat/Settings 与其他路由未动。

**观察（非本 Phase 范围）：** MUI `ButtonBase` 默认的键盘 focus ripple（pulsate）在
tab 行上是一块灰色脉冲，与 CssBaseline 的 2px outline 叠在一起；nav 项同样有。若要关，
应在 theme `MuiButtonBase.defaultProps.disableRipple` 统一决定（Phase 1 owner），不在
页面里单点关。

**目标文件：** `sections/overview/overview-view.tsx` 及其 tests/CLAUDE。

步骤：

1. 套用 Phase 1-3 的 token、shell 和 state；
2. 保持真实 title/subtitle、SummaryBand、PlatformShelf、PlatformDetail、TopTags；
3. 不增加模板 KPI、趋势、收入或虚构 chart；
4. 验证 total=0、部分平台=0、无维度、无 tags、loading、error；
5. 验证平台色只出现在 icon/data graphics；
6. 验证每路由恰一个 h1，section heading 不跳级；
7. 采集 light/dark × 1440/1024/390 目标基线；
8. 做键盘、screen-reader landmarks 和 focus-visible 检查。

**批准门：** 人工审查 target-owned 截图和行为 diff 后，才进入 Phase 5。  
**回滚点：** 只回滚 overview composition；theme/shell 保持独立可审。

### Phase 5：Collections 聚合页和六平台页

**实施状态（2026-08-29）：已完成源码与自动验证，待人工运行时审阅。** 仓库审计确认
六平台已在 Phase 3 消费 `CollectionPageScaffold` 与 `CollectionCard`，因此本阶段没有
重写六套页面，而是消除剩余局部 owner：`/collections` 的自画 Card 骨架改为共享
`CardGridSkeleton + CollectionCardSkeleton(header, 3 lines)`；聚合空态改为 48px
secondary glyph；`ChipRowShell` 新增唯一 `data-slot="icon"` 并统一以
`text.secondary` 着色，删除聚合标签、平台标签和六平台原生筛选 header 的局部
primary/error 色；Bilibili 登录/空夹/选夹状态改用 `StateBox` 结构化 props；六平台
空/认证状态 glyph 统一为 48px secondary，双按钮 action 在窄屏允许换行；GitHub 与
YouTube 配置门早退前补共享 `SectionTitleBar`，保证未配置路由仍恰有一个 h1。

数据 hook、八分支 phase resolver、路由、筛选维度、标签、分页、sync、pipeline、
configuration、retry、i18n key、卡片 link/tag/footer DOM 边界均未改。新增
`collections-view.test.tsx`、`configuration-heading.test.tsx` 与
`chip-row.test.tsx`，分别锁定聚合共享骨架/空态、配置门单 h1、chip icon 单 owner。

验证：focused Vitest 6 文件 / 25 用例通过；`pnpm compile` 通过；`pnpm build`
通过且 background bundle contract 为 12 modules / 937221 bytes；Impeccable 对 17 个
改动 UI 文件检测为 0 finding；全量 `pnpm test` 为 171 文件 / 1242 用例通过，唯一
失败仍是既有 `tests/lib-import-smoke.test.ts` Bilibili 5 秒并发超时，单独重跑该文件
16/16 通过（2.75s）；`git diff --check` 干净。

**[UNKNOWN] 运行时证据：** 当前 `chrome-devtools` 会话只有 `about:blank`，直接打开
已记录扩展 URL 返回 `ERR_BLOCKED_BY_CLIENT`，且工具面没有 extension reload/list API，
因此本阶段没有伪造 light/dark、1440/1024/390 截图或 console 结论。已构建待审产物为
`C:\tmp\favbase-minimal-v7-phase2\.output\chrome-mv3`；用户在加载该 worktree 的
Chrome 中 reload 后，仍需按本节验收矩阵做人工运行时批准。

**目标文件：**

- `sections/collections/**`；
- `sections/bilibili/**`、`bookmarks/**`、`github-stars/**`、`x/**`、
  `zhihu/**`、`youtube/**` 中的 UI TSX；
- 对应 tests/CLAUDE。

步骤：

1. 先迁移 `/collections` 聚合页，验证跨平台 Card 和 Tag Drill-down；
2. 再按 Bilibili → Bookmarks → GitHub → X → Zhihu → YouTube 逐平台迁移；
3. 每个平台只装配媒体和特有字段，不复制 shared styles；
4. 保留 source/folder/playlist/language 等过滤维度；
5. 保留 search、tag AND、pagination、sync、pipeline、configuration、retry；
6. 每个平台分别验证真实 typical/max 文案、缺图、空数据、错误和运行任务；
7. 每完成一个平台就跑 focused tests 和截图，不等六个平台一起发现问题。

**验收：**

- 所有深链、筛选、分页、同步、标签和 pipeline 行为不回归；
- 六平台视觉骨架一致，差异只来自真实内容；
- 首屏能看到真实 Collection 内容的开始位置；
- console 无新 error/warning。

**回滚点：** 聚合页和每个平台各自独立回滚；共享 primitive 另行回滚。

### Phase 6：Settings、Chat 和 overlay

**目标文件：** `sections/settings/**`、`sections/chat/**` 及相关 UI tests/CLAUDE。

步骤：

1. Settings 统一 tabs/rail、section、field、helper/error、button 高度；
2. 清除重复 title/card 嵌套，但不改变设置字段、保存和错误处理；
3. Chat 统一 conversation rail、message width、tool/source state、composer；
4. 保留 assistant markdown 与 user plain text 分叉；
5. 验证 code/table overflow、流式不完整 markdown、停止和滚动；
6. 统一 Dialog/Drawer/Menu/Popover/Tooltip 的 theme defaults；
7. 验证 Escape、focus trap、focus restore、390px overlay width；
8. 验证 zh-CN/en 长文案与未配置/错误/空态。

**验收：** 设置和 Chat 行为测试不回归；所有 overlay 键盘行为通过。  
**回滚点：** Settings、Chat、overlay 分三个独立批次回滚。

### Phase 7：全量验证、文档同步与清理

步骤：

1. 运行 `pnpm compile`；
2. 运行 `pnpm test`；
3. 运行所有 changed UI 的 focused Vitest；
4. 按验证矩阵做 light/dark、zh-CN/en、1440/1024/390；
5. 检查 route/deep link/history/theme/locale/sidebar/jobs；
6. 检查 WCAG 2.2 相关语义、对比、键盘、focus、zoom/reflow、target size；
7. 检查 layout shift、图片/字体加载、bundle 变化、console；
8. 目标截图只与 Favbase 已批准基线比较，不与 Minimal 做 pixel golden；
9. 更新所有改动目录 `CLAUDE.md`；
10. 更新 `.trellis/spec/frontend/ui-design-system.md` 为**实际已实施值**，不得写
    尚未落地的愿景；
11. 删除已经被 shared owner 替代的局部样式和死代码，不保留双轨。

## 10. 验证矩阵

### 10.1 路由

- `/`；
- `/collections` 与 `?tag=<uuid>`；
- 六个平台基础路由；
- Bilibili/Bookmarks 子路由；
- `/chat`；
- `/settings` 及现有 deep link。

### 10.2 Viewport

| 类型 | Viewport | 重点 |
| --- | --- | --- |
| wide desktop | 1440×900 | expanded nav、首屏内容、4 列 grid |
| narrow desktop | 1024×768 | compact/expanded nav、gutter、header overflow |
| mobile reflow | 390×844 | Drawer、1 列、overlay、长文案、touch target |
| zoom | 200% | reflow、无双向滚动、focus 不被裁剪 |

### 10.3 Theme / Locale

- light + dark；
- zh-CN + en；
- system mode 首帧无 FOUC；
- 主题切换 reduced-motion 降级；
- 中英文最长导航、按钮、错误和 helper 文案。

### 10.4 组件状态

- default、hover、focus-visible、active、selected、disabled；
- loading、empty、partial、error、retry、success；
- long title、large number、missing image、no optional metadata；
- menu/dialog/popover open；
- pipeline running/pausing/paused；
- Chat streaming/stopped/tool/source/error。

### 10.5 行为回归

- 所有 hash route/deep link/back/forward；
- nav active、展开、pin/unpin、Drawer close；
- search、filter、tag AND、pagination；
- sync、cooldown、pause/resume、jobs indicator；
- tag editor 和外链 Ctrl/middle click；
- Settings save/error/deep link；
- Chat send/stop/stream/source/conversation；
- theme、locale、storage persistence。

### 10.6 Accessibility

- 每路由一个 h1，heading 无跳级；
- landmark、label、aria name、description 完整；
- icon-only controls 有 Tooltip + aria-label；
- 全键盘操作，focus visible 且不被 sticky/overflow 遮挡；
- Dialog focus trap/restore，Escape 行为正确；
- small text 4.5:1，large text/graphics/focus 3:1；
- 200% zoom 和 390px reflow 无内容丢失；
- reduced motion 生效。

### 10.7 Performance

- 不新增运行时依赖；
- 不把 `motion` 引入 app.html chunk；
- 共享 token/component 改造不制造重复 observer/timer；
- media 预留尺寸，无明显 CLS；
- 字体和离线 icon 不发外部请求；
- 构建与 console 无新增错误或警告。

## 11. 明确拒绝清单

以下内容即使存在于 Minimal，也不得进入本次重构：

- Minimal 绿色主色和 Public Sans；
- Account Drawer、Workspace selector、Contacts、Notifications、Upgrade 卡；
- auth/demo/component showcase/template routes；
- mock 用户、mock 团队、mock 指标、mock chart；
- Horizontal nav 和用户可配置 nav color/layout；
- 为“像模板”而增加的 avatar、badge、illustration；
- 新动画库、页面入场动画、滚动视差；
- 页面 section 全部卡片化、Card 套 Card；
- 散落 hex、rgba、字号、圆角和阴影；
- 修改数据库、同步、Agent Bridge、平台协议或路由；
- 直接编辑 `.output/**/app.html`；
- 以“编译通过”或“看起来像 Minimal”代替验收。

## 12. 风险和停止条件

### 高风险

- theme default 改动影响全部 MUI consumer；
- shell/nav 改动影响全部路由和焦点顺序；
- CollectionCard/scaffold 改动影响六平台；
- 过期 Trellis UI spec 可能误导后续 agent。

### 停止条件

出现任一情况必须停止当前 UI slice：

- 需要新增依赖；
- 需要改变 public props、hook 返回值或数据字段；
- 需要改变路由、storage key、同步或状态机；
- 需要修改 `lib/**`、background、offscreen、manifest；
- target screenshot 与本文规则冲突且无法通过现有 owner 解决；
- visual diff 伴随行为测试失败。

## 13. 完成定义

只有同时满足以下条件，UI 重构才算完成：

- 每个采用的 Minimal 模式都有适配矩阵决策和目标 owner；
- 品牌、术语、路由、数据语义和交互保持正确；
- shared intent 只有一个 owner，无六平台 copy-paste 样式；
- 无 Minimal 演示业务、mock 数据和无依据功能；
- light/dark、zh-CN/en、1440/1024/390、200% zoom 通过；
- loading/empty/error/partial/missing-media/long-text 通过；
- 键盘、focus、heading、overlay 和对比度通过；
- `pnpm compile`、`pnpm test` 通过；
- 目标视觉 baseline 已人工审查；
- 受影响目录 `CLAUDE.md` 和 Trellis UI spec 与实际实现一致；
- 所有剩余例外有明确 owner、理由和后续任务，不留 `[UNKNOWN]` 冒充结论。

## 14. Grill-with-docs 结论

本轮已按 `grill-with-docs` 核对 `CONTEXT.md`、`PRODUCT.md`、根/目录
`CLAUDE.md`、Trellis frontend spec、现有 app UI 源码和 Minimal v7 参考源码。

- 术语未冲突：继续使用 Dashboard、Collection Analytics、Collection Item、
  Pipeline Run、Processing Coverage 等现有领域语言；
- 没有新增领域术语，因此不修改 `CONTEXT.md`；
- 没有不可逆架构决策，因此不新增 ADR；
- 没有未解决的产品设计分支；
- Phase 0 运行时视觉证据已采集；Phase 1 的运行时细节仍需在后续 shell/page Phase
  的代表性路线中复核，不能把本轮源码测试当作全量视觉验收。

## 15. 当前审查判断

**品味评分：凑合。** 代码已有正确的 theme/layout/scaffold owner，说明基础没有坏；
但实际 UI、目录文档和 Trellis UI spec 不一致，继续按页面打补丁会让系统失控。

**致命问题（Phase 0 前）：** 不是某个圆角或颜色，而是设计事实没有单一 owner。实现
写着一套暖纸珊瑚目录卡片，Trellis spec 写着蓝色 Material Kit 阴影卡片，用户目标又
是 Minimal v7。Phase 1 已把 palette、shape、elevation、MUI defaults 和规范收敛到同一
条 theme pipeline，后续只需按页面 Phase 逐步迁移。

**改进方向：** 按本文 Phase 0-4 先建立证据、统一 token/spec、完成一个 Dashboard
vertical slice；通过人工视觉与行为审查后，再扩展到 Collections、Settings 和 Chat。
