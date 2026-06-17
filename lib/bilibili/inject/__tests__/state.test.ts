import { describe, it, expect } from 'vitest';
import { createState } from '../state';

describe('createState', () => {
  it('returns fresh state with default values', () => {
    const s = createState();
    expect(s.isSubtitleCaptured).toBe(false);
    expect(s.capturedBvid).toBe('');
    expect(s.cachedSubtitleBody).toBeNull();
    expect(s.routeGeneration).toBe(0);
    expect(s.autoTriggerAttempts).toBe(0);
    expect(s.autoTriggerStarted).toBe(false);
    expect(s.lastPageNum).toBe(1);
  });

  it('captures original browser APIs', () => {
    const s = createState();
    expect(typeof s.originalFetch).toBe('function');
    expect(typeof s.originalXhrOpen).toBe('function');
    expect(typeof s.originalXhrSend).toBe('function');
  });

  it('returns independent instances', () => {
    const a = createState();
    const b = createState();
    a.isSubtitleCaptured = true;
    expect(b.isSubtitleCaptured).toBe(false);
  });
});
