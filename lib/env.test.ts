import { describe, it, expect, vi, afterEach } from 'vitest';
import { envNumber } from './env';

describe('envNumber', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('falls back when the key is absent', () => {
    expect(envNumber('VITE_TEST_ABSENT_KEY', 42)).toBe(42);
  });

  it('falls back on an empty string (commented-out `# VITE_X=` style)', () => {
    vi.stubEnv('VITE_TEST_KEY', '');
    expect(envNumber('VITE_TEST_KEY', 42)).toBe(42);
  });

  it('overrides with a finite non-negative number', () => {
    vi.stubEnv('VITE_TEST_KEY', '7');
    expect(envNumber('VITE_TEST_KEY', 42)).toBe(7);
  });

  it('accepts 0 as a valid override (zeroed delay for debugging)', () => {
    vi.stubEnv('VITE_TEST_KEY', '0');
    expect(envNumber('VITE_TEST_KEY', 42)).toBe(0);
  });

  it('accepts decimals', () => {
    vi.stubEnv('VITE_TEST_KEY', '1.5');
    expect(envNumber('VITE_TEST_KEY', 42)).toBe(1.5);
  });

  it.each(['abc', '-1', 'Infinity', '-Infinity', 'NaN'])(
    'falls back on invalid value %j',
    (raw) => {
      vi.stubEnv('VITE_TEST_KEY', raw);
      expect(envNumber('VITE_TEST_KEY', 42)).toBe(42);
    },
  );
});
