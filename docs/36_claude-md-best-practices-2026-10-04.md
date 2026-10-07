# CLAUDE.md 最佳实践：Anthropic 官方资料汇总与本仓库对照

> 2026-10-04。本文做两件事：汇总有出处的最佳实践，量出本仓库与它的差距。
> 调研部分不含整改方案；§9.4 列的是整改前要先定的事。整改已于 2026-10-06 落地，记录在 §12。方括号里的代号（如 `[D-mem]`）对应 §11 的来源清单。

## 0. 调研口径

- **档位**：search-master 标准档。开了官方资料、社区一手说法、公开网页三层；个人收藏层没开。
- **工具**：curl 直取官方文档的 `.md` 端点与博客 HTML；exa、anysearch 读论文和文章；bb 抓 X、HN、Reddit；gh 实测样本仓库。
- **失败的工具**：
  - archive.org 全部 429，旧工程博客 "Claude Code best practices" 的原始正文没拿到（该 URL 现已 308 重定向到文档页）。
  - 交叉核对用的子 agent 只拿到搜索摘要、没抓到整页，它的引文本文一条未采用。
  - bb 的 HN 线程抓取不完整（每帖约 27 条顶层评论）；`gh search issues` 查嵌套加载相关 issue 静默返回 0 条。
- **核对方式**：官方页面原文落盘后，本文引用的每句英文都在原文里逐字 grep 命中过。官方文档页没有页面日期，一律记为「抓取 2026-10-04」；当时 Claude Code 最新版是 2.1.289，本机装的也是这一版。
- **证据等级**：官方文档 > 官方博客 > 论文 > 厂商博客（有利益相关）> 个人博客（数字自报）。只有单一来源的结论在行内标出。

## 1. 结论

1. **每个会话必付的只有启动加载的那一批**：工作目录及其祖先目录的 `CLAUDE.md`、不带 `paths` 的 rule、所有 `@import` 的内容、`MEMORY.md` 的前 200 行或 25 KB。子目录的 `CLAUDE.md` 是懒加载。
2. **官方体积目标是每个文件 200 行以内**。硬上限是 4 MiB，超过就整个跳过。字符数和 token 数的目标官方没给。
3. **取舍标准只有一句**：删掉这一行，Claude 会不会犯错？不会就删。经常变化的信息、逐文件的描述、能从代码读出来的内容，都在官方的排除清单上。
4. **拆成 `@import` 不省上下文**。能省的只有四样：带 `paths` 的 rule、skill、嵌套 `CLAUDE.md`、HTML 注释。
5. **`CLAUDE.md` 是建议，不是强制**。它以 user message 的身份进入上下文，官方明说不保证遵守。必须每次都成立的事交给 hook 或测试。
6. **嵌套 `CLAUDE.md` 是官方支持的做法，粒度是「每个包」或「每个子系统」**，不是每个文件夹。文件多了以后，官方自己也说会难以治理。
7. **实证研究的方向一致**：上下文文件对任务成功率的提升很小或不显著，成本稳定增加约 20%。有用的是代码里推不出来的具体指令，仓库概览没用。
8. **本仓库的问题不在「80 个」这个数，而在根文件**：103 KB 每个会话全量加载，其中 63% 是 docs/19 到 docs/35 的落地记录摘要。详见 §9。

## 2. 加载机制

