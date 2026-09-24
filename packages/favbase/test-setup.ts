import { afterEach, expect } from 'vitest';

// No test may reach a real npm registry (docs/27 Step 2). The update check
// swallows every failure by design, so merely refusing a fetch would let a
// test that went online pass in silence. Record every attempt and fail the
// test that made it instead. Nothing in this package's tests uses fetch
// legitimately: daemon traffic goes through node:http.
const attempts: string[] = [];

globalThis.fetch = ((input: string | URL | Request) => {
  attempts.push(input instanceof Request ? input.url : String(input));
  return Promise.reject(new Error('packages/favbase tests must not use the network'));
}) as typeof fetch;

afterEach(() => {
  expect(attempts.splice(0), 'a test called the real fetch').toEqual([]);
});
