import { zipSync, strToU8 } from 'fflate';
import type { TableData } from './query';

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return escapeCsvField(JSON.stringify(value));
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Static column names per table so empty tables still get a header row. */
const TABLE_HEADERS: Record<keyof TableData, string[]> = {
  authors: ['id', 'platform', 'platformAuthorId', 'name', 'avatarUrl', 'platformMeta', 'createdAt', 'updatedAt'],
  sources: ['id', 'platform', 'platformSourceId', 'title', 'description', 'platformMeta', 'lastFetchedAt', 'createdAt', 'updatedAt'],
  items: ['id', 'platform', 'platformItemId', 'authorId', 'title', 'authorName', 'originalUrl', 'publishedAt', 'contentState', 'platformMeta', 'createdAt', 'updatedAt'],
  item_sources: ['itemId', 'sourceId', 'createdAt'],
  item_contents: ['itemId', 'plainText', 'createdAt', 'updatedAt'],
  item_chunks: ['id', 'itemId', 'chunkIndex', 'chunkText', 'embedding', 'createdAt', 'updatedAt'],
};

function toCsv(rows: Record<string, unknown>[], tableName: keyof TableData): string {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : TABLE_HEADERS[tableName];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvField(row[h])).join(','));
  }
  return lines.join('\n');
}

const TABLE_NAMES: (keyof TableData)[] = [
  'authors',
  'sources',
  'items',
  'item_sources',
  'item_contents',
  'item_chunks',
];

export function toExportCsvZip(data: TableData): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const name of TABLE_NAMES) {
    files[`${name}.csv`] = strToU8(toCsv(data[name], name));
  }
  return zipSync(files);
}
