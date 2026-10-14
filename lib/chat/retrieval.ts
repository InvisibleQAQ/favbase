import { and, inArray, sql, type SQL } from 'drizzle-orm';
import type { FavbaseDb } from '@/lib/database';
import * as schema from '@/lib/database/schema';
import { segmentWords, TEXT_SEARCH_CONFIG } from '@/lib/database/text-search';
import { createEmbeddingModel, embedText } from '@/lib/ai';
// Static on purpose: this path also runs inside the Background Service Worker
// (Agent Bridge `searchKnowledgeBase`), and a Service Worker cannot use
// dynamic `import()` (disallowed on ServiceWorkerGlobalScope by the HTML
// specification).
import { getEmbeddingSettings } from '@/lib/embedding/config';
import {
  chunkSimilarities,
  semanticSearchChunks,
  type SemanticSearchHit,
  type SemanticSearchOptions,
} from '@/lib/embedding/vector-store';
import { EmbeddingDimensionError } from '@/lib/embedding/errors';
import { reciprocalRankFusion } from './rrf';
import type {
  HybridRetrieval,
  HybridRetrieveOptions,
  RetrievalDeps,
  RetrievalHit,
  RetrievalItem,
} from './types';

const { items, itemChunks, itemTags } = schema;

/** RRF fusion constant. */
const RRF_K = 60;
/** Default number of fused hits returned. */
const DEFAULT_TOP_K = 8;
/**
 * A query lexeme found in more than this share of the in-scope chunks neither
 * recalls nor scores: it is a stopword (`the`, `的`), and recalling it would
 * fill the keyword arm with chunks sharing nothing else with the query.
 */
const MAX_DF_RATIO = 0.3;
/**
 * Most distinct query words searched, and most words in one phrase run: each
 * word costs an index scan, each phrase word a posting list to intersect.
 */
const MAX_QUERY_WORDS = 32;
/** Most phrase runs taken from one query; each one costs an index scan. */
const MAX_PHRASE_RUNS = 8;
/** What ends a phrase run in the raw query: whitespace and Unicode punctuation. */
const PHRASE_RUN_SEPARATORS = /[\s\p{P}]+/u;

/**
 * Default semantic-arm embedder: resolve the active embedding config and embed
 * the query with the SAME model that populated the column (so the vector width
 * matches). Returns `null` when embedding is not configured — the caller then
 * runs keyword-only. Composed from existing infra (`getEmbeddingSettings` +
 * `createEmbeddingModel` + `embedText`); no new client is introduced.
 */
const defaultEmbedQuery: RetrievalDeps['embedQuery'] = async (query) => {
  const config = await getEmbeddingSettings();
  if (!config.enabled) return null;
  const model = createEmbeddingModel({
    providerId: config.providerId,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
  });
  return embedText(model, query, {
    providerId: config.providerId,
    dimensions: config.dimensions,
  });
};

const defaultDeps: RetrievalDeps = { embedQuery: defaultEmbedQuery };

/**
 * The single scope predicate for `platform` / `tagId`, written against an
 * unaliased `item_chunks` row. Both arms apply it inside their SQL, before
 * their LIMIT. A filter applied after the arms is starved by their global
 * top-K and, on the semantic arm, by HNSW's `ef_search` cap. `undefined` means
 * no filter; an empty platform list is no platform filter.
 */
function buildItemScope({ platform, tagId }: HybridRetrieveOptions): SQL | undefined {
  const platforms = platform === undefined ? [] : [platform].flat();
  const itemFilter = and(
    platforms.length > 0 ? inArray(items.platform, platforms) : undefined,
    tagId
      ? sql`EXISTS (SELECT 1 FROM ${itemTags} WHERE ${itemTags.itemId} = ${items.id} AND ${itemTags.tagId} = ${tagId})`
      : undefined,
  );
  if (!itemFilter) return undefined;
  return sql`${itemChunks.itemId} IN (SELECT ${items.id} FROM ${items} WHERE ${itemFilter})`;
}

/** The query as the keyword arm searches it. */
interface KeywordQuery {
  /** Distinct segmented words, space-joined, at most `MAX_QUERY_WORDS`. */
  words: string;
  /**
   * Runs of the raw query between separators that segment into two or more
   * words, each segmented. A chunk holding a run's words adjacently gets the
   * phrase bonus. At most `MAX_PHRASE_RUNS`.
   */
  phrases: string[];
}

