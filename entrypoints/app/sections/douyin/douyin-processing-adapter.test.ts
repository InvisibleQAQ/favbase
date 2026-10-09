import { describe, expect, it, vi } from 'vitest';

const processingMocks = vi.hoisted(() => ({
  enqueueCollectionProcessingItem: vi.fn(() => ({
    embed: Promise.resolve('embedded' as const),
    tag: Promise.resolve('tagged' as const),
  })),
}));

vi.mock('../../hooks/collection-processing-jobs', () => processingMocks);

import { enqueueDouyinCollectionProcessing } from './douyin-processing-adapter';

describe('Douyin collection processing adapter', () => {
  it('maps one durable item (by aweme_id) into the shared Douyin lanes', () => {
    const ticket = enqueueDouyinCollectionProcessing('7300000000000000001');

    expect(processingMocks.enqueueCollectionProcessingItem).toHaveBeenCalledWith({
      jobPlatform: 'douyin',
      itemPlatform: 'douyin',
      itemId: '7300000000000000001',
    });
    expect(ticket).toEqual({
      embed: expect.any(Promise),
      tag: expect.any(Promise),
    });
  });
});
