import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { AGENT_BRIDGE_TOOL_ERROR_CODES } from '../../lib/agent-bridge/protocol';
import { UsageError } from './args';
import { BridgePortInUseError } from './bridge-server';
import { CHANGE_PORT_HINT, ConfigError, LocalFileError } from './config';
import { DaemonError, type DaemonErrorCode } from './daemon-client';
import {
  describeError,
  describeToolError,
  EXIT_CODES,
  EXIT_TOOL,
  EXIT_UNAVAILABLE,
  EXIT_USAGE,
  USAGE_LINE,
} from './exit-codes';

const DAEMON_ERROR_CODES: DaemonErrorCode[] = ['unreachable', 'unauthorized', 'foreign', 'spawn-failed', 'protocol'];

describe('describeError', () => {
  const CASES: [name: string, error: unknown, exitCode: number, lines: string[]][] = [
    ['a usage error', new UsageError('bad flag'), EXIT_USAGE, ['favbase: bad flag', USAGE_LINE]],
    ['a config error', new ConfigError('No pairing token configured'), EXIT_USAGE, ['favbase: No pairing token configured']],
    ['a local file error', new LocalFileError('cannot write /x: EACCES'), EXIT_USAGE, ['favbase: cannot write /x: EACCES']],
    // D3: a failure nobody typed is the user's to read, not "run doctor".
    ['an untyped error', new Error('EACCES: permission denied'), EXIT_USAGE, ['favbase: EACCES: permission denied']],
    ['a thrown non-error', 'boom', EXIT_USAGE, ['favbase: boom']],
    ...DAEMON_ERROR_CODES.map((code) => [
      `a daemon error (${code})`,
      new DaemonError(code, 'it failed'),
      EXIT_UNAVAILABLE,
      [`favbase: ${code}: it failed`],
    ] as [string, unknown, number, string[]]),
  ];

  it.each(CASES)('reports %s', (_name, error, exitCode, lines) => {
    expect(describeError(error)).toEqual({ exitCode, lines });
  });

  // SKILL.md tells an agent that exit 1 ending in the usage line is its own
  // command to fix, and any other exit 1 goes to the user. So only a usage
  // error may end that way.
  it('ends only a usage error with the usage line', () => {
    const errors = [
      new ConfigError('c'),
      new LocalFileError('l'),
      new Error('e'),
      new BridgePortInUseError(1),
      ...DAEMON_ERROR_CODES.map((code) => new DaemonError(code, 'd')),
    ];
    for (const error of errors) expect(describeError(error).lines).not.toContain(USAGE_LINE);
    expect(describeError(new UsageError('u')).lines.at(-1)).toBe(USAGE_LINE);
  });

  // `favbase setup --port` alone is a usage error (no --token); the fix has
  // to be the settings card's command, which carries both.
  it('names a runnable fix for a port another daemon holds', () => {
    const { exitCode, lines } = describeError(new BridgePortInUseError(17_836));
    expect(exitCode).toBe(EXIT_USAGE);
    expect(lines).toEqual([expect.stringMatching(/^favbase: port 17836 is already in use; /)]);
    expect(lines[0]).toContain(CHANGE_PORT_HINT);
    expect(lines[0]).not.toContain('setup --port');
  });
});

describe('describeToolError', () => {
  const EXPECTED: Record<string, number> = {
    'extension-unavailable': EXIT_UNAVAILABLE,
    'extension-disconnected': EXIT_UNAVAILABLE,
    // D4-a
    timeout: EXIT_UNAVAILABLE,
    'invalid-args': EXIT_TOOL,
    'unknown-tool': EXIT_TOOL,
    'db-unavailable': EXIT_TOOL,
    'execution-failed': EXIT_TOOL,
    cancelled: EXIT_TOOL,
    // A newer daemon's code: still a tool error, and the message is the user's.
    'some-future-code': EXIT_TOOL,
  };

  it('has an expectation for every code the extension can send', () => {
    for (const code of AGENT_BRIDGE_TOOL_ERROR_CODES) expect(EXPECTED).toHaveProperty([code]);
  });

  it.each(Object.entries(EXPECTED))('gives %s exit %i, first line `favbase: <code>: <message>`', (code, exitCode) => {
    const failure = describeToolError(code, 'it failed');
    expect(failure.exitCode).toBe(exitCode);
    expect(failure.lines[0]).toBe(`favbase: ${code}: it failed`);
  });

  it('advises doctor on the unreachable codes, the command on the agent\'s own, nothing on the rest', () => {
    const advice = (code: string) => describeToolError(code, 'm').lines[1];
    for (const code of ['extension-unavailable', 'extension-disconnected', 'timeout']) {
      expect(advice(code)).toContain('favbase doctor');
    }
    expect(advice('timeout')).toContain('retry once');
    for (const code of ['invalid-args', 'unknown-tool']) expect(advice(code)).toContain('favbase tools');
    for (const code of ['db-unavailable', 'execution-failed', 'cancelled', 'some-future-code']) {
      expect(advice(code)).toBeUndefined();
    }
  });

  it('lets a caller with a diagnosis replace the advice', () => {
    expect(describeToolError('extension-unavailable', 'not connected', 'look here').lines).toEqual([
      'favbase: extension-unavailable: not connected',
      'favbase: look here',
    ]);
  });
});