| 问题 | 事实 | 原文与来源 |
|---|---|---|
| 启动时加载什么 | 工作目录及所有祖先目录的 `CLAUDE.md` / `CLAUDE.local.md`，全量拼接 | "…in the directory hierarchy above the working directory are loaded at launch." `[D-mem]` |
| 工作目录之下的子目录 | 启动时不加载；Claude 对该目录下的文件用了 Read、Write 或 Edit 之后才加载 | "Files in subdirectories load on demand when Claude reads files in those directories." `[D-mem]`；v2.1.288 之前只有 Read 触发 `[D-debug]` `[CL]` |
| 从子目录启动 | 加载该目录和所有祖先的文件，兄弟目录不进上下文 | "That directory's plus every ancestor's" `[D-large]` |
| 多个文件的关系 | 拼接，不互相覆盖 | "All discovered files are concatenated into context rather than overriding each other." `[D-mem]` |
| `@path` import | 启动时随宿主文件展开；相对路径相对于宿主文件解析；最多 4 跳 | "Imported files are expanded and loaded into context at launch" `[D-mem]` |
| 不带 `paths` 的 rule | 启动加载 | "loaded at launch with the same priority as `.claude/CLAUDE.md`" `[D-mem]` |
| 带 `paths` 的 rule | 匹配的文件被 Read、Write 或 Edit 时才加载 | `[D-mem]` |
| 压缩之后 | 项目根 `CLAUDE.md`、无作用域的 rule、auto memory 从磁盘重新注入；嵌套 `CLAUDE.md` 与带 `paths` 的 rule 被摘要掉，要再次碰到触发文件才回来 | "Project-root CLAUDE.md survives compaction" `[D-mem]`；"compaction summarizes them away with everything else" `[D-ctx]` |
| 以什么身份进上下文 | system prompt 之后的 user message | "delivered as a user message after the system prompt, not as part of the system prompt itself" `[D-mem]` |
| 子 agent | 内置的 Explore、Plan 不加载；其余内置和自定义子 agent 都加载，除非设 `omitClaudeMd: true`（v2.1.271+）。用 `claude --agent` 把它当主会话跑时，这个字段被忽略 | "Explore and Plan skip your CLAUDE.md files" `[D-sub]` |
| HTML 注释 | 块级 `<!-- -->` 在注入前剥掉，不占 token；代码块里的保留 | `[D-mem]`，v2.1.72 `[CL]` |
| `AGENTS.md` | 默认只在工作目录及以上没有 `CLAUDE.md` 时才读（v2.1.277+） | `[D-mem]` |
| auto memory | `MEMORY.md` 的前 200 行或前 25 KB，先到为准；主题文件按需读 | `[D-mem]` |

懒加载有一条独立于文档的一手确认，来自 Claude Code 负责人 Boris Cherny（2026-01-28）："Descendent CLAUDE.md's are loaded *lazily* only when Claude reads/writes files in a folder… We designed it this way for monorepos and other big repos." `[X-bc]`

## 3. 体积

- **目标**："target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence." `[D-mem]`。同一个数字在 `[D-feat]`、`[D-costs]`、`[B-steer]` 里重复出现。
- **硬上限**："Claude Code loads a CLAUDE.md file of up to 4 MiB in full and skips a larger file." `[D-mem]`
- **告警**：单个文件超过建议长度，或多个文件合计超过上限时，启动时和 `/status` 里会有告警；每个 `CLAUDE.md`、rule 文件、`@import` 各算一个文件 `[D-mem]`。
  - 阈值数字官方没写。`[UNKNOWN]`
  - v2.1.169 起阈值随模型上下文窗口缩放，v2.1.281 起会把多个文件合计 `[CL]`。
  - 一篇 2026-04 的博客截到过 `42.5k chars > 40.0k` `[V-magda]`。单一来源，且早于 v2.1.169。
- **过长的后果**，官方原话：
  - "Bloated CLAUDE.md files cause Claude to ignore your actual instructions!" `[D-bp]`
  - "If your CLAUDE.md is too long, Claude ignores half of it because important rules get lost in the noise." `[D-bp]`
  - "If Claude keeps doing something you don't want despite having a rule against it, the file is probably too long and the rule is getting lost." `[D-bp]`
- **行数是体积的代理指标，不是可以钻的口径**。同一段要求 "Organized sections are easier for Claude to follow than dense paragraphs" `[D-mem]`。把几千字塞进一行，行数达标，官方想避免的两个后果一个都没避开。（这一条是本文的推断，不是官方原话。）

## 4. 内容取舍

官方的收录与排除清单 `[D-bp]`：

| 该写 | 不该写 |
|---|---|
| Claude 猜不到的 Bash 命令 | Claude 读代码就能弄清楚的任何东西 |
| 与默认不同的代码风格规则 | Claude 本来就知道的语言惯例 |
| 测试说明和首选的测试运行方式 | 详细的 API 文档（改成链接） |
| 仓库礼仪（分支命名、PR 约定） | **经常变化的信息** |
| 本项目特有的架构决策 | 长篇解释或教程 |
| 开发环境的怪癖（必需的环境变量） | **逐文件的代码库描述** |
| 常见的坑和不显然的行为 | 「写干净的代码」这类不言自明的话 |

配套的规则：

- **逐行检验**："For each line, ask: *Would removing this cause Claude to make mistakes?* If not, cut it." `[D-bp]`
- **什么时候往里加** `[D-mem]`：
  - Claude 第二次犯同一个错；
  - 评审抓到 Claude 本该知道的事；
  - 你在对话里重复了上次会话说过的纠正；
  - 新同事也需要同样的背景。
