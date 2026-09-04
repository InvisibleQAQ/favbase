# sections/chat

app.html 一级 **Chat** 页面：对话式知识库助手（Agentic RAG，只读 PGlite）。与 Collections 平行的顶层导航。

## 当前状态（P1–P5 + docs/25 Step 9 Minimal chat shell）

多步 tool-calling agent 循环 + token 流式 + 来源卡片 + 工具四态 + 多会话持久化 + assistant markdown 渲染已打通：提问 → agent 调 `searchKnowledgeBase` 等工具检索本地知识库 → 流式渲染回答（markdown）+ 命中项来源卡片，会话持久到 PGlite `chat_conversations` 表跨刷新恢复（存全量模型态，滑窗只在喂模型处）。

外壳自 docs/25 Step 9 起是 Minimal v7.7.0 的 chat 形态：会话 rail 在一张 16px 圆角、`customShadows.card` 的卡片内，与 header + 消息区并排。

## 文件 owner 表

| 文件 | 拥有什么 |
|------|----------|
| `chat-view.tsx` | **编排 + 数据**：连 `useChatAgent`，持有 rail 折叠态、移动 Drawer 开合与 trigger ref、`lg` 断点；`loading` / 未配置 / 正常三态分支；error Alert 落在 list 与 composer 之间。受控 UI 导出为 `ChatWorkspace` |
| `layout.tsx` | 卡片外壳 `ChatLayout`（三槽 `nav / header / main`）与两个宽度常量 `CHAT_NAV_WIDTH = 320` / `CHAT_NAV_COLLAPSE_WIDTH = 96`。root 是带 `aria-labelledby` 的 `section`，header 槽固定 72 高 + 下边框并带 `data-slot="chat-header"`（`docs/ui-baseline/app-runtime-check.mjs` 靠它找历史触发按钮）。**高度由调用方给**（`DashboardContent` 的 `calc(100dvh - header)`）：dashboard main 不是受限高度的 flex 列，Minimal 的 `flex: 1 1 0` 单独用不成立 |
| `chat-nav.tsx` | 会话列表 `ChatNav`（`variant` = `'rail'` 或 `'drawer'`）：`nav[data-slot="chat-nav"]`，rail 在 `lg+` 显示并可折叠到 96（折叠时只留图标按钮与头像），列表走 `Scrollbar`；「新对话」按钮、折叠切换、Drawer 关闭按钮都在顶部一行 |
| `chat-nav-drawer.tsx` | `< lg` 的临时历史 Drawer。paper 宽 `min(320px, 100vw - 32px)`，`md+` 的 left 跟随 `--layout-nav-vertical-width`；**退出焦点契约**（spec §12）在此：显式 refs + `disableRestoreFocus` + `onTransitionExited` 里 blur 后代 + transition `onExited` 归还 trigger，禁止手改 `aria-hidden`/`inert`。trigger 在 `chat-header.tsx`，ref 由 `chat-view.tsx` 注入 |
| `chat-nav-item.tsx` | 单个会话行：72 高 `ListItemButton`（48 头像取标题首字，按码点切）+ **同级** 删除 `IconButton`（不得嵌套）；激活行 `aria-current="true"` + 8% 主色洗底；折叠态只剩头像，完整标题落 tooltip 与 `aria-label` |
| `chat-header.tsx` | 页面 h1（`#chat-page-title`，全页唯一）+ 当前会话标题 caption + `< lg` 的历史触发按钮。**没有会话操作菜单**：runtime 无重命名能力，删除已在每一行上（docs/25 Step 9 勘误 E-2） |
| `chat-message-list.tsx` | `role="log"` 的 `Scrollbar`（`data-slot="chat-messages"`）+ 自动滚底 + 760px 阅读轨道常量 `CHAT_READING_WIDTH`；空态用共享 `EmptyContent` |
| `chat-message-item.tsx` | 单个回合：`article[data-role]`、工具四态 live status（`data-slot="tool-activity"` + `role="status"`）、气泡、来源卡片槽；`activityLabel(kind, phase)` 选 i18n 也在这里 |
| `chat-message-input.tsx` | composer：`InputBase` 多行（`minHeight: 56` + 顶部 divider，`data-slot="chat-input"`）+ 发送/停止按钮，自持输入文本。**键盘契约**：Enter 发送 / Shift+Enter 换行 / Ctrl·⌘+Enter 插 `\n` / IME composing 的 Enter 不发送 |
| `use-chat-agent.ts` | `ConversationRuntime` 的 React Adapter：读 `useSettings`、解析当前 LLM、`useSyncExternalStore` 订阅不可变 snapshot，转发 `{ send, stop, newConversation, switchConversation, deleteConversation }`；mount 调 `loadInitial()`，cleanup 调 `cancelPending()` |
| `chat-markdown.tsx` | assistant 回答的轻量 markdown 渲染器：`react-markdown` + `remark-gfm`，`components` 用 MUI + `theme.vars.*`（`a` 新标签 + accent 色、`code`/`pre` neutral 底 + 横滚、table 外层横滚）。`memo` 包裹。**安全默认：不启用 `rehype-raw`**，原始 HTML 一律转义 |
| `source-card.tsx` | assistant 回合命中的来源卡片，命名 `ul/li` 两列紧凑网格；6px compact row + divider + neutral 底，hover 读 `action.hover`；点击一律安全打开原始来源 |

