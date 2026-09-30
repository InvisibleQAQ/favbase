import { describe, expect, it } from 'vitest';
import { bodySnippet, parseJsonBody, textSnippet } from './response-body';

const LONG = 'a'.repeat(299) + 'bc' + 'd'.repeat(100);

describe('textSnippet', () => {
  it('keeps the first 300 characters', () => {
    expect(textSnippet(LONG)).toBe('a'.repeat(299) + 'b');
    expect(textSnippet('short')).toBe('short');
  });
});

describe('bodySnippet', () => {
  it('reads the body and cuts the snippet', async () => {
    await expect(bodySnippet(new Response(LONG, { status: 500 }))).resolves.toBe(
      'a'.repeat(299) + 'b',
    );
  });

  it("returns '' when the body cannot be read", async () => {
    const res = new Response('already read', { status: 500 });
    await res.text();

    await expect(bodySnippet(res)).resolves.toBe('');
  });
});

describe('parseJsonBody', () => {
  it('returns the parsed value', () => {
    expect(parseJsonBody('{"a":[1,2]}', 'X API 200')).toEqual({ a: [1, 2] });
  });

  it('throws "<what> with non-JSON body: <snippet>" without a suffix', () => {
    expect(() => parseJsonBody(LONG, 'Zhihu API 200')).toThrow(
      new Error(`Zhihu API 200 with non-JSON body: ${'a'.repeat(299)}b`),
    );
  });

  it('appends the suffix after the snippet', () => {
    let message = '';
    try {
      parseJsonBody('<html>', 'X API 200', ' [queryId=q]');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe('X API 200 with non-JSON body: <html> [queryId=q]');
  });
});
