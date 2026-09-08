# Agent Bridge 本地测试路径与改进汇总手册（2026-09-07）

## 目的

> **2026-09-07 改名记录**：npm 包名与包目录从 `favbase-cli` / `packages/favbase-cli/` 改为 `favbase` / `packages/favbase/`（用户决定，bin 名一直是 `favbase`，改后两者一致；`npm view` 确认两名皆未被占用）。`rpc-server.ts` 的 `DAEMON_NAME` 随之改为 `'favbase'`。本文下方 Step 0 / 0.5 的 `验证` 表在 2026-09-07 实跑时用的是旧名 tarball `favbase-cli-0.1.0.tgz`，为让读者能直接重跑，命令与文件名已统一改为新名。**表内体积是改名前的实测值**：改名后重新构建为 `dist/cli.js` 56.46 KB（比 56.47 KB 少 0.01 KB，`'favbase-cli'` 字面量短了 4 字符），包数、退出码、命令数等结论不变。

`favbase` **尚未发布到 npm**。本文做两件事：

1. 给出未发布状态下可重复的本地测试路径（Step 0，零代码改动）。
2. 汇总当前 Agent Bridge 外部面的改进方向，分 Step 排序，每步八段（目标 / 依赖 / 文件 / 改法 / 测试 / 验证 / 回滚 / 判据）。

范围是 Agent Bridge 的**外部面**：`packages/favbase`、`skills/favbase/SKILL.md`、扩展侧的 Agent Bridge 设置卡、以及被这三者暴露的 Knowledge Tool 面。不涉及 v1 wire protocol 的破坏性改动（Step 3 只加可选字段）。

前置阅读：`docs/adr/0003`（Skill-first 决策）、`docs/21` §11、`docs/24`（重连延迟整改）、`packages/favbase/CLAUDE.md`、`CONTEXT.md` 的 Agent Bridge 术语段。

---

## §1 决策记录

| # | 决策 | 来源 | 状态 |
|---|---|---|---|
| D1 | ~~暂不发布 npm，先在本地跑通~~ **已作废**：按 0.1.0 发布 npm | 用户 2026-09-07 定，2026-09-08 推翻 | 手册的选项 1c 成了现实；Step 1 的结论不受影响 |
| D2 | 不提供 MCP server | ADR 0003 | 已定 |
| D3 | Agent Bridge 暴露的 Knowledge Tool 集必须与 Chat **完全相同**，两边都不能多一个 | `CONTEXT.md:138` | 已定，是 Step 4 的成本来源 |
| D4 | 诊断信息不做成 Knowledge Tool，走 `/status` 通道 | 本文建议 | **待用户确认**（Step 3） |
| D5 | `favbase` 必须真的在 PATH 上，而不是靠 `npx` 回退（发布后依然如此：人侧经 npx 配对会留下 agent 用不了的机器） | 用户 2026-09-08 | 已定，已落地（Step 1，选 1a，不建共享常量） |
| D6 | 只补 `listItems` 一个新工具，`getItemByUrl` / `collectionStats` 留待需求出现 | 本文建议 | **待用户确认**（Step 4） |
| D7 | 实机 E2E 不进 vitest，产出人工 checklist | 本文建议 | **待用户确认**（Step 5） |
| D8 | Step 0 连带做 Step 0.5a：删掉入口守卫而非取 realpath 比较 | 用户 2026-09-07 | 已定，已落地 |

---

## §2 现状证据

每条都有 `file:line`，不是推测。

### 证据 1 — 能力面天花板是 3 个只读工具

单一事实源 `lib/chat/tools.ts:148` 的 `chatTools`，Chat 页与 Agent Bridge 共用；`lib/agent-bridge/tool-registry.ts:37` 的 `describeTools()` 由它派生 JSON Schema。

| Tool | 参数 | 返回 |
|---|---|---|
| `searchKnowledgeBase` | `query`、`platform?`、`tag_id?`、`top_k?`（1-20，默认 8） | `{count, results[{item_id,title,url,platform,chunk_text,score}]}` |
| `getItemContent` | `item_id` | `{found, item_id, content}` |
| `listTags` | `platform?` | `{count, tags[{id,name,count}]}` |

CLI 侧 9 个命令：`search` / `tags` / `get`（别名，`commands.ts:32` 是唯一定义处）、`tools` / `call`（零知识透传）、`setup` / `install-skill` / `doctor` / `daemon run|start|stop|restart`。**加 CLI 命令不会加能力，加 tool 才会。**

### 证据 2 — 三处安装指引指向未发布的包

| 位置 | 内容 | 后果 |
|---|---|---|
| `entrypoints/app/sections/settings/agent-bridge-card.tsx:69` | `npx -y favbase setup --token ... --port ...` | 「复制 setup 命令」按钮产出必然失败的命令。这是用户拿到 Bridge Token 的**唯一出口**，所以这是本地测试的首要拦路石 |
| `README.md:92`、`README.md:96` | 同上 npx 形式 | 新读者照抄即失败 |
| `skills/favbase/SKILL.md` Prerequisites | `npm install -g favbase`，或前缀 `npx -y favbase` | 两条路今天都不通 |

