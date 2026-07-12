import { getTableColumns, getTableName } from 'drizzle-orm';
import type { FavbaseDb } from '../database/db';
import * as schema from '../database/schema';

type Tables = typeof schema;

export type TableData = {
  [K in keyof Tables as Tables[K]['_']['name']]: Record<string, unknown>[];
};

// schema.ts 是表清单唯一真相源：加表后导出自动纳入，无需改本模块
export const EXPORT_TABLES = Object.values(schema);

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
  const entries = await Promise.all(
    EXPORT_TABLES.map(async (table) => {
      const rows = (await db.select().from(table)).map(serializeRow);
      const keepEmbedding =
        includeEmbedding || !('embedding' in getTableColumns(table));
      return [
        getTableName(table),
        keepEmbedding ? rows : stripEmbedding(rows),
      ] as const;
    }),
  );
  return Object.fromEntries(entries) as TableData;
}

export function isTableDataEmpty(data: TableData): boolean {
  return Object.values(data).every((rows) => rows.length === 0);
}
