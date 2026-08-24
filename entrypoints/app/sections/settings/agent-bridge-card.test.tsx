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
  t: (key: string, params?: Record<string, string | number>) => {
    let value = key;
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

import {
  AgentBridgeCard,
  buildClaudeCodeCommand,
  buildCodexCommand,
  encodeAgentBridgeToken,
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

  it('builds the verified Claude Code and Codex command shapes', () => {
    expect(buildClaudeCodeCommand('bridge_token', 17_836)).toBe(
      'claude mcp add favbase -e FAVBASE_TOKEN=bridge_token -e FAVBASE_BRIDGE_PORT=17836 -- npx -y favbase-mcp',
    );
    expect(buildCodexCommand('bridge_token', 17_836)).toBe(
      'codex mcp add favbase --env FAVBASE_TOKEN=bridge_token --env FAVBASE_BRIDGE_PORT=17836 -- npx -y favbase-mcp',
    );
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

  it('copies commands with the persisted token and current port', async () => {
    await render({ ...DEFAULT_CONFIG, token: 'existing-token', tokenCreatedAt: 1 });

    await act(async () => findButton(container, 'settings.agentBridge.copyClaude').click());
    expect(mocks.writeText).toHaveBeenLastCalledWith(
      buildClaudeCodeCommand('existing-token', 17_836),
    );

    await act(async () => findButton(container, 'settings.agentBridge.copyCodex').click());
    expect(mocks.writeText).toHaveBeenLastCalledWith(
      buildCodexCommand('existing-token', 17_836),
    );
    expect(container.textContent).toContain('settings.agentBridge.copySuccess');
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

  it('shows a recoverable error when clipboard access fails', async () => {
    mocks.writeText.mockRejectedValueOnce(new Error('permission denied'));
    await render({ ...DEFAULT_CONFIG, token: 'existing-token', tokenCreatedAt: 1 });

    await act(async () => findButton(container, 'settings.agentBridge.copyClaude').click());

    expect(container.textContent).toContain('settings.agentBridge.copyFailed');
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
      });
    });

    expect(container.textContent).toContain('settings.agentBridge.stateConnected');
    expect(container.textContent).toContain('time:123');
  });

  it('unsubscribes both storage watchers on unmount', async () => {
    await render();

    act(() => root.unmount());
    mounted = false;

    expect(mocks.unwatchConfig).toHaveBeenCalledOnce();
    expect(mocks.unwatchStatus).toHaveBeenCalledOnce();
  });
});
