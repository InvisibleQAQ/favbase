import type { BgClientMessage, BgMessage } from './messages';
import {
  decodeBackgroundPush,
  decodeBackgroundResponse,
  encodeBackgroundClientMessage,
  encodeBackgroundMessage,
  type BackgroundClientMessageType,
  type BackgroundPushMessage,
  type BackgroundResponseMap,
} from './message-protocol';

export class BackgroundProtocolError extends Error {
  readonly messageType: string;

  constructor(messageType: string) {
    super(`Invalid background response for ${messageType}`);
    this.name = 'BackgroundProtocolError';
    this.messageType = messageType;
  }
}

export async function sendBackgroundMessage<Type extends BackgroundClientMessageType>(
  request: Extract<BgClientMessage, { type: Type }>,
): Promise<BackgroundResponseMap[Type]> {
  const encoded = encodeBackgroundClientMessage(request);
  if (!encoded) throw new BackgroundProtocolError(request.type);

  const raw = await browser.runtime.sendMessage(encoded);
  const decoded = decodeBackgroundResponse(request.type, raw);
  if (!decoded.ok) throw new BackgroundProtocolError(request.type);
  return decoded.value;
}

export function sendBackgroundProgress(
  message: Extract<BgMessage, { type: 'OFFSCREEN_CHUNK_PROGRESS' }>,
): void {
  const encoded = encodeBackgroundMessage(message);
  if (!encoded) return;
  void browser.runtime.sendMessage(encoded).catch(() => {});
}

export function onBackgroundPush<Type extends BackgroundPushMessage['type']>(
  type: Type,
  callback: (message: Extract<BackgroundPushMessage, { type: Type }>) => void,
): () => void {
  const handler = (input: unknown) => {
    const message = decodeBackgroundPush(type, input);
    if (message) callback(message);
  };

  browser.runtime.onMessage.addListener(handler);
  return () => browser.runtime.onMessage.removeListener(handler);
}
