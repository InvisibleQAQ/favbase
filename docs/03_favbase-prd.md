# favbase — 产品需求文档 (PRD)

**版本**: v1.5-draft
**日期**: 2026-06-14
**状态**: 待审核
**变更**: 新增 i18n 国际化支持（简体中文 / English），默认跟随浏览器语言，用户可手动切换

---

## Problem Statement

用户在 B站、知乎、X 等社交平台上收藏了大量内容，但原生收藏夹依然沦为"写入即遗忘"的信息坟场。favbase 的 MVP 先从 B站切入，但问题本质不是单平台，而是：社交媒体收藏很少被自动沉淀为知识库。

1. **找不到**：平台收藏夹只支持精确关键词匹配，无法按"意思"检索。
2. **不沉淀**：视频、帖子、回答内容锁在平台里，没有被抽成可搜索的文本。想回忆某个观点，只能盲目翻收藏夹。
3. **会消失**：内容下架、删稿、改权限后，收藏随时失效，用户没有稳定的本地副本。
4. **太费心**：市面上大多数知识库要求用户主动复制链接、粘贴内容、手工整理或维护第二套录入流程；社交媒体收藏很少能自动进入知识库，占用户心智。
5. **难同步**：即便本地已经沉淀出知识库，换设备或跨平台终端使用时仍然缺少轻量同步路径；要么重新导入重建，要么被迫走自部署后端。

---

## Solution

favbase 是一款 Chromium 浏览器扩展，目标不是让用户再维护一套手工录入的知识库，而是把社交媒体收藏自动转成知识库。MVP 先从 B站收藏切入：插件自动提取字幕、清洗文本、本地索引，变成可语义搜索、可片段定位，并可选通过 WebDAV 多平台同步.

核心特征：

1. **自动化优先**：输入来自用户已经发生的收藏行为，而不是要求用户再复制链接、手工录入。浏览器收集必要的cookie接入收藏源后，插件在后台自动完成字幕提取、文本清洗、分块和索引，把收藏直接转成知识条目。
2. **浏览器插件形态**：浏览器商店一键安装即用，无需服务器、Docker、命令行或自部署。
3. **本地优先 + 可选 WebDAV 同步**：默认所有数据存在浏览器本地 PGlite 数据库（基于 IndexedDB）；用户可显式开启 WebDAV，把同一知识库同步到自己的 WebDAV 服务（如 Nextcloud、坚果云、InfiniCLOUD），实现跨设备、跨平台终端迁移和同步，不依赖 favbase 自建后端。
4. **敏感凭据不出本机**：B站 Cookie、SESSDATA、Embedding API Key 只保留在当前设备本地，不进入 WebDAV 同步载荷。
5. **计算可云端**：用户用自己的 API Key 调用外部 Embedding 模型（OpenAI 协议兼容）。无 API Key 时退化为关键词搜索，系统仍可用。
6. **检索 + 片段展示**：不做 LLM 生成式回答，提供混合检索（关键词 + 语义 + 过滤）和匹配片段高亮，附带视频时间戳定位。

核心差异化：

1. **不占用户心智**：favbase 利用用户已经存在的收藏动作做输入，而不是逼用户再维护第二套知识录入流程。
2. **切入社交媒体收藏**：这不是通用网页剪藏器；产品从社交平台收藏切入，MVP 先打穿 B站，后续再扩到其他平台。
3. **轻安装 + 轻同步**：入口是插件商店安装，迁移和多设备同步走 WebDAV，而不是要求用户自部署整套服务。

一句话定位：**把你的社交媒体收藏，自动变成可搜可定位、可跨设备同步的本地优先知识库；MVP 先从 B站开始。**

当前 MVP 边界：本版只交付 B站 收藏导入、字幕提取、搜索和可选 WebDAV 同步闭环；X、知乎、小红书等平台仍属于后续扩展，不在本版交付范围内。

**开源项目**：favbase 是一个开源项目，代码公开托管，接受社区贡献。所有功能对用户免费

---

## User Stories

### 内容接入