- **只留每个会话都要的事实**："If an entry is a multi-step procedure or only matters for one part of the codebase, move it to a skill or a path-scoped rule instead." `[D-mem]`
- **写得具体到可以验证**：写「提交前跑 `npm test`」，不写「测试你的改动」`[D-mem]`。
- **强调词只给一行**："add emphasis such as "IMPORTANT" to that line alone. If you emphasize many lines, none of them stands out." `[D-bp]`
- **不要自相矛盾**：两条指令冲突时，"Claude may pick one arbitrarily" `[D-mem]`。
- **当代码维护**："review it when things go wrong, prune it regularly, and test changes by observing whether Claude's behavior actually shifts." `[D-bp]`
- **根文件的定位**："The root file should be pointers and critical gotchas only; everything else drifts into noise." `[B-large]`
- **`/doctor` 自动裁剪的取舍标准**：砍掉 "directory layouts, dependency lists, and architecture overviews"，保留 "pitfalls, rationale, and conventions that differ from tool defaults" `[D-mem]`。
- **每条新增都要解决遇到过的真问题**，不是设想中 Claude 可能需要的东西 `[B-using]`。

## 5. 内容该放哪

| 载体 | 何时加载 | 上下文成本 | 压缩后 | 适合放什么 |
|---|---|---|---|---|
| 根 `CLAUDE.md` | 启动 | 高，每一行每次请求都付 | 从磁盘重读 | 每个会话都需要的事实：构建命令、约定、「永远做 X」 |
| 子目录 `CLAUDE.md` | 碰到该目录的文件时 | 低 | 丢失，再碰到才回来 | 该子系统独有的约定 |
| rule，不带 `paths` | 启动 | 与写进 `CLAUDE.md` 完全相同 | 从磁盘重读 | 只为拆文件，不省 token |
| rule，带 `paths` | 匹配的文件被读写时 | 低 | 丢失，再匹配才回来 | 同一条约定适用于散落多处的路径 |
| skill | 启动时只有描述，调用时才有正文 | 低 | 已调用的按预算重新注入 | 多步流程、偶尔才用的参考资料 |
| hook | 生命周期事件触发 | 零，除非 hook 返回内容 | 不受影响 | 必须每次都发生的事 |
| `docs/` 里的普通文件 | Claude 自己去读时 | 零 | 不适用 | 历史、决策记录、长说明，由 `CLAUDE.md` 指路 |

前六行来自 `[B-steer]` 的总表与 `[D-feat]`、`[D-ctx]`；最后一行来自 `[B-steer]` 的 "an index pointing to other files where Claude can find more information as needed"。

选型时的判断句：

- "Procedures belong in skills. CLAUDE.md is for facts Claude should hold all the time." `[B-steer]`
- "An unscoped rule is mechanically identical to putting the content in CLAUDE.md: always loaded, always costing tokens." `[B-steer]`
- "An instruction like "never edit `.env`" in CLAUDE.md or a skill is a request, not a guarantee." `[D-feat]`

一条反向证据：Vercel 的内部评测里，skill 在 56% 的用例中根本没被调用，胜出的是写在 `AGENTS.md` 里的 8 KB 压缩索引 `[V-vercel]`（单一来源，厂商评测）。含义是 Claude 必须知道的东西，至少要在常驻文件里留一行指针，不能全指望 skill 被自动想起。

## 6. 多目录怎么组织

- **官方推荐两层** `[D-large]`：
  - 根文件放处处适用的规则，如编码规范、提交约定；
  - 子目录文件放该区域独有的约定。粒度的原话是 "In a monorepo that's one per package. In a large single tree it's one per subsystem such as `src/db/` or `src/api/`"。
- **单一根文件的毛病**："tends to either grow to cover every subsystem's conventions, costing context on instructions unrelated to the current task, or stay too generic to be useful" `[D-large]`
- **嵌套 `CLAUDE.md` 与带 `paths` 的 rule 怎么选** `[D-large]`：
  - 嵌套文件：目录的主人各自维护约定，指令跟代码一起做版本管理；
  - 带 `paths` 的 rule：想把约定集中在一处，或同一条规则适用于散落多处的路径。
