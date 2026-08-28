import type { JsonObject } from '../../lib/agent-bridge/protocol';
import { UsageError } from './args';

export interface AliasFlag {
  /** Knowledge Tool argument name this flag maps to. */
  arg: string;
  kind: 'string' | 'integer';
  help: string;
}

export interface ToolAlias {
  command: string;
  /** Knowledge Tool name as advertised by the extension in `hello`. */
  tool: string;
  summary: string;
  positional: { arg: string; label: string } | null;
  flags: Readonly<Record<string, AliasFlag>>;
}

const PLATFORM_FLAG: AliasFlag = {
  arg: 'platform',
  kind: 'string',
  help: 'restrict to one platform (values: see `favbase tools`)',
};

/**
 * Ergonomic subcommands over the Knowledge Tools. This table is the only place
 * the CLI knows tool or argument names; `tests/agent-bridge-cli-aliases.test.ts`
 * at the repository root checks every entry against the extension registry.
 * Anything not listed here stays reachable through `favbase call <tool>`.
 */
const ALIASES: ToolAlias[] = [
  {
    command: 'search',
    tool: 'searchKnowledgeBase',
    summary: 'hybrid semantic + keyword search over saved items',
    positional: { arg: 'query', label: '<query>' },
    flags: {
      platform: PLATFORM_FLAG,
      tag: { arg: 'tag_id', kind: 'string', help: 'restrict to one tag id (from `favbase tags`)' },
      limit: { arg: 'top_k', kind: 'integer', help: 'maximum hits, 1-20 (default 8)' },
    },
  },
  {
    command: 'tags',
    tool: 'listTags',
    summary: 'list tags in use with item counts',
    positional: null,
    flags: { platform: PLATFORM_FLAG },
  },
  {
    command: 'get',
    tool: 'getItemContent',
    summary: 'read the full extracted text of one item',
    positional: { arg: 'item_id', label: '<item-id>' },
    flags: {},
  },
];

export const TOOL_ALIASES: readonly ToolAlias[] = Object.freeze(ALIASES);

export function findAlias(command: string): ToolAlias | undefined {
  return TOOL_ALIASES.find(alias => alias.command === command);
}

export function buildAliasArgs(
  alias: ToolAlias,
  positionals: readonly string[],
  flags: Readonly<Record<string, string | true>>,
): JsonObject {
  const args: JsonObject = {};

  if (alias.positional) {
    if (positionals.length !== 1) {
      throw new UsageError(`favbase ${alias.command} expects exactly one ${alias.positional.label}`);
    }
    args[alias.positional.arg] = positionals[0];
  } else if (positionals.length > 0) {
    throw new UsageError(`favbase ${alias.command} takes no positional arguments`);
  }

  for (const [name, value] of Object.entries(flags)) {
    const flag = alias.flags[name];
    if (!flag) throw new UsageError(`Unknown option --${name} for favbase ${alias.command}`);
    if (value === true) throw new UsageError(`Option --${name} requires a value`);
    if (flag.kind === 'integer') {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) {
        throw new UsageError(`Option --${name} must be an integer`);
      }
      args[flag.arg] = parsed;
    } else {
      args[flag.arg] = value;
    }
  }

  return args;
}

/** Column where usage descriptions start; shared with the static lines in `usage()`. */
export const USAGE_COLUMN = 76;

export function aliasUsageLine(alias: ToolAlias): string {
  const parts = [alias.command];
  if (alias.positional) parts.push(alias.positional.label);
  for (const [name, flag] of Object.entries(alias.flags)) parts.push(`[--${name} <${flag.arg}>]`);
  return `  ${parts.join(' ').padEnd(USAGE_COLUMN)} ${alias.summary}`;
}
