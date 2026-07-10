# favbase Schema v1 — DDL

PGlite + pgvector 知识库数据库结构。7 张业务表 + 1 张迁移表。

## ER 关系

```
authors ←(1:N)— items —(N:M via item_sources)→ sources
                  ↓ (1:1)
             item_contents
                  ↓ (1:N)
             item_chunks (含 embedding VECTOR(N)，维度跟随当前模型，初始 1536)
```

## 初始化

```sql
-------------------------------------------------------------------------------
-- favbase PGlite 初始化
--
-- 运行环境：PGlite WASM（浏览器内 PostgreSQL），持久化到 IndexedDB (idb://favbase)
-- 单连接模型：Offscreen Document 是唯一的 PGlite 持有者
-- 本脚本在首次打开扩展时由 Offscreen 执行一次
-------------------------------------------------------------------------------

-- pgvector: 向量相似度搜索（余弦距离 <=>、L2 距离 <->）
-- 用于知识库语义搜索，embedding 列维度跟随当前模型（初始 1536）
CREATE EXTENSION IF NOT EXISTS vector;

-- uuid-ossp: UUID 生成函数
-- 所有表主键使用 uuid_generate_v4()，跨设备唯一（WebDAV 同步安全）
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- pg_trgm: 三元组（trigram）文本相似度
-- 提供 similarity() 函数和 GIN 索引，加速 ILIKE / 模糊匹配
-- 注意：对中文效果弱于英文（中文无空格分词），但仍优于全表扫描
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 时区锁定 UTC
-- 所有 TIMESTAMPTZ 列统一以 UTC 存储和比较
-- 原因：浏览器扩展可能在不同时区的设备上运行，
-- 未来 WebDAV 同步的 Last-Write-Wins 合并依赖时间戳可比较性
SET timezone = 'UTC';
```

## 表定义

### _migrations

