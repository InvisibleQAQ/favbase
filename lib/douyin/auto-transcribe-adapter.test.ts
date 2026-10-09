import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TranscribeErrorInfo, TranscribeResponse } from '@/lib/transcription/types';

const seamMocks = vi.hoisted(() => ({
  transcribeAndPersist: vi.fn(),
  createStatusListener: vi.fn(),
  persistDouyinTranscript: vi.fn(),
  markDouyinError: vi.fn(),
}));

// Functional mocks: the ASR half is the shared storage helpers
// (lib/storage/asr-prerequisite.ts has their own tests); the tab half is
// injected through the adapter's test seams below.
const storageMocks = vi.hoisted(() => ({
  hasAsrApiKey: vi.fn(async () => false),
  waitForAsrApiKey: vi.fn(async () => undefined),
  getActiveAsrQuotaPause: vi.fn(async () => null),
  setAsrQuotaPause: vi.fn(async () => undefined),
}));

vi.mock('@/lib/transcription/transcribe-and-persist', () => ({
  transcribeAndPersist: seamMocks.transcribeAndPersist,
  createStatusListener: seamMocks.createStatusListener,
}));
vi.mock('./douyin-sync-service', () => ({
  persistDouyinTranscript: seamMocks.persistDouyinTranscript,
  markDouyinError: seamMocks.markDouyinError,
}));
vi.mock('./douyin-tab', () => ({
  findDouyinTab: vi.fn(),
  waitForDouyinTabLoad: vi.fn(),
}));
vi.mock('@/lib/storage', () => storageMocks);

import { createDouyinAutoTranscribeAdapter } from './auto-transcribe-adapter';

const SUCCESS: TranscribeResponse = {
  success: true,
  data: { videoId: '7300000000000000001', rows: [], source: 'asr', cached: false },
};

