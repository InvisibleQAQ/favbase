import { describe, expect, it } from 'vitest';
import { createJobRegistry } from './job-registry';

describe('createJobRegistry', () => {
  it('dedups the same video across tabs and frees the slot on finish', () => {
    const registry = createJobRegistry();

    const first = registry.start(1, 'BV1');
    expect(first).not.toBeNull();
    expect(registry.start(2, 'bv1')).toBeNull(); // case-insensitive dedup

    registry.finish(1, first!);
    expect(registry.start(2, 'BV1')).not.toBeNull();
  });

  it('releases the previous video when a tab switches videos', () => {
    const registry = createJobRegistry();

    registry.start(1, 'BV1');
    expect(registry.start(1, 'BV2')).not.toBeNull();
    expect(registry.getVideoId(1)).toBe('BV2');
    // BV1's slot was handed back, so another tab may take it.
    expect(registry.start(2, 'BV1')).not.toBeNull();
  });

  it('aborts the running controller and tolerates aborting an idle tab', () => {
    const registry = createJobRegistry();
    const controller = registry.start(1, 'BV1')!;

    registry.abort(1);
    expect(controller.signal.aborted).toBe(true);
    expect(registry.getVideoId(1)).toBeUndefined();

    expect(() => registry.abort(1)).not.toThrow();
    expect(() => registry.abort(99)).not.toThrow();
  });

  it('ignores a stale job finishing after a restart in the same tab', () => {
    const registry = createJobRegistry();

    // cancel → immediately generate again: the aborted job's cleanup lands last.
    const stale = registry.start(1, 'BV1')!;
    registry.abort(1);
    const fresh = registry.start(1, 'BV1')!;
    registry.finish(1, stale);

    // The live job still owns the tab: abortable and still deduped.
    expect(registry.getVideoId(1)).toBe('BV1');
    expect(registry.start(2, 'BV1')).toBeNull();
    registry.abort(1);
    expect(fresh.signal.aborted).toBe(true);
  });
});