- **分层也有上限**："Per-directory CLAUDE.md files can become hard to govern as the codebase grows. Conventions drift, files go stale, and no one owns the root." 官方的下一步是把约定和参考内容搬去按需加载的机制 `[D-large]`。
- **`claudeMdExcludes`** 是静态名单，用来排除从不涉足的目录（别的团队的包、遗留代码、vendored 子树）`[D-large]`。单人维护的仓库基本用不上。
- **「每个文件夹一个」没有一手出处**。没找到任何官方或一手资料主张这个粒度，也没找到明确反对的。能确认的是规模样本（2026-10-04 用 gh 实测）：

| 仓库 | 文件数 | 最大单文件 |
|---|---|---|
| anthropics/claude-code | 1 | 2.2 KB / 40 行 |
| anthropics/claude-agent-sdk-python | 1 | 3.9 KB / 82 行 |
| anthropics/anthropic-cookbook | 3 | 8.2 KB / 236 行 |
| facebook/react | 2 | 10.3 KB / 276 行，根文件 359 字节只负责指路 |
| vercel/next.js | 27 个路径，其中 20 多个是 150 字节以内的测试夹具 | 28.6 KB / 520 行 |
| oven-sh/bun | 约 11 个实体文件，合计 157 KB | 44.7 KB / 328 行 |
| **favbase** | **80 个，合计 729 KB** | **103.6 KB / 184 行** |

  这批样本文件里，带日期的变更日志条目是 0 条。

## 7. 维护与诊断手段

| 手段 | 作用 | 来源 |
|---|---|---|
| `/context` | 看本会话实际加载了哪些指令文件（Memory files 一栏） | `[D-mem]` |
| `/status` | 显示超长告警 | `[D-mem]` |
| `/memory` | 列出各层文件的位置、开关 auto memory；它不告诉你本会话加载了哪些 | `[D-mem]` |
| `/doctor`（别名 `/checkup`） | 提出裁剪方案，并把剩下的常驻内容迁到 skill 和嵌套文件；v2.1.206+ | `[D-cmd]` |
| `/doctor prompt-audit` | 查过时、互相矛盾、引用了不存在文件的指令；只出报告不改文件；v2.1.283+ | `[D-mem]` |
| `InstructionsLoaded` hook | 记录每次加载的文件与原因：`session_start`、`nested_traversal`、`path_glob_match`、`include`、`compact` | `[D-hooks]` |
| `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` | 整体关掉所有 `CLAUDE.md`，做有无对照 | `[D-env]` |

维护习惯：

- 在 PR 里评审 `CLAUDE.md` 的改动；大版本模型发布后重新过一遍，为旧模型打的补丁可能已经成了负担 `[D-large]`。
- 给文件指定负责人 `[B-steer]`。
- Cherny 的瘦身办法："delete your CLAUDE.md, then add it back an instruction at a time as you see Claude making mistakes. Do that every few months" `[X-bc]`（2026-01-03）。
- Cherny 谈历史记录外置："One engineer tells Claude to maintain a notes directory for every task/project, updated after every PR. They then point CLAUDE.md at it." `[X-bc]`（2026-01-31）

## 8. 非官方证据

### 8.1 实证研究

- **ETH Zurich，arXiv 2602.11988 v3（2026-09-29）** `[P-eth]`。4 个 agent，SWE-bench Lite 300 题加自建 138 题，仅 Python。
  - 总结论："providing context files does not generally improve task success rates, while increasing inference cost by over 20% on average"。
  - LLM 生成的文件：成功率无显著变化，成本显著增加 20% 和 23%。
  - 开发者手写的文件：平均提升 2.4%（p=21%，不显著），对 Claude Code 没有提升。
  - 指令会被执行，但 "context files are not effective at providing a repository overview"。
  - 建议：文件 "should only contain specific additional instructions beyond what is already available in the codebase"。
  - 社区流传的「LLM 生成 −3%、人写 +4%」是 v1 的数字，v3 已经改掉。
  - 论文说没观察到长度与成功率的明显关系，但被测文件最大只有 2003 词。这条不能拿来替 103 KB 的文件辩护。
- **Agent READMEs，arXiv 2511.12884** `[P-readme]`。2,303 个文件。Claude Code 的上下文文件中位长度 485 词；每次提交中位新增 57 词，删除不到 15 词。论文的原话是这类文件 "risk becoming unstructured append-only logs"。
- **IFScale，arXiv 2507.11538** `[P-ifscale]`。500 条指令密度下，最好的前沿模型只有 68% 的遵循率。任务是在商业报告里嵌关键词，不是编码。
- **方向相反的证据** `[P-msr]`：MSR 2026 的观察性研究里，合并率上升的项目指令文件中位 976 词，接近下降组的两倍。非因果，且 976 词仍然只有几 KB。

