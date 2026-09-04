/**
 * visitReporter.test.ts
 * The VALID_VISIT policy matrix (blocked / private / confirmed / declined /
 * transport failure) is driven through injected fakes — no chrome globals.
 * The shared stat builder is covered directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VisitReporter, buildVisitStats, type VisitReporterDeps } from '../visitReporter.js';

vi.mock('../../utils/logger.js', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
  ErrorCode: { INTERNAL_ERROR: 'x', API_REQUEST_FAILURE: 'y' },
}));

function makePageState(overrides: Record<string, unknown> = {}): VisitReporterDeps['pageState'] {
  return {
    isValidVisitReported: false,
    lastByteStats: { pageBytes: 100, candidateBytes: 80, originalBytes: 90, cleansedBytes: 70 },
    lastAiSummaryCleansedStats: {
      aiSummaryOriginalBytes: 60,
      aiSummaryCleansedBytes: 50,
      aiSummaryCleansedElements: 3,
      aiSummaryCleansedReason: 'keyword',
      aiSummaryCleansedReasons: ['keyword'],
    },
    lastFallbackTriggered: true,
    ...overrides,
  } as unknown as VisitReporterDeps['pageState'];
}

function makeDeps(overrides: Partial<VisitReporterDeps> = {}): VisitReporterDeps & {
  sender: { sendMessageWithRetry: ReturnType<typeof vi.fn> };
} {
  const sender = { sendMessageWithRetry: vi.fn(async () => ({ success: true })) };
  return {
    pageState: makePageState(),
    extractor: () => ({ content: 'hello' }) as never,
    applyResult: vi.fn(),
    sender,
    confirmDialog: vi.fn(async () => true),
    getReasonLabel: vi.fn((_k: string, _f: string, fallback: string) => fallback),
    stopPeriodicCheck: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildVisitStats', () => {
  it('selects the shared field set with undefined normalization', () => {
    const stats = buildVisitStats(makePageState());
    expect(stats.byteStats).toEqual({ pageBytes: 100, candidateBytes: 80, originalBytes: 90, cleansedBytes: 70 });
    expect(stats.aiStats.aiSummaryCleansedReason).toBe('keyword');
    expect(stats.fallbackTriggered).toBe(true);
  });

  it('normalizes zero bytes and none reason to undefined', () => {
    const stats = buildVisitStats(
      makePageState({
        lastByteStats: { pageBytes: 0, candidateBytes: 0, originalBytes: 0, cleansedBytes: 0 },
        lastAiSummaryCleansedStats: {
          aiSummaryOriginalBytes: 0,
          aiSummaryCleansedBytes: 0,
          aiSummaryCleansedElements: 0,
          aiSummaryCleansedReason: 'none',
        },
        lastFallbackTriggered: false,
      }),
    );
    expect(stats.byteStats).toEqual({
      pageBytes: undefined,
      candidateBytes: undefined,
      originalBytes: undefined,
      cleansedBytes: undefined,
    });
    expect(stats.aiStats.aiSummaryCleansedReason).toBeUndefined();
  });
});

describe('VisitReporter policy matrix', () => {
  it('sends the full payload on success without confirm', async () => {
    const deps = makeDeps();
    await new VisitReporter(deps).report();

    expect(deps.sender.sendMessageWithRetry).toHaveBeenCalledTimes(1);
    expect(deps.sender.sendMessageWithRetry).toHaveBeenCalledWith({
      type: 'VALID_VISIT',
      payload: expect.objectContaining({ content: 'hello', pageBytes: 100, fallbackTriggered: true }),
    });
    expect(deps.confirmDialog).not.toHaveBeenCalled();
  });

  it('returns silently on DOMAIN_BLOCKED', async () => {
    const deps = makeDeps();
    deps.sender.sendMessageWithRetry.mockResolvedValueOnce({ success: false, error: 'DOMAIN_BLOCKED' });
    await new VisitReporter(deps).report();

    expect(deps.confirmDialog).not.toHaveBeenCalled();
    expect(deps.sender.sendMessageWithRetry).toHaveBeenCalledTimes(1);
  });

  it('returns without confirm when confirmation is not required', async () => {
    const deps = makeDeps();
    deps.sender.sendMessageWithRetry.mockResolvedValueOnce({
      success: false,
      error: 'PRIVATE_PAGE_DETECTED',
      confirmationRequired: false,
    });
    await new VisitReporter(deps).report();

    expect(deps.confirmDialog).not.toHaveBeenCalled();
  });

  it('confirms and force-retries with the minimal payload when accepted', async () => {
    const deps = makeDeps();
    deps.sender.sendMessageWithRetry.mockResolvedValueOnce({
      success: false,
      error: 'PRIVATE_PAGE_DETECTED',
      reason: 'cache-control',
      confirmationRequired: true,
    });
    await new VisitReporter(deps).report();

    expect(deps.confirmDialog).toHaveBeenCalledTimes(1);
    expect(deps.sender.sendMessageWithRetry).toHaveBeenCalledTimes(2);
    expect(deps.sender.sendMessageWithRetry).toHaveBeenNthCalledWith(2, {
      type: 'VALID_VISIT',
      payload: { content: 'hello', force: true },
    });
  });

  it('skips retry when declined', async () => {
    const deps = makeDeps({ confirmDialog: vi.fn(async () => false) });
    deps.sender.sendMessageWithRetry.mockResolvedValueOnce({
      success: false,
      error: 'PRIVATE_PAGE_DETECTED',
      reason: 'cache-control',
      confirmationRequired: true,
    });
    await new VisitReporter(deps).report();

    expect(deps.sender.sendMessageWithRetry).toHaveBeenCalledTimes(1);
  });

  it('stops periodic check when the extension context is invalidated', async () => {
    const deps = makeDeps();
    deps.sender.sendMessageWithRetry.mockRejectedValueOnce(new Error('Extension context invalidated'));
    await new VisitReporter(deps).report();

    expect(deps.stopPeriodicCheck).toHaveBeenCalledTimes(1);
  });
});
