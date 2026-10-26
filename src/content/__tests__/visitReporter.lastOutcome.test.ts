/**
 * visitReporter.lastOutcome.test.ts
 * PBI 2026-10-22-06 slice 2 (diag wiring + SPA re-scan baseline): the
 * reporter commits the settled visit once — flag, late-rescan baseline,
 * and persisted diag outcome together — and quotes the worker's own
 * error/reason for the dashboard table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VisitReporter } from '../visitReporter.js';
import type { LastCaptureOutcome } from '../../utils/captureOutcome.js';

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

function makeHarness(response: unknown, content = 'hello world') {
  const persisted: LastCaptureOutcome[] = [];
  const pageState = {
    isValidVisitReported: false,
    reportedContentChars: 0,
    maxScrollPercentage: 80,
    startTime: Date.now() - 60_000,
    lastByteStats: { pageBytes: 100, candidateBytes: 80, originalBytes: 90, cleansedBytes: 70 },
    lastAiSummaryCleansedStats: {
      aiSummaryOriginalBytes: 60,
      aiSummaryCleansedBytes: 50,
      aiSummaryCleansedElements: 3,
      aiSummaryCleansedReason: 'keyword',
      aiSummaryCleansedReasons: ['keyword'],
    },
    lastFallbackTriggered: false,
    lastFallbackReason: undefined,
  };
  const sender = {
    sendMessageWithRetry: vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    }),
  };
  const reporter = new VisitReporter({
    pageState: pageState as never,
    extractAndCommit: vi.fn(() => ({ content })) as never,
    sender: sender as never,
    confirmDialog: vi.fn(async () => true),
    getReasonLabel: vi.fn((_k: string, _f: string, fallback: string) => fallback),
    // Instant retry wait: the production backoff is injectable so tests
    // never wait in real time (AGENTS.md wait policy).
    sleep: vi.fn(async () => undefined),
    persistOutcome: (outcome: LastCaptureOutcome): void => {
      persisted.push(outcome);
    },
  });
  return { reporter, pageState, sender, persisted };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VisitReporter settled-visit commit (flag + baseline + outcome)', () => {
  it("persists 'recorded' and the content baseline on success", async () => {
    const { reporter, pageState, persisted } = makeHarness({ success: true });
    await reporter.report();

    expect(pageState.isValidVisitReported).toBe(true);
    expect(pageState.reportedContentChars).toBe('hello world'.length);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.code).toBe('recorded');
    expect(typeof persisted[0]?.at).toBe('number');
  });

  it('quotes the worker error verbatim on settled failure', async () => {
    const { reporter, pageState, persisted } = makeHarness({ success: false, error: 'DOMAIN_BLOCKED' });
    await reporter.report();

    expect(pageState.isValidVisitReported).toBe(true);
    expect(pageState.reportedContentChars).toBe('hello world'.length);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.code).toBe('DOMAIN_BLOCKED');
  });

  it('quotes the worker reason when no error is set', async () => {
    const { reporter, persisted } = makeHarness({ success: false, reason: 'rate_limited' });
    await reporter.report();

    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.code).toBe('rate_limited');
  });

  it('does not count a transport failure as settled (gate stays open, no outcome)', async () => {
    // Generic transport failure (not the extension-reload early-return).
    const { reporter, pageState, sender, persisted } = makeHarness(new Error('network down'));
    await reporter.report();

    expect(sender.sendMessageWithRetry).toHaveBeenCalledTimes(2);
    expect(pageState.isValidVisitReported).toBe(false);
    expect(pageState.reportedContentChars).toBe(0);
    expect(persisted).toHaveLength(0);
  });
});
