# TEMP：app.html 设计整改 — 新对话接力手册（2026-08-20）

> 临时文件，做完 Phase 6 后删除。每个阶段开一个**新对话**，先粘「通用前置」再粘该阶段的 prompt。
> 单一事实源：`docs/19_app-design-critique-2026-08-20.md`（问题清单 + 分阶段计划）。本文件只放「怎么开工」，不复制问题细节。

---

## 0. 已完成与铁律（新对话必须知道的背景）

**已完成（commit `ecd9552`，2026-08-20）**
- impeccable `critique`：app.html 21/40，判定 mostly template。快照 `.impeccable/critique/2026-08-20T08-53-17Z__entrypoints-app.md`。
- 产品事实 `PRODUCT.md`（impeccable init 产物）。
- 视觉方向已锁：**目录卡片库**（docs/19 §7.0.1，seed `30995f23`）。Phase 0 token 层已落地：`entrypoints/app/theme/*`（暖纸面/暖墨灰阶、条目细线零阴影、圆角 ×1/×3、字阶 12/14/16 + Barlow h1、`text.accent`、主按钮墨底、印章 chip 珊瑚底深墨字、焦点环双模式）。
- P0-2 已落地：`entrypoints/app/components/collection/collection-card.tsx` 六平台卡统一外壳。
- 设计系统规格已改写：`.trellis/spec/frontend/ui-design-system.md`（§12 禁止项、§13 检查项）；UI 验证契约在 `.trellis/spec/frontend/quality-guidelines.md` → Testing Requirements（含 MV3 CSP 下浏览器检测器**同源注入**配方）。

**铁律（用户明确决定，不得推翻）**
1. 绑定不动：狐狸 logo、珊瑚 `#FC7E5B` **色相**、DM Sans Variable + Barlow。
2. **平台页 `/collections/<platform>` 从 header 以下到搜索框（含）的布局结构不得再动**（用户否决了三行压缩结构，恢复了 HEAD 堆叠：标题行 / strip 行 / 全宽 56px 搜索 / 配置横幅 / 操作 / 分类 chips / 标签 / 排序 / 列表）。只准改色彩、语义属性。docs/19 的 P0-1「首屏 ≤320px」目标已作废。
3. 珊瑚**只做色块**（印章 chip、进度填充、图标），**从不做文字**，也不压白字；强调文字用 `theme.vars.palette.text.accent`；作为文字的语义色一律用 `.dark`/`.darker` 阶。
4. 项目规则：Trellis 流程（`task.py create` → prd.md → jsonl → `task.py start` → `trellis-implement` 子代理 → `trellis-check` 子代理 → `trellis-update-spec` → 提交计划 → `/trellis:finish-work`）；AI 默认不 commit；改目录同步该目录 `CLAUDE.md`；组件内零 CJK（`tests/i18n-no-hardcoded.test.ts`）；新文案 zh-CN/en 双写；`pnpm compile` + `pnpm test` + `pnpm build`（不要 `wxt dev`）。

---

## 1. 通用前置（每个新对话第一段，原样粘贴）

```
项目：favbase（C:\Users\18368\Desktop\00_myCode\24_cyberSquirrel\00_favbase），Chrome MV3 扩展，WXT + React 19 + MUI v7。
本对话只做 app.html 设计整改的一个阶段。开工前按顺序读：
1. TEMP-app-design-handoff.md 的 §0（已完成与铁律）
2. docs/19_app-design-critique-2026-08-20.md（问题单一事实源，重点 §3 和 §7）
3. PRODUCT.md（产品事实与品牌绑定项）
4. .trellis/spec/frontend/ui-design-system.md §12/§13 与 .trellis/spec/frontend/quality-guidelines.md 的 Testing Requirements（浏览器验证配方）
5. entrypoints/app/theme/CLAUDE.md、entrypoints/app/components/collection/CLAUDE.md
铁律：狐狸 logo / 珊瑚色相 / DM Sans+Barlow 不动；平台页 header→搜索框区域的布局结构不动（只能改色彩与语义属性）；珊瑚从不做文字；走 Trellis 流程并派 trellis-implement / trellis-check 子代理；默认不 commit，停在未提交状态等我审阅。
验证口径：pnpm compile、pnpm test、pnpm build 全绿；用 Chrome DevTools MCP 重载扩展（id ifnlocdgkmdkkokbgddfpjjpngddkopk，页面 chrome-extension://ifnlocdgkmdkkokbgddfpjjpngddkopk/app.html#/<route>），亮/暗两模式截图存 .impeccable/review/，按 quality-guidelines 的同源注入法跑浏览器检测器并报前后数字；不得伪造未测的数字。
```

---

## 2. Phase 2 — P1-1 色彩用法迁移（impeccable `colorize`）

