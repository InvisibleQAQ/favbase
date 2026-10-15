// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserSettings } from '@/lib/storage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  spentToday: null as number | null,
  testLlmConnection: vi.fn(),
  translate: (key: string, params?: Record<string, string | number>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
}));

vi.mock('@/lib/storage', () => ({
  DEFAULT_SETTINGS: {},
  settingsStorage: {
    getValue: vi.fn(),
    setValue: vi.fn(),
    watch: vi.fn(() => () => undefined),
  },
  getEnvApiKey: () => '',
  getEnvModel: () => '',
  resolveAsrConfig: () => ({ apiKey: '', model: '', baseUrl: '' }),
  resolveLlmConfig: () => ({ enabled: false }),
}));

vi.mock('@/lib/i18n', () => ({
  t: mocks.translate,
  formatDateTime: (timestamp: number) => String(timestamp),
  formatCompactNumber: (value: number) => String(value),
}));

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({ t: mocks.translate }),
}));

vi.mock('@/lib/ai', () => ({
  testLlmConnection: mocks.testLlmConnection,
  fetchAvailableModels: vi.fn(),
}));

vi.mock('../../components/iconify', () => ({
  Iconify: () => <span aria-hidden="true" />,
}));

vi.mock('../../components/snackbar', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../hooks/use-tagging-tokens-spent-today', () => ({
  useTaggingTokensSpentToday: () => mocks.spentToday,
}));

import { ThemeProvider } from '../../theme/theme-provider';
import { LlmConfigCard } from './llm-config-card';

// One object for the whole file: the card's `derive` is memoized on the
// `settings` reference, and a fresh object per render would loop forever.
const SETTINGS: UserSettings = {
  provider: 'openai',
  providerApiKeys: { openai: 'sk-test' },
  providerModels: { openai: 'gpt-test' },
  customBaseUrl: '',
  customModel: '',
  customProtocol: 'openai',
  asrProvider: 'groq',
  asrConfigs: {},
  embeddingProvider: 'openai',
  embeddingConfigs: {},
  prefMode: 'efficiency',
  temperature: 0.3,
  maxTokens: 100_000,
  taggingDailyTokenBudget: 5_000_000,
};

const SPENT_LINE_KEY = 'settings.taggingBudgetSpentToday';

describe('LlmConfigCard Tagging Budget field', () => {
  let container: HTMLDivElement;
  let root: Root;
  let saveLlm: ReturnType<typeof vi.fn<(draft: unknown) => Promise<void>>>;

  const budgetInput = (): HTMLInputElement => {
    const label = [...container.querySelectorAll('label')].find(
      (node) => node.textContent?.trim() === 'settings.taggingDailyTokenBudget',
    );
    const input = label ? document.getElementById(label.htmlFor) : null;
    if (!(input instanceof HTMLInputElement)) throw new Error('no budget input');
    return input;
  };
  const saveButton = (): HTMLButtonElement => {
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'settings.save',
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error('no save button');
    return button;
  };
  const type = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const render = () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <LlmConfigCard settings={SETTINGS} saveLlm={saveLlm} />
        </ThemeProvider>,
      );
    });
  };

  beforeEach(() => {
    mocks.spentToday = null;
    mocks.testLlmConnection.mockReset();
    saveLlm = vi.fn<(draft: unknown) => Promise<void>>().mockResolvedValue(undefined);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('shows the saved daily budget', () => {
    render();

    expect(budgetInput().value).toBe('5000000');
  });

  it('saves a budget-only change without a connection test', async () => {
    render();
    expect(saveButton().disabled).toBe(true);

    type(budgetInput(), '2000000');
    expect(saveButton().disabled).toBe(false);

    await act(async () => saveButton().click());

    expect(mocks.testLlmConnection).not.toHaveBeenCalled();
    expect(saveLlm).toHaveBeenCalledOnce();
    expect(saveLlm).toHaveBeenCalledWith(
      expect.objectContaining({ taggingDailyTokenBudget: 2_000_000, maxTokens: 100_000 }),
    );
  });

  it.each(['0', '-5', '1.5', ''])('ignores the invalid budget input %j', (value) => {
    render();

    type(budgetInput(), value);

    expect(budgetInput().value).toBe('5000000');
    expect(saveButton().disabled).toBe(true);
  });

  it("shows today's spend against the saved limit, not the draft", () => {
    mocks.spentToday = 1234;
    render();

    type(budgetInput(), '2000000');

    expect(container.textContent).toContain(
      `${SPENT_LINE_KEY} ${JSON.stringify({ spent: '1234', limit: '5000000' })}`,
    );
  });

  it('omits the spend line while the ledger is unreadable', () => {
    mocks.spentToday = null;
    render();

    expect(container.textContent).not.toContain(SPENT_LINE_KEY);
  });
});
