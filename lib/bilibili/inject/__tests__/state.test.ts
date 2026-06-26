import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStateMachine, type InjectEffects } from '../state';

function mockEffects(overrides?: Partial<InjectEffects>): InjectEffects {
  return {
    triggerCC: vi.fn(() => true),
    hideSubtitleDisplay: vi.fn(),
    restoreDisplay: vi.fn(),
    resolvePageMeta: vi.fn(() => ({ bvid: 'BVmock123', cid: 42 })),
    isPageMetaConsistent: vi.fn(() => true),
    postRouteSwitch: vi.fn(),
    postHandshake: vi.fn(),
    postSubtitleData: vi.fn(),
    ...overrides,
  };
}

const VALID_SUBTITLE_JSON = JSON.stringify({
  body: [
    { from: 0, to: 1, content: 'hello' },
    { from: 1, to: 2, content: 'world' },
  ],
});

describe('createStateMachine', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  describe('initial state', () => {
    it('starts in idle phase with generation 0', () => {
      const sm = createStateMachine(mockEffects());
      expect(sm.phase).toBe('idle');
      expect(sm.generation).toBe(0);
    });
  });

  describe('bootstrap', () => {
    it('emits handshake on bootstrap', () => {
      const fx = mockEffects();
      const sm = createStateMachine(fx);
      sm.bootstrap();
      expect(fx.postHandshake).toHaveBeenCalledWith('BVmock123', 42);
    });

    it('transitions to triggering phase', () => {
      const sm = createStateMachine(mockEffects());
      sm.bootstrap();
      expect(sm.phase).toBe('triggering');
    });

    it('schedules auto-trigger after 2s', () => {
      const fx = mockEffects();
      const sm = createStateMachine(fx);
      sm.bootstrap();
      expect(fx.triggerCC).not.toHaveBeenCalled();
      vi.advanceTimersByTime(2000);
      expect(fx.triggerCC).toHaveBeenCalledTimes(1);
    });

    it('starts reemit loop sending handshake every 1s', () => {
      const fx = mockEffects();
      const sm = createStateMachine(fx);
      sm.bootstrap();
      (fx.postHandshake as ReturnType<typeof vi.fn>).mockClear();

      vi.advanceTimersByTime(1000);
      expect(fx.postHandshake).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      expect(fx.postHandshake).toHaveBeenCalledTimes(2);
    });

    it('stops reemit loop after 10 ticks', () => {
      const fx = mockEffects();
      const sm = createStateMachine(fx);
      sm.bootstrap();
      (fx.postHandshake as ReturnType<typeof vi.fn>).mockClear();

      vi.advanceTimersByTime(10_000);
      expect(fx.postHandshake).toHaveBeenCalledTimes(10);

      vi.advanceTimersByTime(5000);
      expect(fx.postHandshake).toHaveBeenCalledTimes(10);
    });
  });

  describe('markCaptured', () => {
    it('transitions to captured phase on valid subtitle data', () => {
      const sm = createStateMachine(mockEffects());
      sm.markCaptured(0, VALID_SUBTITLE_JSON, 'https://www.bilibili.com/video/BV1abc123');
      expect(sm.phase).toBe('captured');
    });

    it('calls hideSubtitleDisplay + postHandshake + postSubtitleData', () => {
      const fx = mockEffects();
      const sm = createStateMachine(fx);
      sm.markCaptured(0, VALID_SUBTITLE_JSON, 'https://www.bilibili.com/video/BV1abc123');

      expect(fx.hideSubtitleDisplay).toHaveBeenCalledTimes(1);
      expect(fx.postHandshake).toHaveBeenCalledWith('BVmock123', 42);
      expect(fx.postSubtitleData).toHaveBeenCalledWith(
        'BVmock123', 42,
        [{ from: 0, to: 1, content: 'hello' }, { from: 1, to: 2, content: 'world' }],
      );
    });

    it('schedules restoreDisplay after 3s', () => {
      const fx = mockEffects();
      const sm = createStateMachine(fx);
      sm.markCaptured(0, VALID_SUBTITLE_JSON, 'https://www.bilibili.com/video/BV1abc123');

      expect(fx.restoreDisplay).not.toHaveBeenCalled();
      vi.advanceTimersByTime(3000);
      expect(fx.restoreDisplay).toHaveBeenCalledTimes(1);
    });

    it('stops auto-trigger on capture', () => {
      const fx = mockEffects();
      const sm = createStateMachine(fx);
      sm.bootstrap();
      sm.markCaptured(0, VALID_SUBTITLE_JSON, 'https://www.bilibili.com/video/BV1abc123');

      (fx.triggerCC as ReturnType<typeof vi.fn>).mockClear();
      vi.advanceTimersByTime(10_000);
      expect(fx.triggerCC).not.toHaveBeenCalled();
    });

    it('rejects stale generation', () => {
      const fx = mockEffects();
      const sm = createStateMachine(fx);
      sm.resetForRoute('BVnew');
      sm.markCaptured(0, VALID_SUBTITLE_JSON, 'https://www.bilibili.com/video/BV1abc123');
      expect(sm.phase).not.toBe('captured');
    });

    it('rejects if already captured', () => {
      const fx = mockEffects();
      const sm = createStateMachine(fx);
      sm.markCaptured(0, VALID_SUBTITLE_JSON, 'https://www.bilibili.com/video/BV1abc123');
      (fx.postSubtitleData as ReturnType<typeof vi.fn>).mockClear();

      sm.markCaptured(0, VALID_SUBTITLE_JSON, 'https://www.bilibili.com/video/BV1abc123');
      expect(fx.postSubtitleData).not.toHaveBeenCalled();
    });

    it('rejects invalid JSON', () => {
      const sm = createStateMachine(mockEffects());
      sm.markCaptured(0, 'not-json', 'https://www.bilibili.com/video/BV1abc123');
      expect(sm.phase).toBe('idle');
    });

    it('rejects empty body array', () => {
      const sm = createStateMachine(mockEffects());
      sm.markCaptured(0, JSON.stringify({ body: [] }), 'https://www.bilibili.com/video/BV1abc123');
      expect(sm.phase).toBe('idle');
    });

    it('extracts body from nested data.body', () => {
      const fx = mockEffects();
      const sm = createStateMachine(fx);
      const json = JSON.stringify({ data: { body: [{ from: 0, to: 1, content: 'nested' }] } });
      sm.markCaptured(0, json, 'https://www.bilibili.com/video/BV1abc123');
      expect(sm.phase).toBe('captured');
      expect(fx.postSubtitleData).toHaveBeenCalledWith(
        'BVmock123', 42,
        [{ from: 0, to: 1, content: 'nested' }],
      );
    });
  });

  describe('resetForRoute', () => {
    it('increments generation', () => {
      const sm = createStateMachine(mockEffects());
      expect(sm.generation).toBe(0);
      sm.resetForRoute('BVnew');
      expect(sm.generation).toBe(1);
    });

    it('resets phase to idle', () => {
      const fx = mockEffects();
      const sm = createStateMachine(fx);
      sm.markCaptured(0, VALID_SUBTITLE_JSON, 'https://www.bilibili.com/video/BV1abc123');
      expect(sm.phase).toBe('captured');

      sm.resetForRoute('BVnew');
      expect(sm.phase).toBe('idle');
    });

    it('calls restoreDisplay and postRouteSwitch', () => {
      const fx = mockEffects();
      const sm = createStateMachine(fx);
      sm.resetForRoute('BVnew');
      expect(fx.restoreDisplay).toHaveBeenCalledTimes(1);
      expect(fx.postRouteSwitch).toHaveBeenCalledWith('BVnew');
    });

    it('emits handshake after 800ms delay', () => {
      const fx = mockEffects();
      const sm = createStateMachine(fx);
      sm.resetForRoute('BVnew');
      (fx.postHandshake as ReturnType<typeof vi.fn>).mockClear();

      vi.advanceTimersByTime(799);
      expect(fx.postHandshake).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(fx.postHandshake).toHaveBeenCalledWith('BVmock123', 42);
    });

    it('transitions to triggering after 800ms', () => {
      const sm = createStateMachine(mockEffects());
      sm.resetForRoute('BVnew');
      expect(sm.phase).toBe('idle');

      vi.advanceTimersByTime(800);
      expect(sm.phase).toBe('triggering');
    });

    it('allows capture at new generation', () => {
      const fx = mockEffects();
      const sm = createStateMachine(fx);
      sm.resetForRoute('BVnew');
      sm.markCaptured(1, VALID_SUBTITLE_JSON, 'https://www.bilibili.com/video/BVnew');
      expect(sm.phase).toBe('captured');
    });

    it('clears pending restore timer from previous capture', () => {
      const fx = mockEffects();
      const sm = createStateMachine(fx);
      sm.markCaptured(0, VALID_SUBTITLE_JSON, 'https://www.bilibili.com/video/BV1abc123');
      (fx.restoreDisplay as ReturnType<typeof vi.fn>).mockClear();

      sm.resetForRoute('BVnew');
      (fx.restoreDisplay as ReturnType<typeof vi.fn>).mockClear();

      vi.advanceTimersByTime(3000);
      expect(fx.restoreDisplay).not.toHaveBeenCalled();
    });
  });

  describe('auto-trigger retry', () => {
    it('retries up to 10 times when triggerCC returns false', () => {
      const fx = mockEffects({ triggerCC: vi.fn(() => false) });
      const sm = createStateMachine(fx);
      sm.bootstrap();

      vi.advanceTimersByTime(2000);
      expect(fx.triggerCC).toHaveBeenCalledTimes(1);

      for (let i = 2; i <= 10; i++) {
        vi.advanceTimersByTime(1000);
        expect(fx.triggerCC).toHaveBeenCalledTimes(i);
      }

      vi.advanceTimersByTime(5000);
      expect(fx.triggerCC).toHaveBeenCalledTimes(10);
    });
  });

  describe('page meta consistency guard', () => {
    it('rejects markCaptured when __INITIAL_STATE__ is stale', () => {
      const fx = mockEffects({ isPageMetaConsistent: vi.fn(() => false) });
      const sm = createStateMachine(fx);
      sm.markCaptured(0, VALID_SUBTITLE_JSON, 'https://www.bilibili.com/video/BV1abc123');
      expect(sm.phase).toBe('idle');
      expect(fx.postSubtitleData).not.toHaveBeenCalled();
    });

    it('skips emitHandshake when page meta inconsistent', () => {
      const fx = mockEffects({ isPageMetaConsistent: vi.fn(() => false) });
      const sm = createStateMachine(fx);
      sm.bootstrap();
      expect(fx.postHandshake).not.toHaveBeenCalled();
    });

    it('delays autoTrigger when page meta inconsistent', () => {
      const fx = mockEffects({ isPageMetaConsistent: vi.fn(() => false) });
      const sm = createStateMachine(fx);
      sm.bootstrap();
      vi.advanceTimersByTime(12_000);
      expect(fx.triggerCC).not.toHaveBeenCalled();
    });
  });

  describe('reemit after capture', () => {
    it('reemits subtitle data instead of handshake after capture', () => {
      const fx = mockEffects();
      const sm = createStateMachine(fx);
      sm.bootstrap();
      sm.markCaptured(0, VALID_SUBTITLE_JSON, 'https://www.bilibili.com/video/BV1abc123');
      (fx.postSubtitleData as ReturnType<typeof vi.fn>).mockClear();
      (fx.postHandshake as ReturnType<typeof vi.fn>).mockClear();

      vi.advanceTimersByTime(1000);
      expect(fx.postSubtitleData).toHaveBeenCalledTimes(1);
      expect(fx.postHandshake).not.toHaveBeenCalled();
    });
  });
});
