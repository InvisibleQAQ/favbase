import { describe, it, expect } from 'vitest';
import { CHAT_SYSTEM_PROMPT, buildContextSuffix } from './prompts';

describe('buildContextSuffix', () => {
  it('injects the current date as ISO yyyy-mm-dd', () => {
    const suffix = buildContextSuffix({ now: new Date('2026-07-26T12:34:56Z') });
    expect(suffix).toContain('2026-07-26');
  });

  it('varies with the injected date', () => {
    const a = buildContextSuffix({ now: new Date('2020-01-02T00:00:00Z') });
    expect(a).toContain('2020-01-02');
    expect(a).not.toContain('2026-07-26');
  });
});

describe('CHAT_SYSTEM_PROMPT', () => {
  it('mandates searching before answering, referencing the searchKnowledgeBase tool by name', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('searchKnowledgeBase');
  });

  it('encodes the core contract rules: cite sources, no-result honesty, read-only, no fabrication', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/来源/); // cite sources
    expect(CHAT_SYSTEM_PROMPT).toMatch(/没找到/); // honesty on empty retrieval
    expect(CHAT_SYSTEM_PROMPT).toMatch(/只读/); // read-only boundary
    expect(CHAT_SYSTEM_PROMPT).toMatch(/追问/); // ask when info insufficient
  });
});