### 证据 3 — SKILL.md 的 npx 回退在自己的 allowed-tools 下是死路

`skills/favbase/SKILL.md` frontmatter 声明 `allowed-tools: Bash(favbase:*)`，正文却教 agent「没装就前缀 `npx -y favbase`」。该前缀不匹配这条 allow 规则，必被拦。所以**无论发布与否，agent 侧只能用裸 `favbase`** —— 这直接推出 D5。

### 证据 4 — 已安装的 skill 副本会静默过期，且无检测

本机 `~/.claude/skills/favbase/SKILL.md` 与仓库版 diff 不为空，落后至少两轮：

- frontmatter 仍写 `Zhihu collections`（仓库 2026-09-07 已改 `Zhihu favorites`，见 docs/26 Step 3）
- exit-2 行仍是旧文案「~35 s」，缺 docs/24 落地的 30s/60s alarm 段与 `doctor` 指引

`install-skill` 会无条件覆盖（`skill-install.ts:44`），但**没有任何机制告诉人该重装**。frontmatter 的 `description` 正是 agent 据以选不选这个 skill 的那份，它过期的代价是 agent 在该用 favbase 时不去用，且无人察觉。

**2026-09-08 补记**：改名落地后复查，本机两个安装位（`~/.claude/skills/favbase/`、`~/.agents/skills/favbase/`）实际落后**三轮**——上面两条之外，还多出改名带来的 `npm install -g favbase-cli` / `npx -y favbase-cli`。已用 `favbase install-skill` 刷新，两处 `cmp` 与仓库单源字节相同（3483 → 3685 字节）。**这次刷新恰好演示了本条证据**：三轮陈旧全靠人工 `grep` + `diff` 发现，`doctor` 一声不响 —— Step 2 的理由未变，且「落后几轮」这种计数本身就是不该由人维护的东西。

### 证据 5 — embedding 未配置时语义臂静默降级

`lib/chat/retrieval.ts:96`：`embedQuery` 返回 `null` 时语义臂直接返回 `[]`，hybrid 退化成关键词单臂，**不报错、不提示**。维度漂移（`:102`）只 `console.warn` 到 Background SW 的 console，agent 和 CLI 都看不到。结果是召回质量劣化而 `count` 仍然合法，agent 会把「没搜到」当成「用户没收藏」。

### 证据 6 — 实机链路零自动化覆盖

`packages/favbase/integration.test.ts:21` 起用 `node dist/cli.js` + `ws` 假扩展跑真子进程，覆盖 daemon 自启／停／错 token／端口占用。**真 Chrome + 真扩展的链路只有人工验证过一次**（`journal-4:1238` 明确记 "real-machine Claude Code/Codex E2E" 未做）。

### 证据 7 — 构建产物已就绪，本地路径本就可行

- `packages/favbase/tsup.config.ts:17` 注入 `#!/usr/bin/env node` shebang
- `dist/cli.js` 已构建，SKILL.md 以 text loader 打进包内（`tsup.config.ts:23`），不依赖仓库路径
- `ws` / `zod` 是**运行时 external**（未打包），所以全局安装必须带上依赖安装，`pnpm link --global` 则依赖 workspace 的 `node_modules`
- `FAVBASE_HOME` 可整体重定向配置根（`config.ts`，`integration.test.ts:80` 已用同一 seam）—— 隔离测试不必污染真实 `~/.favbase`

### 证据 8 — 三处版本各自独立

根 `package.json` `version: 0.0.5`（扩展）、`packages/favbase/package.json` `version: 0.1.0`（CLI）、wire protocol `v1`。locale `settings.agentBridge.errorVersion` 让用户「升级 favbase」，但没有任何版本比对机制产生这个判断。

### 证据 9 — 全局安装后 CLI 静默失效（2026-09-07 Step 0 实测发现，**P0**；**已由 Step 0.5a 修复 2026-09-07**）

`packages/favbase/cli.ts:13` 的入口守卫：

```ts
const entrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;
```

Node 的 ESM loader 把 `import.meta.url` 解析成 **realpath**，而 `process.argv[1]` 保留调用时的路径。两者中间只要隔了一层符号链接就不相等，`main` 永不执行，进程 **exit 0、stdout 与 stderr 全空**。

本机实测（`npm i -g ./favbase-0.1.0.tgz` 之后，`cmp` 确认全局副本与仓库 `dist/cli.js` 字节完全相同）：

```
argv[1]         = C:\nvm4w\nodejs\node_modules\favbase\dist\cli.js
pathToFileURL   = file:///C:/nvm4w/nodejs/node_modules/favbase/dist/cli.js
import.meta.url = file:///C:/Users/18368/AppData/Local/nvm/v22.22.2/node_modules/favbase/dist/cli.js
guard passes    = false
```

`C:\nvm4w\nodejs` 是 nvm-for-windows 的 junction。实测结果：

| 调用方式 | 结果 |
|---|---|
| `favbase --version`（全局 shim） | 空输出，exit 0 |
| `favbase search "test"` | **空输出，exit 0** |
| `favbase doctor` | 空输出，exit 0 |
| `node <realpath>/dist/cli.js --version` | `0.1.0`，exit 0 |