1. 作为 B站用户，我想安装插件后一键导入收藏夹，不需要再把内容手工复制到别的知识库里，就能立即拥有可搜索的本地知识库。
2. 作为用户，我想选择导入哪些收藏夹（而非全量），只索引我真正关心的内容。
3. 作为用户，我想在 B站视频页通过 Popup 一键保存当前视频到知识库。
4. 作为用户，我想看到哪些内容已入库，避免重复操作。
5. 作为用户，我想在 B站 Cookie 过期时收到明确提示和重新登录引导。

### 内容处理

6. 作为用户，我想让插件自动获取视频字幕并存为本地文本，使视频内容可搜索。
7. 作为用户，我想让系统自动完成清洗、分块和索引，而不是自己整理收藏内容。
8. 作为用户，我想看到导入进度（"正在导入第 23/128 个视频"），知道系统在工作。
9. 作为用户，我想不配置 API Key 也能导入内容和关键词搜索——语义搜索是增值能力，不是准入门槛。
10. 作为用户，我想配置 API Key 后自动补全之前跳过的 embedding，存量内容也能语义搜索。

### 搜索与检索

11. 作为用户，我想通过语义搜索找到"某个 UP 主讲过的关于 xxx 的观点"，即使不记得原文关键词。
12. 作为用户，我想看到搜索结果以卡片展示：标题、UP 主、时间、匹配片段高亮、相关度评分。
13. 作为用户，我想在搜索结果中看到视频时间戳（如 12:34 - 15:20），点击直接跳转。
14. 作为用户，我想按 UP 主、时间范围过滤搜索结果。
15. 作为用户，我想看到最近搜索历史，快速重复之前的搜索。

### 信息浏览

16. 作为用户，我想打开 Side Panel 后看到搜索框和全部已入库内容列表。
17. 作为用户，我想按 UP 主分组浏览知识库内容。
18. 作为用户，我想点击卡片展开详情，看到完整摘要、匹配片段和时间戳列表。
19. 作为用户，我想从详情页一键跳转 B站原视频（带时间戳参数）。

### 首次使用

20. 作为新用户，我想从浏览器插件商店安装后直接开始使用，不需要额外安装本地服务或自部署。
21. 作为新用户，我想安装后被引导完成：B站登录检测 → 收藏夹选择 → （可选）API Key 配置。
22. 作为新用户，我想跳过 API Key 配置不影响基础功能。
23. 作为新用户，我想导入完成后立即看到内容列表，确认系统在工作。

### 错误与异常

24. 作为用户，我想在 Cookie 过期时看到提示条和重新登录链接。
25. 作为用户，我想在 Embedding API 失败时仍能关键词搜索。
26. 作为用户，我想在 offscreen 崩溃时无感知恢复（watchdog 自动重建）。
27. 作为用户，我想在导入失败时看到"重试"按钮。

### 国际化

28. 作为中文用户，我想安装插件后界面自动显示简体中文，不需要手动切换。
29. 作为英文用户，我想安装插件后界面自动显示英文，不需要手动切换。
30. 作为用户，我想在设置中手动切换界面语言（简体中文 / English），切换后立即生效，无需重启插件。
31. 作为用户，我想让搜索功能不受界面语言影响——搜索始终基于收藏内容的原始语言，而非 UI 语言。

### 数据管理

32. 作为用户，我想删除单条已入库内容。
33. 作为用户，我想对单条内容触发"重新索引"。
34. 作为用户，我想看到知识库统计（总条目数、已索引数）。

### 多设备同步

35. 作为用户，我想配置 WebDAV 地址、用户名和密码，并先测试连通性，再决定是否开启同步。
36. 作为用户，我想在一台设备上手动触发同步，把当前知识库推送到自己的 WebDAV 空间。
37. 作为用户，我想在另一台设备首次接入时直接拉取已有知识库，而不是重新全量导入收藏夹。
38. 作为用户，我想看到同步状态、上次同步时间和失败原因，知道远端是否可用。
39. 作为用户，我想明确知道哪些内容会同步、哪些不会同步，尤其是 B站 Cookie 和 API Key 不应被上传。
40. 作为用户，我想在多设备内容冲突时使用可预测的规则合并，并在大规模覆盖或删除前收到警告。
41. 作为用户，我想在不配置 WebDAV 的情况下导出一个可导入的本地备份包，用于迁移设备或灾难恢复。

