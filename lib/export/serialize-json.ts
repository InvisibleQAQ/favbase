import type { TableData } from './query';

export interface ExportJson {
  exported_at: string;
  version: number;
  tables: TableData;
}

export function toExportJson(data: TableData): string {
  const payload: ExportJson = {
    exported_at: new Date().toISOString(),
    version: 1,
    tables: data,
  };
  return JSON.stringify(payload, null, 2);
}