两点让这条比「装不上」严重得多：

1. **失败模式是静默成功**。SKILL.md 教 agent「exit 0 → 用 stdout 的 JSON」，于是 agent 拿到空字符串，要么 JSON 解析炸掉，要么直接告诉用户「你没有收藏相关内容」——库里明明有。错误答案，全链路零信号。
2. **发布到 npm 也一样死**。POSIX 上 `npm i -g` 把 `$PREFIX/bin/favbase` 建成指向 `lib/node_modules/.../dist/cli.js` 的符号链接，argv[1] 是链接、`import.meta.url` 是 realpath，同样不相等。这不是 Windows 特有，是**交付方式本身**坏的。

为什么测试没抓到：`integration.test.ts:21` 的 `CLI_PATH` 由 `new URL('./dist/cli.js', import.meta.url)` 算出（已是 realpath），再 `spawn(process.execPath, [CLI_PATH, ...])`。**测试恰好用了唯一不会触发该 bug 的调用方式**——它验证了除交付路径之外的一切。

守卫本身零消费者：`packages/favbase/*.ts` 中没有任何模块 import `./cli`（测试全部 import `cli-main`）。

---

## §3 跨 Step 铁律

1. **工具集对称**（D3）：任何新增／删除 Knowledge Tool 都同时改变 Chat 的行为面。别为 CLI 加「专属」工具，`tests/agent-bridge-cli-aliases.test.ts` 会红，而且那是对的。
2. **stdout 只放 JSON**，诊断全走 stderr，且**永不含 Bridge Token**（`packages/favbase/CLAUDE.md` Boundaries）。
3. **SKILL.md 是单源**：仓库 `skills/favbase/SKILL.md` → tsup 打进 `dist/cli.js` → `install-skill` 写出。任何改文案的 Step 都要想到「已安装副本会过期」（Step 2 的存在理由）。
4. **SKILL.md 的两份平台清单**由 `tests/agent-bridge-cli-aliases.test.ts` 双向对账（`<platform>` 句 vs 平台 id；frontmatter `description` vs `PLATFORM_META.title` 经 en locale）。改文案要保住测试锚定的形状。
5. **v1 wire protocol 只加可选字段**，不改语义。旧 daemon／旧扩展的组合必须继续工作（`daemon-client.ts` 已为老 daemon 供 null／零诊断）。
6. **只读**：Agent Bridge 从不写任何表，连 Conversations 都不写（`CONTEXT.md:139`）。

---

## Step 0 — 本地安装与隔离测试路径（零代码改动）—— **已落地 2026-09-07（连带 Step 0.5a）**

**目标** 未发布 npm 的前提下，让 `favbase` 真的出现在 PATH 上，并给出可重复的隔离验证流程。

**依赖** 无。这是唯一不改代码就能做完的一步，先做。

**文件** 无改动。

**改法** 两条路，用途不同。

*A. 贴近发布态（用于验收，每次改完 CLI 跑一次）*

```bash
pnpm --filter favbase build
cd packages/favbase && npm pack          # 产出 favbase-0.1.0.tgz
npm i -g ./favbase-0.1.0.tgz
```

`npm pack` 会走 `prepack`（重新 build）并只收 `files: ["dist"]`，因此这条路同时验证了：`files` 白名单没漏、shebang 生效、SKILL.md 确实打进了包、`ws` / `zod` 作为运行时依赖被正确安装。

`npm pack` 产出的 `.tgz` 落在 `packages/favbase/`，**当前没有被 gitignore**（`git check-ignore` 实测未命中）。这条路会反复跑，顺手补一条忽略规则，否则每次 `git status` 都多一个未跟踪的构建产物。

*B. 迭代期（改一行就生效，不必重装）*

```bash
pnpm --filter favbase build
cd packages/favbase && pnpm link --global
```

需要 pnpm 的 global bin 目录在 PATH 上（未配过就先 `pnpm setup`）。这条路复用 workspace 的 `node_modules`，所以只在仓库存在时有效。

*隔离验证（不污染真实配置）*

```bash
FAVBASE_HOME=/tmp/fb-test FAVBASE_BRIDGE_PORT=17836 favbase doctor
```

`FAVBASE_HOME` 把配置根与 `daemon.log` 一起重定向。跑真实配对前先用它确认二进制本身没问题。

**测试** 无新增。`pnpm --filter favbase test` 已覆盖真子进程链路（证据 6）。

**验证**

1. `favbase --version` → `0.1.0`
2. `favbase --help` → 9 个命令齐全
3. 扩展里开 Agent Bridge、生成 token，复制 **token 本身**（不是 setup 命令，那条今天是坏的，见证据 2），然后 `favbase setup --token <token> --port <port>`
4. Chrome 保持打开，`favbase doctor` → `ok: true`
5. `favbase tags` → JSON；`favbase search "任意关键词"` → JSON

**2026-09-07 首轮实测（选路 A）** 第 1 步即失败，暴露出证据 9 的 P0：

