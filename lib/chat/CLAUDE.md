# lib/chat

Chat（Agentic RAG 知识库助手）的平台无关 lib：hybrid 检索、Knowledge Tool、agent 循环、多会话持久化。app.html 的 `sections/chat` 与 Background 的 Agent Bridge 都消费它。

## 约束

- 检索面（`retrieval.ts` / `tools.ts` / `agent.ts`）对知识库表只读：只发 `SELECT`。唯一写入是 `history.ts` 写 chat 自有表 `chat_conversations`（`docs/adr/0001`）。
- Chat 与 Agent Bridge 共用同一套 Knowledge Tool（`chatTools`），任何一边都不得有另一边没有的工具（`CONTEXT.md` Relationships）。`chatTools` 的 key 就是模型看到的工具名。
- 读写函数显式吃 `db`，工具经 `experimental_context` 取（`contextDb`），不调 `getDb()`：Agent Bridge 在 SW 里注入只读 proxy，测试注入内存 PGlite。
- 新工具的 inputSchema：`.describe()` 放 `z.object(...)` 链尾、字段 snake_case、`platform` 用 `z.enum(COLLECTION_PLATFORMS)`、返回值把关键字段拍平到顶层。
- Chat 复用主 LLM 配置（`config.ts`），刻意不设独立的 chat provider 设置。
- prompt 走原生 tool-calling，不叠加 `Thought:/Action:` 文本模板。prompt 是模型指令不是 UI 文案，中文不走 i18n。

## Service Worker 可达（`tools.ts` / `retrieval.ts` 被 Agent Bridge tool registry 静态加载）

- 禁止动态 `import()`：HTML 规范不许 `ServiceWorkerGlobalScope` 用它，Chrome 直接 reject，Vite 的 preload 包装又把它报成误导性的 `window is not defined` / `document is not defined`。所有依赖一律静态 import。
- 只走 leaf、不走 barrel：`@/lib/database/schema`、`@/lib/collections/processing-coverage` 与 `configuration-blockers`、`@/lib/storage/settings` 与 `resolve`、`@/lib/tagging/tag-queries`。database / collections barrel 会把 PGlite 打进 `background.js`。
- 这类错误 `pnpm test` 全绿、`pnpm build` 才炸。守卫：`tests/agent-bridge-background-bundle-contract.test.ts`（源码层）、`scripts/check-background-bundle.mjs`（产物层）。
- `conversation-runtime.ts` 对 `./agent` 的动态 import 是刻意的（纯所有权测试不该加载 WXT storage 模块图）；它只跑在 app.html，不得进入 SW 可达图。

## 模型可见面

- 平台清单与 content kind 清单一律派生（`PLATFORM_LIST`、`CONTENT_KIND_LIST`、`CHAT_SYSTEM_PROMPT`），不得手写：手写清单会让 zod enum 接受新平台、而文本仍只说旧的，模型永不按新平台过滤。
- 清单用平台 id 不用显示名：显示名是 `entrypoints/app/` 侧的 `LocaleKeys`，`lib/` 引不到。
- 工具的盲区（读不到的状态、刻意不做的能力、不可知的分母）必须写进 description / system prompt，并写明模型下一步该做什么；只写在代码注释里等于没写（`.trellis/spec/guides/silent-failure-thinking-guide.md` Gotcha 2）。
- 盲区守卫要从工具实际调用的函数派生再对账文本，不手写限制清单。模型面守卫全部放在 `tools.test.ts` 一个文件里，别拆到 `prompts.test.ts`。
- `top_k` 的范围与默认值只有 `tools.ts` 三个不导出常量一处事实源，zod 链与 describe 串都由它们拼。唯一手写副本是 SKILL.md 的 `--limit <1-20>`，由 `tests/agent-bridge-cli-aliases.test.ts` 对账。
- `retrieval.ts` 自己的 `DEFAULT_TOP_K` 是库默认值，模型看不到（工具总是显式传 `topK`）。
- `getItemContent` 的 `found`（有已提取正文）不得改义：已发布 CLI 捆绑的 SKILL.md 描述的就是它，扩展与 CLI 各自发版。新状态只能纯追加字段（如 `item_exists`）。
- `getItemContent` 收到非 uuid 的 id 时让 Postgres 抛错、工具报错，刻意不兜底。
- `getProcessingCoverage` 存在的理由：`searchKnowledgeBase` 的 `count: 0` 有三种成因（真没收藏 / 还在处理 / provider 没配所以永远不会处理），要给三种回答。
- `getProcessingCoverage` 的 `blockers` 走共享的 `deriveConfigurationBlockers`，与 Collection 页横幅同一条规则，别另写一份。

## 检索

- 关键词臂只能用 trigram + `ILIKE`：PGlite 没有 `tsvector` 与中文分词，做不了 BM25，别「升级」成全文检索。
- 关键词排名用 `word_similarity` 不用 `similarity()`：短 query 对长 CJK chunk，后者分数低到无法排序（实测 0.105 对 0.4）。
- RRF 只用排名不用原始分：cosine 与 `word_similarity` 量纲不同，别改成加权分数。
- `platform` / `tagId` 过滤写在 SQL 里、且在 RRF 截断之前，否则严格过滤会被全局 topK 饿死。
- 语义臂在未配置 embedding 或维度漂移（`EmbeddingDimensionError`）时静默降级为仅关键词臂，绝不抛。

## 会话

- `agent.ts` 必须显式传 `stopWhen: stepCountIs(N)`：AI SDK v6 默认 `stepCountIs(1)`，不设就是工具调用后不作答的单步。
- 持久化的 `modelMessages`（含 tool-call / tool-result 轮次）是唯一事实源；display 气泡与来源卡片在加载时由 `conversation-runtime.ts` 重建，不另存。
- `saveConversation` 存全量、不裁剪。滑窗 `trimMessages` 只在喂模型处调用（`conversation-runtime.ts`）。
- `trimMessages` 会丢弃窗口开头的非 user 消息：脱离 tool-call 的孤立 tool-result 会被部分 provider 拒绝。
- `conversation-runtime.ts` 是会话异步所有权的唯一 owner：单调 generation 让过期的 load / stream / finally 无权提交。
- 主动 `stop` 不撤销 owner，partial answer 仍折回原会话并持久化；switch / new / 删除当前会话才撤权并 abort。
- 同一会话的 save / delete 串行，delete tombstone 保证删除是最终 mutation。守卫：`conversation-runtime.test.ts`。

## 已知缺口

- `getProcessingCoverage` 的 `blockers` 不穷举：`asrBlocked` 恒为 `false`（ASR 阻塞的判据是 bilibili 状态机的 wait signal，这里拿不到），正文卡在未配置的转录 provider 上时它是空的。description 已写明，改动时不得删。
- `acquisition.total` 恒为 `null`（远端总数不可知），description 写明不得声称同步完整。
- 语义臂因维度漂移降级时（provider 已配置，查询向量与列维度不符）只在 SW console 打一条 warn，模型与外部 agent 都看不到：`blockers` 只抓得到「embedding provider 没配」那一种。`docs/27` Step 3 只剩这一项与 chunk 级计数未做。

## 指针

- 来源卡片跳转、tool-call 四态渲染：`entrypoints/app/sections/chat/CLAUDE.md`。
- Agent Bridge 的 tool registry 与协议：`lib/agent-bridge/CLAUDE.md`。
