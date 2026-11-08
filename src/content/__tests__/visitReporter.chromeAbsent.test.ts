/**
 * visitReporter.chromeAbsent.test.ts (review S4)
 * Pins the chrome-absent contract: where chrome itself is missing the
 * reporter fails OPEN to retry (transient errors keep the gate open);
 * only a present-but-idless runtime (the real post-reload shape) stops
 * the periodic check. Production content scripts always have
 * chrome.runtime, so "absent" is a test/hosted-preview state, never a
 * production invalidation.
 */
import { describe, it, expect, vi } from 'vitest';
import { VisitReporter, type VisitReporterDeps } from '../visitReporter.js';
import { PageState } from '../pageState.js';

vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'fn',
    logWarn: 'fn',
    logError: 'fn',
    logDebug: 'fn',
    ErrorCode: { INTERNAL_ERROR: 'x', API_REQUEST_FAILURE: 'y' },
  }),
);
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'fn',
    logWarn: 'fn',
    logError: 'fn',
    logDebug: 'fn',
    ErrorCode: { INTERNAL_ERROR: 'x', API_REQUEST_FAILURE: 'y' },
  }),
);
vi.mock('../../utils/logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'fn',
    logWarn: 'fn',
    logError: 'fn',
    logDebug: 'fn',
    ErrorCode: { INTERNAL_ERROR: 'x', API_REQUEST_FAILURE: 'y' },
  }),
);

function makeDeps(): VisitReporterDeps & {
  sender: { sendMessageWithRetry: ReturnType<typeof vi.fn> };
  stopPeriodicCheck: ReturnType<typeof vi.fn>;
} {
  const sender = { sendMessageWithRetry: vi.fn(async () => ({ success: true })) };
  const stopPeriodicCheck = vi.fn();
  return {
    pageState: new PageState(),
    extractAndCommit: vi.fn(() => ({ content: 'hello' }) as never),
    sender,
    confirmDialog: vi.fn(async () => true),
    getReasonLabel: vi.fn((_k: string, _f: string, fallback: string) => fallback),
    stopPeriodicCheck,
    sleep: () => Promise.resolve(),
  } as unknown as VisitReporterDeps & {
    sender: { sendMessageWithRetry: ReturnType<typeof vi.fn> };
    stopPeriodicCheck: ReturnType<typeof vi.fn>;
  };
}

describe('VisitReporter — chrome-absent contract (S4)', () => {
  it('retries (never stops) when chrome itself is absent', async () => {
    const holder = globalThis as unknown as Record<string, unknown>;
    const saved = holder['chrome'];
    try {
      delete holder['chrome'];
      const deps = makeDeps();
      deps.sender.sendMessageWithRetry.mockRejectedValueOnce(new Error('Service worker busy'));
      await new VisitReporter(deps).report();
      // Fail-open: one bounded retry, which then succeeds — the gate
      // commits through the normal path and the checker keeps running.
      expect(deps.sender.sendMessageWithRetry).toHaveBeenCalledTimes(2);
      expect(deps.stopPeriodicCheck).not.toHaveBeenCalled();
      expect(deps.pageState.isValidVisitReported).toBe(true);
    } finally {
      holder['chrome'] = saved;
    }
  });

  it('stops the periodic check when chrome.runtime.id is gone (post-reload shape)', async () => {
    const holder = globalThis as unknown as Record<string, unknown>;
    const saved = holder['chrome'];
    try {
      holder['chrome'] = { runtime: {} };
      const deps = makeDeps();
      deps.sender.sendMessageWithRetry.mockRejectedValueOnce(new Error('Worker connection lost (code=7)'));
      await new VisitReporter(deps).report();
      expect(deps.stopPeriodicCheck).toHaveBeenCalledTimes(1);
      expect(deps.sender.sendMessageWithRetry).toHaveBeenCalledTimes(1);
      expect(deps.pageState.isValidVisitReported).toBe(false);
    } finally {
      holder['chrome'] = saved;
    }
  });
});