function prepareKeywordQuery(query: string): KeywordQuery {
  const words = [...new Set(segmentWords(query).split(' ').filter(Boolean))];
  const phrases = [
    ...new Set(
      query
        .split(PHRASE_RUN_SEPARATORS)
        .map((run) => segmentWords(run).split(' ').slice(0, MAX_QUERY_WORDS).join(' '))
        .filter((run) => run.includes(' ')),
    ),
  ];
  return {
    words: words.slice(0, MAX_QUERY_WORDS).join(' '),
    phrases: phrases.slice(0, MAX_PHRASE_RUNS),
  };
}

/**
 * `lexeme` as a single-term tsquery. tsquery input is parsed, so the lexeme is
 * quoted with its quotes and backslashes doubled (`chr(39)` is `'`, `chr(92)`
 * is `\`), which keeps every lexeme literal.
 */
const LEXEME_TSQUERY = sql.raw(
  '(chr(39) || replace(replace(lexeme, chr(92), repeat(chr(92), 2)), chr(39), repeat(chr(39), 2)) || chr(39))::tsquery',
);

interface KeywordRow extends Record<string, unknown> {
  chunk_id: string;
  item_id: string;
  chunk_text: string;
  matched_terms: string[];
  query_terms: string[];
}

interface KeywordArmResult {
  rows: KeywordRow[];
  /** The surviving lexemes; `[]` exactly when `rows` is empty. */
  queryTerms: string[];
}

/**
 * Keyword arm over `item_chunk_terms` (segmented tsvector, GIN). The query is
 * segmented by the same `segmentWords` as the index, then:
 *
 * - `N`, each lexeme's `df`, the hits and the phrase hits count in-scope
 *   chunks only: every count and `@@` search over `item_chunk_terms` joins
 *   `in_scope`.
 * - A lexeme with `df = 0`, or `df` above both `MAX_DF_RATIO · N` and `limit`,
 *   neither recalls nor scores. The `limit` floor keeps a small scope (a tag
 *   with a dozen chunks) from pruning the very word it was searched for; a
 *   lexeme in at most `limit` chunks cannot flood the arm anyway.
 * - A chunk scores the BM25 idf `ln(1 + (N - df + 0.5) / (df + 0.5))` of every
 *   surviving lexeme it holds, so a rare word outweighs a common one.
 * - Phrase bonus: a chunk holding one of the query's multi-word runs
 *   adjacently (`phraseto_tsquery`) gets that run's idf sum again. ICU splits
 *   words it does not know into single characters (`编程` → `编 程`), and only
 *   adjacency tells `大模型微调` from `微调…大模型`.
 * - Order: score, then `ts_rank_cd`, then chunk id.
 *
 * `cutoff` changes cost, not results: a chunk scoring below the limit-th best
 * score cannot reach the top `limit`, so only the rest pay for `ts_rank_cd`.
 * Pure SELECT; every query-derived string is a bound parameter.
 */
