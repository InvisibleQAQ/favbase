// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage', () => ({
  localeStorage: {
    getValue: () => Promise.resolve('en' as const),
    setValue: () => Promise.resolve(),
    watch: () => () => undefined,
  },
}));

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/lib/i18n', () => ({
  formatDateTime: () => 'formatted date',
}));

const mediaState = vi.hoisted(() => ({ isLgUp: true }));

vi.mock('@mui/material/useMediaQuery', () => ({ default: () => mediaState.isLgUp }));

vi.mock('./use-chat-agent', () => ({
  useChatAgent: vi.fn(),
}));

vi.mock('./source-card', () => ({ SourceCards: () => null }));
vi.mock('./chat-markdown', () => ({
  ChatMarkdown: ({ children }: { children: string }) => <>{children}</>,
}));

import { ThemeProvider } from '../../theme/theme-provider';
import { ChatWorkspace } from './chat-view';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const agent = {
  messages: [
    { id: 'question-1', role: 'user' as const, content: 'Stored question' },
    { id: 'answer-1', role: 'assistant' as const, content: 'Stored answer' },
  ],
  streamingText: '',
  toolActivity: null,
  status: 'idle' as const,
  errorKind: null,
  isStreaming: false,
  configured: true,
  loading: false,
  send: vi.fn(),
  stop: vi.fn(),
  conversations: [
    {
      id: 'conversation-1',
      title: 'Stored conversation',
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  historyError: false,
  activeConversationId: 'conversation-1',
  newConversation: vi.fn(),
  switchConversation: vi.fn(),
  deleteConversation: vi.fn(),
};

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function pressEnter(
  textarea: HTMLTextAreaElement,
  options: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; isComposing?: boolean } = {},
) {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
    shiftKey: options.shiftKey,
    ctrlKey: options.ctrlKey,
    metaKey: options.metaKey,
  });
  if (options.isComposing) Object.defineProperty(event, 'isComposing', { value: true });
  textarea.dispatchEvent(event);
}

describe('ChatWorkspace', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mediaState.isLgUp = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('separates the conversation navigation, message log, and composer', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <ChatWorkspace agent={agent} />
        </ThemeProvider>,
      );
    });

    const conversationNav = container.querySelector(
      'nav[aria-label="chat.conversationHistory"]',
    );
    const messageLog = container.querySelector('[role="log"][aria-label="chat.messageHistory"]');
    const composer = container.querySelector('textarea[aria-label="chat.composerLabel"]');

    expect(conversationNav).not.toBeNull();
    expect(messageLog).not.toBeNull();
    expect(composer).not.toBeNull();
    expect(messageLog?.contains(composer)).toBe(false);
    expect(messageLog?.querySelector('[aria-label="chat.userMessage"]')).not.toBeNull();
    expect(messageLog?.querySelector('[aria-label="chat.assistantMessage"]')).not.toBeNull();
  });

  it('renders a distinct loading state before the workspace is interactive', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <ChatWorkspace agent={{ ...agent, loading: true, messages: [] }} />
        </ThemeProvider>,
      );
    });

    expect(container.textContent).toContain('chat.loading');
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('opens mobile conversation history with an explicit close control', () => {
    mediaState.isLgUp = false;

    act(() => {
      root.render(
        <ThemeProvider>
          <ChatWorkspace agent={agent} />
        </ThemeProvider>,
      );
    });

    const openButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="chat.openHistory"]',
    );
    expect(openButton).not.toBeNull();

    act(() => openButton?.click());

    expect(
      document.body.querySelector('button[aria-label="chat.closeHistory"]'),
    ).not.toBeNull();
  });

  it('marks the active Conversation without nesting its delete action', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <ChatWorkspace agent={agent} />
        </ThemeProvider>,
      );
    });

    const currentConversation = container.querySelector('[aria-current="true"]');
    const deleteButton = container.querySelector(
      'button[aria-label="chat.deleteConversation: Stored conversation"]',
    );

    expect(currentConversation?.textContent).toContain('Stored conversation');
    expect(deleteButton).not.toBeNull();
    expect(currentConversation?.contains(deleteButton)).toBe(false);

    act(() => deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(agent.deleteConversation).toHaveBeenCalledWith('conversation-1');
    expect(agent.switchConversation).not.toHaveBeenCalled();
  });

  it('preserves the composer Enter, newline, and IME contract', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <ChatWorkspace agent={agent} />
        </ThemeProvider>,
      );
    });

    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="chat.composerLabel"]',
    );
    expect(textarea).not.toBeNull();

    act(() => {
      setTextareaValue(textarea!, 'Send this');
      pressEnter(textarea!);
    });
    expect(agent.send).toHaveBeenCalledWith('Send this');

    vi.mocked(agent.send).mockClear();
    act(() => {
      setTextareaValue(textarea!, 'Keep editing');
      pressEnter(textarea!, { shiftKey: true });
    });
    expect(agent.send).not.toHaveBeenCalled();

    act(() => {
      setTextareaValue(textarea!, 'abcd');
      textarea!.selectionStart = textarea!.selectionEnd = 2;
      pressEnter(textarea!, { ctrlKey: true });
    });
    expect(agent.send).not.toHaveBeenCalled();
    expect(textarea?.value).toBe('ab\ncd');

    act(() => {
      setTextareaValue(textarea!, 'composing');
      pressEnter(textarea!, { isComposing: true });
    });
    expect(agent.send).not.toHaveBeenCalled();
  });
});