---

## Implementation Decisions

### 模块划分（11 个模块）

#### 1. Message Bridge（消息桥）

系统脊柱。TypeScript 联合类型定义所有上下文间的消息，request-response 模式。

- Content Script → Background: `SAVE_CURRENT_ITEM`, `OPEN_SIDEPANEL`, `GET_PAGE_CONTEXT`
- Side Panel → Background: `RUN_SEARCH`, `GET_RECENT_ITEMS`, `DELETE_ITEM`, `GET_JOB_STATUS`, `CONFIGURE_API_KEY`, `CONFIGURE_WEBDAV`, `TEST_WEBDAV_CONNECTION`, `RUN_WEBDAV_SYNC`, `GET_SYNC_STATUS`, `SET_LOCALE`, `GET_LOCALE`
- Background → Offscreen: `INGEST_ITEM`, `GENERATE_EMBEDDINGS`, `VECTOR_SEARCH`, `TEXT_SEARCH`, `SYNC_FAVORITES`, `RUN_WEBDAV_SYNC`, `TEST_WEBDAV_CONNECTION`, `HEALTH_CHECK`

统一错误格式：`{ success: boolean; data?: T; error?: { code: string; message: string } }`

#### 2. Database Layer（数据库层）

PGlite 初始化、schema 迁移、查询封装。仅在 offscreen 中运行。

- PGlite `idb://favbase` 基于 IndexedDB 持久化
- pgvector 扩展，向量维度锁定 1536
- 12 表完整 schema，MVP 阶段 QA 三表和 digests 表建但不用
- 版本化迁移通过 `_migrations` 表追踪
- 所有参与双向同步的记录必须具备稳定主键、`updated_at` 和软删除标记（如 `deleted_at` 或 tombstone），否则无法做确定性合并

约束：PGlite 单连接（offscreen 唯一持有者）、不支持中文分词插件、vector 列维度不可变、**不能直接把 IndexedDB/PGlite 底层文件当同步对象**

#### 3. Offscreen Runtime（离屏运行时）

Background 通过 `chrome.alarms` 每 60 秒 watchdog 巡检，`chrome.runtime.getContexts()` 检测存活，丢失时自动重建。重建后重连 PGlite（数据不丢）、interrupted 任务可重试。WebDAV 同步任务也在 offscreen 中串行运行，避免 UI、同步和导入任务同时争抢数据库主连接。

#### 4. B站 API Client

Cookie-based B站 API 封装。`chrome.cookies.get()` 获取 SESSDATA/bili_jct/DedeUserID。请求队列串行处理，2-5 秒随机延迟，429 指数退避，401 检测通知 UI。

已验证端点：

- 收藏夹列表 `/x/v3/fav/folder/created/list-all`
- 收藏夹视频 `/x/v3/fav/resource/list`
- **视频字幕获取** `/x/player/v2?bvid={bvid}&cid={cid}`（已通过 Bilitato 开源项目验证）

字幕获取路径（已验证）：

1. 调用 `/x/player/v2`，需携带 Cookie（`credentials: "include"`）
2. 从响应 `data.subtitle.subtitles` 数组获取字幕轨列表
3. 每条字幕轨包含 `lan`（语言代码）、`lan_doc`（语言描述）、`subtitle_url`（字幕 JSON 地址）
4. 中文字幕选择：遍历数组找 `lan_doc` 包含"中文"的轨道
5. `subtitle_url` 格式为 `//aisubtitle.hdslb.com/bfs/ai_subtitle/...json`，需补 `https:` 前缀
6. Fetch 字幕 JSON 后从 `body` 字段取出时间戳数组：`[{from, to, content}, ...]` 或 `[{start, end, text}, ...]`

