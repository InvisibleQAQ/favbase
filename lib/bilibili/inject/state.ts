import { extractBvid } from '../url-utils';

export type InjectPhase = 'idle' | 'triggering' | 'captured';

export interface InjectEffects {
  triggerCC(): boolean;
  hideSubtitleDisplay(): void;
  restoreDisplay(): void;
  resolvePageMeta(): { bvid: string; cid: number };
  isPageMetaConsistent(): boolean;
  postRouteSwitch(bvid: string): void;
  postHandshake(bvid: string, cid: number): void;
  postSubtitleData(bvid: string, cid: number, body: unknown[]): void;
}

export interface InjectStateMachine {
  readonly generation: number;
  readonly phase: InjectPhase;
  bootstrap(): void;
  markCaptured(gen: number, rawText: string, capturedUrl: string): void;
  resetForRoute(newBvid: string): void;
}

export function createStateMachine(effects: InjectEffects): InjectStateMachine {
  let phase: InjectPhase = 'idle';
  let generation = 0;
  let capturedBvid = '';
  let cachedSubtitleBody: unknown[] | null = null;

  let autoTriggerTimer: ReturnType<typeof setTimeout> | null = null;
  let autoTriggerAttempts = 0;
  let stealthRestoreTimer: ReturnType<typeof setTimeout> | null = null;
  let routeResolveTimer: ReturnType<typeof setTimeout> | null = null;
  let reemitTimer: ReturnType<typeof setInterval> | null = null;

  function clearAllTimers(): void {
    if (autoTriggerTimer) { clearTimeout(autoTriggerTimer); autoTriggerTimer = null; }
    if (stealthRestoreTimer) { clearTimeout(stealthRestoreTimer); stealthRestoreTimer = null; }
    if (routeResolveTimer) { clearTimeout(routeResolveTimer); routeResolveTimer = null; }
    if (reemitTimer) { clearInterval(reemitTimer); reemitTimer = null; }
  }

  function stopAutoTrigger(): void {
    if (autoTriggerTimer) { clearTimeout(autoTriggerTimer); autoTriggerTimer = null; }
  }

  function stopReemit(): void {
    if (reemitTimer) { clearInterval(reemitTimer); reemitTimer = null; }
  }

  function emitHandshake(): void {
    if (!effects.isPageMetaConsistent()) return;
    const meta = effects.resolvePageMeta();
    if (meta.bvid) {
      capturedBvid = meta.bvid;
      effects.postHandshake(meta.bvid, meta.cid);
    }
  }

  function autoTriggerLoop(): void {
    if (phase === 'captured') return;

    if (!effects.isPageMetaConsistent()) {
      autoTriggerAttempts++;
      if (autoTriggerAttempts >= 10) return;
      autoTriggerTimer = setTimeout(autoTriggerLoop, 1000);
      return;
    }

    const triggered = effects.triggerCC();
    if (!triggered) {
      autoTriggerAttempts++;
      if (autoTriggerAttempts >= 10) return;
      autoTriggerTimer = setTimeout(autoTriggerLoop, 1000);
      return;
    }
  }

  function startAutoTrigger(): void {
    if (phase === 'captured') return;
    stopAutoTrigger();
    phase = 'triggering';
    autoTriggerAttempts = 0;
    autoTriggerTimer = setTimeout(autoTriggerLoop, 2000);
  }

  function startReemit(): void {
    stopReemit();
    let ticks = 0;
    reemitTimer = setInterval(() => {
      ticks++;
      if (ticks > 10) { stopReemit(); return; }

      if (phase === 'captured' && cachedSubtitleBody) {
        const urlBvid = extractBvid(location.href);
        if (capturedBvid && urlBvid
            && capturedBvid.toLowerCase() !== urlBvid.toLowerCase()) {
          return;
        }
        const meta = effects.resolvePageMeta();
        if (meta.bvid) effects.postSubtitleData(meta.bvid, meta.cid, cachedSubtitleBody);
      } else {
        emitHandshake();
      }
    }, 1000);
  }

  const sm: InjectStateMachine = {
    get generation() { return generation; },
    get phase() { return phase; },

    bootstrap(): void {
      emitHandshake();
      startAutoTrigger();
      startReemit();
    },

    markCaptured(gen: number, rawText: string, capturedUrl: string): void {
      if (phase === 'captured') return;
      if (gen !== generation) return;
      if (!effects.isPageMetaConsistent()) return;

      const fetchBvid = extractBvid(capturedUrl);
      const currentUrlBvid = extractBvid(location.href);
      if (fetchBvid && currentUrlBvid
          && fetchBvid.toLowerCase() !== currentUrlBvid.toLowerCase()) {
        return;
      }

      let data: any;
      try { data = JSON.parse(rawText); } catch { return; }

      const body =
        data?.body ??
        data?.data?.body ??
        data?.content ??
        data?.result?.body ??
        (Array.isArray(data) ? data : null);

      if (!Array.isArray(body) || !body.length) return;

      phase = 'captured';
      capturedBvid = fetchBvid ?? capturedBvid;
      cachedSubtitleBody = body;

      stopAutoTrigger();
      effects.hideSubtitleDisplay();

      const meta = effects.resolvePageMeta();
      const bvid = meta.bvid || capturedBvid;
      if (bvid) {
        effects.postHandshake(bvid, meta.cid);
        effects.postSubtitleData(bvid, meta.cid, body);
      }

      if (stealthRestoreTimer) clearTimeout(stealthRestoreTimer);
      stealthRestoreTimer = setTimeout(() => {
        effects.restoreDisplay();
        stealthRestoreTimer = null;
      }, 3000);
    },

    resetForRoute(newBvid: string): void {
      generation++;
      phase = 'idle';
      capturedBvid = newBvid;
      cachedSubtitleBody = null;

      clearAllTimers();
      effects.restoreDisplay();
      effects.postRouteSwitch(newBvid);

      routeResolveTimer = setTimeout(() => {
        emitHandshake();
        startAutoTrigger();
        startReemit();
        routeResolveTimer = null;
      }, 800);
    },
  };

  return sm;
}
