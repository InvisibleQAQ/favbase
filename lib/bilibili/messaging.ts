import type { RawSubtitleItem } from '../types';

export interface BiliMessageMap {
  BILI_ROUTE_SWITCH: { bvid: string };
  BILI_SUBTITLE_HANDSHAKE: { bvid: string; cid: number };
  BILI_SUBTITLE_DATA: { data: RawSubtitleItem[]; bvid: string; cid: number };
}

export type BiliMsgType = keyof BiliMessageMap;

export function postBiliMessage<T extends BiliMsgType>(
  type: T,
  payload: BiliMessageMap[T],
  opts?: { defer?: boolean },
): void {
  const send = () => window.postMessage({ type, ...payload }, '*');
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
    callback(msg as BiliMessageMap[T]);
  }

  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