注意：不是所有视频都有 AI 字幕。无字幕视频需走降级路径（见 Ingestion Pipeline）。

技术参考：Bilitato `content.js` 的 `fetchSubtitleByPlayerApi()` 函数实现了完整的主动 API 调用路径；`inject.js` 实现了 fetch/XHR 拦截的被动捕获方案。favbase 采用主动 API 调用方案（不需要用户停留在视频页面）。

#### 5. Ingestion Pipeline

offscreen 中运行的处理链：获取元数据 → 写入 items/entities → 获取字幕 → 字幕预处理 → 写入 item_contents → chunk（保留时间戳）→ 写入 item_chunks → 调用 Embedding API → 写入 item_embeddings → 更新 content_state。失败记录到 jobs 表。

**字幕预处理管线**（参考 Bilitato `subtitleProcessor.js`，适配 favbase 需求）：

1. 文本标准化：全角字符转半角，去除无意义括号内容（如 `[笑声]`、`(鼓掌)`）
2. 过滤噪声：移除互动引导句（含"点赞""投币""关注""一键三连"等关键词的句子）
3. 语气词处理：去除纯语气词句（"嗯""啊""那个"等），剥离长句开头的填充词
4. 保留事实信息：含数字、年份、百分比等的句子强制保留，不因短句误删
5. 相邻去重：Jaccard 相似度 > 0.85 的相邻句段合并，保留较长文本

**chunk 策略**：以 30 秒时间窗口为基本单元合并字幕句，每 chunk 保留起止时间戳和内部逐句时间标记 `[m:ss]`。相邻 chunk 间隙超过 2 秒或超出窗口时断开。这样 chunk 天然对齐视频段落，时间戳定位直接可用。

**无字幕降级路径**：`/x/player/v2` 返回空字幕列表时，`content_state` 标记为 `'no_subtitle'`。MVP 阶段不实现 ASR 转录，仅基于视频标题和描述进行关键词检索。后续可参考 Bilitato 的 Groq Whisper 集成方案扩展 ASR 支持。

#### 6. Embedding Service

OpenAI 协议兼容客户端。支持批量 embedding。无 API Key 时标记 `'skipped'`，配置后自动补录。

#### 7. Search Engine

混合检索：ILIKE 文本匹配 + pgvector cosine 向量搜索 + 结构化过滤（UP 主 / 时间）。RRF 算法合并结果。无 API Key 时只走文本通道。

#### 8. WebDAV Sync Config & Client

同步配置与状态不放进主知识库，而是放在 WXT `local` storage：

- `webdavConfig`：`enabled`、`url`、`username`、`password`
- `syncStatus`：`idle | syncing | error`、`lastSyncTime`、`lastError`

底层使用浏览器可运行的 `webdav` 客户端库，负责：

- 目录存在性检查与创建
- JSON / `.json.gz` 文件读写
- 401 / 404 / 429 / 超时错误统一封装
- 对第三方 WebDAV 服务差异做适配

边界：这里只同步知识库数据和安全设置；**不**同步 B站 Cookie、Embedding API Key、临时 jobs 状态。

此外保留一条单机迁移/灾备路径：

- `Export Snapshot`：导出 `snapshot.tar.gz`
- `Import Snapshot`：在新设备本地一次性恢复

这个快照能力只解决**备份 / 迁移**，不参与多设备持续合并，不替代 WebDAV 协议。

#### 9. Sync Engine（WebDAV）

同步引擎运行在 offscreen，采用 `Pull -> Compare -> Merge -> Push` 状态机：

- WebDAV 是**传输层**，不是远端数据库
- 远端用 `sys.json` 保存锁状态、版本号、最后同步时间
- 冲突规则采用 **Last-Write-Wins + 软删除 tombstone**
- 写入顺序必须是：内容分块 / 向量分块先落远端，再更新远端目录元数据
- 首次新设备接入时支持 full pull
- 若一次同步会覆盖或删除超过阈值（如 30%），挂起并要求用户确认

