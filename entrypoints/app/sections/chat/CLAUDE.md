# sections/chat

app.html 一级 **Chat** 页面：对话式知识库助手（Agentic RAG，只读 PGlite）。与 Collections 平行的顶层导航。

## 当前状态（P1 + P2 + P3 + P4 + P5）

多步 tool-calling agent 循环 + token 流式 + 来源卡片 + 工具四态 + 多会话持久化 + assistant markdown 渲染已打通：提问 → agent 调 `searchKnowledgeBase` 等工具检索本地知识库 → 流式渲染回答（markdown）+ 命中项来源卡片，会话持久到 PGlite `chat_conversations` 表跨刷新恢复（存全量模型态，滑窗只在喂模型处）。

## 模块结构

- `use-chat-agent.ts` — `ConversationRuntime` 的 React Adapter。只负责读取 `useSettings`、解析当前 LLM、以 `useSyncExternalStore` 订阅不可变 snapshot，并把 `{ send, stop, newConversation, switchConversation, deleteConversation }` 命令转发给 runtime；mount 调 `loadInitial()`，cleanup 调 `cancelPending()`。Conversation 模型态、展示态、stream/tool/source 状态、会话切换和持久化不再由 hook refs 协调。
- `chat-view.tsx` — 页面主视图：`<DashboardContent maxWidth="xl">` 在剩余视口内承载一个 outlined `Paper` 工作区，不再嵌套主 Card。`ChatView` 只连接 `useChatAgent`，受控 UI 导出为 `ChatWorkspace`，便于用真实状态覆盖响应式和键盘契约。桌面两栏为固定 `248px` 会话 rail + 弹性聊天区；消息日志独立滚动，composer 固定在聊天区底部，避免长对话挤出视口。assistant 回答宽幅无框，user 保留紧凑右侧气泡。**响应式收起**：< lg 时 rail 隐藏，标题历史按钮（`chat.openHistory`）打开临时 `Drawer`，避免在窄桌面同时挤入全局 nav 与 Conversation rail；在 `md+`，Drawer paper 的 `left` 跟随 `--layout-nav-vertical-width`（展开 300px / 收起 88px，值由 `layouts/dashboard/css-vars.ts` 拥有），且层级高于全局 nav，避免两个 sidebar 互相覆盖。Drawer 有显式关闭按钮，选中/新建后自动关闭，跨回 lg+ 时 effect 清理 Modal 状态。关闭动画期间禁用 MUI 过早的自动焦点回退：Modal 清理前先释放 Drawer 内焦点，清除 `#root[aria-hidden]` 后再恢复标题历史按钮；跨回 lg+ 时跳过恢复，避免聚焦已隐藏控件。会话 nav、消息 log、composer 和 user/assistant 消息均有命名语义，active 会话用 `aria-current`，删除按钮的 accessible name 包含目标 Conversation 标题。三态明确分离：`loading` 不显示 composer；未配置显示 `chat.llmNotConfigured`；就绪态显示消息/空态与 composer。composer 保留 **Enter 发送；Ctrl/⌘+Enter 在光标处插 `\n`；Shift+Enter 默认换行；IME composing Enter 不发送**。删除仍是一击删除，不改变既有行为契约。assistant 内容（已完成与流式草稿）统一走 `<ChatMarkdown>`。测试见 `chat-view.test.tsx`，覆盖状态语义、移动 Drawer 焦点生命周期、键盘、IME、active 会话和删除目标。
- `chat-markdown.tsx` — `ChatMarkdown`：assistant 回答的轻量 markdown 渲染器。包 `react-markdown` + `remark-gfm`（表格/删除线/任务列表），`components` 用 MUI + `theme.vars.*` token 定制（`a` 新标签打开 + primary 色、inline `code`/`pre` 代码块浅底圆角 + `overflow-x:auto`、`ul/ol/li/p/h1-h4/blockquote/table/hr` 合理间距，禁硬编码色，暗色模式成立）。`memo` 包裹（流式逐 token re-render 友好）。**安全默认**：不启用 `rehype-raw`——原始 HTML 一律转义为文本（react-markdown 默认行为），LLM 输出无法注入 DOM/XSS。测试 `chat-markdown.test.tsx` 用 `react-dom/server` `renderToStaticMarkup`（无需 RTL）验证 bold/列表/代码块/链接 target/GFM 表格/HTML 转义。
- `source-card.tsx` — `SourceCards`：assistant 回合命中的收藏项来源卡片（按 `itemId` 去重），以命名 `ul/li` 两列响应式紧凑网格呈现；每项复用平台 registry 的图标/标题，并显示匹配分数。**点击策略（诚实）**：知识库无任何 item 级内部详情路由——`/collections/bilibili/:mediaId` 与 `/collections/bookmarks/:folderId` 都是**文件夹**路由非 item 路由，且检索工具只回 `url`（不回 platform-native item id），故一律 `window.open(url, '_blank', 'noopener,noreferrer')` 打开原始来源。测试见 `source-card.test.tsx`，锁定列表语义、去重和安全打开参数。

## 工具四态（course §2）

`ToolActivity = { kind: 'search'|'read'|'listTags'; phase: 'input-streaming'|'input-available'|'output-available'|'output-error'; count? }`。`fullStream` 事件映射：`tool-input-start`→input-streaming（灰"准备检索"）/ `tool-call`→input-available（"正在检索…"）/ `tool-result`→output-available（search 出"已检索 N 条"）/ `tool-error`→output-error（友好文案）。`chat-view` 的 `activityLabel(kind,phase)` 选 i18n（`chat.toolThinking`/`toolSearching`/`toolSearched`/`toolReading`/`toolListingTags`/`toolError`）。

## 约定

- 只读纪律（2026-07 收窄）：检索工具层对知识库表仅 SELECT；chat 唯一写入是 `lib/chat/history.ts` 落自有表 `chat_conversations`（会话持久化），不触碰任何知识库表。
- i18n：`chat.*` 命名空间，`nav.chat` 顶层导航项；组件内 `const { t } = useTranslation();`，禁 CJK 硬编码。
