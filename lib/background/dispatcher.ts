import type { BgMessage } from './messages';
import type { BackgroundContext } from './types';
import { decodeBackgroundMessage } from './message-protocol';

export interface BackgroundMessageSender {
  id?: string;
  url?: string;
  tab?: { id?: number };
}

export type RouteBackgroundMessage = (
  message: BgMessage,
  sender: BackgroundMessageSender,
  ctx: BackgroundContext,
) => void | Promise<unknown>;

export function dispatchBackgroundMessage(
  input: unknown,
  sender: BackgroundMessageSender,
  ctx: BackgroundContext,
  route: RouteBackgroundMessage,
): void | Promise<unknown> {
  const msg = decodeBackgroundMessage(input);
  if (!msg) return;
  if (sender.id !== browser.runtime.id) return;
  if (
    msg.type === 'OFFSCREEN_CHUNK_PROGRESS' &&
    sender.url !== browser.runtime.getURL('/offscreen.html')
  ) return;
  return route(msg, sender, ctx);
}