同步粒度是**逻辑记录 + 分块文件**，不是复制 PGlite 文件。引擎维护两条能力：

1. **Snapshot Backup Path**
   - `export snapshot -> download snapshot.tar.gz`
   - `import snapshot -> local overwrite / merge`
   - 用于单设备迁移、人工备份、灾难恢复

2. **Continuous Sync Path**
   - `export delta -> push WebDAV -> pull remote -> merge -> apply`
   - 用于多设备持续同步

推荐远端目录结构：

```text
/favbase-sync
  ├── manifest.json
  ├── sys.json
  ├── settings.json
  ├── catalog.json.gz
  ├── content/
  │   └── <item-id>.json.gz
  ├── chunks/
  │   └── <chunk-id>.json.gz
  └── vectors/
      └── <embedding-profile>/<chunk-id>.json.gz
```

其中：

- `manifest.json`：远端 schema 版本、生成时间、chunk 编码版本、默认 embedding profile、catalog hash
- `catalog.json.gz`：`sources`、`entities`、`items` 的轻量索引、tombstone、内容 hash、向量 hash
- `content/<item-id>.json.gz`：单条内容正文、摘要、字幕元信息
- `chunks/<chunk-id>.json.gz`：单个 chunk 的文本、时间戳、偏移、hash
- `vectors/<embedding-profile>/<chunk-id>.json.gz`：向量数组与 profile 指纹

同步与恢复规则：

- `catalog` 是目录层，负责列出对象和版本
- `content` / `chunks` 是事实数据
- `vectors` 是**派生缓存**，不是事实源；只有 `provider + model + dimension` 一致时才复用，不一致时本地标记为待重建
- `snapshot.tar.gz` 可打包 `manifest + catalog + content + chunks + vectors`，供手动导出/导入

#### 10. UI Layer（Side Panel + Popup + Content Script）

**Side Panel**：搜索优先首屏。顶部搜索框固定，Tab 导航（全部 / UP主），卡片列表滚动加载，底部状态栏。搜索结果卡片含匹配片段高亮、相关度条、时间戳定位。

**Popup**：B站视频页显示"保存到知识库"按钮 + 当前状态；非 B站页显示统计 + "打开知识库"。

**Content Script**：检测 B站视频页，提取 BV号/UP 主/标题，与 Popup 通信。

**Onboarding**：Side Panel 内四步引导（登录检测 → 收藏夹选择 → 可选 API Key → 可选 WebDAV 配置）。

**Settings / Sync UI**：提供 WebDAV 配置表单、连接测试、手动同步按钮、首次拉取确认、上次同步时间和错误状态展示。

#### 11. i18n（国际化）

支持简体中文（zh-CN）和英文（en）两种语言。

**语言检测与切换**：

- 默认语言：读取 `navigator.language`，匹配 `zh` 前缀时使用 zh-CN，其余 fallback 到 en
- 用户可在设置中手动切换，选择后持久化到 `chrome.storage.local`（键：`locale`），优先级高于浏览器语言
- 切换后所有 UI 上下文（Side Panel、Popup、Onboarding、Settings）立即生效，无需重启

**翻译范围**：

- 所有 UI 静态文本：按钮、标签、提示、状态信息、错误消息、Onboarding 引导文案
- 不翻译用户数据：视频标题、UP 主名称、字幕内容、搜索结果片段保持原始语言
- 不翻译内部状态：日志、Message Bridge 消息类型、错误 code 字段

**实现约束**：

- 翻译资源为静态 JSON 文件，随扩展打包，不依赖远端翻译服务
- 翻译 key 采用扁平命名空间（如 `search.placeholder`、`onboarding.step1.title`），避免深层嵌套
- 所有面向用户的字符串必须通过 i18n 函数输出，禁止在组件中硬编码文本
- WebDAV 同步不包含语言偏好（属于设备级配置，不跨设备同步）