## 气泡规则（docs/25 Step 9，用户 2026-09-04 决定）

- **用户提问**吃 Minimal 气泡几何：`p 1.5` / `minWidth 48` / `maxWidth 320` / `borderRadius 1` / `body2` / 16% 主色洗底 / `text.primary`，`pre-wrap` 保留换行，永远是 plain text。
- **助手回答不进气泡**：满 760 轨道、无底色无边框。Minimal 的 `maxWidth 320` + `background.neutral` 是给 IM 短句的——markdown 表格与代码块放不进 320px，且 `chat-markdown` 的 `code`/`pre` 本来就画在 `background.neutral` 上，再铺一层会把代码块吃掉。改这两条前先回到这一段。
- 流式草稿与已完成回答走同一条路径（都经 `<ChatMarkdown>`）。

## 工具四态（course §2）

`ToolActivity = { kind: 'search'|'read'|'listTags'; phase: 'input-streaming'|'input-available'|'output-available'|'output-error'; count? }`。`fullStream` 事件映射：`tool-input-start`→input-streaming（灰「准备检索」）/ `tool-call`→input-available（「正在检索…」）/ `tool-result`→output-available（search 出「已检索 N 条」）/ `tool-error`→output-error（友好文案）。`chat-message-item.tsx` 的 `activityLabel(kind, phase)` 选 i18n（`chat.toolThinking`/`toolSearching`/`toolSearched`/`toolReading`/`toolListingTags`/`toolError`）。

## 约定

- 只读纪律（2026-07 收窄）：检索工具层对知识库表仅 SELECT；chat 唯一写入是 `lib/chat/history.ts` 落自有表 `chat_conversations`（会话持久化），不触碰任何知识库表。
- i18n：`chat.*` 命名空间，`nav.chat` 顶层导航项；组件内 `const { t } = useTranslation();`，禁 CJK 硬编码。子组件各自 `useTranslation()`，不从父组件透传 `t`。
- 结构契约（`chat-view.test.tsx` 9 例）：单 h1、nav/log/composer 三分且各带 `data-slot`、tool activity 是 live status、loading 三态、Drawer 焦点归还与 Escape、激活会话不嵌套删除键、composer 键盘/IME、rail 折叠 320↔96、消息列表有真实滚动容器。**改选择器要连着改断言，不许删用例。**
- happy-dom 的 `Node.contains()` 对 `<form>` 的后代一律返回 `false`；composer 的包含关系只能用后代选择器断言。
