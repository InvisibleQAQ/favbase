// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  queryAllTables: vi.fn(),
  isTableDataEmpty: vi.fn(),
  triggerDownload: vi.fn(),
  queryObsidianNotes: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../components/iconify', () => ({
  Iconify: ({ icon }: { icon: string }) => <span data-icon={icon} aria-hidden="true" />,
}));

vi.mock('../../components/snackbar', () => ({
  toast: {
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
    error: mocks.toastError,
  },
}));

vi.mock('../../../../lib/database/db', () => ({ getDb: () => ({}) }));

vi.mock('../../../../lib/export/query', () => ({
  queryAllTables: mocks.queryAllTables,
  isTableDataEmpty: mocks.isTableDataEmpty,
}));

vi.mock('../../../../lib/export/serialize-json', () => ({ toExportJson: () => '{}' }));

vi.mock('../../../../lib/export/serialize-csv', () => ({
  toExportCsvZip: () => new Uint8Array([1]),
}));

vi.mock('../../../../lib/export/download', () => ({
  triggerDownload: mocks.triggerDownload,
  buildExportFilename: (kind: string) => `favbase.${kind}`,
}));

vi.mock('../../../../lib/export/obsidian/query', () => ({
  queryObsidianNotes: mocks.queryObsidianNotes,
}));

vi.mock('../../../../lib/export/obsidian/serialize', () => ({
  toObsidianZip: () => new Uint8Array([1]),
}));

import { ExportCard } from './export-card';
import { ThemeProvider } from '../../theme/theme-provider';

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`);
  return button;
}

describe('ExportCard', () => {
  let container: HTMLDivElement;
  let root: Root;

  async function render() {
    await act(async () => root.render(
      <ThemeProvider>
        <ExportCard />
      </ThemeProvider>,
    ));
  }

  beforeEach(() => {
    mocks.queryAllTables.mockReset().mockResolvedValue({});
    mocks.isTableDataEmpty.mockReset().mockReturnValue(false);
    mocks.triggerDownload.mockReset();
    mocks.queryObsidianNotes.mockReset().mockResolvedValue([{ path: 'a.md', body: 'x' }]);
    mocks.toastSuccess.mockReset();
    mocks.toastWarning.mockReset();
    mocks.toastError.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('reports a completed backup through the snackbar and downloads the file', async () => {
    await render();

    await act(async () => findButton(container, 'export.exportBtn').click());

    expect(mocks.triggerDownload).toHaveBeenCalledOnce();
    expect(mocks.toastSuccess).toHaveBeenCalledExactlyOnceWith('snackbar.exported');
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('reports a failed export as an error toast, leaving no Alert behind', async () => {
    mocks.queryAllTables.mockRejectedValueOnce(new Error('boom'));
    await render();

    await act(async () => findButton(container, 'export.exportBtn').click());

    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('export.failed');
    expect(mocks.triggerDownload).not.toHaveBeenCalled();
    // docs/25 Step 5: the inline Alert is gone — the card body must stay clean.
    expect(container.querySelector('.MuiAlert-root')).toBeNull();
    expect(container.textContent).not.toContain('export.failed');
  });

  it('keeps the specific database-not-ready message rather than a generic failure', async () => {
    mocks.queryAllTables.mockRejectedValueOnce(new Error('database not initialized'));
    await render();

    await act(async () => findButton(container, 'export.exportBtn').click());

    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('export.dbNotReady');
  });

  it('treats an empty database as a warning, not a failure', async () => {
    mocks.isTableDataEmpty.mockReturnValue(true);
    await render();

    await act(async () => findButton(container, 'export.exportBtn').click());

    expect(mocks.toastWarning).toHaveBeenCalledExactlyOnceWith('export.emptyDb');
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.triggerDownload).not.toHaveBeenCalled();
  });

  it('reports the Obsidian vault export on its own button', async () => {
    mocks.queryObsidianNotes.mockResolvedValueOnce([]);
    await render();

    await act(async () => findButton(container, 'export.obsidianBtn').click());

    expect(mocks.toastWarning).toHaveBeenCalledExactlyOnceWith('export.emptyDb');
    expect(mocks.triggerDownload).not.toHaveBeenCalled();
  });
});