### 架构决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 扩展框架 | WXT (Vite) | 多入口管理清晰，MV3 支持好 |
| 数据库 | PGlite + pgvector on IndexedDB | 浏览器原生运行，SQL + 向量搜索 |
| 运行时 | MV3 SW + Offscreen Document | SW 路由，offscreen 重任务 |
| 前端 | React + TypeScript | WXT Vite 生态 |
| Embedding | 外部 API（OpenAI 协议） | 避免浏览器跑大模型 |
| 同步协议 | WebDAV（可选） | 用户自有存储，无需 favbase 托管后端 |
| 备份格式 | `snapshot.tar.gz` | 单机迁移/灾备简单直接，不引入持续同步冲突处理 |
| 同步粒度 | 逻辑记录 + gzip 分块文件 | 避免直接复制 IndexedDB/PGlite 文件，便于合并、校验和恢复 |
| 冲突策略 | Last-Write-Wins + tombstone + 远端锁文件 | 规则简单可预测，适合多设备离线后重连 |
| 向量语义 | 派生缓存 | 模型参数一致才复用，不一致则重建 |
| 凭据边界 | B站 Cookie / API Key 本地独占 | 降低远端泄露面，符合 local-first 叙事 |
| 目标浏览器 | Chrome / Edge 117+ | offscreen API 是 Chromium 特有；117 是 MUI v9 的浏览器下限（Agent Bridge 只需 116） |
| 问答方式 | 检索 + 片段展示 | 聚焦检索价值，无 LLM 依赖 |
| 国际化 | 静态 JSON 翻译文件 + `navigator.language` 检测 | 两种语言无需运行时翻译服务，随扩展打包零延迟 |

### 数据模型

**知识库主表**：sources、entities、items、item_contents、item_chunks、item_embeddings、search_history、jobs

**WebDAV 同步范围**：

- 参与同步：`sources`、`entities`、`items`、`item_contents`、`item_chunks`、`item_embeddings`
- 本地独占：`search_history`、`jobs`、B站 Cookie、Embedding API Key、语言偏好（`locale`）、临时 UI 状态
- 同步配置与状态：单独存 WXT `local` storage，不放入 PGlite 主库

为了支持双向同步，所有参与同步的记录需要补齐：

- 稳定主键（跨设备不变）
- `updated_at`
- 软删除标记（如 `deleted_at` / `is_deleted`）
- `content_hash` / `chunk_hash`
- 向量配置指纹（provider / model / dimension），用于判断远端向量是否仍可复用
- `vector_hash`，用于识别远端向量缓存是否与本地记录匹配

完整 DDL 见 [`docs/schema/v1_init.sql`](./schema/v1_init.sql)。

### 实施顺序

**阶段 A：本地闭环先跑通**

1. WXT 项目初始化 + 目录结构
2. 消息类型定义（系统脊柱）
3. i18n 基础设施（翻译 JSON、语言检测、切换持久化、i18n 函数）
4. Offscreen + PGlite 初始化 + 12 表 schema
5. Watchdog 机制
6. B站 Cookie 获取 + API 请求队列
7. 收藏夹列表 + 视频列表抓取
8. 字幕获取（`/x/player/v2` → 字幕 JSON URL → 字幕数据）+ 预处理管线（标准化/过滤/去重）+ 时间窗口 chunk
9. Embedding API 客户端
10. 混合检索
11. Side Panel UI（搜索 + 卡片 + UP 主浏览）
12. Popup + Content Script
13. 首次使用引导

**阶段 B：WebDAV Sync Beta**

14. 为同步表补齐 `updated_at` / tombstone / 向量配置指纹
15. `snapshot.tar.gz` 导出 / 导入能力
16. WebDAV config/status storage + 客户端封装
17. 远端目录结构、`manifest.json` 与 schema 校验
18. Sync Engine（锁、delta 导出、合并、上传顺序、首次 full pull）
19. Sync UI（连接测试、手动同步、同步状态）
20. Background 定时同步 + 本地变更防抖同步 + 灾难阈值保护

---

## Testing Decisions

- 只测外部行为，不测内部实现
- Mock 外部 API（B站、Embedding）和 chrome.* API