```
阶段：Phase 2 / P1-1「色彩用法迁移」。token 层已经换好，这一阶段只改「用法」，范围严格限于 docs/19 §3 P1-1 + §7 Phase 2 + §7 Backlog 里 trellis-check 列出的遗留项：
- text.disabled 仍作正文色：components/collection/no-matches-state.tsx、components/tags/tagged-item-grid.tsx、sections/bilibili/folder-chips.tsx、layouts/dashboard/nav.tsx 的 Platform Request 外链叶（先 grep "text.disabled" 全量核对，只改「正文/标签文字」用法，disabled 控件不动）
- 本地珊瑚焦点环：sections/chat/chat-view.tsx、sections/chat/source-card.tsx 里 outline: 2px solid primary.main —— 删掉让 MuiCssBaseline 全局焦点环生效
- 全站剩余 color: 'primary.main' / 'error.main' / 'warning.main' / 'info.main' / 'success.main' 的**文字**用法（grep 后逐个判断：图标/色块/进度填充保留，文字改 text.accent 或 .dark 阶，暗色用 theme.applyStyles('dark', …) 分支）
- 彩色 outlined Chip 文字（如 B站卡 "CC Official"、Transcribe 状态 chip）改 soft filled：底 <color>.lighter、字 <color>.darker，暗色分支用 varAlpha(<color>.mainChannel, 0.16) 底 + <color>.light 字
- Analytics 页 "View platform collection" 等珊瑚文字链接 → text.accent
- overline 变体若无消费方删除或保持，不新增 eyebrow 式小标签
不做：布局、结构、字体、token 值本身（除非某个 token 被证明在两模式下都无法达标，先报告再改）。
验收：浏览器检测器在 /、/collections、/collections/bilibili、/collections/x、/settings、/chat 亮/暗各一次 low-contrast = 0；grep 主题外 "primary.main" 的文字用法 = 0；现有测试全绿；ui-design-system.md §12 若有新禁止项同步；docs/19 §3 P1-1 标注完成日期。
先建 Trellis 任务（title: style(app): migrate remaining text colors to accessible tokens），prd 写清上述清单，然后派 trellis-implement，再派 trellis-check。
```

---

## 3. Phase 3 — P1-2 空态与深链（impeccable `onboard`）

```
阶段：Phase 3 / P1-2「死胡同空态 / 阻塞态」，范围 = docs/19 §3 P1-2：
1. Settings 深链：entrypoints/app/sections/settings/settings-view.tsx 目前只解析 ?section，不解析 ?tab。加 ?tab=ai|connections|general|storage 解析（保持现有 ?section 与 ?resume 行为不变），并在 sections/settings/CLAUDE.md 记录 URL 契约。
2. GitHub / YouTube 空态的 "Go to Settings"（sections/github-stars/github-stars-view.tsx 的 NoTokenState、sections/youtube 的 NotConnectedState）改为 navigate('/settings?tab=connections&section=github|youtube')。
3. Chat 未配置 LLM 态（sections/chat/chat-view.tsx 的 !configured 分支）：把裸 <Alert> 换成 components/collection 的 StateBox + Button component={RouterLink} to="/settings?tab=ai&section=llm"，文案走 i18n；!configured 时禁用会话 rail 的 New chat。注意 chat-view 里现有的 [role=alert] 就是这个 Alert，换掉后平台页与 chat 页加载时 [role=alert] 都应为 0。
4. 文案对齐：lib/i18n/locales/{zh-CN,en}.ts 中 githubStars.emptyDesc / x.emptyDesc / youtube.emptyDesc 等「Click Sync」类说法与按钮 pipeline.fetchNow 对齐（两语言同改）。
5. 顺带：LLM 设置卡描述 "for video content summarization" 已过时（驱动 chat + tagging），改文案（双语）。
不做：布局结构、设置页 Tab 结构、任何 token。
验收：三个空态 CTA 点击后落到正确 Tab + section（浏览器实测）；chat 阻塞态有可点 CTA 且 New chat 禁用；i18n 守卫与 locale key 对称；相关 CLAUDE.md 同步；docs/19 §3 P1-2 标注完成日期。
先建 Trellis 任务（title: fix(app): dead-end empty states and settings deep links），prd → trellis-implement → trellis-check。
```

---

## 4. Phase 4 — P2-1 语义与可访问性（impeccable `audit`）