| 步骤 | 结果 |
|---|---|
| `pnpm --filter favbase build` | 通过，`dist/cli.js` 56.63 KB |
| `npm pack` | 通过，`favbase-0.1.0.tgz` 44.6 kB / 3 文件（`dist/cli.js`、`dist/cli.js.map`、`package.json`）。`prepack` 确实重跑了 build |
| `npm i -g ./favbase-0.1.0.tgz` | 通过，`added 3 packages`（自身 + `ws` + `zod`，证实两者是运行时 external） |
| `command -v favbase` | `/c/nvm4w/nodejs/favbase`，PATH 命中 |
| `favbase --version` | **空输出，exit 0** —— 见证据 9 |

第 3-5 步因此未能进行。**Step 0 在 Step 0.5 修掉入口守卫之前无法完成。**

**2026-09-07 复测（Step 0.5a 落地后，同一条选路 A）**

| 步骤 | 结果 |
|---|---|
| `pnpm --filter favbase build` | 通过，`dist/cli.js` 56.47 KB |
| `pnpm --filter favbase test` | 56 例全绿（含新增的符号链接例） |
| `npm pack` | 通过，44.7 kB / 3 文件，`prepack` 重跑 build |
| `npm i -g ./favbase-0.1.0.tgz` | 通过，`changed 3 packages` |
| 验证 1 `favbase --version` | **`0.1.0`，exit 0** —— P0 已消 |
| 验证 2 `favbase --help` | 9 个命令齐全（search/tags/get/tools/call/setup/install-skill/doctor/daemon） |
| 隔离 `FAVBASE_HOME=... FAVBASE_BRIDGE_PORT=17899 favbase doctor` | JSON 输出 + `ok:false` + 缺 token 的诊断文案，exit 1 —— 二进制自身健康 |

改名（`favbase-cli` → `favbase`）后重测：`pnpm --filter favbase test` 56 例仍全绿，`dist/cli.js` 56.46 KB。全局包需先 `npm rm -g favbase-cli` 再装新名，否则两个包争同一个 `favbase` bin。

`.gitignore` 顺手补了 `packages/*/*.tgz`（`git check-ignore -v` 已确认命中），
否则每次走选路 A 都会在工作区留一个未跟踪的构建产物。

**验证 3-5 挂起，但阻断原因已换人**。本机 `~/.favbase/config.json` 早已配过
（token 43 字符 / 端口 17836），所以第 3 步免做；第 4 步 `favbase doctor` 起得来 daemon
（`spawned: true`、`/health` 正常），扩展侧却是：

```
"extension": { "connected": false, "extensionId": null, "tools": [],
                "rejectedHelloCount": 0, "lastRejectedHelloAt": null }
```

等满一个 alarm 周期（75 秒）后复跑，结果一字不变。**`rejectedHelloCount: 0` 是关键判别符**：
token 不匹配会让这个计数涨（docs/24 Step 4 加它就是为了这个），计数为 0 说明扩展**根本没拨过号**——
不是配对错，是扩展侧没在连。剩下三种可能全在 Chrome 侧，CLI 无从代劳：扩展没装进这个 Chrome 实例、
Settings > Connections 里 Agent Bridge 没开、或扩展配的端口不是 17836。

因此本轮实测的结论是：**CLI 二进制与交付路径已全部健康，Step 0 的判据 `ok: true`
现在只差 Chrome 侧开启 Agent Bridge 这一步人工动作**。这与首轮的"空输出 exit 0"是完全不同性质的
阻断——首轮是代码坏了，这轮是环境没配。Step 1-6 的实机验证不再被代码阻断。

**回滚** `npm rm -g favbase` 或 `pnpm rm --global favbase`。

**判据** 不改任何源码即完成，`favbase doctor` 返回 `ok: true`。冷启动首次可能等一个 alarm 周期（Chrome 120+ 约 30 秒，116-119 约 60 秒）。

---

## Step 0.5 — 修入口守卫（P0，阻断其余全部 Step）—— **已落地 2026-09-07**

**目标** 让全局安装的 `favbase` 真的执行，并让这类失效在测试里可被抓到。

**依赖** Step 0 的实测发现（证据 9）。**阻断 Step 1-6 的全部实机验证** —— 在它修好前，任何「跑一下看看」都得不到输出。

**文件**

- `packages/favbase/cli.ts:13-15`
- `packages/favbase/integration.test.ts`（新增经符号链接调用的例）
- `packages/favbase/CLAUDE.md`（Modules 段的 `cli.ts` 描述）

**改法** 两个选项：

| 选项 | 做法 | 评价 |
|---|---|---|
| **0.5a** | 删掉守卫，`cli.ts` 顶层直接调 `main` | **推荐**。守卫零消费者（证据 9），`cli.ts` 是 bin 专用入口，没有任何模块 import 它，`files: ["dist"]` 也保证它不会被当库消费。删掉即消除整类特殊情况 |
| 0.5b | 两边都取 realpath 再比较（`realpathSync(process.argv[1])` vs `fileURLToPath(import.meta.url)`） | 保留守卫，但要多一次同步 fs 调用与一处 try/catch（argv[1] 可能已被删除或不可解析）。守卫仍然没有消费者，等于为不存在的场景付复杂度 |

按「消除特殊情况优于增加条件判断」选 **0.5a**。

