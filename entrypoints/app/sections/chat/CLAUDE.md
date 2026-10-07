# sections/chat

app.html 一级 Chat 页面：对话式知识库助手（Agentic RAG）。外壳是 Minimal 的 chat 卡片（会话 rail + header + 消息区）；agent 循环、检索与会话持久化在 `lib/chat/`（见 `lib/chat/CLAUDE.md`）。

## 约束

- 只读纪律：检索工具对知识库表只 SELECT；chat 唯一的写入是 `lib/chat/history.ts` 落自有表 `chat_conversations`，不碰任何知识库表。
- header 没有会话操作菜单：runtime 没有重命名能力，删除已在每个会话行上。别照 Minimal 补一个 `CustomPopover` 菜单。
- 卡片高度由 `chat-view.tsx` 显式给（`100dvh` 减 header），不能照 Minimal 只写 `flex: 1 1 0`：dashboard main 不是受限高度的 flex 列。
- 上面那两档 header 高度必须按 `DASHBOARD_LAYOUT_QUERY` 切换，不写字面量断点：它与 dashboard Header 是同一个常量，写字面量会在两者之间漏出一段宽度。
- 会话 rail 保持 `minHeight: 0` + `flex: '1 1 auto'` 且无底色（同 Minimal）：缺了 flex，rail 只有内容那么高，会话多了也不滚。
- `< lg` 的历史 Drawer 持有退出焦点契约（`.trellis/spec/frontend/ui-design-system.md` §12）：显式 refs + `disableRestoreFocus` + 退出时 blur 后代 + transition `onExited` 归还 trigger；禁止手改 `aria-hidden` / `inert`。
- Drawer 的 paper 不加 `left` 偏移：它存在的宽度里没有 dashboard rail。
- 会话行的删除 `IconButton` 与 `ListItemButton` 是同级，不得嵌套；头像首字按码点切，不按 UTF-16 单元。
- 激活会话行用 8% 主色洗底而不是 Minimal 的 `action.selected`，是刻意偏离（docs/25 Step 9）。
- composer 是 `minHeight` 不是固定 `height`（多行输入会撑高），发送/停止按钮留在行内。
- composer 键盘契约：Enter 发送 / Shift+Enter 换行 / Ctrl·⌘+Enter 插入换行 / IME composing 期间的 Enter 不发送。
- `chat-markdown.tsx` 不启用 `rehype-raw`：模型输出里的原始 HTML 一律转义，这是 XSS 防线。
- 子组件各自 `useTranslation()`，不从父组件透传 `t`；文案在 `chat.*` 命名空间。
- 页面 h1 在 `chat-header.tsx`，全页唯一。
- `chat-view.test.tsx` 锁结构契约（单 h1、nav / log / composer 三分及各自的 `data-slot`、Drawer 焦点、键盘/IME、rail 折叠）：改选择器要连着改断言，不许删用例。
- `data-slot="chat-header"` 还被 `docs/ui-baseline/app-runtime-check.mjs` 用来找历史触发按钮，改它要同步那处选择器。

### 气泡规则

- 用户提问吃 Minimal 气泡（`maxWidth 320` + 16% 主色洗底），永远是 plain text。
- 助手回答不进气泡：铺满 `CHAT_READING_WIDTH` 阅读轨道，无底色无边框（用户决定，docs/25 Step 9）。别改回 Minimal 的 320px + `background.neutral`：markdown 表格与代码块放不进 320px，且 `chat-markdown` 的 `code` / `pre` 本来就画在 `background.neutral` 上，再铺一层会把代码块吃掉。
- 流式草稿与已完成回答走同一条渲染路径，都经 `ChatMarkdown`。

### 工具四态

- `ToolActivity.phase` 四态是 `input-streaming` / `input-available` / `output-available` / `output-error`，由 `lib/chat/conversation-runtime.ts` 从 `fullStream` 事件映射。
- 选文案只在 `chat-message-item.tsx` 的 `activityLabel` 一处（`chat.tool*` 键）；渲染必须是 `role="status"` 的 live region（`data-slot="tool-activity"`）。

### 来源卡片跳转策略

- 来源卡片一律在新标签打开条目的原始 `url`：没有任何平台有条目级内部路由（`/collections/bilibili/:mediaId`、`/collections/bookmarks/:folderId` 是夹路由），检索工具也只给出 `url`。

## 坑

- happy-dom 的 `Node.contains()` 对 `<form>` 的后代一律返回 `false`；composer 的包含关系只能用后代选择器断言。
