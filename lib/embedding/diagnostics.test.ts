import { describe, expect, it, vi } from 'vitest';

import {
  createEmbeddingTraceId,
  embeddingTrace,
  embeddingTraceError,
} from './diagnostics';

describe('embedding diagnostics', () => {
  it('emits a searchable error without leaking credentials', () => {
    const error = new Error(
      'request failed: Authorization: Bearer sk-live-secret ' +
        'https://example.test/embed?api_key=query-secret&token=session-secret ' +
        '{"apiKey":"json-secret","authorization":"Bearer json-bearer"}',
      { cause: new Error('database cause token=cause-secret') },
    );
    const sink = vi.fn();

    embeddingTraceError(
      'provider:failed',
      error,
      { traceId: 'backlog-1', platform: 'x', stage: 'provider' },
      sink,
    );

    expect(sink).toHaveBeenCalledOnce();
    expect(sink).toHaveBeenCalledWith(
      '[embedding:trace]',
      'provider:failed',
      expect.objectContaining({
        traceId: 'backlog-1',
        platform: 'x',
        stage: 'provider',
        error: expect.objectContaining({
          name: 'Error',
          message: expect.stringContaining('[REDACTED]'),
          cause: expect.objectContaining({
            name: 'Error',
            message: expect.stringContaining('[REDACTED]'),
          }),
        }),
      }),
    );
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(
      /sk-live-secret|query-secret|session-secret|json-secret|json-bearer|cause-secret/,
    );
  });

  it('correlates lifecycle events without logging content or vectors', () => {
    const traceId = createEmbeddingTraceId('backlog');
    const nextTraceId = createEmbeddingTraceId('backlog');
    const sink = vi.fn();

    embeddingTrace(
      'backlog:started',
      { traceId, platform: 'github', total: 3, elapsedMs: 0 },
      sink,
    );
    embeddingTrace(
      'backlog:completed',
      { traceId, platform: 'github', done: 3, total: 3, elapsedMs: 42 },
      sink,
    );

    expect(nextTraceId).not.toBe(traceId);
    expect(sink.mock.calls).toEqual([
      [
        '[embedding:trace]',
        'backlog:started',
        { traceId, platform: 'github', total: 3, elapsedMs: 0 },
      ],
      [
        '[embedding:trace]',
        'backlog:completed',
        { traceId, platform: 'github', done: 3, total: 3, elapsedMs: 42 },
      ],
    ]);
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(/chunkText|vectors|apiKey/);
  });

  it('drops fields outside the diagnostic metadata allowlist', () => {
    const sink = vi.fn();

    embeddingTrace(
      'provider:started',
      {
        traceId: 'item-1',
        chunkCount: 1,
        chunkText: 'private article body',
        vectors: [[0.1, 0.2]],
        apiKey: 'sk-secret',
        platform: { apiKey: 'nested-secret' },
      } as never,
      sink,
    );

    expect(sink).toHaveBeenCalledWith('[embedding:trace]', 'provider:started', {
      traceId: 'item-1',
      chunkCount: 1,
    });
    expect(JSON.stringify(sink.mock.calls)).not.toContain('nested-secret');
  });
});