async function keywordArm(
  db: FavbaseDb,
  query: string,
  scope: SQL | undefined,
  limit: number,
): Promise<KeywordArmResult> {
  const { words, phrases } = prepareKeywordQuery(query);
  if (words.length === 0) return { rows: [], queryTerms: [] };

  const config = sql`${TEXT_SEARCH_CONFIG}::regconfig`;
  // The in-scope chunk ids, materialized once and hash-joined into every terms
  // scan (aliased `ict`). Joining the predicate itself costs two index probes
  // per posting of every query word (20k chunks, 2% scope: 100 ms against 19).
  const scopeCte = scope
    ? sql`in_scope AS MATERIALIZED (SELECT item_chunks.id FROM item_chunks WHERE ${scope}),`
    : sql``;
  const inScope = scope ? sql`JOIN in_scope ON in_scope.id = ict.chunk_id` : sql``;
  const phraseArray = sql.join(
    phrases.map((phrase) => sql`${phrase}`),
    sql`, `,
  );

  const result = await db.execute<KeywordRow>(sql`
    WITH ${scopeCte}
    n AS (
      SELECT count(*)::float8 AS n FROM item_chunk_terms ict ${inScope}
    ),
    candidates AS (
      SELECT lexeme, ${LEXEME_TSQUERY} AS tq
      FROM unnest(tsvector_to_array(to_tsvector(${config}, ${words}))) AS lexeme
    ),
    terms AS (
      SELECT cand.lexeme, cand.tq, ln(1 + (n.n - d.df + 0.5) / (d.df + 0.5)) AS idf
      FROM candidates cand
      CROSS JOIN n
      CROSS JOIN LATERAL (
        SELECT count(*)::float8 AS df
        FROM item_chunk_terms ict ${inScope}
        WHERE ict.tsv @@ cand.tq
      ) AS d
      WHERE d.df > 0 AND d.df <= greatest(n.n * ${MAX_DF_RATIO}, ${limit})
    ),
    hits AS (
      SELECT ict.chunk_id, t.lexeme, t.idf
      FROM terms t
      JOIN item_chunk_terms ict ON ict.tsv @@ t.tq
      ${inScope}
    ),
    phrases AS (
      SELECT phraseto_tsquery(${config}, run) AS pq,
             (SELECT sum(t.idf) FROM terms t
              WHERE t.lexeme = ANY (tsvector_to_array(to_tsvector(${config}, run)))) AS bonus
      FROM unnest(ARRAY[${phraseArray}]::text[]) AS run
    ),
    phrase_hits AS (
      SELECT ict.chunk_id, sum(p.bonus) AS bonus
      FROM phrases p
      JOIN item_chunk_terms ict ON ict.tsv @@ p.pq
      ${inScope}
      WHERE p.bonus > 0
      GROUP BY ict.chunk_id
    ),
    scored AS (
      SELECT h.chunk_id,
             sum(h.idf) + coalesce(max(ph.bonus), 0) AS score,
             array_agg(h.lexeme ORDER BY h.lexeme) AS matched_terms
      FROM hits h
      LEFT JOIN phrase_hits ph ON ph.chunk_id = h.chunk_id
      GROUP BY h.chunk_id
    ),
    cutoff AS (
      SELECT min(score) AS score
      FROM (SELECT score FROM scored ORDER BY score DESC LIMIT ${limit}) AS top_scores
    ),
    any_term AS (
      SELECT string_agg(tq::text, ' | ')::tsquery AS q,
             array_agg(lexeme ORDER BY lexeme) AS lexemes
      FROM terms
    )
    SELECT c.id AS chunk_id, c.item_id, c.chunk_text, s.matched_terms,
           any_term.lexemes AS query_terms
    FROM scored s
    JOIN cutoff ON s.score >= cutoff.score
    JOIN item_chunk_terms ict ON ict.chunk_id = s.chunk_id
    JOIN item_chunks c ON c.id = s.chunk_id
    CROSS JOIN any_term
    ORDER BY s.score DESC, ts_rank_cd(ict.tsv, any_term.q) DESC, s.chunk_id ASC
    LIMIT ${limit}
  `);
  const rows = (result.rows ?? []) as KeywordRow[];
  return { rows, queryTerms: rows[0]?.query_terms ?? [] };
}

interface SemanticArmResult {
  /** The query vector the arm searched with; `null` when the arm did not run. */
  vector: number[] | null;
  hits: SemanticSearchHit[];
}

/**
 * Semantic arm: embed the query then cosine search (HNSW unscoped, exact when
 * `itemScope` is set). Does not run (`vector: null`, never throws) when
 * embedding is unconfigured or the query vector width no longer matches the
 * column (config drift) — chat degrades to keyword-only rather than breaking.
 * Any other error propagates (real bug).
 */
async function semanticArm(
  db: FavbaseDb,
  query: string,
  options: SemanticSearchOptions,
  embedQuery: RetrievalDeps['embedQuery'],
): Promise<SemanticArmResult> {
  const vector = await embedQuery(query);
  if (!vector) return { vector: null, hits: [] };

  try {
    return { vector, hits: await semanticSearchChunks(db, vector, options) };
  } catch (err) {
    if (err instanceof EmbeddingDimensionError) {
      console.warn(
        '[chat] semantic arm skipped — query/column dimension mismatch (embedding config drift):',
        err.message,
      );
      return { vector: null, hits: [] };
    }
    throw err;
  }
}

interface ItemRow {
  id: string;
  title: string;
  url: string;
  platform: string;
}

/**
 * Source metadata for the candidate chunks' items. A plain lookup by id: the
 * scope already ran inside both arms. Read-only.
 */
