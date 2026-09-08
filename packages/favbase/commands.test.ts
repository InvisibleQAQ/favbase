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
    expect(() => buildAliasArgs(alias('search'), ['q'], { limit: true })).toThrow(UsageError);
  });

  it('renders one usage line per alias with every flag', () => {
    expect(aliasUsageLine(alias('search'))).toContain(
      'search <query> [--platform <platform>] [--tag <tag_id>] [--limit <top_k>]',
    );
    expect(aliasUsageLine(alias('coverage'))).toContain('coverage [--platform <platform>]');
  });
});
