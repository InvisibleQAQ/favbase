// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../theme/theme-provider';
import { ChipRowShell, FilterChip } from './chip-row';

describe('ChipRowShell', () => {
  const roots: ReturnType<typeof createRoot>[] = [];
  const containers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    for (const container of containers) container.remove();
    roots.length = 0;
    containers.length = 0;
  });

  it('owns one quiet icon slot instead of delegating header color to every platform', () => {
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);

    act(() => {
      root.render(
        <ThemeProvider>
          <ChipRowShell icon={<span data-test-icon />} title="Folders">
            <span>All</span>
          </ChipRowShell>
        </ThemeProvider>,
      );
    });

    const slot = container.querySelector('[data-slot="icon"]');
    expect(slot).not.toBeNull();
    expect(slot?.querySelector('[data-test-icon]')).not.toBeNull();
    expect(container.textContent).toBe('FoldersAll');
  });
});

describe('FilterChip', () => {
  const roots: ReturnType<typeof createRoot>[] = [];
  const containers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    for (const container of containers) container.remove();
    roots.length = 0;
    containers.length = 0;
  });

  function renderChip(selected: boolean) {
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);

    act(() => {
      root.render(
        <ThemeProvider>
          <FilterChip label="Folder" selected={selected} onClick={() => undefined} />
        </ThemeProvider>,
      );
    });

    const chip = container.querySelector('.MuiChip-root');
    if (!chip) throw new Error('chip not rendered');
    return chip;
  }

  it('stamps the selected value in filled primary', () => {
    const chip = renderChip(true);
    expect(chip.classList.contains('MuiChip-filled')).toBe(true);
    expect(chip.classList.contains('MuiChip-colorPrimary')).toBe(true);
  });

  it('leaves unselected values on the theme default soft skin, never outlined', () => {
    const chip = renderChip(false);
    expect(chip.classList.contains('MuiChip-soft')).toBe(true);
    expect(chip.classList.contains('MuiChip-outlined')).toBe(false);
    expect(chip.classList.contains('MuiChip-filled')).toBe(false);
  });
});
