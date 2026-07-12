import { zipSync, strToU8 } from 'fflate';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { EXPORT_TABLES, type TableData } from './query';

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return escapeCsvField(JSON.stringify(value));
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(rows: Record<string, unknown>[], fallbackHeaders: string[]): string {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : fallbackHeaders;
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvField(row[h])).join(','));
  }
  return lines.join('\n');
}

export function toExportCsvZip(data: TableData): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const table of EXPORT_TABLES) {
    const name = getTableName(table);
    files[`${name}.csv`] = strToU8(
      toCsv(data[name], Object.keys(getTableColumns(table))),
    );
  }
  return zipSync(files);
}
