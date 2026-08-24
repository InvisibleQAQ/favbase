# lib/chat

Chat（Agentic RAG 知识库助手）平台无关 lib 层，供 app.html `sections/chat` 消费。

## 当前状态（P1 + P2 + P3 + P4 + P5）

`config.ts`（LLM 解析）+ `retrieval.ts` / `rrf.ts` / `types.ts`（Hybrid 检索核心）+ `tools.ts` / `prompts.ts` / `agent.ts`（agent 循环 + 工具）+ `history.ts`（多会话持久化，PGlite `chat_conversations`）已落地。

## 读写铁律（2026-07 收窄）

chat 检索面（`retrieval.ts` / `tools.ts` / `agent.ts`）对知识库表**只读**——只发 `SELECT` / `db.execute(sql\`SELECT ...\`)`，绝不 insert/update/delete/DDL。唯一写入是 `history.ts` 落 chat 自有表 `chat_conversations`（会话持久化，见下），不触碰任何知识库表。

## 模块结构

- `config.ts` — chat LLM 解析。`resolveChatModel(settings: UserSettings): { enabled: true; model: LanguageModel } | { enabled: false }`。**复用主 LLM 配置**：`deriveLlmDraft(settings)`（`lib/hooks/useSettings`）→ `createLanguageModel(...)`（`@/lib/ai`），不新增设置 UI。`enabled = !!apiKey`（活动 provider 无 key 即 false，供 view 渲染空态）。纯派生，无存储副作用、无硬编码 key。
- `types.ts` — 检索共享契约：`FusedHit`/`RrfOptions`、`RetrievalItem`（`{ id, title, url, platform }`——来源卡片直接开 `url`，无 item 级内部详情路由，故不带 platform-native id）、`RetrievalHit`（`{ chunkId, chunkText, score, item }`）、`HybridRetrieveOptions`（`topK`/`minScore`/`platform`/`tagId`）、`RetrievalDeps`（注入 `embedQuery`，测试免网络）。
- `rrf.ts` — `reciprocalRankFusion(lists: string[][], opts?: { k?, topK? }): FusedHit[]` 纯函数（零 IO，可单测）。`score = Σ 1/(k+rank)`，**只用排名不用原始分**（融合 cosine 与 word_similarity 两种不同量纲的健壮之道），k 默认 60；列表内同 id 只计首次；`score DESC` + `id ASC` 确定序；`topK` 截断。
- `retrieval.ts` — `hybridRetrieve(db, query, opts?, deps?): Promise<RetrievalHit[]>`。两臂并行：
  - **语义臂** = `embedQuery(query)`（默认 `getEmbeddingSettings`→`createEmbeddingModel`→`embedText`，与索引期同模型保证维度一致；`@/lib/embedding/config` **懒加载** 避免把 WXT storage 拖进模块图）→ `semanticSearchChunks`。未配置 embedding（`embedQuery` 返回 `null`）或**维度漂移**（`EmbeddingDimensionError`）时静默降级为仅关键词臂，绝不抛。
  - **关键词臂** = `item_chunks.chunk_text` 上 `ILIKE '%'||escapeLike(q)||'%' ESCAPE '\'`（GIN `gin_trgm_ops` 加速的精确子串召回）+ `ORDER BY word_similarity(q, chunk_text) DESC`（排名）。
  - RRF 融合两臂 chunkId 排名 → topK → 回连 `items`（`platform`/`tagId` 过滤在 SQL 里，且在 RRF 截断**之前**，严格过滤不会被全局 topK 饿死）。空白 query / 无候选 → `[]`。

## 关键词臂的 PGlite 约束结论（已代码验证，见 research/retrieval-design.md）

- `pg_trgm` **已装且可用**：`lib/database/migrations/v001-init.ts:7` `CREATE EXTENSION` + `:130/:131` 两个 `gin_trgm_ops` GIN 索引。`similarity()` / `word_similarity()` / `%` / `ILIKE` 实测全部可用。
- **无** `tsvector` / 中文分词（`zhparser`/`pgroonga`）——故关键词臂只能 trigram/ILIKE，**非** BM25。
- 排名用 `word_similarity` 而非 `similarity()`：实测短 query 对长 CJK chunk，`similarity('…机器学习…','机器学习')=0.105`（弱）vs `word_similarity=0.4`（对，非对称最佳子串匹配）。二者皆 pg_trgm 函数，`word_similarity` 是本场景技术正解（对 prd「优先 similarity」的有据偏离）。