```
阶段：Phase 4 / P2-1「标题语义与可访问名」，范围 = docs/19 §3 P2-1：
1. 每路由恰一个 <h1>：平台页已由 SectionTitleBar 提供（component="h1"，视觉 h5，不要改它的视觉）；Analytics（sections/overview/overview-view.tsx）、Settings（sections/settings/settings-view.tsx）、Chat（sections/chat/chat-view.tsx）的页标题 Typography 加 component="h1"，视觉变体保持现状。
2. 卡片与面板里的 subtitle/h6 滥用：已在 theme/core/components.tsx 用 MuiTypography.defaultProps.variantMapping 把 subtitle1/2 映射为 p；核查仍用 variant="h6"/"h5"/"h3" 做非标题用途的地方（卡片作者、统计数字、面板小标题），改 component="p"/"span" 或降级 variant，消除 skipped-heading。
3. 无名按钮补 aria-label（i18n key 双语）：layouts/dashboard/layout.tsx 侧栏 toggle 与移动菜单按钮；sections/settings/llm-config-card.tsx 与 webdav-sync-card.tsx 的密码眼睛按钮；components/tags/tag-row.tsx 的 "Edit tags" 按钮名带条目标题；components/iconify 里按钮名夹零宽空格的问题排查。
4. Tab 顺序：首次 Tab 应落在侧栏第一个链接而非内容区的 rail；排查 tabIndex / autoFocus。
5. "Show N more" 展开大量 chip 后缺收起/跳过：给 CollapsibleChipRow 已有的收起能力确认可达，必要时在展开后把焦点放到第一个新 chip。
不做：布局结构、色彩、token。
验收：浏览器检测器 skipped-heading = 0；每路由 document.querySelectorAll('h1').length === 1；所有 icon button 有非空可读名（用 evaluate_script 扫 button 的 accessible name）；测试全绿；相关 CLAUDE.md 同步；docs/19 §3 P2-1 标注完成日期。
先建 Trellis 任务（title: a11y(app): heading semantics and accessible names），prd → trellis-implement → trellis-check。
```

---

## 5. Phase 5 — 记录设计系统（impeccable `document`）+ 一项已决、一项待决

```
阶段：Phase 5 / 收口。两件事：
A. 用 impeccable 的 document 命令（skill impeccable，reference/document.md）从**已建成**的 entrypoints/app/theme 与 components/collection 生成 DESIGN.md（根目录），记录目录卡片库世界：token 表（亮/暗）、圆角、阴影、字阶、珊瑚=印章规则、text.accent 规则、CollectionCard 契约、平台品牌色只在图标与数据图形。DESIGN.md 必须与 .trellis/spec/frontend/ui-design-system.md 一致，若发现不一致以代码为准，两边同改。
B. 画布色已决，Analytics 指标仍待决：
   1) **已决（2026-08-26）**：app 画布按用户当前要求固定为亮色 `#FFFFFF`、暗色 `#141A21`；旧的 `#F8F4EE` 与候选 `#F7F6F3` 不再参与 A/B。
   2) Analytics 页是否把"Used tags / Tagged items"两个 0 的 hero 数字换成更有信息的维度（docs/19 §1 H8 与 Jordan 红旗）。只出方案，不改代码。
不做：任何布局结构改动。
```

---

## 6. Phase 6 — Backlog 与复评（impeccable `critique` 再跑一次）

```
阶段：Phase 6 / backlog 清扫 + 复评。
1. 从 docs/19 §5「次要观察」里挑出**不涉及布局结构**的项成批处理（一个 Trellis 任务，prd 列清单）：
   - "5023 items" 数字未格式化 → 走 formatCompactNumber / Intl；X "1943 new this sync" 噪音；知乎 "924 favorites vs 599 waiting" 差额解释
   - 暗色分段 Tab 选中态可辨性、暗色卡 1px divider（若仍有问题）
   - 语言菜单双重选中信号；后台任务 chip 1440 宽截断；Temperature 浮点泄漏；Max Tokens valuemax=0；"Get Key"/"Fetch Models" 两种按钮高度
   - document.title 逐路由标题
   - 会话删除确认 / 撤销；"Pause library build" 反馈 toast
2. 做完后重新跑 impeccable critique（目标 entrypoints/app），把新分数与 21/40 对比写进 docs/19 顶部，并在 .impeccable/critique/ 留新快照。
3. 最后删除 TEMP-app-design-handoff.md，并在 docs/19 顶部写明各 Phase 完成日期与 commit。
不做：布局结构（尤其平台页 header→搜索框区域）、字体、珊瑚色相。
```

---

## 7. 每阶段收尾清单（粘在阶段 prompt 末尾也行）

```
收尾：trellis-check 通过后运行 trellis-update-spec（只记录可执行契约）；给出提交计划（文件清单 + `<type>(<scope>): <description>`）并停下等我审阅；我说"提交"才 commit；然后 /trellis:finish-work（归档任务 + 记录会话，add_session 的占位段要手工补齐）。更新 docs/19 对应小节的完成标注。
```