```sql
-------------------------------------------------------------------------------
-- _migrations: Schema 版本追踪
--
-- 每次迁移脚本执行成功后插入一行。应用启动时读取 MAX(version)
-- 判断是否需要执行新迁移。迁移脚本应在事务中运行（PGlite 支持 DDL 事务）。
--
-- 本表不参与 WebDAV 同步（每台设备独立管理自己的迁移状态）。
-------------------------------------------------------------------------------
CREATE TABLE _migrations (
  -- 迁移版本号，单调递增（1, 2, 3, ...）
  version    INTEGER PRIMARY KEY,

  -- 迁移名称，便于识别（如 'v1_init', 'v2_add_webdav_fields'）
  name       TEXT NOT NULL,

  -- 迁移执行时间
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### authors

```sql
-------------------------------------------------------------------------------
-- authors: 内容创作者
--
-- 存储各平台的内容创作者信息：B站 UP主、YouTube channel、知乎作者、
-- X 用户、小红书博主等。
--
-- 同一个真人在不同平台是不同的 author 记录（按 platform 隔离），
-- 因为跨平台身份关联不可靠且不在 MVP 范围内。
--
-- items.author_id FK 到本表，一个 author 可以有多个 items。
-- items.author_name 是快照冗余列，避免列表查询 JOIN authors 表。
-- 创作者改名时 authors.name 更新，items.author_name 保持导入时的快照不变。
-------------------------------------------------------------------------------
CREATE TABLE authors (
  -- 主键：UUIDv4，由 PGlite uuid_ossp 扩展生成
  -- 跨设备唯一，满足未来 WebDAV 同步需求
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- 平台标识符，如 'bilibili', 'youtube', 'zhihu', 'x', 'xiaohongshu', 'rss'
  -- 与 items.platform、sources.platform 使用相同的值域
  platform            TEXT NOT NULL,

  -- 该创作者在其平台上的唯一标识
  -- B站: UP主 mid (如 '12345')
  -- YouTube: channel ID (如 'UC...')
  -- 知乎: url_token (如 'zhang-san-42')
  -- X: user ID (如 '123456789')
  -- 小红书: user ID
  platform_author_id  TEXT NOT NULL,

  -- 创作者显示名称（如 "某某UP主"）
  name                TEXT NOT NULL,

  -- 头像 URL（可选，用于 UI 展示）
  avatar_url          TEXT,

  -- 平台特有元数据（JSONB）
  -- B站: { "level": 6, "sign": "个人简介", "face": "头像CDN地址" }
  -- YouTube: { "subscriberCount": "100K", "customUrl": "@channel" }
  -- 新增平台字段只需扩展 TypeScript 类型，不需要 DDL 变更
  platform_meta       JSONB NOT NULL DEFAULT '{}',

  -- 记录创建时间（首次导入时写入）
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 记录最后更新时间（名称/头像等信息更新时刷新）
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 去重约束：同一平台 + 同一平台 ID 只允许一条记录
  -- 导入时使用 INSERT ... ON CONFLICT(platform, platform_author_id) DO UPDATE
  -- 来更新 name/avatar_url 等字段
  CONSTRAINT uq_authors_platform UNIQUE (platform, platform_author_id)
);
```

### sources

```sql
-------------------------------------------------------------------------------
-- sources: 内容来源（收藏夹/播放列表/RSS feed）
--
-- 代表用户选择导入的"内容容器"：
-- B站: 收藏夹（fav folder，有 fid 和 title）
-- YouTube: 播放列表（playlist）
-- 知乎: 收藏夹
-- X: 书签（无分组，自动创建一个默认 source）
-- 小红书: 收藏（无分组，自动创建一个默认 source）
-- RSS: 订阅的 feed
--
-- items 和 sources 是多对多关系（通过 item_sources 关联），
-- 因为同一个视频可以在多个收藏夹里。
--
-- 支持 User Story: "用户想选择导入哪些收藏夹"
-------------------------------------------------------------------------------
CREATE TABLE sources (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- 平台标识符（同 authors.platform）
  platform            TEXT NOT NULL,

  -- 该来源在其平台上的唯一标识
  -- B站: 收藏夹 fid (如 '1234567')
  -- YouTube: playlist ID (如 'PLxxx')
  -- X/小红书: 使用约定值如 'default_bookmarks'
  -- RSS: feed URL
  platform_source_id  TEXT NOT NULL,

  -- 来源显示名称（如 "我的学习收藏夹"）
  title               TEXT NOT NULL,

  -- 来源描述（可选）
  description         TEXT,

  -- 平台特有元数据（JSONB）
  -- B站: { "mediaCount": 128, "cover": "封面URL" }
  -- RSS: { "feedUrl": "https://...", "refreshInterval": 60, "fetchStatus": "success" }
  platform_meta       JSONB NOT NULL DEFAULT '{}',

  -- 上次从该来源拉取内容的时间
  -- 所有平台通用：B站收藏夹同步时间、RSS feed 刷新时间等
  -- NULL = 从未拉取过
  last_fetched_at     TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 去重约束：同一平台 + 同一来源 ID 只允许一条
  CONSTRAINT uq_sources_platform UNIQUE (platform, platform_source_id)
);
```

### items

```sql
-------------------------------------------------------------------------------
-- items: 收藏条目（知识库核心表）
--
-- 每条收藏在知识库中对应一行 item。所有平台共用一张表，
-- 通过 platform 鉴别列 + platform_meta JSONB 存储差异字段。
--
-- 共性字段提取为顶层列（title, author_name, original_url），
-- 平台特有字段存在 platform_meta JSONB 中。
-- 新增平台只需扩展 TypeScript 类型定义，不需要 DDL 变更。
--
-- content_state 列追踪 Ingestion Pipeline 的处理进度：
-- pending → has_content → chunked → embedded（完整路径）
-- pending → no_content（无内容可获取）
-- 任意阶段 → error（出错，可重试）
-------------------------------------------------------------------------------
CREATE TABLE items (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- 平台标识符（同 authors.platform、sources.platform）
  platform            TEXT NOT NULL,

  -- 该条目在其平台上的唯一标识
  -- B站: bvid (如 'BV1xx411c7mD'，保留原始大小写，B站 API 区分大小写)
  -- YouTube: videoId (如 'dQw4w9WgXcQ')
  -- 知乎: answer_id 或 article_id (如 '123456789')
  -- X: tweet_id (如 '1234567890123456789')
  -- 小红书: note_id
  platform_item_id    TEXT NOT NULL,

  -- 关联的内容创作者
  -- ON DELETE RESTRICT: 禁止删除仍有 items 的 author
  -- （应用层应先处理关联 items 再删 author）
  author_id           UUID NOT NULL REFERENCES authors(id) ON DELETE RESTRICT,

  -- 条目标题（如视频标题、文章标题、推文前 N 字）
  title               TEXT NOT NULL,

  -- 作者名称快照（导入时从 authors.name 复制）
  -- 冗余设计：避免列表查询 JOIN authors 表
  -- 不随 authors.name 更新而更新（快照语义）
  author_name         TEXT NOT NULL,

  -- 原始平台链接（点击跳转用）
  -- B站: 'https://www.bilibili.com/video/BV1xx411c7mD'
  -- 知乎: 'https://www.zhihu.com/question/xxx/answer/yyy'
  original_url        TEXT NOT NULL,

  -- 原始平台发布时间（可选）
  -- B站: pubdate, YouTube: publishedAt, 知乎: created_time
  -- NULL = 平台未提供或未获取到
  -- 用于"按发布时间排序/过滤"
  published_at        TIMESTAMPTZ,

  -- Ingestion Pipeline 处理状态（6 种）
  -- 'pending':     刚导入，等待获取内容
  -- 'has_content': 纯文本已写入 item_contents，等待 chunk 切分
  -- 'chunked':     chunk 切分完成，等待 embedding（需 API Key）
  -- 'embedded':    所有 chunk 的向量已填充，可语义搜索
  -- 'no_content':  内容不存在或不可获取（如无字幕视频），退化为标题搜索
  -- 'error':       处理过程中出错，可重试
  --
  -- embedding 部分完成（部分 chunk 有向量）的精确状态
  -- 通过查询 item_chunks.embedding IS NULL 获取，不在此列体现
  content_state       TEXT NOT NULL DEFAULT 'pending'
                      CHECK (content_state IN (
                        'pending', 'has_content', 'chunked',
                        'embedded', 'no_content', 'error'
                      )),

  -- 平台特有元数据（JSONB）
  -- B站: { "cid": 12345, "bvid": "BV1xx...", "duration": 600,
  --         "view": 10000, "danmaku": 200, "partition": "科技" }
  -- YouTube: { "duration": "PT10M30S", "viewCount": "50000",
  --            "channelTitle": "..." }
  -- 知乎: { "questionTitle": "...", "voteupCount": 500,
  --          "commentCount": 30 }
  -- X: { "retweetCount": 100, "likeCount": 500,
  --       "mediaUrls": ["..."], "quotedTweetId": "..." }
  -- 小红书: { "imageList": ["..."], "tags": ["标签1", "标签2"],
  --            "likeCount": 200 }
  --
  -- 类型安全靠 TypeScript 层保证（PlatformMeta 联合类型），非 DB 约束
  platform_meta       JSONB NOT NULL DEFAULT '{}',

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 去重约束：同一平台 + 同一条目 ID 只允许一条
  -- 从不同收藏夹导入同一视频时，只新增 item_sources 关联行，不重复创建 item
  -- 导入时使用 INSERT ... ON CONFLICT(platform, platform_item_id) DO NOTHING
  CONSTRAINT uq_items_platform UNIQUE (platform, platform_item_id)
);

