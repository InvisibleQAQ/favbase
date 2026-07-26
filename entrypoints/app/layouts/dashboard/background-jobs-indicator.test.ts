import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import type { LocaleKeys } from '@/lib/i18n';
import type { BackgroundJob } from '../../hooks/background-jobs-store';
import { backgroundJobDetail } from './background-jobs-indicator';

const messages: Partial<Record<LocaleKeys, string>> = {
  'backgroundJobs.embedding': 'Embedding {{done}}/{{total}}',
  'backgroundJobs.kind.embed': 'Embedding',
  'backgroundJobs.phase.paused': 'Paused: {{detail}}',
};

function translate(
  key: LocaleKeys,
  params: Record<string, string | number> = {},
): string {
  return (messages[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(params[name] ?? ''),
  );
}

describe('background job reminder detail', () => {
  it('identifies a paused lane without describing it as running', () => {
    const job: BackgroundJob = {
      platform: 'x-bookmarks',
      kind: 'embed',
      phase: 'paused',
      running: true,
      progress: { done: 2, total: 5 },
      lastProgress: null,
      error: null,
      generation: 0,
    };

    expect(backgroundJobDetail(job, translate)).toBe('Paused: Embedding 2/5');
  });
});