## Agent 循环 + 工具（P3）

- `tools.ts` — AI SDK v6 `tool()` 定义，纯对象 registry `chatTools = { searchKnowledgeBase, getItemContent, listTags }`（**key 即模型看到的 tool 名**，prompt/描述用同名交叉引用）。DB handle 经 `streamText` 的 `experimental_context` 注入，tool `execute(input, { experimental_context })` 里 `contextDb(...)` 取 `db`（缺则抛，`ChatToolContext` 契约共享给 `agent.ts`）。**全部只读**（SELECT）。inputSchema 遵循 course 规则：`.describe()` 放 `z.object(...)` 链尾、`platform` 用 `z.enum(COLLECTION_PLATFORMS)`、字段 snake_case、返回把关键字段拍平到顶层。
  - `searchKnowledgeBase`：包 `hybridRetrieve`。字段 `query`(必填) / `platform`?(enum) / `tag_id`? / `top_k`?(默认 8)。返回 `{ count, results: [{ item_id, title, url, platform, chunk_text, score }] }`。描述强制"回答收藏内容问题前必须先调用"。
  - `getItemContent`：字段 `item_id`(来自 search 结果)。`db.select(itemContents.plainText).where(eq(itemContents.itemId, id))`，返回 `{ found, item_id, content }`。
  - `listTags`：包 `getAllUsedTags(platform?)`。字段 `platform`?(enum)。返回 `{ count, tags: [{ id, name, count }] }`；tagging facade 在 `execute` 内延迟导入，保证 `chatTools`/Agent Bridge registry 的模块加载不触碰 WXT storage 或 `chrome.runtime`。
- `prompts.ts` — 契约式（非人设）system prompt。稳定前缀 `CHAT_SYSTEM_PROMPT`（7 条硬规则：须先检索/基于结果作答并标注来源/无结果如实说/不足则追问/只读边界/不臆造/Markdown 输出，原生 tool-calling **不叠加** "Thought:" 文本模板）+ 动态后缀 `buildContextSuffix({ now })`（注入当天 ISO 日期，模型不知"今天"）。prompt 是模型指令非 UI 文案，含中文合规（i18n 守卫只扫 `entrypoints/**`）。
- `agent.ts` — `createChatStream({ model, messages: ModelMessage[], db, now, abortSignal? })` 包 `streamText({ model, system: prefix+suffix, messages, tools: chatTools, stopWhen: stepCountIs(8), temperature: 0.3, experimental_context: { db }, abortSignal })`。**必须显式 `stopWhen: stepCountIs(8)`**（v6 默认 `stepCountIs(1)` 单步陷阱）。返回 `StreamTextResult` 供 hook 消费 `fullStream`。

## 多会话持久化（P4，2026-07 迁至 PGlite）

- `conversation-runtime.ts` — Conversation 异步运行所有权 Module，也是并发测试 Surface。对外提供不可变 snapshot + `subscribe` 以及 load/new/switch/delete/send/stop 命令；单调 generation 让 stale load/stream/catch/finally 无权提交，stream 的 Conversation id、model messages、draft 与 sources 都是 run-local 快照。主动 `stop` 不撤销 owner，故 partial answer 仍折回原 Conversation；switch/new/active-delete 才撤权并 abort。持久化只接收捕获的 `ChatConversation`，同 id 的 save/delete 经 mutation lane 串行，delete tombstone 保证删除是最终 mutation。生产 Store Adapter 复用 `history.ts` + `initDbProxy()`，LLM Adapter 懒加载 `agent.ts`，避免纯 ownership 测试触发 WXT storage 模块图。

