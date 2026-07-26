# sections/chat

app.html 一级 **Chat** 页面：对话式知识库助手（Agentic RAG，只读 PGlite）。与 Collections 平行的顶层导航。

## 当前状态（P1 + P2 + P3 + P4 + P5）

多步 tool-calling agent 循环 + token 流式 + 来源卡片 + 工具四态 + 多会话持久化 + assistant markdown 渲染已打通：提问 → agent 调 `searchKnowledgeBase` 等工具检索本地知识库 → 流式渲染回答（markdown）+ 命中项来源卡片，会话持久到 WXT storage 跨刷新恢复。

## 模块结构

- `use-chat-agent.ts` — 流式驱动 hook。持有两份对话：模型态 `modelMessagesRef`（`ModelMessage[]`，喂 `createChatStream`，含 tool call/result 轮次）+ 展示态 `messages`（`{id,role,content,sources?}` 气泡）。`send`：`resolveChatModel(settings)` 未配置置 `not-configured`；首条消息 lazily `createConversation()` 拿 `crypto.randomUUID` id；append user → `await initDbProxy()` → `createChatStream({ model, messages, db, now, abortSignal })` → 消费 `result.fullStream`（`text-delta` 累加草稿 / `tool-input-start`·`tool-call`·`tool-result`·`tool-error` 驱动**四态** `ToolActivity` / `searchKnowledgeBase` 的 result 抽到 `turnSourcesRef` 累积来源 / `error` 抛）→ 结束把 `(await result.response).messages` 合并回模型态 + 附去重来源到 assistant 气泡 + `saveConversation` 持久化。`stop` 经 `AbortController` 中止（abort 不算错误，保留草稿并折进模型态一并持久化）。错误分类 `network`/`generic` 供 UI 选 i18n。**多会话**：mount 载入最近会话（`listConversations`→重建 display 消息 + 来源，`rebuildDisplayMessages` 从 `modelMessages` 逐轮拼 assistant 文本 + 从 `tool` 消息 `tool-result` parts 提取 searchKnowledgeBase results；`unwrapToolOutput` 兼容持久态 `{type:'json',value}` 与实时 raw output 两种壳）。导出 `{ messages, streamingText, toolActivity, status, errorKind, isStreaming, configured, loading, send, stop, conversations, activeConversationId, newConversation, switchConversation, deleteConversation }`。切换/删除会话先 `stop` 当前流。
- `chat-view.tsx` — 页面主视图：`<DashboardContent maxWidth="lg">` + 标题行（`/icon/128.png` 32px logo + `chat.title` + 窄屏历史 IconButton）+ **两栏 Grid**（左 `md:3` 会话 rail + 右 `md:9` 聊天 Card）。**响应式收起**：< md 时左栏 `display:none`，标题行历史按钮（`chat.openHistory`）唤出左侧临时 `Drawer`（width 300，选中/新建后自动关闭；视口跨回 md+ 时 effect 自动关闭，避免 CSS 隐藏 open Modal 遗留 body 滚动锁 + 焦点陷阱）；`ConversationRail` 是纯内容组件（新对话按钮 + 会话列表），宽屏包 Card、窄屏包 Drawer paper，零复制。会话行：title + `formatDateTime` 时间 + 删除 IconButton，active 项 primary 淡底；空态 `chat.noConversations`。右 Card：消息气泡列表（user 右对齐 primary 淡色、assistant 左对齐 neutral 底，assistant 气泡下挂 `SourceCards`）+ 流式草稿气泡（含四态 `activityLabel` caption + pending spinner）+ 空态中央 56px logo + `chat.emptyHint` + composer（多行，**Enter 发送；Ctrl/⌘+Enter 手动在光标处插 `\n` 换行，Shift+Enter 走默认换行；`e.nativeEvent.isComposing` 时 Enter 不发送防 IME 选词误发**）+ 发送/停止切换。**消息渲染分叉**：user 气泡纯文本（`whiteSpace:'pre-wrap'`），assistant 气泡（已完成 + 流式草稿）走 `<ChatMarkdown>`。三态：`loading` / 未配置（`chat.llmNotConfigured`）/ error。样式遵循 ui-design-system（`theme.vars.*` + `varAlpha`，禁硬编码色）。
- `chat-markdown.tsx` — `ChatMarkdown`：assistant 回答的轻量 markdown 渲染器。包 `react-markdown` + `remark-gfm`（表格/删除线/任务列表），`components` 用 MUI + `theme.vars.*` token 定制（`a` 新标签打开 + primary 色、inline `code`/`pre` 代码块浅底圆角 + `overflow-x:auto`、`ul/ol/li/p/h1-h4/blockquote/table/hr` 合理间距，禁硬编码色，暗色模式成立）。`memo` 包裹（流式逐 token re-render 友好）。**安全默认**：不启用 `rehype-raw`——原始 HTML 一律转义为文本（react-markdown 默认行为），LLM 输出无法注入 DOM/XSS。测试 `chat-markdown.test.tsx` 用 `react-dom/server` `renderToStaticMarkup`（无需 RTL）验证 bold/列表/代码块/链接 target/GFM 表格/HTML 转义。
- `source-card.tsx` — `SourceCards`：assistant 回合命中的收藏项来源卡片（按 `itemId` 去重）。每卡 = 平台图标（复用 `collectionPlatformRegistry` 的 `icon`/`title`，`isCollectionPlatform` 守卫）+ title + 平台名·score caption。**点击策略（诚实）**：知识库无任何 item 级内部详情路由——`/collections/bilibili/:mediaId` 与 `/collections/bookmarks/:folderId` 都是**文件夹**路由非 item 路由，且检索工具只回 `url`（不回 platform-native item id），故所有卡片一律 `window.open(url, '_blank', 'noopener,noreferrer')` 打开原始来源，不做内部 react-router 跳转。

## 工具四态（course §2）

`ToolActivity = { kind: 'search'|'read'|'listTags'; phase: 'input-streaming'|'input-available'|'output-available'|'output-error'; count? }`。`fullStream` 事件映射：`tool-input-start`→input-streaming（灰"准备检索"）/ `tool-call`→input-available（"正在检索…"）/ `tool-result`→output-available（search 出"已检索 N 条"）/ `tool-error`→output-error（友好文案）。`chat-view` 的 `activityLabel(kind,phase)` 选 i18n（`chat.toolThinking`/`toolSearching`/`toolSearched`/`toolReading`/`toolListingTags`/`toolError`）。

## 约定

- 只读纪律：tool 层仅 SELECT，全程不写 PGlite。
- i18n：`chat.*` 命名空间，`nav.chat` 顶层导航项；组件内 `const { t } = useTranslation();`，禁 CJK 硬编码。
