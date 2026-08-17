import { z } from 'zod';

import type { RawSubtitleItem } from './types';

export interface BiliMessageMap {
  BILI_ROUTE_SWITCH: { bvid: string };
  BILI_SUBTITLE_HANDSHAKE: { bvid: string; cid: number };
  BILI_SUBTITLE_DATA: { data: RawSubtitleItem[]; bvid: string; cid: number };
}

export type BiliMsgType = keyof BiliMessageMap;

export const BILI_PROTOCOL_CHANNEL = 'favbase-bilibili';
export const BILI_PROTOCOL_VERSION = 1;
export const MAX_BILI_SUBTITLE_ITEMS = 20_000;
export const MAX_BILI_SUBTITLE_TEXT_CHARS = 2_000_000;

const bvidSchema = z.string().min(1).max(64);
const cidSchema = z.number().int().nonnegative();
const envelopeShape = {
  channel: z.literal(BILI_PROTOCOL_CHANNEL).optional(),
  protocolVersion: z.literal(BILI_PROTOCOL_VERSION).optional(),
};
const rawSubtitleItemSchema = z.object({
  from: z.number().finite(),
  to: z.number().finite(),
  content: z.string().max(10_000),
});

const biliMessageSchemas = {
  BILI_ROUTE_SWITCH: z.object({
    ...envelopeShape,
    type: z.literal('BILI_ROUTE_SWITCH'),
    bvid: bvidSchema,
  }),
  BILI_SUBTITLE_HANDSHAKE: z.object({
    ...envelopeShape,
    type: z.literal('BILI_SUBTITLE_HANDSHAKE'),
    bvid: bvidSchema,
    cid: cidSchema,
  }),
  BILI_SUBTITLE_DATA: z.object({
      ...envelopeShape,
      type: z.literal('BILI_SUBTITLE_DATA'),
      data: z.array(rawSubtitleItemSchema).max(MAX_BILI_SUBTITLE_ITEMS),
      bvid: bvidSchema,
      cid: cidSchema,
    })
    .refine((message) => {
      let total = 0;
      for (const item of message.data) {
        total += item.content.length;
        if (total > MAX_BILI_SUBTITLE_TEXT_CHARS) return false;
      }
      return true;
    }),
} satisfies { [T in BiliMsgType]: z.ZodType<{ type: T } & BiliMessageMap[T]> };

const warnedProtocolTypes = new Set<string>();

function warnProtocolRejection(type: string, direction: 'send' | 'receive'): void {
  const key = `${direction}:${type}`;
  if (warnedProtocolTypes.has(key)) return;
  warnedProtocolTypes.add(key);
  console.warn(`[bilibili protocol] refused invalid ${type} message (${direction})`);
}

function decodeBiliMessage<T extends BiliMsgType>(
  type: T,
  input: unknown,
): BiliMessageMap[T] | null {
  const result = biliMessageSchemas[type].safeParse(input);
  if (!result.success) return null;
  // The keyed schema map preserves the type/value pairing at runtime; TypeScript
  // loses that correlation when indexing with a generic key.
  return result.data as BiliMessageMap[T];
}

export function postBiliMessage<T extends BiliMsgType>(
  type: T,
  payload: BiliMessageMap[T],
  opts?: { defer?: boolean },
): void {
  const message = decodeBiliMessage(type, {
    type,
    ...payload,
    channel: BILI_PROTOCOL_CHANNEL,
    protocolVersion: BILI_PROTOCOL_VERSION,
  });
  if (!message) {
    warnProtocolRejection(type, 'send');
    return;
  }

  const send = () => window.postMessage(message, '*');
  if (opts?.defer) {
    setTimeout(send, 0);
  } else {
    send();
  }
}

export function onBiliMessage<T extends BiliMsgType>(
  type: T,
  callback: (payload: BiliMessageMap[T]) => void,
): () => void {
  function handler(event: MessageEvent): void {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.type !== type) return;
    const payload = decodeBiliMessage(type, msg);
    if (!payload) {
      warnProtocolRejection(type, 'receive');
      return;
    }
    callback(payload);
  }

  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