**2026-09-07 落地（选 0.5a）** 守卫整段删除，`cli.ts` 顶层无条件 `void main(...)`，
并留一条注释说明为什么这里不该有守卫（防止后来者"补回"）。`pathToFileURL` 的
import 随之删掉，`fileURLToPath` 仍用于 `cliPath`。

走真实交付路径的回归例已加在 `integration.test.ts` 末尾：用 `symlink(dirname(CLI_PATH),
linkDir, 'junction')` 建一个指向 `dist/` 的链接，经 `<link>/cli.js` spawn `--version`。
选 junction 而非文件符号链接，是因为 Windows 上非特权用户建 junction 不需要开发者模式；
POSIX 忽略该 type，退化成普通目录符号链接。**本机实测未走 skip 分支**，
建链接成功，因此这条例在 Windows 上是真的在跑，不是静默跳过。

先红后绿已验证：在修复前的 `dist/` 上跑该例得到 `expected '' to be '0.1.0'` ——
正是证据 9 描述的"空输出 exit 0"，说明这条例真的抓得住这类回归。

**测试** 这条 bug 的根因是**测试的调用方式与交付方式不一致**，所以修复必须附带一个走真实交付路径的例：`integration.test.ts` 新增一例，在临时目录建一个指向 `dist/cli.js` 的符号链接，经该链接 spawn 并断言 `--version` 输出版本号。Windows 上普通用户建 symlink 需要开发者模式，建不出来时用 junction 或显式 skip 并标注原因——但**不能没有这个例**，否则同类回归还会再来一次。

**验证** `npm i -g ./favbase-0.1.0.tgz` 后 `favbase --version` → `0.1.0`；`favbase doctor` 有 JSON 输出；`favbase search x --limit 0` 有 stderr。

**回滚** 单文件 revert。

**判据** 经符号链接调用与直接调用行为一致，且测试覆盖前者。

---

## Step 1 — 修掉三处指向未发布包的安装指引

**目标** 让「复制 → 粘贴 → 能跑」这条路在未发布状态下成立，并消掉 SKILL.md 里那条自相矛盾的 npx 回退。

**依赖** Step 0（先确认本地 PATH 形态可用，再决定文案写什么）。

**文件**

- `entrypoints/app/sections/settings/agent-bridge-card.tsx:69`（`setupCommand` 构造）
- `skills/favbase/SKILL.md`（Prerequisites 段 + frontmatter `allowed-tools`）
- `README.md:88-98`
- locale `settings.agentBridge.commandsHint`（zh-CN + en，两边都要改）

**改法** 核心分支是「前缀写什么」。三个选项：

| 选项 | 做法 | 代价 |
|---|---|---|
| **1a** | 命令前缀收敛成单一常量（如 `lib/agent-bridge/cli-invocation.ts` 导出 `CLI_COMMAND = 'favbase'`），三处消费同一个值 | 改动最小，DRY；但 card 从此假定用户已装好 CLI，需要 hint 里补一句怎么装 |
| **1b** | card 保留 `npx` 形式（发布后就对了），另加一个「本地开发」折叠块给出 Step 0 的命令 | card 复杂度上升，且发布前默认按钮仍是坏的 |
| **1c** | 直接发布 npm | 用户已明确暂不（D1） |

**建议 1a**，理由：`allowed-tools: Bash(favbase:*)`（证据 3）已经把 agent 侧锁死成裸 `favbase`，那么让人侧和 agent 侧用同一个前缀是唯一自洽的选择；npx 形式在发布后也只是「另一种装法」，不该是文档主线。

配套：SKILL.md 删掉 npx 回退句（它在自己的 allowed-tools 下不可用），Prerequisites 改为「`favbase` 必须在 PATH 上」+ 指向 README 的安装段。**不要**为了留住 npx 而放宽 `allowed-tools` —— 那会让 agent 在没装 CLI 时反复跑网络安装，慢且不确定。

**测试**

- `agent-bridge-card.test.tsx` 加例：断言复制出的命令以约定前缀开头（现有测试若锚定 `npx` 字面量需同步改）
- `tests/i18n-no-hardcoded.test.ts` 已存在，改 locale 时自动兜底
- `tests/agent-bridge-cli-aliases.test.ts` 的两份平台清单对账不受影响（只改 Prerequisites 段），但**改完必须跑一次**确认没碰到锚定形状（铁律 4）

**验证** 从设置卡复制命令 → 终端粘贴 → 直接成功；`git grep -n "npx -y favbase"` 只在「发布后可选装法」的语境里出现。

**回滚** 单 commit revert；无数据迁移。

**判据** 三处指引与「未发布 + 已 link」的现实一致；SKILL.md 内不再存在与 `allowed-tools` 冲突的指令。

**2026-09-08 落地（选 1a，判据改写）** D1「暂不发布」当天作废，包按 0.1.0 发 npm，所以判据的前半句换成「三处指引与已发布的 `favbase@0.1.0` 一致」。选项仍取 1a 而非 1b，理由不变且更硬：`allowed-tools` 把 agent 侧锁死成裸 `favbase`，人侧若经 npx 配对，`setup` 写完 config 与 skill 就结束，机器上并没有 agent 能调用的 `favbase`——那是一台「配好了但用不了」的机器。

