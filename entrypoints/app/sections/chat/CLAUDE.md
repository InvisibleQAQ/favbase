# sections/chat

app.html 一级 **Chat** 页面：对话式知识库助手（Agentic RAG，只读 PGlite）。与 Collections 平行的顶层导航。

## 当前状态（P1 + P2 + P3 + P4 + P5 + Minimal v7 Phase 6）

多步 tool-calling agent 循环 + token 流式 + 来源卡片 + 工具四态 + 多会话持久化 + assistant markdown 渲染已打通：提问 → agent 调 `searchKnowledgeBase` 等工具检索本地知识库 → 流式渲染回答（markdown）+ 命中项来源卡片，会话持久到 PGlite `chat_conversations` 表跨刷新恢复（存全量模型态，滑窗只在喂模型处）。

## 模块结构

- `use-chat-agent.ts` — `ConversationRuntime` 的 React Adapter。只负责读取 `useSettings`、解析当前 LLM、以 `useSyncExternalStore` 订阅不可变 snapshot，并把 `{ send, stop, newConversation, switchConversation, deleteConversation }` 命令转发给 runtime；mount 调 `loadInitial()`，cleanup 调 `cancelPending()`。Conversation 模型态、展示态、stream/tool/source 状态、会话切换和持久化不再由 hook refs 协调。
- `chat-view.tsx` — 页面主视图：`<DashboardContent maxWidth="xl">` 在剩余视口内承载一个 outlined `Paper` 工作区，不再嵌套主 Card；路由标题为唯一 `h1`。`ChatView` 只连接 `useChatAgent`，受控 UI 导出为 `ChatWorkspace`。桌面两栏为固定 `264px` Conversation rail + 弹性聊天区；消息、error 和 composer 共用 760px 阅读轨道，日志独立滚动，composer 固定在聊天区底部。assistant 回答宽幅无框，user 气泡最大 88%/72%；tool activity 是独立 neutral 30px live status，source item 也消费 neutral/divider/action token。**响应式收起**：< lg 时 rail 隐藏，标题历史按钮打开临时 `Drawer`；paper 宽 `min(288px, 100vw - 32px)`，在 `md+` 的 left 跟随全局 nav 宽，390px 不横溢。Drawer 显式关闭、Escape、选中/新建后关闭和跨回 lg+ 清理保持；退出时仍先 blur modal descendant，Modal 清除根 `aria-hidden` 后再恢复 trigger，禁止手改 aria-hidden/inert。会话 nav、message log、composer 和 user/assistant message 均有命名语义与 `data-role`；active Conversation 用 `aria-current`。三态与 composer 键盘契约不变：**Enter 发送；Ctrl/⌘+Enter 插 `\n`；Shift+Enter 换行；IME composing Enter 不发送**。assistant（含流式草稿）只走 `<ChatMarkdown>`，user 永远 plain text。测试覆盖单 h1、分叉、tool live state、Drawer Escape/焦点生命周期、键盘/IME、active 会话和删除目标。
- `chat-markdown.tsx` — `ChatMarkdown`：assistant 回答的轻量 markdown 渲染器。包 `react-markdown` + `remark-gfm`（表格/删除线/任务列表），`components` 用 MUI + `theme.vars.*` token 定制（`a` 新标签打开 + accent 色、inline `code`/`pre` 代码块 neutral 底 + `overflow-x:auto`、table 外层横滚，禁硬编码色，暗色模式成立）。`memo` 包裹。**安全默认**：不启用 `rehype-raw`——原始 HTML 一律转义为文本。测试还直接喂未闭合 fenced code/link，锁定逐 token 流式时不抛错。
- `source-card.tsx` — `SourceCards`：assistant 回合命中的收藏项来源卡片，以命名 `ul/li` 两列响应式紧凑网格呈现；surface 统一为 6px compact row + divider + neutral 背景，hover 读 `action.hover`，不再自造弱 alpha border/background。点击仍一律安全打开原始来源，理由与路由边界不变。

## 工具四态（course §2）

`ToolActivity = { kind: 'search'|'read'|'listTags'; phase: 'input-streaming'|'input-available'|'output-available'|'output-error'; count? }`。`fullStream` 事件映射：`tool-input-start`→input-streaming（灰"准备检索"）/ `tool-call`→input-available（"正在检索…"）/ `tool-result`→output-available（search 出"已检索 N 条"）/ `tool-error`→output-error（友好文案）。`chat-view` 的 `activityLabel(kind,phase)` 选 i18n（`chat.toolThinking`/`toolSearching`/`toolSearched`/`toolReading`/`toolListingTags`/`toolError`）。

## 约定

- 只读纪律（2026-07 收窄）：检索工具层对知识库表仅 SELECT；chat 唯一写入是 `lib/chat/history.ts` 落自有表 `chat_conversations`（会话持久化），不触碰任何知识库表。
- i18n：`chat.*` 命名空间，`nav.chat` 顶层导航项；组件内 `const { t } = useTranslation();`，禁 CJK 硬编码。