### 8.2 一手实践者

- **Claude Code 团队自己的文件**："Our checked in CLAUDE.md is 2.5k tokens." `[X-bc]`（Cherny，2026-01-02）。整个团队共用一个，每周多次提交。
- **OpenAI Codex 团队** `[V-oai]`：试过「一个大 `AGENTS.md`」，结论是 "It rots instantly"。改成约 100 行的地图，执行计划和决策日志放进 `docs/exec-plans/`，用 linter、CI 和定期的清理 agent 维护。
- **Augment Code** `[V-aug]`（厂商内部评测，单一来源）：
  - 表现最好的是 100 到 150 行的主文件加少量聚焦的参考文档，再长收益开始反转。
  - 仓库根的大而全文件不如模块级文件。
  - 一个模块有 37 份相关文档共 50 万字符，另一个有 226 份共 2 MB，结论是 "the sprawl was the problem"。这是与本仓库规模最接近的实测。
  - 单个文件里的引用不要超过 10 到 15 个。
- **HumanLayer** `[V-hl]`：自家根文件不到 60 行。
- **Ivan Magda** `[V-magda]`：monorepo 三个文件从约 92k 字符降到约 25k，做法是把内容抽到 `docs/`，指针写成带条件的形式，如「改路由之前先读 `docs/routes.md`」。效果是主观描述，没有对照测量。

## 9. 对照本仓库

### 9.1 实测数据

| 项 | 数值 |
|---|---|
| 受版本控制的 `CLAUDE.md` | 80 个，合计 729 KB，约 51 万字符 |
| 根 `CLAUDE.md` | 103.6 KB，67,942 字符，184 行；最长一行 11,388 字符 |
| 根文件「关键文档」一节 | 74 KB，占根文件 72%，只有 29 行 |
| 其中 `docs/NN` 条目 | 18 条，65.6 KB，占根文件 63% |
| 其中测试、配置、spec 条目 | 9 条，8.5 KB，占根文件 8% |
| 根文件「目录文档索引」一节 | 22 KB，103 行 |
| 根文件里的日期串 / 「落地」 | 136 处 / 112 处 |
| 79 个嵌套文件 | 合计 625 KB；中位数 6.4 KB、26 行；18 个超过 10 KB；26 个含超过 1000 字符的单行 |
| 分布 | `entrypoints/` 40 个，`lib/` 35 个，其余 4 个 |
| 项目级 `.claude/rules/`、`claudeMdExcludes` | 都没有 |
| `.claude/agents/` 三个 Trellis 子 agent | 都没设 `omitClaudeMd` |
| 改过某个 `CLAUDE.md` 的提交 | 444 次提交里有 345 次，占 78% |
| 文件的创建时间 | 2026-07 一个月新增 57 个，此后每月 10 个左右 |

根文件的 token 数没有实测，只有估算：

- 多字节字符约 1.78 万个，ASCII 字符约 5 万个（由字节数减字符数推出）。
- 按每个中文字符 1 到 1.5 token、每 3 到 4 个 ASCII 字符 1 token 算，约 3 万到 4.5 万 token。
- 实际值以会话里的 `/context` 为准。

### 9.2 诊断

1. **成本在根文件，不在文件个数**。从仓库根启动时，79 个嵌套文件一个都不加载；根文件 103 KB 每个会话全量加载，压缩后再重读一次。
2. **根文件的 63% 是落地记录摘要**。「关键文档」一节的 18 条 `docs/NN` 条目记的是每个 Step 的落地日期、偏离、勘误。
   - 这正是官方排除清单里的「经常变化的信息」，也正是论文说的 append-only log。
   - 对应的 docs 大多自带落地记录（docs/20、24 到 27、29 到 33 都有落地标记，docs/32 一份就有 265 KB），根文件里的是摘要副本。是否每一条都能在 docs 里找到，没有逐条核对。
   - 同一节另有 9 条测试与配置文件的描述，占 8%，写的是「这个测试查什么」，属于读代码就能弄清楚的内容。