**偏离手册两处**：

1. **不建共享常量**。手册 1a 让三处消费 `CLI_COMMAND = 'favbase'`，但三个消费点里只有 `agent-bridge-card.tsx` 是代码，SKILL.md 与 README 是 shipped markdown，引不到常量。为单一消费者建常量是仪式，真正的跨文件约束由测试守，不由常量守。
2. **加了手册没要求的守卫**。`tests/agent-bridge-cli-aliases.test.ts` 追加一个 describe：一例锁 `allowed-tools: Bash(favbase:*)` 行的形状，一例断言正文零 `npx`/`pnpm dlx`/`bunx`/`yarn dlx`。理由是这条矛盾隐性——frontmatter 与正文隔二十行，review 看不出来。第一版守卫**红在自己身上**：改写后的 Prerequisites 里那句「so there is no npx fallback」含该词。没有给守卫开例外，而是把散文里的词也去掉，让规则无例外（先红后绿已验证）。

**手册未记的证据** `settings.agentBridge.errorBadToken` 的文案本就是「复制并运行修复命令，然后执行 `favbase daemon restart`」。同一张卡片里，错误提示早已假定 CLI 在 PATH 上，只有复制按钮在发 npx。这不是「发布前的权宜」，是卡片内部自相矛盾——这条使 1b（保留 npx + 折叠块）连过渡方案都算不上。

**实际改动** `agent-bridge-card.tsx` 的 `buildSetupCommand` 与其 JSDoc（写明为什么是裸命令）、`agent-bridge-card.test.tsx:128` 的字面量锚点、`commandsHint` zh/en（补 `npm install -g favbase`，命令仍单行——不发 `A && B`，Windows PowerShell 5.1 没有 `&&`）、`skills/favbase/SKILL.md` Prerequisites、根 `README.md:88-96`（`npx skills add InvisibleQAQ/favbase` 保留，那是另一个工具）、`tests/agent-bridge-cli-aliases.test.ts` 新 describe、`entrypoints/app/sections/settings/CLAUDE.md`。`packages/favbase/README.md` 本就写的 `npm install -g favbase`，无需改——它才是 npm 详情页正文。

---

## Step 2 — skill 漂移检测

**目标** 让「已安装的 SKILL.md 落后于仓库」变成 `doctor` 能报出来的事实，而不是靠人 diff（证据 4）。

**依赖** Step 1（先把文案改对，再让 doctor 去比对；否则会持续报一份错文案的漂移）。

**文件**

- `packages/favbase/skill-install.ts`（新增只读比对函数）
- `packages/favbase/cli-main.ts:190` 附近 `runDoctor`（输出新增段）
- `packages/favbase/cli-main-doctor.test.ts`
- `packages/favbase/CLAUDE.md`（Modules 段同步）

**改法** CLI 内已带打包好的 SKILL.md 单源（`io.skillContent`，证据 7），所以比对是纯本地操作，不需要扩展在线：

```
doctor 输出新增
  skill: [{ path, state: 'current' | 'stale' | 'missing' }]
```

三态判定：文件不存在 → `missing`；内容与 `io.skillContent` 不等 → `stale`；相等 → `current`。检查 `SKILL_AGENTS` 两个根（`~/.claude/skills/favbase/`、`~/.agents/skills/favbase/`）。任一非 `current` 时 stderr 追加一行 `favbase install-skill` 提示。

**不要**做的两件事：不比版本号（SKILL.md 里没有版本字段，加一个就多一处要同步的手写值）；不自动重装（`doctor` 是诊断命令，静默改用户 home 里的文件违背最小意外原则）。

**测试** `cli-main-doctor.test.ts` 三例（current / stale / missing），用 `FAVBASE_HOME` + 临时 home 注入。

**验证** 手动把已安装副本改一个字符 → `favbase doctor` 报 `stale` → `favbase install-skill` → 再 doctor 报 `current`。

**回滚** 输出字段是新增的，删掉即回到旧行为；`daemon-client.ts` 的解码不受影响（纯 CLI 侧本地检查，不走 RPC）。

**判据** 本机那份陈旧副本能被机器发现。

---

## Step 3 — 检索健康度可见

**目标** 让 agent 能区分「用户确实没收藏这个」和「语义检索根本没在工作」（证据 5）。

**依赖** Step 0。与 Step 2 并列，无先后。

**文件**

- `lib/agent-bridge/protocol.ts`（`hello` 或 status 响应加**可选**诊断字段）
- `lib/agent-bridge/client.ts`（扩展侧填充）
- `packages/favbase/bridge-server.ts`（descriptor state 存下）
- `packages/favbase/rpc-server.ts` + `daemon-client.ts`（`/status` 透出，老 daemon 供 null）
- `packages/favbase/cli-main.ts` 的 `runDoctor`

**改法** 关键设计选择（D4）：**不做成第四个 Knowledge Tool**。理由是铁律 1 —— 那会强制给 Chat 也加一个「查检索健康度」的工具，而 Chat 页有自己的 UI 展示这类状态，不需要模型去调工具问。所以走 `/status` 诊断通道：