function error(code: TranscribeErrorInfo['code'], params?: Record<string, string | number>): TranscribeErrorInfo {
  return { code, message: code, ...(params && { params }) };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Douyin auto-transcribe adapter (docs/37 D5 / Step 3)', () => {
  const findTab = vi.fn<() => Promise<number | null>>();
  const waitForTabLoad = vi.fn<() => Promise<void>>();
  const sleep = vi.fn<(ms: number) => Promise<void>>();

  function adapter(startProcessing = vi.fn()) {
    return createDouyinAutoTranscribeAdapter({ startProcessing, findTab, waitForTabLoad, sleep });
  }

  beforeEach(() => {
    seamMocks.transcribeAndPersist.mockReset().mockResolvedValue(SUCCESS);
    storageMocks.hasAsrApiKey.mockReset().mockResolvedValue(false);
    storageMocks.waitForAsrApiKey.mockReset().mockResolvedValue(undefined);
    findTab.mockReset().mockResolvedValue(7);
    waitForTabLoad.mockReset().mockResolvedValue(undefined);
    sleep.mockReset().mockResolvedValue(undefined);
  });

  it('transcribes through the shared seam with the Douyin writer and the injected lanes', async () => {
    const startProcessing = vi.fn();
    const onIndexing = vi.fn();

    await expect(adapter(startProcessing).transcribe('7300000000000000001', 'A clip', onIndexing)).resolves.toBe(SUCCESS);

    expect(seamMocks.transcribeAndPersist).toHaveBeenCalledWith({
      platform: 'douyin',
      videoId: '7300000000000000001',
      title: 'A clip',
      persist: seamMocks.persistDouyinTranscript,
      hooks: { onIndexing, startProcessing },
    });
    expect(adapter().markError).toBe(seamMocks.markDouyinError);
    expect(adapter().getQuotaPause).toBe(storageMocks.getActiveAsrQuotaPause);
    expect(adapter().setQuotaPause).toBe(storageMocks.setAsrQuotaPause);
    expect(adapter().createStatusListener).toBe(seamMocks.createStatusListener);
  });

  describe('missingPrerequisite is judged now, not from the code alone', () => {
    it('a closed tab is a prerequisite only while no usable tab exists (T2: a transient failure with the tab open is an ordinary failure)', async () => {
      findTab.mockResolvedValue(null);
      await expect(adapter().missingPrerequisite(error('DOUYIN_TAB_MISSING', { reason: 'closed' }))).resolves.toBe('platform-tab');
      await expect(adapter().missingPrerequisite(error('DOUYIN_TAB_MISSING'))).resolves.toBe('platform-tab');

      findTab.mockResolvedValue(7);
      await expect(adapter().missingPrerequisite(error('DOUYIN_TAB_MISSING', { reason: 'closed' }))).resolves.toBeNull();
    });

    it('login, verification and a refused signature need the user on the tab: a prerequisite without even asking for the tab', async () => {
      findTab.mockResolvedValue(7);
      await expect(adapter().missingPrerequisite(error('DOUYIN_TAB_MISSING', { reason: 'login' }))).resolves.toBe('platform-tab');
      await expect(adapter().missingPrerequisite(error('DOUYIN_TAB_MISSING', { reason: 'verify' }))).resolves.toBe('platform-tab');
      await expect(adapter().missingPrerequisite(error('DOUYIN_SIGNATURE_REJECTED', { reason: 'argus' }))).resolves.toBe('platform-tab');
      expect(findTab).not.toHaveBeenCalled();
    });

    it('a missing ASR key is the ASR prerequisite only while the key is still missing', async () => {
      await expect(adapter().missingPrerequisite(error('ASR_INVALID_KEY'))).resolves.toBe('asr');
      storageMocks.hasAsrApiKey.mockResolvedValue(true);
      await expect(adapter().missingPrerequisite(error('ASR_INVALID_KEY'))).resolves.toBeNull();
    });

    it('everything else is an ordinary per-item failure', async () => {
      for (const code of ['ASR_UNKNOWN', 'DOUYIN_MEDIA_UNAVAILABLE', 'DOUYIN_RATE_LIMITED', 'DOWNLOAD_FAILED'] as const) {
        await expect(adapter().missingPrerequisite(error(code)), code).resolves.toBeNull();
      }
      expect(findTab).not.toHaveBeenCalled();
    });
  });

  describe('waitForPrerequisite', () => {
    it('polls for a usable tab while the tab is closed, pacing with the configured interval', async () => {
      findTab.mockReset()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(7);

      await adapter().waitForPrerequisite(error('DOUYIN_TAB_MISSING', { reason: 'closed' }));

      expect(findTab).toHaveBeenCalledTimes(3);
      expect(sleep.mock.calls).toEqual([[5_000], [5_000]]);
      expect(waitForTabLoad).not.toHaveBeenCalled();
    });

    it('waits for the next completed tab load after login / verification / a refused signature, short-circuiting transcribe() meanwhile (ruling 4)', async () => {
      const reloaded = deferred();
      waitForTabLoad.mockReturnValue(reloaded.promise);
      const douyin = adapter();
      const loginWall = error('DOUYIN_TAB_MISSING', { reason: 'login' });

      const waiting = douyin.waitForPrerequisite(loginWall);
      expect(waitForTabLoad).toHaveBeenCalledOnce();
      expect(findTab).not.toHaveBeenCalled();

      // Every item the pipeline hands over meanwhile bounces off the same
      // wall without a signed request: the pipeline parks them all.
      await expect(douyin.transcribe('7300000000000000002', 'Next')).resolves.toEqual({
        success: false,
        error: loginWall,
      });
      expect(seamMocks.transcribeAndPersist).not.toHaveBeenCalled();

      reloaded.resolve();
      await waiting;
      await expect(douyin.transcribe('7300000000000000002', 'Next')).resolves.toBe(SUCCESS);
      expect(seamMocks.transcribeAndPersist).toHaveBeenCalledOnce();
      expect(sleep).not.toHaveBeenCalled();
    });

    it('waits on the shared ASR key watcher for a missing key', async () => {
      await adapter().waitForPrerequisite(error('ASR_INVALID_KEY'));
      expect(storageMocks.waitForAsrApiKey).toHaveBeenCalledOnce();
      expect(findTab).not.toHaveBeenCalled();
      expect(waitForTabLoad).not.toHaveBeenCalled();
    });
  });
});
