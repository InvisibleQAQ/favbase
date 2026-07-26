export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Defer revocation so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type ExportFileKind = 'json' | 'csv' | 'obsidian';

const EXPORT_FILE_SPECS: Record<ExportFileKind, { stem: string; ext: string }> = {
  json: { stem: 'favbase-export', ext: 'json' },
  csv: { stem: 'favbase-export', ext: 'zip' },
  obsidian: { stem: 'favbase-obsidian', ext: 'zip' },
};

export function buildExportFilename(kind: ExportFileKind): string {
  const date = new Date().toISOString().slice(0, 10);
  const { stem, ext } = EXPORT_FILE_SPECS[kind];
  return `${stem}-${date}.${ext}`;
}