```
extension: {
  ...,
  retrieval: { embedding: 'off' | 'ready' | 'dimension-mismatch', embeddedChunks: n } | null
}
```

`embedding` 三态直接来自 `getEmbeddingSettings()` 与 `EmbeddingDimensionError` 的现有语义（`retrieval.ts:29`、`retrieval.ts:102`），不新增判定逻辑。`null` 表示对端是旧版本。

**待决策**：`embeddedChunks` 需要一次 `COUNT(*)`，在 hello 时算还是 status 时算？建议 status 时算（hello 在 SW 冷启动路径上，别加 DB 查询）。

**测试**

- `lib/agent-bridge/protocol.test.ts`：新字段缺省时解码仍通过（向后兼容断言，铁律 5）
- `packages/favbase/rpc-server.test.ts` + `daemon-client.test.ts`：老 daemon 形状供 `null`
- `cli-main-doctor.test.ts`：三态呈现

**验证** 关掉 embedding 配置 → `favbase doctor` 报 `embedding: 'off'` → `favbase search` 仍能返回关键词命中，但 agent 已被告知语义臂未工作。

**回滚** 可选字段，两端各自 revert 均不破坏对方。

**判据** 未配 embedding 时，agent 能从 `doctor` 得到明确信号，而不是只看到一个合法的低质量结果集。

---

## Step 4 — 能力面缺口：新增 Knowledge Tool

**目标** 补上「无 query 的列举」这个真实缺口。

**依赖** Step 0。**成本前置**：铁律 1（D3）—— 加工具同时改 Chat 的工具面与 system prompt（`lib/chat/prompts.ts`）。这不是 CLI 的局部改动，是产品面改动。

**文件**

- `lib/chat/tools.ts`（新工具定义）
- `lib/chat/prompts.ts`（system prompt 提到新工具）
- `lib/collections/`（复用现有分页查询，**不要**新写 SQL）
- `packages/favbase/commands.ts`（新别名）
- `skills/favbase/SKILL.md`（Commands + Workflow 段）
- `tests/agent-bridge-cli-aliases.test.ts`（别名对账，自动会红）

**改法** 三个候选，各对应一句今天答不出来的用户提问：

| 候选 | 对应提问 | 现状为何答不出 | 建议 |
|---|---|---|---|
| `listItems`（`platform?` / `tag_id?` / `limit`，按收藏时间倒序） | 「我最近收藏了什么？」 | `searchKnowledgeBase` 的 `query` 是必填（`tools.ts:57`），没有无 query 的列举路径 | **做**。缺口最真实，且 `lib/collections/` 已有分页查询可复用 |
| `getItemByUrl` | 「我收藏过这个链接吗？」 | 只能 `search` URL 文本，命中靠运气；`getItemContent` 只认 `item_id` | 暂缓，等真实需求出现 |
| `collectionStats` | 「我一共收藏了多少 / 各平台怎么分布」 | 无工具；扩展侧 `CollectionAnalyticsSnapshot` 已有全部数字 | 暂缓。Dashboard 已经把这些数字给人看了，agent 需要它的场景还没出现 |

**建议 D6：本 Step 只做 `listItems`。** 每加一个工具都同时增加模型的选择负担和 Chat 的 prompt 长度，三个一起上是拿确定的复杂度换不确定的收益。

**测试** `lib/chat/tools.test.ts`（含已有的「不得出示部分平台清单」守卫）、`tests/agent-bridge-cli-aliases.test.ts`、`lib/agent-bridge/tool-registry.test.ts`（JSON Schema 生成）。

**验证** `favbase tools` 列出 4 个工具；`favbase list --platform bilibili --limit 5` 返回最近 5 条；Chat 页问「我最近收藏了什么」能走通新工具。

**回滚** 删工具即回到 3 个；但**注意**已安装的 SKILL.md 副本会残留新命令说明（这正是 Step 2 存在的价值）。

**判据** 「我最近收藏了什么」这类无关键词提问有工具可答；Chat 与 Bridge 的工具集仍完全相同。

---

## Step 5 — 实机端到端验证清单

**目标** 把只做过一次的人工验证固化成可重复的 checklist（证据 6）。

**依赖** Step 1-4 中实际落地的那些（清单要覆盖改过的面）。

**文件** 本文附录 C（骨架已备），或 `packages/favbase/CLAUDE.md` 新增一节。

**改法** 不追求自动化 —— 真 Chrome + 真扩展 + 真 alarm 周期不适合进 vitest（会引入 60 秒级等待和外部依赖）。清单内容见附录 C。

**测试** 不适用（本 Step 产出的就是测试规程）。

**验证** 清单跑一遍，每条记录**实际观测值**，不是「应该」。

**回滚** 纯文档。

**判据** 下一个人（或下一个会话）能照单复现，不必重新推导。

---

## Step 6 — 小瑕疵收口

**目标** 清掉三处已定位但不紧急的粗糙点。

**依赖** 无，可随时插入。

**文件** `packages/favbase/commands.ts`、`lib/chat/tools.ts`、locale `settings.agentBridge.errorVersion`。

**改法**

