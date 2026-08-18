import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DEFAULT_HTTP_DEADLINE_SECONDS,
  HttpDeadlineError,
  fetchWithDeadline,
  resolveHttpDeadlineMs,
} from './fetch-with-deadline';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// A fetch that never settles on its own — only the abort signal can end it.
// Mirrors the audit #5 failure mode (a request that never converges).
function hangingFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      }),
  );
}

describe('resolveHttpDeadlineMs', () => {
  it('falls back to the default when the env var is absent/empty', () => {
    vi.stubEnv('VITE_HTTP_DEADLINE_SECONDS', '');
    expect(resolveHttpDeadlineMs()).toBe(DEFAULT_HTTP_DEADLINE_SECONDS * 1000);
  });

  it('reads seconds from VITE_HTTP_DEADLINE_SECONDS', () => {
    vi.stubEnv('VITE_HTTP_DEADLINE_SECONDS', '12');
    expect(resolveHttpDeadlineMs()).toBe(12_000);
  });

  it('supports fractional seconds', () => {
    vi.stubEnv('VITE_HTTP_DEADLINE_SECONDS', '0.5');
    expect(resolveHttpDeadlineMs()).toBe(500);
  });

  it.each(['abc', '0', '-5', 'Infinity'])(
    'falls back to the default on invalid value %s',
    (value) => {
      vi.stubEnv('VITE_HTTP_DEADLINE_SECONDS', value);
      expect(resolveHttpDeadlineMs()).toBe(DEFAULT_HTTP_DEADLINE_SECONDS * 1000);
    },
  );
});

describe('fetchWithDeadline', () => {
  it('rejects a never-settling fetch with HttpDeadlineError at the deadline', async () => {
    vi.stubEnv('VITE_HTTP_DEADLINE_SECONDS', '0.05');
    vi.stubGlobal('fetch', hangingFetch());

    const err = await fetchWithDeadline('https://api.example.com/x').then(
      () => {
        throw new Error('should not resolve');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpDeadlineError);
    expect((err as HttpDeadlineError).name).toBe('HttpDeadlineError');
    expect((err as HttpDeadlineError).url).toBe('https://api.example.com/x');
    expect((err as HttpDeadlineError).deadlineMs).toBe(50);
  });

  it('propagates a caller abort with its own reason, not HttpDeadlineError', async () => {
    vi.stubEnv('VITE_HTTP_DEADLINE_SECONDS', '5');
    vi.stubGlobal('fetch', hangingFetch());

    const controller = new AbortController();
    const pending = fetchWithDeadline('https://api.example.com/x', {
      signal: controller.signal,
    });
    const reason = new DOMException('user cancelled', 'AbortError');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('resolves under the deadline and passes init through with a merged signal', async () => {
    vi.stubEnv('VITE_HTTP_DEADLINE_SECONDS', '5');
    const response = new Response('ok');
    const mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response);
    vi.stubGlobal('fetch', mock);

    await expect(
      fetchWithDeadline('https://api.example.com/x', { headers: { Accept: 'application/json' } }),
    ).resolves.toBe(response);
    const init = mock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({ Accept: 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
