# Agent Setup Guide 是一条公开 raw URL，而不是第二份 Skill

2026-09-17。welcome.html 新增 Agent Skills 段落时要给出一个**可执行入口**。设置卡已有的那条一键复制命令在这里用不了：首装页上 **Bridge Token** 还不存在（开关没开、token 没生成），而 `favbase setup` 没有 token 就是一条残缺命令。

于是新增 `skills/favbase/INSTALL.md`，用户把它的 raw URL 交给自己的 agent，agent 读完自己走安装流程。本 ADR 记录的是**这条 URL 的契约地位**与**为什么它不能、也不该做到真·一键**。

## Decision

- 新增 **Agent Setup Guide**（`CONTEXT.md` 已登记该术语）：`skills/favbase/INSTALL.md`，英文，读者是 agent 不是人。
- 对外形态是 **raw URL**：`https://raw.githubusercontent.com/InvisibleQAQ/favbase/main/skills/favbase/INSTALL.md`。不用 blob URL——那是 GitHub 的 HTML 外壳，agent 抓回来要从一堆导航里刨正文。
- **它不是 Skill**。Skill 仍然只有 `skills/favbase/SKILL.md` 一份，打进 CLI、由 `favbase setup` / `install-skill` 写进 `~/.claude/skills/favbase/` 与 `~/.agents/skills/favbase/`。Agent Setup Guide 在**任何东西被安装之前**读一次，读完它的使命就结束了。
- **流程中间必须停一次**：agent 装完 CLI 后停下来，让用户去 Settings → Connections → Agent Skills 开开关、点「复制配对命令」、贴回来；agent 执行的是那条**由扩展生成、自带 token 与 port** 的命令。Guide 自己永远不构造 `favbase setup` 的参数。
- welcome 段落只出示「把这个 URL 交给你的 agent」这一条可复制指令，不出示任何 `npm` / `favbase` 命令。安装命令的真源是 Guide（给 agent）与设置卡（给人），welcome 不做第三份。

## Considered Options

- **welcome 直接抄设置卡的三步命令** — 拒绝。首装时没有 token，抄出来的 `favbase setup --token <你的token>` 是个占位符命令；用户照着跑会拿到一个失败，而失败原因（token 是假的）在命令本身看不出来。
- **Guide 里教 agent 自己去拿 token** — 做不到。token 只在扩展的 `storage` 里，`lib/agent-bridge/` 那条通路本身就要 token 才能开。任何"自动获取"的写法都是幻觉，会让 agent 编一个出来重试到超时。
- **把安装步骤并进 `SKILL.md`，不新建文件** — 拒绝。SKILL.md 的读者是**已经装好 CLI** 的 agent，它的 Prerequisites 是运行前置（Chrome 开着、开关打开），不是安装流程；塞进去会让 agent 每次检索都先读一遍与检索无关的安装说明，也会把 `CONTEXT.md:168` 已经标过的「Skill 是什么」那个歧义再加深一层。
- **提供一个 `curl | sh` 安装脚本** — 拒绝。它要么同样卡在 token 上，要么诱导用户把 token 写进命令行历史；而且 agent 生态里那条 `.md` 链接的惯例本来就是"读，然后自己判断怎么做"，脚本反而更不透明。
- **只在 README / npm 页面写安装** — 拒绝。那是给人读的，且 welcome 的用户此刻根本不在 GitHub 上。

## Consequences

- **这条 URL 是对外契约**。它会被用户贴进自己的 prompt、笔记、团队文档里。`skills/favbase/INSTALL.md` 这个路径与 `main` 这个分支名**不能再随便挪**；真要挪，旧路径得留一份重定向说明，否则是静默打断别人。
- **仓库必须公开**，且 `main` 上的这份始终可用。仓库转私有或改默认分支名，这条路径当场失效——而失效方式是 agent 抓到 404 然后自由发挥，不是一个显式错误。
- **"一键"是有边界的说法**：agent 能自动完成的是「装 CLI + 装 skill + 验证」，配对那一步必然过用户的手。welcome 的文案因此照实写出 Node.js 20+ 与「配对在设置页」两个前置，不许省。
- **第 4 份手写安装说明**（前三份：设置卡 `settings.agentBridge.commandsStep1..3`、`SKILL.md` Prerequisites、`packages/favbase/README.md`）。四份会漂——e462948 重命名后 `SKILL.md:25` 与 `README.md:21` 立刻就漂了，无人发现，因为零守卫。所以 `tests/agent-bridge-cli-aliases.test.ts` 扩为对账包名、`setup` 命令形状与设置页路径；它原本就是 SKILL.md 那两份平台清单的对账处，同一类问题并进同一个文件，不另起。
- **welcome → GitHub 的外链多了一处**。`entrypoints/welcome/CLAUDE.md` 原记「footer 刻意零新外链，repo 链接本页已两处」；现在是三处，但第三处是**可复制文本**不是 `<a>`，用户不会误点离开引导流。
- `CONTEXT.md` 增术语 **Agent Setup Guide** 与一条 Flagged ambiguity：仓库里那份装 CLI 的 markdown 不是 Skill。Skill 的定义一个字没改。
