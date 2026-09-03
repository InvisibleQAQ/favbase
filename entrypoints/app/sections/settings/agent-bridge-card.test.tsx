// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentBridgeConfig, AgentBridgeStatus } from '@/lib/storage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  defaultConfig: {
    enabled: false,
    port: 17_836,
    token: '',
    tokenCreatedAt: null,
  } satisfies AgentBridgeConfig,
  defaultStatus: {
    state: 'disabled',
    lastConnectedAt: null,
    lastError: null,
    authFailureCount: 0,
    nextRetryAt: null,
    lastAuthFailureAt: null,
  } satisfies AgentBridgeStatus,
  getConfig: vi.fn(),
  getStatus: vi.fn(),
  setConfig: vi.fn(),
  sendBackgroundMessage: vi.fn(),
  unwatchConfig: vi.fn(),
  unwatchStatus: vi.fn(),
  configListener: null as null | ((value: AgentBridgeConfig) => void),
  statusListener: null as null | ((value: AgentBridgeStatus) => void),
  writeText: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  t: (key: string, params?: Record<string, string | number>) => {
    let value = key === 'settings.agentBridge.retryIn'
      ? `${key}:{{time}}`
      : key;
    for (const [name, param] of Object.entries(params ?? {})) {
      value = value.replace(`{{${name}}}`, String(param));
    }
    return value;
  },
}));

const DEFAULT_CONFIG = mocks.defaultConfig;
const DEFAULT_STATUS = mocks.defaultStatus;

vi.mock('@/lib/storage', () => ({
  DEFAULT_AGENT_BRIDGE_CONFIG: mocks.defaultConfig,
  DEFAULT_AGENT_BRIDGE_STATUS: mocks.defaultStatus,
  getAgentBridgeConfig: mocks.getConfig,
  getAgentBridgeStatus: mocks.getStatus,
  setAgentBridgeConfig: mocks.setConfig,
  watchAgentBridgeConfig: vi.fn((listener: (value: AgentBridgeConfig) => void) => {
    mocks.configListener = listener;
    return mocks.unwatchConfig;
  }),
  watchAgentBridgeStatus: vi.fn((listener: (value: AgentBridgeStatus) => void) => {
    mocks.statusListener = listener;
    return mocks.unwatchStatus;
  }),
}));

vi.mock('@/lib/background/client', () => ({
  sendBackgroundMessage: mocks.sendBackgroundMessage,
}));

vi.mock('@/lib/i18n', () => ({
  formatDateTime: (timestamp: number) => `time:${timestamp}`,
}));

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({
    t: mocks.t,
  }),
}));

vi.mock('../../components/iconify', () => ({
  Iconify: ({ icon }: { icon: string }) => <span data-icon={icon} aria-hidden="true" />,
}));