3. **根文件字面达标、实质超标**。184 行低于 200 行的目标，但平均每行 369 字符。按字符算，它是 2026-04 那个 40k 告警阈值的 1.7 倍（阈值现已改为随上下文窗口缩放，当前是否告警见 `/status`）。
4. **真正的指令占比极小，而且位置不显眼**。例如「用 WXT 开发必须查 context7」只有 76 字节，是 74 KB 的「关键文档」一节的第一行；`motion` 只许 welcome 用、`sonner` 的 import 边界两条写在「技术栈」的长句里。官方对这种情况的描述是 "important rules get lost in the noise"。
5. **「目录文档索引」把懒加载的好处抵消了一部分**。它为每个嵌套文件写了一段内容摘要，等于把按需加载的内容抄进了常驻文件，而且同一件事从此有两处要同步。
6. **80 个文件和它们的增长方式，源头是全局规则**（推断，依据是下面的提交数据）。`~/.claude/CLAUDE.md` 里的「改代码必须同步更新目录 CLAUDE.md（没有就建）」有两个效果：
   - 「没有就建」让文件按文件夹增殖，而官方的粒度是每个包或每个子系统；
   - 「改代码必须同步更新」让文件记录的是「这次改了什么」，而官方的触发条件是「Claude 犯了错」或「出现了代码里看不出来的约定」。
   - 证据：78% 的提交都改了某个 `CLAUDE.md`。按官方的触发条件，这个比例应该很低。
   - 同一条规则的后半句「文档要精准简短，指出位置而非复制代码」目前没有被遵守。
7. **嵌套文件不是免费的**。它们单个偏大，一次跨目录的任务会陆续拉进多个，并一直留在对话历史里直到压缩。例如碰一下 `entrypoints/app/hooks/` 就多 27.8 KB。从根目录到目标文件之间的中间层文件是否一并加载，文档没明说。`[UNKNOWN]`
8. **子 agent 也在付根文件的钱**。除了内置的 Explore 和 Plan，每个子 agent 启动都加载一遍根文件；Trellis 的 implement、check、research 三个都是。

### 9.3 做对了的

- 按子系统分层（`lib/<platform>/`、`sections/<platform>/`、`lib/database/`）与官方推荐的两层切分一致。
- 大量约定已经由契约测试守住（`tests/platform-completeness-contract.test.ts` 等）。这与官方「必须成立的事不要靠提示词」的方向一致，而且意味着对应的散文描述可以从 `CLAUDE.md` 里删掉：测试红了自然会告诉 Claude。
- 决策记录本身有价值（「用户某日决定……」）。问题只在它们住错了地方，应当在 `docs/` 和 ADR 里，由根文件指路。

### 9.4 整改前要先定的事

每条附推荐，供决策，不是方案。

1. **落地记录归谁**。推荐：只留在各份 docs 自己的落地记录节，根文件每份 doc 留一行，写路径和「什么情况下必须先读它」。
2. **全局规则怎么改**。推荐：把「改代码必须同步更新」换成「出现了代码里看不出来的新约定或新坑才更新；不记录改了什么、何时改的；没有独有约定的目录不建文件」。
3. **嵌套文件留到哪一级**。推荐：保留子系统级；叶子组件级（如 `components/label/`、`components/loading-screen/`）并入上一级，或在内容能从代码读出时直接删除。
4. **横切约定放哪**。推荐：i18n、测试守卫这类跨目录的约定改成带 `paths` 的 rule；平台接入、发版这类多步流程留在现有的 `.trellis/spec` 或改成 skill，根文件只留指针。
5. **Trellis 子 agent 要不要 `omitClaudeMd`**。它们的上下文由 hook 注入。根文件瘦身后这一项的收益会变小，建议最后再定。
6. **先量基线**。动手前在会话里跑 `/context`、`/status`、`/doctor`，记下根文件的 token 数和官方给的裁剪建议。这三个是交互命令，本次调研没法代跑。

## 10. 官方资料之间的不一致与未知项

**不一致**（以 2026-10-04 的文档为准）：

- `[B-using]`（2025-11-25）说 `CLAUDE.md` "becomes part of Claude's system prompt"；现行 `[D-mem]` 明说是 user message。
- `[B-using]` 建议在文件里放目录树；现行 `[D-bp]` 把逐文件描述列入排除清单，`/doctor` 也会裁掉目录布局。
- `[B-steer]` 的总表说 rule 在压缩后重新注入；`[D-ctx]` 说只有不带 `paths` 的才是，带 `paths` 的会被摘要掉。

