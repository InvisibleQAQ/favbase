import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PLATFORM_META } from '@/entrypoints/app/collection-platform-registry';
import { describeTools } from '@/lib/agent-bridge/tool-registry';
import { COLLECTION_PLATFORMS } from '@/lib/collections/platforms';
import en from '@/lib/i18n/locales/en';
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

/**
 * SKILL.md is the other half of that same sentence: besides the tool and
 * argument names above, it is the only place outside the extension that spells
 * the Collection Platforms — and it teaches them to an external agent, the way
 * `chatTools`' descriptions teach them to the in-app one (docs/26 Step 1 and
 * appendix A item 3 — this used to be an unguarded row in
 * platform-onboarding.md §9). Being shipped markdown it cannot derive either of
 * its two lists, so both reconciliations live here.
 */
describe('favbase SKILL.md matches the live platform list', () => {
  const SKILL_MD = path.resolve(__dirname, '..', 'skills', 'favbase', 'SKILL.md');
  const PLATFORM_SENTENCE = /`<platform>` is one of ([^.]+)\./;
  const DESCRIPTION_LIST = /^description:[^(]*\(([^)]+)\)/m;

  it('names every platform, and no platform the product dropped', () => {
    const skill = readFileSync(SKILL_MD, 'utf8');
    const sentence = skill.match(PLATFORM_SENTENCE)?.[1];
    expect(
      sentence,
      'SKILL.md no longer carries the "`<platform>` is one of …." sentence this contract reads',
    ).toBeDefined();

    const listed = [...(sentence ?? '').matchAll(/`([a-z][a-z0-9-]*)`/g)].map((m) => m[1]);
    expect(listed.slice().sort()).toEqual([...COLLECTION_PLATFORMS].sort());
  });

  // The `<platform>` sentence above is not the only hand-written list in this
  // file. The frontmatter `description` names the platforms a second time, in
  // display prose, and that copy is what an agent *selects the skill by*: a
  // platform missing there means the agent never reaches for favbase when the
  // user asks about it — no error, no red test, just a knowledge base that
  // appears not to know. So the parenthesised list is reconciled the same way,
  // against the in-app names (`PLATFORM_META.title` resolved through the en
  // locale) rather than the ids, because prose cannot spell `x` unambiguously.
  // The coupling is deliberate: renaming a platform in the product renames it
  // here too.
  it('names every platform in the frontmatter description an agent selects by', () => {
    const skill = readFileSync(SKILL_MD, 'utf8');
    const listed = skill.match(DESCRIPTION_LIST)?.[1];
    expect(
      listed,
      'SKILL.md frontmatter `description` no longer carries the parenthesised platform list this contract reads',
    ).toBeDefined();

    expect((listed ?? '').split(',').map((entry) => entry.trim().toLowerCase())).toEqual(
      COLLECTION_PLATFORMS.map((platform) => en[PLATFORM_META[platform].title].toLowerCase()),
    );
  });
});
