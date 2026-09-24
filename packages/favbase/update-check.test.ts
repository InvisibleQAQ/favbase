import { describe, expect, it } from 'vitest';

import { queryRegistries, REGISTRY_LATEST_URLS, updateNotice } from './update-check';

type Answer = { status?: number; body: unknown } | 'fail' | 'hang';

/** A fetch that answers per registry URL; `hang` waits for the abort signal. */
function fakeFetch(answers: Record<string, Answer>, calls: Array<[string, RequestInit | undefined]> = []) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push([url, init]);
    const answer = answers[url];
    if (answer === undefined || answer === 'fail') throw new TypeError('fetch failed');
    if (answer === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as typeof fetch;
}

const [NPMJS, MIRROR] = REGISTRY_LATEST_URLS;

describe('queryRegistries', () => {
  it('asks both registries with a bare GET and nothing else', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    await queryRegistries(fakeFetch({}, calls));

    expect(calls.map(([url]) => url).sort()).toEqual([...REGISTRY_LATEST_URLS].sort());
    for (const [, init] of calls) {
      expect(init?.method ?? 'GET').toBe('GET');
      expect(init?.body).toBeUndefined();
      expect(init?.headers).toEqual({ accept: 'application/json' });
    }
  });

  it.each([
    ['npmjs is ahead', '0.3.0', '0.2.0', '0.3.0'],
    ['the mirror is ahead', '0.2.0', '0.3.0', '0.3.0'],
    ['both agree', '0.2.0', '0.2.0', '0.2.0'],
  ])('takes the highest version when %s', async (_label, npmjs, mirror, expected) => {
    const fetchImpl = fakeFetch({
      [NPMJS]: { body: { version: npmjs } },
      [MIRROR]: { body: { version: mirror } },
    });
    await expect(queryRegistries(fetchImpl)).resolves.toBe(expected);
  });

  it('uses whichever registry answered when the other fails', async () => {
    await expect(queryRegistries(fakeFetch({ [MIRROR]: { body: { version: '0.2.0' } } })))
      .resolves.toBe('0.2.0');
    await expect(queryRegistries(fakeFetch({ [NPMJS]: { body: { version: '0.2.0' } } })))
      .resolves.toBe('0.2.0');
  });

  it('ignores error statuses and answers that do not parse as a release', async () => {
    const fetchImpl = fakeFetch({
      [NPMJS]: { status: 404, body: { version: '9.9.9' } },
      [MIRROR]: { body: { version: '1.0.0-beta.1' } },
    });
    await expect(queryRegistries(fetchImpl)).resolves.toBeNull();

    for (const body of [{}, { version: 5 }, null, 'text', []]) {
      await expect(queryRegistries(fakeFetch({ [NPMJS]: { body }, [MIRROR]: 'fail' })))
        .resolves.toBeNull();
    }
  });

  it('never throws and gives up at the budget', async () => {
    await expect(queryRegistries(fakeFetch({}))).resolves.toBeNull();

    const started = Date.now();
    const slow = fakeFetch({ [NPMJS]: 'hang', [MIRROR]: 'hang' });
    await expect(queryRegistries(slow, 50)).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('keeps a fast answer when the other registry hangs past the budget', async () => {
    const fetchImpl = fakeFetch({ [NPMJS]: 'hang', [MIRROR]: { body: { version: '0.2.0' } } });
    await expect(queryRegistries(fetchImpl, 50)).resolves.toBe('0.2.0');
  });
});

describe('updateNotice', () => {
  it('speaks only when the CLI is outdated', () => {
    expect(updateNotice({ version: '0.1.0', latest: '0.2.0', state: 'outdated' })).toContain('0.2.0');
    expect(updateNotice({ version: '0.2.0', latest: '0.2.0', state: 'current' })).toBeNull();
    expect(updateNotice({ version: '0.2.0', latest: null, state: 'unknown', reason: 'x' })).toBeNull();
  });
});
