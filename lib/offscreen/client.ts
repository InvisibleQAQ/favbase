import type { OffscreenProgressMessage, OffscreenRequest } from './types';
import {
  decodeOffscreenResponse,
  encodeOffscreenProgress,
  encodeOffscreenRequest,
  type OffscreenResponseMap,
} from './protocol';

export class OffscreenProtocolError extends Error {
  readonly messageType: string;

  constructor(messageType: string) {
    super(`Invalid offscreen response for ${messageType}`);
    this.name = 'OffscreenProtocolError';
    this.messageType = messageType;
  }
}

export async function sendOffscreenMessage<Type extends keyof OffscreenResponseMap>(
  request: Extract<OffscreenRequest, { type: Type }>,
): Promise<OffscreenResponseMap[Type]> {
  const encoded = encodeOffscreenRequest(request);
  if (!encoded) throw new OffscreenProtocolError(request.type);

  const raw = await chrome.runtime.sendMessage(encoded);
  const decoded = decodeOffscreenResponse(request.type, raw);
  if (!decoded.ok) throw new OffscreenProtocolError(request.type);
  return decoded.value;
}

export function sendOffscreenProgress(message: OffscreenProgressMessage): void {
  const encoded = encodeOffscreenProgress(message);
  if (!encoded) return;
  void chrome.runtime.sendMessage(encoded).catch(() => {});
}