vi.mock('../../components/snackbar', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

import {
  AgentBridgeCard,
  buildSetupCommand,
  encodeAgentBridgeToken,
  formatRetryCountdown,
  parseAgentBridgePort,
} from './agent-bridge-card';
import { ThemeProvider } from '../../theme/theme-provider';

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`);
  return button;
}

describe('AgentBridgeCard helpers', () => {
  it.each([
    ['', null],
    ['1.5', null],
    ['abc', null],
    ['0', null],
    ['65536', null],
    ['1', 1],
    [' 17836 ', 17_836],
    ['65535', 65_535],
  ])('parses port %j as %j', (value, expected) => {
    expect(parseAgentBridgePort(value)).toBe(expected);
  });

  it('encodes 32 bytes as an unpadded 43-character base64url token', () => {
    const token = encodeAgentBridgeToken(Uint8Array.from({ length: 32 }, (_, index) => index));
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain('=');
  });

  it('builds the single favbase CLI setup command for every agent', () => {
    expect(buildSetupCommand('bridge_token', 17_836)).toBe(
      'npx -y favbase-cli setup --token bridge_token --port 17836',
    );
  });

  it('formats retry deadlines as a stable non-negative mm:ss countdown', () => {
    expect(formatRetryCountdown(62_000, 1_000)).toBe('01:01');
    expect(formatRetryCountdown(61_001, 1_000)).toBe('01:01');
    expect(formatRetryCountdown(61_000, 1_000)).toBe('01:00');
    expect(formatRetryCountdown(1_000, 1_001)).toBe('00:00');
  });
});

describe('AgentBridgeCard', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;

  async function render(config: AgentBridgeConfig = DEFAULT_CONFIG) {
    mocks.getConfig.mockResolvedValue(config);
    await act(async () => root.render(
      <ThemeProvider>
        <AgentBridgeCard />
      </ThemeProvider>,
    ));
    await act(async () => undefined);
  }

  beforeEach(() => {
    mocks.getConfig.mockReset();
    mocks.getStatus.mockReset().mockResolvedValue(DEFAULT_STATUS);
    mocks.setConfig.mockReset().mockResolvedValue(undefined);
    mocks.sendBackgroundMessage.mockReset().mockResolvedValue(undefined);
    mocks.unwatchConfig.mockReset();
    mocks.unwatchStatus.mockReset();
    mocks.configListener = null;
    mocks.statusListener = null;
    mocks.writeText.mockReset().mockResolvedValue(undefined);
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.writeText },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mounted = true;
  });

  afterEach(() => {
    if (mounted) act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('generates and persists a token atomically when enabling an unpaired bridge', async () => {
    await render();

    const checkbox = container.querySelector('input[type="checkbox"]');
    if (!(checkbox instanceof HTMLInputElement)) throw new Error('Switch not found');
    await act(async () => checkbox.click());

    expect(mocks.setConfig).toHaveBeenCalledOnce();
    const persisted = mocks.setConfig.mock.calls[0][0] as AgentBridgeConfig;
    expect(persisted).toMatchObject({ enabled: true, port: 17_836 });
    expect(persisted.token).toHaveLength(43);
    expect(persisted.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(persisted.tokenCreatedAt).toEqual(expect.any(Number));
    expect(mocks.sendBackgroundMessage).toHaveBeenCalledWith({
      type: 'AGENT_BRIDGE_CONNECT_NOW',
    });
  });

  it('does not persist an invalid port draft', async () => {
    await render({ ...DEFAULT_CONFIG, token: 'existing-token', tokenCreatedAt: 1 });
    mocks.setConfig.mockClear();

    const portInput = container.querySelector('input[value="17836"]');
    if (!(portInput instanceof HTMLInputElement)) throw new Error('Port input not found');
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(portInput, '65536');
      portInput.dispatchEvent(new Event('input', { bubbles: true }));
      portInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });

    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(container.textContent).toContain('settings.agentBridge.portInvalid');
  });

  it('copies the setup command with the persisted token and current port', async () => {
    await render({ ...DEFAULT_CONFIG, token: 'existing-token', tokenCreatedAt: 1 });

    await act(async () => findButton(container, 'settings.agentBridge.copySetup').click());
    expect(mocks.writeText).toHaveBeenLastCalledWith(
      buildSetupCommand('existing-token', 17_836),
    );
    // docs/25 Step 5: a copy is a one-shot action, so the result is a toast and
    // nothing is left behind in the card.
    expect(mocks.toastSuccess).toHaveBeenCalledExactlyOnceWith('settings.agentBridge.copySuccess');
    expect(container.textContent).not.toContain('settings.agentBridge.copySuccess');
  });

  it('resets the token without changing enablement or port', async () => {
    await render({
      enabled: true,
      port: 43_210,
      token: 'existing-token',
      tokenCreatedAt: 1,
    });

    await act(async () => findButton(container, 'settings.agentBridge.resetToken').click());

    const persisted = mocks.setConfig.mock.calls[0][0] as AgentBridgeConfig;
    expect(persisted.enabled).toBe(true);
    expect(persisted.port).toBe(43_210);
    expect(persisted.token).toHaveLength(43);
    expect(persisted.token).not.toBe('existing-token');
    expect(persisted.tokenCreatedAt).toEqual(expect.any(Number));
  });

  it('reports a clipboard failure through the snackbar, not the card body', async () => {
    mocks.writeText.mockRejectedValueOnce(new Error('permission denied'));
    await render({ ...DEFAULT_CONFIG, token: 'existing-token', tokenCreatedAt: 1 });

    await act(async () => findButton(container, 'settings.agentBridge.copySetup').click());

    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('settings.agentBridge.copyFailed');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('settings.agentBridge.copyFailed');
  });

  it('renders status updates from storage without remounting', async () => {
    await render({ ...DEFAULT_CONFIG, enabled: true, token: 'existing-token' });

    act(() => {
      mocks.statusListener?.({
        state: 'connected',
        lastConnectedAt: 123,
        lastError: null,
        authFailureCount: 0,
        nextRetryAt: null,
        lastAuthFailureAt: null,
      });
    });

    expect(container.textContent).toContain('settings.agentBridge.stateConnected');
    expect(container.textContent).toContain('time:123');
  });

  it('counts down bad-token retry time and reuses the setup copy action', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    await render({
      ...DEFAULT_CONFIG,
      enabled: true,
      token: 'existing-token',
      tokenCreatedAt: 1,
    });

    act(() => {
      mocks.statusListener?.({
        state: 'disconnected',
        lastConnectedAt: null,
        lastError: 'bad-token',
        authFailureCount: 2,
        nextRetryAt: 62_000,
        lastAuthFailureAt: 500,
      });
    });

    expect(container.textContent).toContain('settings.agentBridge.errorBadToken');
    expect(container.textContent).toContain('settings.agentBridge.retryIn:01:01');
    expect(container.textContent).toContain('settings.agentBridge.lastAuthFailure');
    expect(container.textContent).toContain('time:500');

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(container.textContent).toContain('settings.agentBridge.retryIn:01:00');

    await act(async () => {
      findButton(container, 'settings.agentBridge.copySetupToFix').click();
    });
    expect(mocks.writeText).toHaveBeenLastCalledWith(
      buildSetupCommand('existing-token', 17_836),
    );

    act(() => root.unmount());
    mounted = false;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('unsubscribes both storage watchers on unmount', async () => {
    await render();

    act(() => root.unmount());
    mounted = false;

    expect(mocks.unwatchConfig).toHaveBeenCalledOnce();
    expect(mocks.unwatchStatus).toHaveBeenCalledOnce();
  });
});
