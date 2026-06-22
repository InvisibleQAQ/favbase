# PGlite + pgvector 浏览器内向量数据库参考

基于 memorall 项目（`03_memorall`）的实现分析。PGlite 在浏览器中运行完整 PostgreSQL（WASM），配合 pgvector 扩展实现向量相似度搜索。

## 1. 依赖

```json
{
  "@electric-sql/pglite": "^0.4.5",
  "drizzle-orm": "^0.45.2"
}
```

可选：`@huggingface/transformers`（本地 embedding 生成）、`drizzle-kit`（schema 管理工具，memorall 未用其 push/pull）。

## 2. 初始化

```typescript
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";

// IndexedDB 持久化，idb:// 协议
const pg = new PGlite("idb://memorall-db", {
  extensions: { vector, uuid_ossp, pg_trgm },
});
await pg.waitReady;

const db = drizzle(pg, { schema });
```

- `idb://` 前缀 = IndexedDB 持久化，页面关闭后数据保留
- 不传路径或传 `memory://` = 内存模式，刷新即丢失
- `pg.waitReady` 必须 await，否则查询会失败

## 3. Schema 定义（Drizzle ORM）

```typescript
import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { vector } from "drizzle-orm/pg-core";

export const node = pgTable("nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  summary: text("summary"),
  // 向量列：vector(列名, { dimensions: N })
  nameEmbedding: vector("name_embedding", { dimensions: 384 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

memorall 的做法是每个嵌入字段开 3 列（384d/768d/1536d），运行时只激活一个尺寸。对于 favbase，选定一个维度即可。

## 4. 迁移

memorall 用自研迁移系统，核心是 raw SQL：

```typescript
async function up(pg: PGlite) {
  await pg.exec(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    CREATE TABLE IF NOT EXISTS nodes (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name TEXT NOT NULL,
      summary TEXT,
      name_embedding VECTOR(384),
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    -- 三元组索引（模糊文本搜索）
    CREATE INDEX IF NOT EXISTS idx_nodes_name_trgm
      ON nodes USING GIN (name gin_trgm_ops);
  `);
}
```

也可以用 Drizzle Kit 的 `drizzle-kit push` 自动同步 schema，但 memorall 选择了手写迁移以精确控制。

## 5. 向量存储

写入时将 embedding 数组直接赋值给向量列：

```typescript
import { eq } from "drizzle-orm";

const embedding: number[] = await embeddingService.textToVector("some text");
// embedding 是 float[] 数组，长度必须匹配 VECTOR(N) 的维度

await db.insert(schema.node).values({
  name: "example",
  nameEmbedding: embedding,  // Drizzle 自动序列化为 pgvector 格式
});
```

## 6. 向量相似度搜索

pgvector 提供三种距离运算符：

| 运算符 | 距离类型 | 备注 |
|--------|----------|------|
| `<=>` | 余弦距离 | memorall 使用此种，`1 - (a <=> b)` = 余弦相似度 |
| `<->` | L2 距离 | 欧氏距离 |
| `<#>` | 内积距离 | 负内积 |

### 余弦相似度搜索（Raw SQL）

```typescript
const searchVec = await embeddingService.textToVector("查询文本");
const vecStr = JSON.stringify(searchVec);

const results = await pg.query(`
  SELECT id, name, summary,
    1 - (name_embedding <=> $1::vector) as similarity
  FROM nodes
  WHERE name_embedding IS NOT NULL
  ORDER BY similarity DESC
  LIMIT $2
`, [vecStr, 20]);
```

关键点：
- 向量参数需要 `JSON.stringify()` 序列化 + `::vector` 类型转换
- `1 - (col <=> vec)` 将距离转为相似度（0~1，1 = 完全相同）
- `WHERE ... IS NOT NULL` 跳过未嵌入的行

### Edge 表多列取最大相似度

```typescript
const results = await pg.query(`
  SELECT id, source_id, destination_id, fact_text,
    GREATEST(
      1 - (fact_embedding <=> $1::vector),
      1 - (type_embedding <=> $1::vector)
    ) as similarity
  FROM edges
  WHERE fact_embedding IS NOT NULL OR type_embedding IS NOT NULL
  ORDER BY similarity DESC
  LIMIT $2
`, [vecStr, 20]);
```

## 7. 混合搜索（向量 + 三元组）

memorall 的核心搜索策略：并行执行三路搜索，加权合并去重。

```
用户查询
  ├─ vectorSearch()   (pgvector 余弦距离) → 40% 权重
  ├─ trigramSearch()  (pg_trgm 文本相似) → 30% 权重
  └─ drizzleSearch()  (SQL LIKE/条件)    → 30% 权重
  └─ combineResults() → 加权去重 → Top N
```

三元组搜索函数（SQL 定义）：

```sql
CREATE OR REPLACE FUNCTION search_nodes_trigram(
  search_text TEXT,
  similarity_threshold REAL DEFAULT 0.1,
  result_limit INTEGER DEFAULT 50
) RETURNS TABLE(id UUID, name TEXT, similarity_score REAL) AS $$
  SELECT n.id, n.name,
    GREATEST(
      COALESCE(similarity(n.name, search_text), 0),
      COALESCE(similarity(COALESCE(n.summary, ''), search_text), 0)
    ) as similarity_score
  FROM nodes n
  WHERE similarity(n.name, search_text) > similarity_threshold
    OR similarity(COALESCE(n.summary, ''), search_text) > similarity_threshold
  ORDER BY similarity_score DESC
  LIMIT result_limit;
$$ LANGUAGE plpgsql;
```

合并函数签名：

```typescript
function combineSearchResultsWithTrigram<T>(
  sqlResults: T[],
  vectorResults: T[],
  trigramResults: T[],
  weights: { sqlPercentage: 30, vectorPercentage: 40, trigramPercentage: 30 },
  totalLimit: number,
  getKey: (item: T) => string,
): T[]
```

## 8. Chrome 扩展架构

PGlite WASM 不能在 Service Worker 中运行（没有 DOM/IndexedDB 完整支持）。memorall 的解决方案：

```
Offscreen Document（持有 PGlite 实例）
  ↑ chrome.runtime.Port("postgres-rpc")
Background Service Worker（纯中继）
  ↑ chrome.runtime.Port("postgres-rpc")
UI 上下文（Popup / Standalone Page）
  使用 PGliteSharedProxy，API 与真实 PGlite 相同
```

### 关键约束

1. **CSP 要求**：manifest.json 必须添加 `'wasm-unsafe-eval'`

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

2. **Offscreen Document 权限**：manifest.json 需要 `"offscreen"` 权限

```json
{
  "permissions": ["offscreen"]
}
```

3. **Offscreen 创建**（background.ts）：

```typescript
await chrome.offscreen.createDocument({
  url: "offscreen.html",
  reasons: [chrome.offscreen.Reason.WORKERS],
  justification: "PGlite database engine",
});
```

### RPC 代理模式

UI 端使用 `PGliteSharedProxy` 透明代理，对 Drizzle ORM 完全透明：

```typescript
// proxy-driver.ts（UI 端）
class PGliteSharedProxy implements PGliteLike {
  async query(sql: string, params?: any[]) {
    return this.transport.send({ type: "query", sql, params });
  }
}

// rpc-handler.ts（Offscreen 端）
class DatabaseRpcHandler {
  async handle(req: RpcRequest) {
    const pg = getPGLite();
    return pg.query(req.sql, req.params);
  }
}
```

## 9. Embedding 生成策略

| 策略 | 维度 | 模型 | 运行环境 | 依赖 |
|------|------|------|----------|------|
| 本地 HuggingFace | 384 | `paraphrase-multilingual-MiniLM-L12-v2` | 浏览器 WASM/WebGPU | `@huggingface/transformers` |
| 本地 HuggingFace | 768 | `nomic-embed-text-v1.5` | 浏览器 WASM/WebGPU | `@huggingface/transformers` |
| 远程 OpenAI | 1536 | `text-embedding-3-small` | API 调用 | API Key |

本地 embedding 示例（`@huggingface/transformers`）：

```typescript
import { pipeline } from "@huggingface/transformers";

const extractor = await pipeline(
  "feature-extraction",
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  { dtype: "fp32" }
);

const output = await extractor("要嵌入的文本", {
  pooling: "mean",
  normalize: true,
});
const embedding: number[] = Array.from(output.data);
// embedding.length === 384
```

## 10. favbase 适配要点

| 维度 | memorall 做法 | favbase 建议 |
|------|--------------|-------------|
| PGlite 位置 | Offscreen Document | 同样用 Offscreen（已有 offscreen.html） |
| ORM | Drizzle ORM | Drizzle ORM（与 memorall 一致） |
| 迁移 | 自研迁移系统 | 自研即可，初期表少 |
| Embedding 维度 | 3 列并存（384/768/1536） | 选定一个维度，避免过度设计 |
| Embedding 生成 | 本地 HF + 远程 OpenAI | 复用 AI SDK 已有 Provider 基础设施 |
| UI 访问 | Port RPC 代理 | app.html 和 content script 都通过 background 中继 |
| 搜索 | pgvector + pg_trgm 混合 | 先实现 pgvector 余弦搜索，按需加 pg_trgm |

### 核心变更清单

1. 安装 `@electric-sql/pglite` + `drizzle-orm`
2. `wxt.config.ts` 确认 offscreen 入口点
3. `manifest.json` 添加 `wasm-unsafe-eval` CSP + `offscreen` 权限
4. `lib/database/` 新建 PGlite 初始化 + schema + 迁移
5. Offscreen 端持有真实 PGlite，Background 中继，UI 侧 Proxy
6. `public/` 放 PGlite WASM 文件（如需离线加载）
