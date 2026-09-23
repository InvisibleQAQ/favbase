import { describe, expect, it } from 'vitest';

import { UsageError } from './args';
import { aliasUsageLine, buildAliasArgs, findAlias, TOOL_ALIASES } from './commands';

function alias(command: string) {
  const found = findAlias(command);
  if (!found) throw new Error(`missing alias ${command}`);
  return found;
}

describe('TOOL_ALIASES', () => {
  it('maps every ergonomic command onto a distinct Knowledge Tool', () => {
    expect(TOOL_ALIASES.map(entry => entry.command)).toEqual([
      'search',
      'tags',
      'get',
      'coverage',
    ]);
    // Distinct tools, not just distinct commands: two aliases sharing a tool
    // would pass the list above while breaking the repo-root reconciliation.
    expect(new Set(TOOL_ALIASES.map(entry => entry.tool)).size).toBe(TOOL_ALIASES.length);
    expect(findAlias('call')).toBeUndefined();
  });

  it('builds search arguments from the positional query and typed flags', () => {
    expect(buildAliasArgs(alias('search'), ['rust async'], { platform: 'github', tag: 't1', limit: '5' }))
      .toEqual({ query: 'rust async', platform: 'github', tag_id: 't1', top_k: 5 });
    expect(buildAliasArgs(alias('tags'), [], {})).toEqual({});
    expect(buildAliasArgs(alias('get'), ['item-1'], {})).toEqual({ item_id: 'item-1' });
    expect(buildAliasArgs(alias('coverage'), [], {})).toEqual({});
    expect(buildAliasArgs(alias('coverage'), [], { platform: 'bilibili' })).toEqual({
      platform: 'bilibili',
    });
  });

  it('rejects wrong positional counts, unknown flags and non-integer limits', () => {
    expect(() => buildAliasArgs(alias('search'), [], {})).toThrow(UsageError);
    expect(() => buildAliasArgs(alias('search'), ['a', 'b'], {})).toThrow(UsageError);
    expect(() => buildAliasArgs(alias('tags'), ['extra'], {})).toThrow(UsageError);
    expect(() => buildAliasArgs(alias('coverage'), ['extra'], {})).toThrow(UsageError);
    expect(() => buildAliasArgs(alias('search'), ['q'], { bogus: 'x' })).toThrow(UsageError);
    expect(() => buildAliasArgs(alias('search'), ['q'], { limit: 'many' })).toThrow(UsageError);
    expect(() => buildAliasArgs(alias('search'), ['q'], { limit: '2.5' })).toThrow(UsageError);
    expect(() => buildAliasArgs(alias('search'), ['q'], { limit: true })).toThrow(UsageError);
  });

  // A limit below 1 is a usage error whatever the tool's schema says, so it
  // must stop here: past this point it costs a daemon auto-start and an alarm
  // wait, and an unreachable extension would turn it into exit 2 ("fix your
  // connection") for what is really exit 1. `''` is `--limit=`, which
  // `Number('')` reads as 0; `-5` is what the argv parser hands over for
  // `--limit -5`, since a value-taking flag consumes the next token as-is.
  it.each(['0', '-5', ''])('rejects the non-positive limit %j locally', (limit) => {
    expect(() => buildAliasArgs(alias('search'), ['q'], { limit })).toThrow(
      new UsageError('Option --limit must be a positive integer'),
    );
  });

  // The upper bound belongs to the Knowledge Tool's schema, not to the CLI: a
  // local copy would be a second source of truth. 999 must reach the extension
  // and be refused there.
  it('leaves the upper bound to the tool schema', () => {
    expect(buildAliasArgs(alias('search'), ['q'], { limit: '1' })).toEqual({ query: 'q', top_k: 1 });
    expect(buildAliasArgs(alias('search'), ['q'], { limit: '999' })).toEqual({ query: 'q', top_k: 999 });
  });

  it('renders one usage line per alias with every flag', () => {
    expect(aliasUsageLine(alias('search'))).toContain(
      'search <query> [--platform <platform>] [--tag <tag_id>] [--limit <top_k>]',
    );
    expect(aliasUsageLine(alias('coverage'))).toContain('coverage [--platform <platform>]');
  });
});