- `history.ts` — 会话 CRUD over PGlite `chat_conversations` 表（每会话一行，`model_messages` jsonb **全量**存储；entity 见 `lib/database/entities/chat-conversations.ts`，迁移 v005）。CRUD 显式 `db: FavbaseDb` 首参（镜像 `retrieval.ts` 仓库模式，亦是 in-memory PGlite 测试的前提）。
  - `ChatConversation = { id: string; title: string; modelMessages: ModelMessage[]; createdAt: number; updatedAt: number }`（域类型不变，时间戳 ms epoch number；行映射 `rowToConversation` 做 timestamptz Date ↔ number 转换）。**持久 `modelMessages`（模型态，含 tool-call/tool-result 轮次）为唯一事实源**——display 气泡 + 每条 assistant 的来源卡片都在加载时由 `conversation-runtime.ts` 重建。`id` 用 `crypto.randomUUID()`（app.html 可用）。
  - CRUD：`listConversations(db)`（`updatedAt` 降序）/ `loadConversation(db, id)` / `saveConversation(db, conv)`（`onConflictDoUpdate` upsert，**不 trim 存全量**——滑窗职责移到喂模型处；update 路径 v001 `updated_at` 触发器刷新时间戳）/ `createConversation()`（新空会话，未落盘）/ `deleteConversation(db, id)`。
  - `deriveTitle(modelMessages)` — 从首条 user 消息取文本、折叠空白、截断 40 字（`modelMessageText` 兼容 string / text-part 数组两种 content）。
  - `trimMessages(messages, max=MAX_MESSAGES=40)` — 滑动窗口：取末 `max` 条后**丢弃开头非 user 消息**，使窗口从 user 轮开始，避免模型看到孤立的 tool-result 脱离其 tool-call（部分 provider 会拒绝）。**调用点在 `use-chat-agent.send` 喂 `createChatStream` 前**（模型上下文预算），存储层不裁剪。
- 来源卡片跳转策略、tool-call 四态富渲染见 `sections/chat/CLAUDE.md`。

## 测试

- `conversation-runtime.test.ts` — fake Conversation Store/stream Adapter 的确定性并发契约：load 乱序、stale stream 不串写、旧 finally 不清新运行、save/delete 最终顺序、主动 stop 在有 partial answer 或首 token 前都保留并持久化当前 Conversation。
- `rrf.test.ts` — 纯函数：空输入 / 单列表 1/(k+rank) / 多列表重叠累加 / 分数并列 id 升序 / k 影响 / topK 截断 / 列表内重复 id 只计首次。
- `retrieval.test.ts` — in-memory PGlite（`PGlite.create` + vector/uuid_ossp/pg_trgm + `runMigrations`，同 `vector-store.test.ts` 搭法）：blank query→[] / 仅关键词臂（`embedQuery`→null）/ 两臂融合（注入 oneHot 向量 + minScore，双臂命中 chunk 居首）/ 维度不匹配降级不抛 / 平台过滤 / 标签过滤 / 无匹配→[] / 不选非命中 chunk。所有测试注入 `embedQuery`，故 storage 不入图、无需 mock。
- `tools.test.ts` — `vi.mock('./retrieval')` + `vi.mock('@/lib/tagging')`（免网络），`getItemContent` 走真 in-memory PGlite：search 拍平结构 + 过滤透传 + top_k 默认 8 + platform enum 约束（`inputSchema.safeParse`）；getItemContent 命中/缺失；listTags 拍平 + 参数透传。经 fake `ToolExecutionOptions`（`experimental_context: { db }`）调 `execute`。
- `prompts.test.ts` — `buildContextSuffix` 含注入 ISO 日期且随日期变化；`CHAT_SYSTEM_PROMPT` 含 `searchKnowledgeBase` 及"来源/没找到/只读/追问"关键硬规则词。
- `history.test.ts` — CRUD 走真 in-memory PGlite（同 `retrieval.test.ts` 搭法：`PGlite.create` + vector/uuid_ossp/pg_trgm + `runMigrations`，无任何 storage/proxy mock）：空态 / save+load 时间戳往返 / **save 不 trim（>MAX_MESSAGES 全量存取）** / upsert 不重复 / 降序 list / delete + 纯函数 `deriveTitle`（首 user 消息 / 折叠空白 / 截断 / 无 user→'' / text-part 数组）+ `trimMessages`（cap 内不动 / 超 cap 取末段且首条为 user / 丢弃开头孤立 tool-result）。
