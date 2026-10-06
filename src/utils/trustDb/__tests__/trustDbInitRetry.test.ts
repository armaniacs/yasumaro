/**
 * trustDbInitRetry.test.ts
 * TrustDbKernel init retry uses an injectable sleep (PBI 2026-10-05-15).
 * No real-time waits, no fake timers: sleep stub resolves immediately.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger/api.js', () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { TrustDbKernel } from '../TrustDbKernel.js';
import { backoffDelayMs } from '../../backoff.js';

const settingsReader = {
  getAll: async (): Promise<Record<string, unknown>> => ({}),
  setAll: async (): Promise<void> => {},
};

function recordingSleep(delays: number[]): (ms: number) => Promise<void> {
  return async (ms: number): Promise<void> => {
    delays.push(ms);
  };
}

beforeEach(() => {
  TrustDbKernel.initPromise = null;
  vi.clearAllMocks();
});

describe('TrustDbKernel init retry (injected sleep)', () => {
  it('retries without wall time and succeeds on the 3rd attempt', async () => {
    const delays: number[] = [];
    const kernel = new TrustDbKernel({ settingsReader, sleep: recordingSleep(delays) });
    const doInit = vi
      .spyOn(kernel as unknown as { doInitialize(): Promise<void> }, 'doInitialize')
      .mockRejectedValueOnce(new Error('boom-1'))
      .mockRejectedValueOnce(new Error('boom-2'))
      .mockResolvedValueOnce(undefined);

    await kernel.initialize();

    expect(doInit).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([
      backoffDelayMs(0, { baseMs: 100 }),
      backoffDelayMs(1, { baseMs: 100 }),
    ]);
    expect(TrustDbKernel.initPromise).toBeNull();
  });

  it('throws the last error after maxRetries with pinned retry count', async () => {
    const delays: number[] = [];
    const kernel = new TrustDbKernel({ settingsReader, sleep: recordingSleep(delays) });
    const doInit = vi
      .spyOn(kernel as unknown as { doInitialize(): Promise<void> }, 'doInitialize')
      .mockRejectedValue(new Error('always down'));

    await expect(kernel.initialize()).rejects.toThrow('always down');

    expect(doInit).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([
      backoffDelayMs(0, { baseMs: 100 }),
      backoffDelayMs(1, { baseMs: 100 }),
    ]);
    expect(TrustDbKernel.initPromise).toBeNull();
    expect(kernel.isInitialized()).toBe(false);
  });
});