-- 按作者查询（"某 UP 主的所有视频"）
CREATE INDEX idx_items_author_id ON items(author_id);


-- 按入库时间排序（列表默认排序）
CREATE INDEX idx_items_created_at ON items(created_at DESC);
```

### item_sources

```sql
-------------------------------------------------------------------------------
-- item_sources: items 与 sources 的多对多关联
--
-- 一个 item 可以属于多个 sources（同一视频在多个收藏夹中），
-- 一个 source 可以包含多个 items。
--
-- 复合主键 (item_id, source_id) 天然防止重复关联。
--
-- CASCADE 策略：
-- item 被删除 → 关联行自动删除（合理，item 是核心实体）
-- source 被删除 → 关联行自动删除（合理，只删关联不删 item 本身）
-------------------------------------------------------------------------------
CREATE TABLE item_sources (
  item_id   UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,

  -- 关联创建时间（记录"什么时候从这个收藏夹导入了这个 item"）
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 复合主键：同一 item + 同一 source 只允许一条关联
  PRIMARY KEY (item_id, source_id)
);

-- 反向查询："某个收藏夹里有哪些 items"
-- （正向查询 "某个 item 属于哪些 sources" 走复合主键的前缀索引）
CREATE INDEX idx_item_sources_source_id ON item_sources(source_id);
```

### item_contents

```sql
-------------------------------------------------------------------------------
-- item_contents: 清洗后的纯文本内容
--
-- 每个 item 有且仅有一条对应的 content 记录（1:1 关系）。
-- PK 直接使用 item_id（而非独立 UUID），明确表达 1:1 语义。
--
-- 所有平台的内容统一为纯文本字符串：
-- B站/YouTube: 视频字幕拼接为纯文本（不保留逐行时间戳）
-- 知乎: Markdown 富文本（保留格式标记）
-- X: 纯文本（含链接）
-- 小红书: 纯文本（含链接）
--
-- 为什么分表而不合并到 items？
-- 1. plain_text 可能很大（2h 视频字幕几万字符），列表查询不应加载
-- 2. 写入时序不同：items 在 metadata 阶段创建，contents 在内容获取成功后插入
-- 3. 未来 WebDAV 同步时，内容和元数据可分开传输
--
-- 时间戳跳转功能不依赖本表，而是依赖 VideoCacheEntry 缓存
-- （chrome.storage.local 中的 SubtitleRow[] 原始结构）。
-------------------------------------------------------------------------------
CREATE TABLE item_contents (
  -- PK = item_id，直接表达 1:1 关系
  -- ON DELETE CASCADE: item 被删除时自动删除对应 content
  item_id     UUID PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,

  -- 清洗后的纯文本
  -- 经过 processSubtitles() 管线处理：标准化 → 过滤噪声 → 去重
  -- 应用层建议对极端长文本做上限校验（如 1MB）
  plain_text  TEXT NOT NULL,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 内容更新时间（如用户触发"重新索引"时，重新获取并覆盖内容）
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### item_chunks

```sql
-------------------------------------------------------------------------------
-- item_chunks: 语义段落 chunk + embedding 向量
--
-- 搜索热路径表。混合检索（向量 + 文本）的主要查询对象。
--
-- 每个 item_content 被切分为多个 chunk（语义段落，上限 500 token）。
-- 每个 chunk 附带一个 nullable 的 embedding 向量列。
--
-- embedding 为什么不用独立的 item_embeddings 表？
-- 单一活跃维度（列维度跟随当前模型），换模型全量重建——任何时刻一个 chunk
-- 最多一个有效 embedding（1:0..1 关系）。独立表是过度正规化，
-- 且搜索热路径多一次 JOIN。
--
-- embedding 状态自描述（memorall 模式）：
-- NULL = 未嵌入（无 API Key，或排队中）
-- 非 NULL = 已嵌入，可参与向量搜索
-- 无需额外的 embedding_status 列。
--
-- TOAST 机制：VECTOR(1536) 约 6KB/行，PostgreSQL 自动将大列存到行外，
-- 不扫描 embedding 列时不加载，非搜索查询不受影响。
-------------------------------------------------------------------------------
CREATE TABLE item_chunks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- 所属 item
  -- ON DELETE CASCADE: item 被删除时级联删除所有 chunk（含向量）
  item_id     UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,

  -- chunk 在该 item 内的序号（从 0 开始，连续递增）
  -- 用于按原文顺序排列 chunk，以及"重新索引"时定位
  chunk_index INTEGER NOT NULL,

  -- chunk 纯文本内容
  -- 由语义段落切分器生成：按段落边界切分，每 chunk 上限 500 token
  -- 所有平台统一管线，不区分 chunk_type
  chunk_text  TEXT NOT NULL,

  -- embedding 向量。列维度跟随当前 embedding 模型（初始 1536，运行时可变）
  -- NULL = 未嵌入（用户未配置 API Key、embedding 排队/失败，或维度切换后待重建）
  -- 非 NULL = 已嵌入，可参与向量余弦搜索
  --
  -- 维度惰性自适应（lib/embedding/vector-store.ts）：upsert 发现新向量维度
  -- ≠ 当前列维度时，自动执行单条
  --   ALTER TABLE item_chunks ALTER COLUMN embedding
  --     TYPE vector(N) USING NULL::vector(N)
  -- （清空旧向量 + 换维度 + HNSW 索引自动重建三合一，PGlite + pgvector 0.8.1
  -- 实测验证），并把 'embedded' item 回退 'chunked'；积压通过设置页嵌入卡片
  -- 「重建向量」按钮（lib/embedding rebuildPendingEmbeddings）批量重嵌入，
  -- 失败即停 + 幂等续跑。
  -- 当前列维度唯一真相是 pg catalog（pg_attribute.atttypmod = 维度原值），
  -- 不在 WXT storage 维护副本。
  -- HNSW 索引上限 2000 维：超限模型（如 text-embedding-3-large 3072 未裁剪）
  -- 在 upsert 前被拒绝（EmbeddingDimensionLimitError），不静默退化为无索引。
  embedding   VECTOR(1536),  -- 初始迁移建为 1536，运行时可 ALTER

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 去重约束：同一 item 的 chunk_index 不允许重复
  -- "重新索引"时先 DELETE FROM item_chunks WHERE item_id = $1，再重新插入
  CONSTRAINT uq_item_chunks_index UNIQUE (item_id, chunk_index)
);

-- 按 item 查询所有 chunk（"展示某条收藏的完整内容"）
-- PostgreSQL 不会自动为 FK 列创建索引，必须手动建
CREATE INDEX idx_item_chunks_item_id ON item_chunks(item_id);

-- pg_trgm GIN 索引：加速 chunk 文本的 ILIKE / similarity() 搜索
-- 对中文：三元组按字符拆分（如 "机器学习" → "机器", "器学", "学习"），
-- 短查询词（2-3 字）效果有限，但长查询词仍有加速效果
CREATE INDEX idx_item_chunks_text_trgm ON item_chunks USING GIN (chunk_text gin_trgm_ops);

-- pg_trgm GIN 索引：加速 items 标题的 ILIKE / similarity() 搜索
-- （定义在 item_chunks 之后，但索引建在 items 表上）
CREATE INDEX idx_items_title_trgm ON items USING GIN (title gin_trgm_ops);

-- 向量索引：MVP 阶段不建（精确 KNN 扫描在 <50k 行时性能足够）
-- 未来数据量增长后通过迁移添加：
-- CREATE INDEX idx_item_chunks_embedding ON item_chunks
--   USING hnsw (embedding vector_cosine_ops);
```

## content_state 状态机

```
pending ──→ has_content ──→ chunked ──→ embedded
   │              │             │
   └──→ no_content (内容不存在/不可获取)
   └──→ error (处理出错，可重试)
         has_content ──→ error (chunk 失败)
                  chunked ──→ error (embedding 失败)
```

| 状态 | 含义 | 后续动作 |
|------|------|---------|
| `pending` | 刚导入，等待获取内容 | Ingestion Pipeline 获取内容 |
| `has_content` | 纯文本已写入 item_contents | 执行 chunk 切分 |
| `chunked` | chunk 切分完成 | 执行 embedding（需 API Key） |
| `embedded` | 所有 chunk 向量已填充 | 完成，可语义搜索 |
| `no_content` | 内容不存在或不可获取 | 退化为标题/描述搜索 |
| `error` | 处理过程中出错 | 可重试，重试后回到前一有效状态 |

embedding 部分完成（部分 chunk 有向量、部分没有）的精确状态通过查询 `item_chunks.embedding IS NULL` 获取。

## 搜索查询参考

### 向量搜索（余弦相似度）

```sql
-- 语义搜索：将用户查询文本转为 embedding 后，找最相似的 chunk
-- $1: 查询向量（由当前 embedding 模型生成，维度须与列维度一致；'[...]' 文本形式传入）
-- $2: 返回条数上限
-- <=> 是 pgvector 的余弦距离运算符，1 - distance = similarity (0~1)
-- WHERE embedding IS NOT NULL 跳过未嵌入的 chunk
SELECT c.id, c.item_id, c.chunk_text,
  1 - (c.embedding <=> $1::vector) AS similarity
FROM item_chunks c
WHERE c.embedding IS NOT NULL
ORDER BY c.embedding <=> $1::vector
LIMIT $2;
```

### 文本搜索（pg_trgm）

```sql
-- 关键词搜索：三元组相似度 + ILIKE 模糊匹配
-- $1: 用户输入的搜索关键词
-- % 是 pg_trgm 的相似度运算符（默认阈值 0.3）
-- ILIKE 作为兜底：即使三元组相似度不够，精确包含也能命中
-- 两个条件 OR 组合，保证召回率
SELECT c.id, c.item_id, c.chunk_text,
  similarity(c.chunk_text, $1) AS score
FROM item_chunks c
WHERE c.chunk_text % $1
   OR c.chunk_text ILIKE '%' || $1 || '%'
ORDER BY score DESC
LIMIT $2;
```

### 按作者过滤

```sql
-- 浏览某个作者的所有收藏条目
-- $1: author UUID
-- 排除 error 状态的 item，按发布时间倒序
-- NULLS LAST: 没有发布时间的排到最后
SELECT i.id, i.title, i.author_name, i.published_at
FROM items i
WHERE i.author_id = $1
  AND i.content_state != 'error'
ORDER BY i.published_at DESC NULLS LAST;
```

### 统计已索引数

```sql
-- Dashboard 统计卡片：各状态的 item 数量
-- User Story #34: "用户想看到知识库统计（总条目数、已索引数）"
-- embedded 的 count 即"已索引数"，无需 JOIN item_chunks
SELECT content_state, COUNT(*) AS cnt
FROM items
GROUP BY content_state;
```

## 迁移记录

```sql
-- v1 初始化完成后插入迁移记录
INSERT INTO _migrations (version, name) VALUES (1, 'v1_init');
```

## PGlite 外的存储（WXT storage.defineItem）

以下数据不进 PGlite，存在 chrome.storage.local：

| Key | 数据 | 理由 |
|-----|------|------|
| `local:settings` | UserSettings（API Key、模型选择等） | 敏感凭据 + Background SW 直接访问 |
| `local:platformCookies` | 各平台 cookie（SESSDATA 等）+ collectedAt + expiresAt + status | 敏感凭据、本地独占、Background SW 直接访问 |
| `local:embeddingProfile` | 当前 embedding 配置（provider + model + dimension） | 单值配置 |
| `local:sidebarPinned` | 侧边栏展开/折叠状态 | UI 状态 |

## 设计决策偏差说明（vs PRD）

| PRD 原始设计 | v1 实际 | 理由 |
|-------------|--------|------|
| `entities` 表 | 改名 `authors` | 语义明确，避免歧义 |
| 独立 `item_embeddings` 表 | 合并到 `item_chunks.embedding` 列 | 1:0..1 关系，消除搜索 JOIN |
| 12 表（含 QA/digests/jobs/search_history） | 7 表 | MVP 精简，后续迁移添加 |
| WebDAV 同步字段（deleted_at/content_hash 等） | 延后 | 先做本地闭环 |
| content_state 4 状态 | 6 状态（+embedded, +error） | 审查补充，覆盖异常和统计需求 |
| 向量维度固定 1536 | 列维度跟随当前模型（惰性 ALTER + 设置页手动重建） | 固定维度锁死非 1536 provider；换模型本就要全量重算 |
