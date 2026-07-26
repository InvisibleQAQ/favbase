import { describe, expect, it, vi } from 'vitest';

const processingMocks = vi.hoisted(() => ({
  enqueueCollectionProcessingItem: vi.fn(() => ({
    embed: Promise.resolve('embedded' as const),
    tag: Promise.resolve('tagged' as const),
  })),
}));

vi.mock('../../hooks/collection-processing-jobs', () => processingMocks);

import { enqueueBiliCollectionProcessing } from './bilibili-processing-adapter';

describe('Bilibili collection processing adapter', () => {
  it('maps a durable transcript item into the shared Bilibili lanes', () => {
    const ticket = enqueueBiliCollectionProcessing('BV1');

    expect(processingMocks.enqueueCollectionProcessingItem).toHaveBeenCalledWith({
      jobPlatform: 'bilibili',
      itemPlatform: 'bilibili',
      itemId: 'BV1',
    });
    expect(ticket).toEqual({
      embed: expect.any(Promise),
      tag: expect.any(Promise),
    });
  });
});
