import { describe, expect, it } from 'vitest';

import { parseArgv, requireValue, UsageError } from './args';

describe('parseArgv', () => {
  it('separates command, positionals and valued flags', () => {
    expect(parseArgv(['search', 'rust async', '--platform', 'github', '--limit=3'])).toEqual({
      command: 'search',
      positionals: ['rust async'],
      flags: { platform: 'github', limit: '3' },
    });
  });

  it('treats declared boolean flags and short aliases as valueless', () => {
    expect(parseArgv(['setup', '--no-skill', '--token', 't', '-h'])).toEqual({
      command: 'setup',
      positionals: [],
      flags: { 'no-skill': true, token: 't', help: true },
    });
    expect(parseArgv(['-v']).flags).toEqual({ version: true });
  });

  it('passes everything after -- through as positionals', () => {
    expect(parseArgv(['search', '--', '--not-a-flag'])).toEqual({
      command: 'search',
      positionals: ['--not-a-flag'],
      flags: {},
    });
  });

  it('rejects a valued flag without a value and unknown short options', () => {
    expect(() => parseArgv(['search', 'x', '--platform'])).toThrow(UsageError);
    expect(() => parseArgv(['-x'])).toThrow(UsageError);
    expect(() => parseArgv(['--'])).not.toThrow();
  });

  // Last-wins dropped the first value in silence: `--agent claude --agent
  // codex` installed codex alone. Every pairing of the two spellings counts.
  it.each([
    [['install-skill', '--agent', 'claude', '--agent', 'codex'], 'agent'],
    [['search', 'q', '--limit=3', '--limit', '5'], 'limit'],
    [['search', 'q', '--limit', '3', '--limit=5'], 'limit'],
    [['search', 'q', '--platform=a', '--platform=b'], 'platform'],
  ])('rejects a value flag given twice in %j', (argv, name) => {
    expect(() => parseArgv(argv)).toThrow(new UsageError(`Option --${name} given more than once`));
  });

  it('lets a boolean flag repeat', () => {
    expect(parseArgv(['setup', '--no-skill', '--no-skill', '-h', '--help']).flags).toEqual({
      'no-skill': true,
      help: true,
    });
    expect(parseArgv(['--version', '-v', '-v']).flags).toEqual({ version: true });
  });

  it('requireValue rejects boolean-only usage of a valued flag', () => {
    expect(requireValue({ token: 'abc' }, 'token')).toBe('abc');
    expect(requireValue({}, 'token')).toBeUndefined();
    expect(() => requireValue({ token: true }, 'token')).toThrow(UsageError);
  });
});
