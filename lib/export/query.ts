import type { FavbaseDb } from '../database/db';
import {
  authors,
  sources,
  items,
  itemSources,
  itemContents,
  itemChunks,
} from '../database/schema';

export interface TableData {
  authors: Record<string, unknown>[];
  sources: Record<string, unknown>[];
  items: Record<string, unknown>[];
  item_sources: Record<string, unknown>[];
  item_contents: Record<string, unknown>[];
  item_chunks: Record<string, unknown>[];
}

function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

function stripEmbedding(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.map(({ embedding: _, ...rest }) => rest);
}

export async function queryAllTables(
  db: FavbaseDb,
  includeEmbedding: boolean,
): Promise<TableData> {
  const [a, s, i, is, ic, ik] = await Promise.all([
    db.select().from(authors),
    db.select().from(sources),
    db.select().from(items),
    db.select().from(itemSources),
    db.select().from(itemContents),
    db.select().from(itemChunks),
  ]);

  const chunkRows = ik.map(serializeRow);
  return {
    authors: a.map(serializeRow),
    sources: s.map(serializeRow),
    items: i.map(serializeRow),
    item_sources: is.map(serializeRow),
    item_contents: ic.map(serializeRow),
    item_chunks: includeEmbedding ? chunkRows : stripEmbedding(chunkRows),
  };
}

export function isTableDataEmpty(data: TableData): boolean {
  return Object.values(data).every((rows) => rows.length === 0);
}