| 模块 | 测试类型 | 重点 |
|------|----------|------|
| Message Bridge | 单元 | 路由正确性、错误传播 |
| Database Layer | 集成 | 迁移、查询、事务 |
| B站 API Client | 单元 | 队列顺序、限流、退避、字幕轨选择逻辑 |
| Subtitle Preprocessor | 单元 | 标准化、噪声过滤、事实保留、时间窗口合并、去重 |
| Ingestion Pipeline | 集成 | 状态流转 pending → indexed，无字幕降级到 no_subtitle |
| Embedding Service | 单元 | 降级行为 |
| Search Engine | 集成 | 混合排序、过滤、RRF |
| Snapshot Export / Import | 集成 | 打包完整性、恢复后索引可用、版本校验 |
| WebDAV Client | 单元 | 目录创建、JSON / gzip 文件读写、401/404/429/超时处理 |
| Sync Engine | 集成 | 首次全量拉取、delta 合并、LWW、软删除、锁超时恢复、上传顺序、灾难阈值保护、向量失效重建 |
| i18n | 单元 | 浏览器语言检测 fallback 逻辑、手动切换持久化与即时生效、翻译 key 完整性（zh-CN 与 en 的 key 集合一致）、用户数据不被翻译 |

不测：UI 视觉样式、Content Script DOM 注入、chrome.* 行为。

需要手工验证：Nextcloud / 坚果云 / InfiniCLOUD 等 WebDAV 提供商兼容矩阵。

---

## Out of Scope

1. YouTube / 其他平台支持
2. 生成式 LLM 问答
3. 关注流自动同步（UP 主新内容自动入库）
4. 账号系统 / favbase 托管云同步 / 专有后端
5. 团队协作
6. 知识图谱 / Mind Map
7. Notion / Obsidian 同步
8. 自定义 Embedding 模型 / Chunk 策略
9. Firefox / Safari
10. WebDAV 之外的同步协议（如 Dropbox / Google Drive 原生同步）
11. B站 Cookie、SESSDATA、Embedding API Key 跨设备同步
12. WebDAV payload 端到端加密
13. 推送通知 / 角标
14. 远端直接挂载或复制 IndexedDB / PGlite 文件作为同步方案
15. 简体中文和英文之外的其他语言支持（日语、繁体中文等属于后续扩展）
16. 内容自动翻译（字幕、标题等用户数据保持原始语言）
17. 语言偏好跨设备同步（语言设置是设备级配置）

---

## Further Notes

### 技术参考：04_ham_home 的 WebDAV 方案

`04_ham_home` 已经证明三件事：

1. 浏览器扩展里跑 `webdav` 客户端是可行的。
2. `sys.json` 锁文件 + `chrome.alarms` 周期调度 + 本地同步状态存储，这套控制面是成立的。
3. 远端按“轻量索引 + 大对象分块”组织，而不是把所有数据硬塞进一个大文件，这个方向是对的。

但不能直接照搬的点也很明确：

1. HamHome 同步的是 JSON 业务对象和网页快照；favbase 核心数据在 PGlite + 向量索引里，**直接同步 IndexedDB/PGlite 文件是错误方向**。
2. favbase 的字幕文本和向量体量明显更大，远端 payload、压缩、并发限制和灾难阈值都要更严格。
3. `04_ham_home` 代码里存在 `e2ePassword` 配置字段，但当前已读代码没有看到完整的远端 payload 加密闭环，[UNKNOWN] 是否已经完整落地；因此 favbase PRD 不把 E2E 当成已验证能力。

### 技术参考：Bilitato 开源项目