1. **`--limit` 缺本地上界校验**。`commands.ts:78` 只验 `Number.isSafeInteger`，所以 `--limit 999` 和 `--limit -5` 都会一路传到扩展侧被 zod 拒（`tools.ts:60` 的 `min(1).max(20)`），返回 exit 3。改法：别在 CLI 里手写 `1-20`（那是第二处事实源），只在 CLI 侧拒绝非正整数（`< 1` 明显是用法错误，与 schema 无关），上界仍交给 schema。
2. **`getItemContent` 的 `found: false` 语义重载**（`tools.ts:110`）。`item_id` 不存在与「存在但无已提取正文」返回同一个形状，agent 无法区分「id 错了」和「这项还没提取」。改法：查一次 `items` 表存在性，分成两态。
3. **三处版本各自独立**（证据 8）。`errorVersion` 让用户升级 CLI，但没有比对机制。hello 已带 CLI 版本，扩展侧可在协议不兼容时把双方版本写进那条错误文案。**建议**：等真出现版本不兼容再做，现在只有 v1。

**测试** `commands.test.ts` 加非正整数例；`lib/chat/tools.test.ts` 加「id 不存在」与「无正文」两态例。

**验证** `favbase search x --limit 0` 在 CLI 侧就返回 exit 1（不再跑一趟 RPC）；`favbase get <不存在的 id>` 与 `favbase get <无正文的 id>` 返回可区分的形状。

**回滚** 三条独立，可逐条 revert。

**判据** 每条要么改掉，要么在本文明确记为「接受现状」并写下理由。

---

## 附录 A — 经决策排除

| 项 | 理由 |
|---|---|
| 发布 npm | 用户 2026-09-07 明确暂不（D1）。发布后 Step 1 的 npx 形式会重新变成合法的可选装法，但那时也不该是主线（证据 3） |
| 提供 MCP server | ADR 0003 已否 |
| 给 CLI 加「专属」工具 | 违反铁律 1；`tests/agent-bridge-cli-aliases.test.ts` 会红，而且那是对的 |
| 放宽 `allowed-tools` 以救 npx 回退 | 会让 agent 在未装 CLI 时反复走网络安装，慢且不确定（Step 1 详述） |
| 给 SKILL.md 加版本号字段 | 多一处手写值要同步；内容哈希比对已足够（Step 2） |
| 自动化真 Chrome E2E | 60 秒级 alarm 等待 + 外部依赖，不适合进 vitest（Step 5） |

## 附录 B — `[UNKNOWN]`

1. `[UNKNOWN]` `README.md:95` 声称可用 `npx skills add InvisibleQAQ/favbase` 安装 skill —— 未验证该命令今天是否可用、是否要求仓库公开。Step 1 改 README 时顺手验一次。
2. ~~`[UNKNOWN]` `pnpm link --global` 在本机是否已配好 global bin~~ —— **2026-09-07 已查**：`pnpm config get global-bin-dir` 返回 `undefined`，但 `PNPM_HOME=C:\Users\18368\AppData\Local\pnpm` 已设且在 PATH 上（目录下目前只有 `store/`）。选路 B 应可用，未实测——且在 Step 0.5 修好前实测也没有意义（`pnpm link` 同样经符号链接，必然踩证据 9）。
3. ~~`[UNKNOWN]` npm 上包名是否可用~~ —— **2026-09-08 已查（订正）**：直接请求 `https://registry.npmjs.org/favbase` 与 `/favbase-cli`，均 HTTP 404；`/-/v1/search?text=favbase` 返回 `total: 0`。**注意不要用本机的 `npm view` 判断**——本机 `npm config get registry` 是 `https://registry.npmmirror.com`（只读镜像），它的 404 不能证明官方源上的可用性，`npm publish` 也必须显式 `--registry https://registry.npmjs.org` 才不会失败。**用户 2026-09-07 决定改用 `favbase`**（包名与 bin 名从此一致），包目录同步改为 `packages/favbase/`，见本文开头的改名记录。

## 附录 C — 实机 checklist 骨架

Step 5 落地时填入实测值。`预期`列现在就写死，`实测`留空。

| # | 场景 | 预期 | 实测 |
|---|---|---|---|
| 1 | Chrome 冷启动后首次 `favbase search` | 一个 alarm 周期内返回（30s / 60s 按 Chrome 版本） | |
| 2 | 错 token | doctor 的 `troubleshooting` 指出 bad-token，带计数与时间（`cli-main.ts:104`） | |
| 3 | 扩展断开 + `FAVBASE_DAEMON_IDLE_MINUTES=1` | daemon 退出；有认证 peer 时**不**退 | |
| 4 | Chrome 关闭 | exit 2 + 明确提示 | |
| 5 | 端口被非 favbase 进程占用 | exit 1，且**不**杀占用者 | |
| 6 | Windows 首个数据命令 | daemon 自启（detached），日志落 `~/.favbase/daemon.log` | |
| 7 | 陈旧 skill 副本（Step 2 后） | doctor 报 `stale` | |
| 8 | 关闭 embedding（Step 3 后） | doctor 报 `embedding: 'off'` | |
| 9 | 经符号链接／junction 调用（Step 0.5 后） | `favbase --version` 输出版本号，不是空输出 | |
