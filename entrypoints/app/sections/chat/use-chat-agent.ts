import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import { isChatModelConfigured, resolveChatModel } from '@/lib/chat/config';
import {
  createConversationRuntime,
  type ConversationRuntime,
  type ConversationRuntimeSnapshot,
} from '@/lib/chat/conversation-runtime';
import { useSettings } from '@/lib/hooks/useSettings';

export type {
  ChatDisplayMessage,
  ChatErrorKind,
  ChatSource,
  ChatStatus,
  ConversationSummary,
  ToolActivity,
  ToolKind,
  ToolPhase,
} from '@/lib/chat/conversation-runtime';

export interface UseChatAgentReturn extends ConversationRuntimeSnapshot {
  configured: boolean;
  loading: boolean;
  send: (text: string) => void;
  stop: () => void;
  newConversation: () => void;
  switchConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
}

/** React Adapter for the Conversation runtime's immutable snapshot and commands. */
export function useChatAgent(): UseChatAgentReturn {
  const { settings, loading } = useSettings();
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const runtimeRef = useRef<ConversationRuntime | null>(null);
  if (runtimeRef.current === null) runtimeRef.current = createConversationRuntime();
  const runtime = runtimeRef.current;
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );

  useEffect(() => {
    void runtime.loadInitial();
    return () => runtime.cancelPending();
  }, [runtime]);

  const send = useCallback(
    (text: string) => {
      const resolved = resolveChatModel(settingsRef.current);
      void runtime.send(text, resolved.enabled ? resolved.model : null);
    },
    [runtime],
  );
  const stop = useCallback(() => runtime.stop(), [runtime]);
  const newConversation = useCallback(() => runtime.newConversation(), [runtime]);
  const switchConversation = useCallback(
    (id: string) => void runtime.switchConversation(id),
    [runtime],
  );
  const deleteConversation = useCallback(
    (id: string) => void runtime.deleteConversation(id),
    [runtime],
  );

  return {
    ...snapshot,
    configured: isChatModelConfigured(settings),
    loading,
    send,
    stop,
    newConversation,
    switchConversation,
    deleteConversation,
  };
}
