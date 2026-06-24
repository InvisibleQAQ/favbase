export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Defer revocation so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function buildExportFilename(format: 'json' | 'csv'): string {
  const date = new Date().toISOString().slice(0, 10);
  return `favbase-export-${date}.${format === 'json' ? 'json' : 'zip'}`;
}