/**
 * The exit-code tables are the agent's error handling (silent-failure guide,
 * Gotcha 5): SKILL.md for an agent using favbase, the npm README for a person.
 * Each row has to fit every failure the module above puts in its code. Before
 * docs/30 #2 only exit 1 was reconciled, and the other rows told an agent to
 * "adjust the arguments" after a timeout and "Chrome closed" after an
 * unwritable log.
 *
 * Both tables ship with the CLI they describe: SKILL.md is bundled into it (and
 * `npx skills add` is pointed at the `favbase-latest` branch, the last release
 * commit), the README is the npm page of that version. INSTALL.md, read from
 * `main` by agents about to install the last release, carries no table at all
 * (docs/30 #4, D6-a); `tests/agent-bridge-cli-aliases.test.ts` keeps it that way.
 */
describe('the exit-code tables in the markdown', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').split(/\r?\n/);

  const TABLES = {
    'skills/favbase/SKILL.md': { lines: read('../../skills/favbase/SKILL.md'), row: /^\| (\d+) \|/, codes: EXIT_CODES.map(([code]) => code) },
    'packages/favbase/README.md': { lines: read('./README.md'), row: /^\| (\d+) \|/, codes: EXIT_CODES.map(([code]) => code) },
  };

  function rowFor(file: keyof typeof TABLES, code: number): string {
    const { lines, row } = TABLES[file];
    const found = lines.find((line) => Number(row.exec(line)?.[1]) === code);
    expect(found, `${file} has no row for exit ${code}`).toBeDefined();
    return found!;
  }

  it.each(Object.entries(TABLES))('%s has a row for exactly the codes the CLI exits with', (_file, table) => {
    const codes = table.lines.flatMap((line) => {
      const match = table.row.exec(line);
      return match ? [Number(match[1])] : [];
    });
    expect(codes).toEqual(table.codes);
  });

  const AGENT_TABLE = 'skills/favbase/SKILL.md';

  describe(AGENT_TABLE, () => {
    const file = AGENT_TABLE;

    it('exit 1: recognises a usage error by its closing line, and sends any other to the user', () => {
      const row = rowFor(file, EXIT_USAGE);
      expect(row).toContain(`\`${USAGE_LINE}\``);
      expect(row).toContain('show the stderr message to the user');
    });

    // A DaemonError and a timeout land here. Doctor reports ok on a slow tool,
    // hence the retry. Since docs/30 #3 doctor prints its report whatever
    // fails, with the failed step's problem in `troubleshooting`; the published
    // 0.2.1 printed one stderr line instead, and this row carried a "when it
    // prints no report" clause for it until docs/30 #4 stopped pairing `main`'s
    // SKILL.md with a released CLI (D6-a, D7-b). The CLI this copy ships in
    // always reports, so the clause must not come back.
    it('exit 2: runs doctor, acts on its troubleshooting list, and retries once when it is ok', () => {
      const row = rowFor(file, EXIT_UNAVAILABLE);
      expect(row).toContain('`favbase doctor`');
      expect(row).toContain('`troubleshooting` list');
      expect(row).toContain('if it reports `ok: true`, retry the command once');
      expect(row).not.toContain('no report');
    });

    // The codes the row tells the agent to fix itself are exactly the exit-3
    // codes the CLI advises a command fix for; every other goes to the user.
    it('exit 3: names exactly the codes the agent fixes itself', () => {
      const row = rowFor(file, EXIT_TOOL);
      const named = [...row.matchAll(/`([a-z-]+)`/g)].map((match) => match[1]);
      const commandCodes = AGENT_BRIDGE_TOOL_ERROR_CODES.filter((code) => {
        const failure = describeToolError(code, 'm');
        return failure.exitCode === EXIT_TOOL && failure.lines.length > 1;
      });
      expect(named.filter((code) => (AGENT_BRIDGE_TOOL_ERROR_CODES as readonly string[]).includes(code)).sort())
        .toEqual([...commandCodes].sort());
      expect(row).toContain('`favbase tools`');
      expect(row).toContain('for any other code, show the stderr message to the user');
    });
  });
});
