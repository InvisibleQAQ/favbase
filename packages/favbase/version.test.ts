import { describe, expect, it } from 'vitest';

import { compareVersions, isReleaseVersion } from './version';

describe('compareVersions', () => {
  it.each([
    ['0.1.0', '0.2.0', -1],
    ['0.2.0', '0.1.0', 1],
    ['0.1.0', '0.1.0', 0],
    ['1.0.0', '0.99.99', 1],
    ['0.9.0', '0.10.0', -1],
    ['0.1.9', '0.1.10', -1],
    ['10.0.0', '9.9.9', 1],
  ] as const)('%s vs %s is %s', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  // Anything but a plain release is not comparable, so nothing acts on it:
  // cli.ts falls back to 0.0.0-dev and test fixtures report `test`.
  it.each([
    ['0.0.0-dev', '0.1.0'],
    ['test', '0.1.0'],
    ['0.1.0', '0.2.0-beta.1'],
    ['', '0.1.0'],
    ['0.1', '0.1.0'],
    ['v0.1.0', '0.1.0'],
    ['01.0.0', '1.0.0'],
    ['0.1.0 ', '0.1.0'],
  ])('%j vs %j is not comparable', (a, b) => {
    expect(compareVersions(a, b)).toBeNull();
    expect(compareVersions(b, a)).toBeNull();
  });

  it('recognises release versions only', () => {
    expect(isReleaseVersion('0.1.0')).toBe(true);
    expect(isReleaseVersion('0.0.0-dev')).toBe(false);
    expect(isReleaseVersion('test')).toBe(false);
  });
});
