import { describe, expect, it } from 'vitest';

import { describeTools } from '@/lib/agent-bridge/tool-registry';
import { TOOL_ALIASES } from '../packages/favbase-cli/commands';

/**
 * The favbase CLI's ergonomic subcommands (`search` / `tags` / `get`) are the
 * only place outside the extension that spells Knowledge Tool and argument
 * names. This contract pins every alias to the live `chatTools` registry so a
 * renamed tool or argument fails here instead of at an agent's terminal.
 */
describe('favbase CLI aliases match the Knowledge Tool registry', () => {
  const descriptors = new Map(describeTools().map((tool) => [tool.name, tool]));

  it('covers every Knowledge Tool exactly once', () => {
    expect(TOOL_ALIASES.map((alias) => alias.tool).sort()).toEqual([...descriptors.keys()].sort());
  });

  it.each(TOOL_ALIASES.map((alias) => [alias.command, alias] as const))(
    'favbase %s maps only onto declared arguments and covers required ones',
    (_command, alias) => {
      const descriptor = descriptors.get(alias.tool);
      expect(descriptor).toBeDefined();
      const schema = descriptor!.inputSchema as {
        properties?: Record<string, { type?: string }>;
        required?: string[];
      };
      const properties = schema.properties ?? {};

      const mapped = [
        ...(alias.positional ? [alias.positional.arg] : []),
        ...Object.values(alias.flags).map((flag) => flag.arg),
      ];
      for (const arg of mapped) expect(Object.keys(properties)).toContain(arg);
      expect(new Set(mapped).size).toBe(mapped.length);

      for (const required of schema.required ?? []) expect(mapped).toContain(required);

      for (const flag of Object.values(alias.flags)) {
        const type = properties[flag.arg]?.type;
        expect(flag.kind === 'integer' ? ['integer', 'number'] : ['string']).toContain(type);
      }
    },
  );
});