**未知项**：

- 超长告警的当前阈值，以及它按行数还是字符数算。
- 字符数或 token 数层面的官方目标。
- 用户级 `~/.claude/CLAUDE.md` 在压缩后是否重读（文档的表里只写了项目根）。
- 读取深层文件时，中间各层目录的 `CLAUDE.md` 是否一并加载。可以用 `InstructionsLoaded` hook 实测。
- 旧工程博客里是否有过「YOU MUST」之类的强调词建议；现行页面只提 `IMPORTANT`。

## 11. 来源

官方文档，均为 `https://code.claude.com/docs/en/<页名>`，抓取 2026-10-04：

| 代号 | 页名 |
|---|---|
| `[D-mem]` | `memory` |
| `[D-bp]` | `best-practices` |
| `[D-feat]` | `features-overview` |
| `[D-large]` | `large-codebases` |
| `[D-ctx]` | `context-window` |
| `[D-debug]` | `debug-your-config` |
| `[D-sub]` | `sub-agents` |
| `[D-hooks]` | `hooks` |
| `[D-cmd]` | `commands` |
| `[D-costs]` | `costs` |
| `[D-env]` | `env-vars` |
| `[CL]` | `anthropics/claude-code` 的 `CHANGELOG.md`，版本日期取 npm 发布时间 |

官方博客与团队成员：

| 代号 | 来源 | 日期 |
|---|---|---|
| `[B-steer]` | https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more | 2026-06-18 |
| `[B-large]` | https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start | 2026-05-14 |
| `[B-using]` | https://claude.com/blog/using-claude-md-files | 2025-11-25 |
| `[B-ctxeng]` | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | 2025-09-29 |
| `[X-bc]` | Boris Cherny 的 X 帖，`https://x.com/bcherny/status/<id>`：2007212366094811401（2.5k tokens）、2007569961796153649（瘦身办法）、2016339448863355206（懒加载）、2017742747067945390（notes 目录） | 2026-01 |

`[B-ctxeng]` 提供的是总原则："find the smallest set of high-signal tokens that maximize the likelihood of your desired outcome"。

论文与实践者：

| 代号 | 来源 | 日期 |
|---|---|---|
| `[P-eth]` | https://arxiv.org/abs/2602.11988 | v3 2026-09-29 |
| `[P-readme]` | https://arxiv.org/abs/2511.12884 | 2025-11 |
| `[P-ifscale]` | https://arxiv.org/abs/2507.11538 | 2025-07 |
| `[P-msr]` | https://arxiv.org/abs/2606.13449 | 2026-06-11 |
| `[V-oai]` | https://openai.com/index/harness-engineering/ | 2026-02-11 |
| `[V-aug]` | https://www.augmentcode.com/blog/how-to-write-good-agents-dot-md-files | 2026-04-22 |
| `[V-vercel]` | https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals | 2026-01-27 |
| `[V-hl]` | https://www.humanlayer.dev/blog/writing-a-good-claude-md | 2025-11-25 |
| `[V-magda]` | https://ivanmagda.dev/posts/fixing-40k-claude-md-warning-monorepo/ | 2026-04-13 |

原文存档在本机 `C:/Users/18368/AppData/Local/Temp/search-master/` 下的 `claude-md-best-practices-official/` 与 `claude-md-best-practices-practitioner/` 两个目录。它们在临时目录里，需要长期保留请另存。

## 12. 整改记录（2026-10-06）

用户指示「精简所有 CLAUDE.md，按最佳实践去改」，一次做完。任务目录 `.trellis/tasks/10-06-claude-md-slimming/`，取舍标准写在它的 `prd.md`。动手前重新抓了 `memory` 与 `best-practices` 两页，§2–§4 的关键引文仍逐字命中。

### 12.1 结果

| 项 | 整改前 | 整改后 |
|---|---|---|
| 根 `CLAUDE.md` | 104.8 KB / 183 行，最长一行 11,388 字符 | 14.4 KB / 151 行，最长一行 236 字符 |
| 79 个嵌套文件合计 | 631.6 KB | 266.7 KB |
| 80 个文件合计 | 736.3 KB | 281.2 KB |
| 行数最多的文件 | 447 行（`packages/favbase/CLAUDE.md`） | 185 行（同一个文件） |
| 最长的单行 | 11,388 字符 | 283 字符 |

