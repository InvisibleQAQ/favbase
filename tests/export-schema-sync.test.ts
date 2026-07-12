import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { getTableName } from 'drizzle-orm';
import * as schema from '../lib/database/schema';
import type { TableData } from '../lib/export/query';
import { toExportCsvZip } from '../lib/export/serialize-csv';
import { toExportJson } from '../lib/export/serialize-json';

const emptyData = Object.fromEntries(
  Object.values(schema).map((t) => [getTableName(t), [] as Record<string, unknown>[]]),
) as TableData;

describe('export stays in sync with schema', () => {
  it('CSV zip contains exactly one csv per schema table', () => {
    const files = unzipSync(toExportCsvZip(emptyData));
    const actual = Object.keys(files).sort();
    const expected = Object.values(schema)
      .map((t) => `${getTableName(t)}.csv`)
      .sort();
    expect(actual).toEqual(expected);
    expect(actual).toContain('tags.csv');
    expect(actual).toContain('item_tags.csv');
  });

  it('empty-table csv headers derive from schema columns', () => {
    const files = unzipSync(toExportCsvZip(emptyData));
    const chunkHeader = strFromU8(files['item_chunks.csv']).split('\n')[0].split(',');
    expect(chunkHeader).toEqual(
      expect.arrayContaining(['startSec', 'endSec', 'embedding', 'chunkText']),
    );
    const tagHeader = strFromU8(files['tags.csv']).split('\n')[0].split(',');
    expect(tagHeader).toEqual(expect.arrayContaining(['id', 'name', 'createdAt']));
  });

  it('JSON export includes every schema table key', () => {
    const parsed = JSON.parse(toExportJson(emptyData)) as {
      tables: Record<string, unknown>;
    };
    const expected = Object.values(schema).map((t) => getTableName(t)).sort();
    expect(Object.keys(parsed.tables).sort()).toEqual(expected);
  });
});
