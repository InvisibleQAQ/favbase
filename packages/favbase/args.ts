export interface ParsedArgv {
  command: string | null;
  positionals: string[];
  flags: Record<string, string | true>;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Flags that never take a value. Every other `--flag` consumes the next token. */
export const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['help', 'version', 'no-skill']);

const SHORT_FLAGS: Readonly<Record<string, string>> = { h: 'help', v: 'version' };

export function parseArgv(
  argv: readonly string[],
  booleanFlags: ReadonlySet<string> = BOOLEAN_FLAGS,
): ParsedArgv {
  const result: ParsedArgv = { command: null, positionals: [], flags: {} };
  let literal = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (literal || arg === '-' || !arg.startsWith('-')) {
      if (result.command === null && !literal) result.command = arg;
      else result.positionals.push(arg);
      continue;
    }
    if (arg === '--') {
      literal = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      const name = SHORT_FLAGS[arg.slice(1)];
      if (!name) throw new UsageError(`Unknown option ${arg}`);
      result.flags[name] = true;
      continue;
    }

    const body = arg.slice(2);
    const separator = body.indexOf('=');
    const name = separator === -1 ? body : body.slice(0, separator);
    if (!name) throw new UsageError(`Unknown option ${arg}`);
    if (separator !== -1) {
      result.flags[name] = body.slice(separator + 1);
      continue;
    }
    if (booleanFlags.has(name)) {
      result.flags[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) throw new UsageError(`Option --${name} requires a value`);
    result.flags[name] = value;
    index += 1;
  }

  return result;
}

export function requireValue(
  flags: ParsedArgv['flags'],
  name: string,
): string | undefined {
  const value = flags[name];
  if (value === true) throw new UsageError(`Option --${name} requires a value`);
  return value;
}
