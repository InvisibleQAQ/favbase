import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { applyJobsBadge } from './use-jobs-badge';

function stubAction(reject = false) {
  const result = () => (reject ? Promise.reject(new Error('no action')) : Promise.resolve());
  const action = {
    setBadgeText: vi.fn(result),
    setTitle: vi.fn(result),
    setBadgeBackgroundColor: vi.fn(result),
  };
  vi.stubGlobal('browser', { action });
  return action;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('applyJobsBadge', () => {
  it('shows the running count with the reminder as hover title', () => {
    const action = stubAction();

    applyJobsBadge(3, '3 jobs running');

    expect(action.setBadgeText).toHaveBeenCalledWith({ text: '3' });
    expect(action.setTitle).toHaveBeenCalledWith({ title: '3 jobs running' });
    expect(action.setBadgeBackgroundColor).toHaveBeenCalled();
  });

  it('clears badge and title when the last job settles', () => {
    const action = stubAction();

    applyJobsBadge(0, '');

    expect(action.setBadgeText).toHaveBeenCalledWith({ text: '' });
    expect(action.setTitle).toHaveBeenCalledWith({ title: '' });
    expect(action.setBadgeBackgroundColor).not.toHaveBeenCalled();
  });

  // vitest fails the run on unhandled rejections, so flushing after rejecting
  // mocks is the whole assertion.
  it('swallows action API failures', async () => {
    stubAction(true);

    applyJobsBadge(2, 'reminder');
    applyJobsBadge(0, '');
    await flush();
  });
});