async function loadItems(
  db: FavbaseDb,
  itemIds: string[],
): Promise<Map<string, RetrievalItem>> {
  const rows: ItemRow[] = await db
    .select({
      id: items.id,
      title: items.title,
      url: items.originalUrl,
      platform: items.platform,
    })
    .from(items)
    .where(inArray(items.id, itemIds));

  return new Map(rows.map((r) => [r.id, r]));
}

interface CandidateChunk {
  itemId: string;
  chunkText: string;
  matchedTerms: string[];
}

/**
 * Hybrid retrieval over the local knowledge base: semantic (pgvector cosine) ∥
 * segmented-tsvector keyword, fused with RRF, deduped to one hit per item,
 * joined back to `items` for source metadata, then each hit's raw cosine
 * looked up. Fully read-only (SELECT / db.execute SELECT only).
 *
 * Degradation (never throws on the normal path): unconfigured embedding or a
 * query/column dimension mismatch drops the semantic arm and runs keyword-only
 * (`semanticSearch: false`, every `similarity` null); a blank query or no
 * candidates returns no hits. See research/retrieval-design.md.
 */
export async function hybridRetrieve(
  db: FavbaseDb,
  query: string,
  options: HybridRetrieveOptions = {},
  deps: RetrievalDeps = defaultDeps,
): Promise<HybridRetrieval> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return { hits: [], queryTerms: [], semanticSearch: false };

  const topK = options.topK ?? DEFAULT_TOP_K;
  const scope = buildItemScope(options);
  // Over-fetch per arm so RRF has material to fuse and the per-item dedupe
  // below can still fill topK distinct items. Known cap: the unscoped semantic
  // arm is an HNSW scan and returns at most `hnsw.ef_search` rows (pgvector
  // default 40) whatever this budget says; the scoped semantic arm is an exact
  // scan and gets all of it.
  const perArm = Math.min(scope ? Math.max(topK * 5, 50) : Math.max(topK * 3, 30), 100);

  const [semantic, keyword] = await Promise.all([
    semanticArm(
      db,
      trimmed,
      { topK: perArm, minScore: options.minScore, itemScope: scope },
      deps.embedQuery,
    ),
    keywordArm(db, trimmed, scope, perArm),
  ]);
  const searched = { queryTerms: keyword.queryTerms, semanticSearch: semantic.vector !== null };

  // chunkId -> chunk from either arm (no extra chunk query). Keyword rows
  // overwrite semantic ones: same chunk, plus the terms it matched.
  const chunkMap = new Map<string, CandidateChunk>();
  for (const h of semantic.hits) {
    chunkMap.set(h.chunkId, { itemId: h.itemId, chunkText: h.chunkText, matchedTerms: [] });
  }
  for (const r of keyword.rows) {
    chunkMap.set(r.chunk_id, {
      itemId: r.item_id,
      chunkText: r.chunk_text,
      matchedTerms: r.matched_terms,
    });
  }
  if (chunkMap.size === 0) return { hits: [], ...searched };

  const itemMap = await loadItems(db, [...new Set([...chunkMap.values()].map((c) => c.itemId))]);

  // RRF fuses per chunk, untruncated. Walking it in score order and keeping the
  // first chunk per item keeps each item's best chunk, so one long item cannot
  // take several result slots.
  const fused = reciprocalRankFusion(
    [semantic.hits.map((h) => h.chunkId), keyword.rows.map((r) => r.chunk_id)],
    { k: RRF_K },
  );

  const picked: Omit<RetrievalHit, 'similarity'>[] = [];
  const seenItems = new Set<string>();
  for (const { id: chunkId, score } of fused) {
    if (picked.length === topK) break;
    const chunk = chunkMap.get(chunkId);
    const item = chunk && itemMap.get(chunk.itemId);
    if (!chunk || !item || seenItems.has(item.id)) continue;
    seenItems.add(item.id);
    picked.push({ chunkId, chunkText: chunk.chunkText, score, matchedTerms: chunk.matchedTerms, item });
  }

  // Every returned chunk's cosine, whichever arm found it: a keyword-only hit
  // needs one too, or the model cannot weigh it against the others.
  const similarities = semantic.vector
    ? await chunkSimilarities(db, semantic.vector, picked.map((p) => p.chunkId))
    : new Map<string, number>();
  const hits = picked.map((p) => ({ ...p, similarity: similarities.get(p.chunkId) ?? null }));
  return { hits, ...searched };
}
