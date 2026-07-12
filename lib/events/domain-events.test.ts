import { describe, it, expect, vi } from 'vitest';
import { onDomainEvent, emitDomainEvent } from './domain-events';

describe('domain-events', () => {
  it('delivers the payload to a subscribed listener', () => {
    const seen: Array<{ platform: string; platformItemId: string }> = [];
    const off = onDomainEvent('item-tagged', (e) => seen.push(e));
    try {
      emitDomainEvent('item-tagged', { platform: 'bilibili', platformItemId: 'BV1X' });
      expect(seen).toEqual([{ platform: 'bilibili', platformItemId: 'BV1X' }]);
    } finally {
      off();
    }
  });

  it('stops delivery after unsubscribe', () => {
    const listener = vi.fn();
    const off = onDomainEvent('item-tagged', listener);
    off();
    emitDomainEvent('item-tagged', { platform: 'bilibili', platformItemId: 'BV2X' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies all listeners; a throwing listener never blocks the rest nor the emitter', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    const offBad = onDomainEvent('item-tagged', () => {
      throw new Error('listener boom');
    });
    const offGood = onDomainEvent('item-tagged', good);
    try {
      expect(() =>
        emitDomainEvent('item-tagged', { platform: 'bilibili', platformItemId: 'BV3X' }),
      ).not.toThrow();
      expect(good).toHaveBeenCalledTimes(1);
      expect(errSpy).toHaveBeenCalled();
    } finally {
      offBad();
      offGood();
      errSpy.mockRestore();
    }
  });

  it('emitting with no listeners is a no-op', () => {
    expect(() =>
      emitDomainEvent('item-tagged', { platform: 'bilibili', platformItemId: 'BV4X' }),
    ).not.toThrow();
  });
});