[Bilitato](https://github.com/user/Bilitato) 是一款 B站视频 AI 助手浏览器插件（MV3），核心能力包括字幕提取、AI 总结、章节分段、广告识别、内容问答。2026-06-11 对其源码进行了深度分析，主要收获：

| 能力 | Bilitato 实现 | favbase 采纳情况 |
|------|-------------|------------------|
| 字幕获取 | 双路径：inject.js 拦截 fetch/XHR + content.js 主动调用 `/x/player/v2` | 采纳主动 API 调用路径（不依赖用户停留在视频页） |
| 字幕预处理 | subtitleProcessor.js：标准化、过滤、去重、时间窗口合并 | 采纳清洗逻辑，适配 chunk 策略 |
| 无字幕兜底 | Groq/硅基流动 Whisper ASR，支持分块上传 | MVP 不实现，作为后续扩展参考 |
| AI 调用 | OpenAI 协议兼容多 Provider | 架构思路一致（favbase Embedding Service 同样走 OpenAI 协议） |
| 数据存储 | chrome.storage + Supabase 云端缓存 | 不采纳，favbase 走 PGlite 本地存储 |

关键验证结论：**`/x/player/v2` API 路径已被 Bilitato 在生产环境验证可用**，字幕 JSON 结构稳定，中文字幕覆盖率对有 AI 字幕的视频为 100%。

### 风险清单（按严重度排序）

1. **同步对象比 HamHome 更重**（中高风险）：favbase 同步的不只是元数据，还有字幕文本、chunk 和向量。若试图直接同步 PGlite / IndexedDB 底层文件，冲突恢复会失控。必须做逻辑层同步。
2. **第三方 WebDAV 的限频与兼容差异**（中高风险）：免费 WebDAV 容易出现 429、连接重置、目录行为不一致。应对：gzip、并发池（5-10）、重试、schema 校验、兼容矩阵手测。
3. **向量配置跨设备不一致**（中风险）：不同设备上的 provider / model / dimension 若发生变化，远端向量可能失效。应对：记录 `embedding_profile`，不匹配时标记重建。
4. **把备份和同步混成一件事会污染实现**（中风险）：`snapshot.tar.gz` 适合人工迁移，不适合多设备持续合并。必须分成两条能力，不能拿快照覆盖持续同步协议。
5. **无 AI 字幕视频比例未知**（中风险）：部分视频没有 B站 AI 生成的字幕。MVP 阶段这类视频退化为仅标题/描述检索。用户需看到明确状态提示。实际覆盖率需在首批用户数据中统计。
6. **B站反爬和接口变更**（中风险）：`/x/player/v2` 是非公开 API，B站可能调整参数签名、限频策略或返回结构。应对：请求队列限速 + 结构化错误处理 + 字幕 schema 容错解析。
7. **PGlite 并发和 offscreen 生命周期**（低-中风险）：技术风险不变，但属于已知工程问题，有成熟应对方案。
8. **字幕 URL 时效性**（低风险）：Bilitato 的实践表明字幕 JSON URL 相对稳定（托管在 CDN），不像视频流 URL 那样频繁过期。但批量导入场景下仍需处理偶发 404。

### "本地优先"定义

**数据主权**而非完全离线：默认所有知识库数据落在浏览器本地；WebDAV 只是用户显式开启的、自有远端同步层，不是 favbase 托管云。Embedding 计算继续使用用户自己的 API Key；B站 Cookie、SESSDATA、API Key 和临时任务状态仍然只留在本机。

### 成功标准

1. 用户导入后 7 天内发生 3 次以上搜索
2. 用户导入 3 个以上收藏夹
3. 用户使用时间戳跳转功能
4. 开启 WebDAV 的用户能在第二设备完成一次成功拉取，并在不重新导入收藏夹的前提下恢复搜索能力

### 存储估算

存储的是字幕文本和向量索引，不是视频文件。500 条视频的字幕文本约 2.5MB，向量索引（1536 维 × 平均 10 chunk）约 30MB，元数据约 0.3MB，合计约 33MB。5000 条约 330MB。均在 IndexedDB 配额内。

若开启 WebDAV 同步，远端空间量级大致相同。字幕与 chunk JSON 可通过 gzip 明显压缩，但向量数据压缩收益有限，因此：

- 500 条视频：远端建议预留 25MB - 40MB
- 5000 条视频：远端建议预留 250MB - 400MB

这也是为什么同步必须按分块文件组织，并限制并发，而不是做整库单文件上传。


A local-first browser extension that automatically turns your social media favorites into a searchable knowledge base.