整改前按 git blob 计，整改后按工作区计，与 §9.1 的口径略有出入。改动只涉及 80 个 `CLAUDE.md`、13 份 docs、2 份 spec，零代码改动。

### 12.2 §9.4 六项的处置

1. **落地记录归谁**：根文件「关键文档」里 12 段长摘要逐字追加到了各自 doc 的末尾（标题「附：迁自根 CLAUDE.md 的落地摘要」），根文件每份 doc 只留一行「动什么之前先读它」。同一节里 6 段测试与配置文件的描述没有迁，内容在测试文件自身和 spec 里；原文见 `git show 37eff88:CLAUDE.md`。嵌套文件里删掉的落地叙事同样没有迁，原文见 `git show 37eff88:<path>`。
2. **全局规则**：根文件新增「维护 CLAUDE.md」一节，作为全局「文档即代码」在本仓库的执行口径。用户 2026-10-07 采纳新口径；`~/.claude/CLAUDE.md` 的「改代码必须同步更新目录 CLAUDE.md（没有就建）」由用户自行改写为「只记代码里看不出来的约束、坑和刻意决定；出现新约束、新坑或旧条目失效时才更新；没有这类内容的目录不建文件」（该文件不在仓库里，本次会话无权改它）。
3. **嵌套文件留到哪一级**：没有删除或合并任何文件，全部原位精简。可并入上一级的候选：`entrypoints/app/pages`、`entrypoints/app/utils`、`lib/subtitle`、`lib/runtime-message`、`entrypoints/bilibili-video.content/components`。
4. **横切约定**：没建 `.claude/rules/`。`.claude/` 整个被 gitignore，要用得先加 `!.claude/rules/`。i18n 的机制细节下沉到 `lib/i18n/CLAUDE.md`，根文件留六条规则。
5. **`omitClaudeMd`**：未动。
6. **基线**：`/context`、`/status`、`/doctor` 是交互命令，没有跑；整改前后的 token 数都没有实测值。

### 12.3 做法

- 根文件由主会话重写。
- 79 个嵌套文件分给 10 个并行的子 agent，按同一份取舍标准重写。每个文件先查入站指针（代码注释、测试注释、spec 里「见 X/CLAUDE.md」的地方），保留条目里点名的文件、符号、测试都用 grep 核对过。
- 再由 3 个独立的 check agent 对照 HEAD 原文审计遗漏：恢复了 7 条被误删的约束，纠正了 9 处写错或写过头的陈述。
- 因精简而失效的指针已改指：`platform-onboarding.md` 三处、`.trellis/spec/frontend/index.md` 一处、docs/32、docs/33、docs/35 各一处。历史落地记录里带行号的引用（如 docs/20、docs/25）记的是当时的状态，没有改。

### 12.4 核对代码时的发现（都没有改代码）

重写时逐条对代码核对，旧文件里与代码不符的说法约 60 处，已在各文件里改正。下面几项落在代码侧，留给后续任务：

- **缺陷**：WebDAV 开关关闭时点「立即同步」，`doSync`（`lib/sync/sync-engine.ts:145`）用 `isConfigSyncable` 判定后直接返回 `{ ok: true }`，设置卡照样提示已同步。`sync-config-storage.ts:56` 的 JSDoc 写的是「立即同步只需凭据」，`hasWebdavCredentials` 在自己文件之外没有调用方。
- **过时的代码注释**：`sections/x/x-view.tsx:31`（写 outlined，实际是 soft）、`sections/youtube/youtube-view.tsx:44`（写 channel chips，实际是播放列表）、`welcome/sections/orbit-core.tsx:35`（写 six platform chips）、`components/tags/tag-row.tsx:18`、`packages/favbase/exit-codes.ts` 文件头（仍提 INSTALL.md 的表）、`tests/lib-import-smoke.test.ts` 文件头、`tests/platform-completeness-contract.test.ts` 里的 `'agent-bridge'`（section id 实际是 `agent-skills`）。
- **疑似死代码**（只有 barrel 导出或测试在用，没有逐一验证）：`lib/embedding` 的 `indexItemChunks` / `persistItemChunks`，`components/collection` 的 `SyncProgressBar` / `BackgroundJobsBar`，`hooks` 的 `trackJobRun`。
- **`spikes/agent-bridge` 的 runner 可能已跑不通**：`background.ts` 的 spike 分支用动态 `import()`，而 `scripts/check-background-bundle.mjs` 现在拒绝 SW 图里的任何动态 import。没有跑 build 验证。
