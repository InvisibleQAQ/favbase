# Tagging 领域层

AI 标签：转录/收藏同步完成后自动打标 + 标签 CRUD（UI 消费）。深模块，tags/item_tags schema 知识的唯一持有者。依赖 `lib/ai`（createLanguageModel）+ `lib/database`（Drizzle RPC proxy）。LLM 管线首个落地场景（`generateObject` 用法为后续 LLM 总结铺路）。

## 模块结构

- `config.ts` — `resolveTaggingConfig(settings)` 纯函数（镜像 `resolveEmbeddingConfig`）：`UserSettings` → `{ providerId, apiKey, model, customBaseUrl?, customProtocol?, enabled }`。**无开关**：`enabled` 派生自 apiKey+model 可解析（用户填写 > env > provider def），未配置时钩子静默 no-op。`getTaggingConfig()` 异步便利（非 React 消费者用）
- `prompt.ts` — `TaggingInput { title, author?, description?, content? }`：**内容类型无关 DTO，禁止 import 平台类型**——未来文章/GitHub 仓库直接复用。`buildTaggingPrompt(input, existingTags)` 纯函数（hamhome 式防重指令：优先复用已有标签、不生成语义重复新标签）。常量：MAX_TAGS=5 / MAX_CONTENT_CHARS=2000（正文截头）/ MAX_EXISTING_TAGS=50（喂 prompt 上限）。**JSON 字样是硬约束不可删**：openai-compatible provider 走 `response_format: json_object`，OpenAI 规范要求 prompt 必须含 "json" 否则 400；且该模式下 Zod schema 不发给模型，输出结构 `{"tags": [...]}` 只能靠 prompt 传达（system prompt + 要求第 5 条，`tagging.test.ts` 有防回归断言）
- `tagger.ts` — `generateTags(config, input, existingTags)`：按 `supportsSchemaDelivery(providerId, customProtocol)`（`lib/ai`）能力分叉——true（openai/claude/gemini/openrouter/custom+claude）走 `generateObject({schema: tagsSchema})`（schema 真正下发）；false（deepseek/zhipu/kimi/modelscope/custom+openai）走 `generateObject({output:'no-schema'})` + `tagsSchema.parse` 客户端校验（schema 为 null 消除 SDK responseFormat 警告，请求体仍 `response_format: json_object`，prompt 是唯一 schema 载体）。Zod schema `tags: z.array(z.string()).max(5)`，温度 0.2。抛错不吞（失败语义由 service 层决定；no-schema 路径非法结构抛 ZodError，同语义）。`normalizeTags(raw)`：trim + Set 去重 + 截 5，prompt 规则之外的代码层兜底
- `tagging-service.ts` — 核心服务，全部以 (platform, platformItemId) 寻址（调用方不接触 DB uuid）：
  - `tagPlatformItem(platform, platformItemId, deps?)` → `'tagged'|'skipped'|'failed'`：管线入口，**never throws**（fire-and-forget 设计）。幂等检查（已有链接即 'skipped'——重复转录不重打）→ 取 item + item_contents.plainText → 已有标签喂 prompt → LLM → 落库（tag upsert by name + 链接 onConflictDoNothing，事务）→ 成功后 `emitDomainEvent('item-tagged', { platform, platformItemId })`（`lib/events`，UI 借此实时刷新；'skipped'/'failed' 不发）。失败只 console.error，item 保持无标签——**无重试、无关键词 fallback、无存量回填，均为有意决策**（宁缺毋滥，见任务 ADR）。`TaggingDeps { db, getConfig, generate }` 可注入测试（镜像 IndexingDeps DI 风格）
  - `tagNewItems(platform, platformItemIds, deps?, onProgress?, control?)` → `void`：串行逐条 `await tagPlatformItem`，继承 never-throws/幂等/未配置静默语义，单条失败不中断后续；每条 item 前执行 cooperative checkpoint，当前 LLM/DB 工作不中断。`onProgress({done,total})` 从 0 单调到输入总数，`skipped|failed` 同样推进。app 层共享 Tags lane 持有队列和暂停状态，lib 不 import store。
  - `getAllUsedTags(platform?, db?)` → `UsedTag[]`（含 count，降序）：`platform` 接受单个平台或平台数组；inner join item_tags——**孤儿 tag（链接全删）自然隐身，无需清理任务**；tag 行本身保留。传过滤值时列表与计数限定这些平台的 items（页面级筛选 chips，计数真实）；省略 = 全库（`tagPlatformItem` 内部喂 prompt 用全库——LLM 应跨平台复用标签名，不分叉重复）。`/collections` 必须传 `COLLECTION_PLATFORMS`，避免未知持久化平台的标签进入聚合筛选
  - `getTagsForPlatformItems(platform, ids, db?)` → `Record<platformItemId, TagRef[]>`：卡片页批量查询
  - `getItemsByTags(tagIds, platform?, db?)` → `TaggedItem[]`：**AND 语义**（group by item + having count(distinct tagId)=N，多选收窄），跨收藏夹（标签是知识库维度非文件夹维度），createdAt 降序。传 `platform` 时结果限定该平台（页面级标签网格）；省略 = 跨平台。`TaggedItem` 保留 `originalUrl` + `publishedAt`，平台卡片 adapter 不重新派生 URL/日期
  - `addTagToPlatformItem` / `removeTagFromPlatformItem` — 手动编辑：新名字自动建 tag（复用同名行），空白名/未知 item 返回 null；remove 只解链不删 tag 行
- `index.ts` — barrel，单一 import 面

## 约定

- **接缝枚举（均在 app.html/可读 storage 的 context）**：x/github/zhihu/youtube 的 `newItemIds` 批量 enqueue；bookmarks 每条提取成功后 enqueue；Bilibili 每条 durable transcription enqueue 并只让上游 await Embed ticket。六平台都经 `collection-processing-jobs.ts` 的独立串行 Tags lane 执行；lib/tagging 不反向依赖平台或 app store。
- UI 消费者走 service 高层操作，零 drizzle/entity/getDb 导入（同 `bili-sync-service` 约定）。标签 UI 集中在共享模块 `entrypoints/app/components/tags/`（platform 参数化，见该目录 CLAUDE.md）
- 存储：`tags`（name 全局唯一，单用户无 userId）+ `item_tags`（复合 PK，双 FK cascade），schema 在 `lib/database/entities/`，迁移 `v004-tags.ts`。新表不受 insert-only ADR 约束，但打标幂等（upsert + onConflictDoNothing）
- 测试：`tagging.test.ts` 纯函数（config 解析/prompt 构建/normalizeTags）+ `generateTags` 能力分叉（`vi.hoisted` mock `ai` 的 `generateObject`，断言 no-schema/schema 参数与 Zod parse 兜底）；`tagging-service.test.ts` in-memory PGlite（同 `videos-sync.test.ts` 基建）+ 注入 `TaggingDeps`，覆盖幂等/同名复用/未配置静默/失败无残留/existingTags 与 content 传参/孤儿隐身/AND 筛选/`tagNewItems` 批量（逐条调用/空批 no-op/单条失败不中断/**onProgress 0/total→total 且 total=ids.length + 'skipped' 项亦进度**）/platform 过滤（单平台与平台数组计数限定、getItemsByTags 结果限定、originalUrl 透传）/手动编辑往返/'item-tagged' 事件（成功发一次、skip/fail 不发）。测试文件需 `vi.mock('@/lib/storage')`（barrel 加载时触碰 chrome.runtime）
