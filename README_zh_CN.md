<p align="right">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

<img src="./assets/readme/hero.zh-CN.svg" alt="favbase 将 Bilibili、GitHub、浏览器书签、X、知乎和 YouTube 收藏汇入一个本地知识库" width="100%">

favbase 是一款本地优先的 Chromium 浏览器扩展，面向收藏散落在不同平台的普通用户。它把已保存的内容收进浏览器本地资料库，让你统一搜索、提问，并从答案返回原始来源。

> [!IMPORTANT]
> favbase 仍在积极开发中。目前没有浏览器商店版本或 GitHub Release，试用需要[从源码构建](#从源码安装)。

## 你可以做什么

- **汇集六个平台。** 集中浏览收藏、Star、书签和播放列表，不必反复切换平台界面。
- **把收藏变成知识。** 提取正文、拆分可检索片段、生成标签，并在本地 PGlite 数据库中建立向量。
- **不只匹配原词。** 在整个收藏库中结合关键词与语义检索。
- **带证据地提问。** 基于收藏内容对话，并打开每条答案引用的原始收藏项。
- **找回视频中的文字。** 优先使用 Bilibili 官方字幕，无字幕时可配置 ASR 作为后备。
- **随时带走数据。** 导出 JSON 或 CSV 备份，也可生成适配 Obsidian 的 ZIP。

## 工作方式

<img src="./assets/readme/workflow.zh-CN.svg" alt="从采集收藏、在本地整理到搜索和带来源回答的概念流程" width="100%">

上图是产品流程说明，不是界面截图。每条收藏进入 favbase 后会成为一个保留来源 URL 和元数据的 **Collection Item（收藏项）**。内容可用时，favbase 会将其分块、打标签并建立向量，用于后续检索。搜索和 Chat 的结果始终关联原始收藏项，方便你自行核对上下文。

## 支持的来源

| 来源 | favbase 采集的内容 | 连接方式 |
| --- | --- | --- |
| Bilibili | 收藏夹、视频和可用字幕文本 | 浏览器中现有的 Bilibili 登录状态 |
| GitHub | Star 仓库及仓库信息 | GitHub Personal Access Token |
| 浏览器书签 | 书签文件夹、链接和可提取的网页正文 | 本地浏览器书签权限 |
| X | 书签和帖子元数据 | 浏览器中现有的 X 登录状态 |
| 知乎 | 收藏夹、回答和文章 | 浏览器中现有的知乎登录状态 |
| YouTube | 播放列表、视频和可用元数据 | YouTube Data API Key |

GitHub 和 YouTube 首次同步前必须在 **设置 → 连接** 中配置凭据。Bilibili、X 和知乎复用浏览器已有的登录状态；favbase 不会要求你粘贴这些平台的账户密码。

## 隐私边界

“本地优先”只描述知识库的默认存储位置：favbase 将其保存在基于 IndexedDB 的浏览器本地 PGlite 中。它**不代表**所有操作都离线，也不代表所有数据处理都留在设备上。

- 从平台采集内容时，会使用上表所列连接方式向对应平台发起请求。
- LLM、Embedding、ASR 及兼容的 AI 功能会把相关查询、文本或媒体发送给你配置的服务商。
- 实验性的 WebDAV 功能目前同步整份应用配置和语言设置，**不会同步知识库数据库**。配置中可能包含 API Key 或 Token，因此只能使用你信任的 WebDAV 服务。
- 导出文件包含你的资料库数据，请按敏感数据妥善保存和分享。

即使没有配置所有 AI 服务，你仍可导入和浏览收藏。语义检索、AI 标签、Chat 和转录后备能力需要各自对应的服务配置。

## 从源码安装

### 环境要求

- Chromium 内核浏览器
- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) 和 [pnpm](https://pnpm.io/)

### 构建并加载

```bash
git clone https://github.com/InvisibleQAQ/favbase.git
cd favbase
pnpm install
pnpm build
```

1. 打开浏览器扩展管理页，例如 `chrome://extensions`。
2. 启用**开发者模式**。
3. 点击**加载已解压的扩展程序**。
4. 选择构建生成的 `.output/chrome-mv3` 目录。

安装后打开 favbase，选择一个来源并执行首次同步。如果从 GitHub 或 YouTube 开始，请先配置对应凭据。语义检索需要 Embedding 服务，Chat 和 AI 标签需要 LLM 服务。

## 开发

favbase 使用 WXT、React、TypeScript、PGlite/pgvector 和 Vitest 构建。

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动扩展开发构建 |
| `pnpm build` | 生成 Chromium 生产构建 |
| `pnpm compile` | 执行 TypeScript 检查，不生成文件 |
| `pnpm test` | 运行测试套件 |

架构记录和实现规格位于 [`docs/`](./docs/)。其中部分文档记录的是历史决策；当旧计划与当前实现冲突时，应以当前源码和测试为准。

## 项目状态与许可证

favbase 仍是预发布软件，部分流程可能不完整，数据迁移也存在风险；重要数据请保留备份。欢迎提交问题和范围清晰的 Pull Request。

项目使用 [GNU General Public License v3.0](./LICENSE) 许可。
