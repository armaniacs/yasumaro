// @vitest-environment jsdom
/**
 * statusPanel-cleansingFeedback.test.ts
 * PBI 2026-09-28-08: the 報告 button synthesized the removal counts by merging
 * `cleanseStats` and `aiSummaryCleansedStats` into one Record<string, number>
 * through `as unknown as`, so the stored feedback entry carried byte totals
 * and reason labels as if they were removal counts. Only the count side may
 * reach the wire shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitForMock, useTimerClock } from '../../../testDir/waitPolicy.js';
import type { ContentResponse } from '../../messaging/types.js';

const {
  mockLoadActiveTabStatus,
  mockGetCurrentTab,
  mockRequestContentFromTab,
  mockGetAll,
  mockEnqueueFeedback,
} = vi.hoisted(() => ({
  mockLoadActiveTabStatus: vi.fn(),
  mockGetCurrentTab: vi.fn(),
  mockRequestContentFromTab: vi.fn(),
  mockGetAll: vi.fn(),
  mockEnqueueFeedback: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../statusStore.js', () => ({ loadActiveTabStatus: mockLoadActiveTabStatus }));

vi.mock('../tabUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tabUtils.js')>();
  return {
    ...actual,
    getCurrentTab: mockGetCurrentTab,
    getActiveTabUrl: async () => (await mockGetCurrentTab())?.url ?? null,
  };
});

vi.mock('../contentFetchGateway.js', () => ({ requestContentFromTab: mockRequestContentFromTab }));

vi.mock('../../utils/storage/SettingsRepository.js', () => ({
  settingsRepository: { getAll: mockGetAll, setAll: vi.fn(), getMany: vi.fn() },
}));

vi.mock('../../utils/aiSummaryCleaner/feedbackQueue.js', () => ({
  enqueueFeedback: mockEnqueueFeedback,
  getFeedbackQueue: vi.fn(),
  clearFeedbackQueue: vi.fn(),
  removeFeedbackEntry: vi.fn(),
}));

import { initStatusPanel } from '../statusPanel.js';

function setupDom(): void {
  document.body.innerHTML = [
    '<div id="statusPanel"></div>',
    '<button id="reportCleansingFeedbackBtn"></button>',
    '<span id="reportCleansingFeedbackStatus"></span>',
  ].join('\n');
}

async function clickReport(response: ContentResponse | null): Promise<void> {
  mockRequestContentFromTab.mockResolvedValue(response);
  await initStatusPanel();
  document.getElementById('reportCleansingFeedbackBtn')?.click();
  await waitForMock(() => expect(mockEnqueueFeedback).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnqueueFeedback.mockResolvedValue(undefined);
  setupDom();
  mockGetAll.mockResolvedValue({ privacy_mode: 'full_pipeline' });
  mockGetCurrentTab.mockResolvedValue({ url: 'https://example.com/page', id: 7 });
  mockLoadActiveTabStatus.mockResolvedValue({
    url: 'https://example.com/page',
    tab: { url: 'https://example.com/page', id: 7 },
    status: {
      domainFilter: { allowed: true, mode: 'whitelist' },
      privacy: { isPrivate: false, hasCache: false },
    },
  });
});

describe('statusPanel cleansing feedback synthesis', () => {
  it('stores only the removal counts, never the AI summary byte totals', async () => {
    await clickReport({
      content: '<p>hello</p>',
      cleanseStats: { hardStripRemoved: 4, keywordStripRemoved: 2, totalRemoved: 6 },
      aiSummaryCleansedStats: {
        aiSummaryOriginalBytes: 31204,
        aiSummaryCleansedBytes: 21000,
        aiSummaryCleansedElements: 12,
        aiSummaryCleansedReason: 'ads',
        aiSummaryCleansedReasons: ['ads', 'nav'],
      },
    });

    const entry = mockEnqueueFeedback.mock.calls[0][0];
    expect(entry.removedByReason).toEqual({
      hardStripRemoved: 4,
      keywordStripRemoved: 2,
      totalRemoved: 6,
    });
    expect(Object.keys(entry.removedByReason).some((k) => k.startsWith('aiSummary'))).toBe(false);
    expect(entry.url).toBe('https://example.com/page');
    expect(entry.domain).toBe('example.com');
  });

  it('stores an empty count map when the response carries only AI summary stats', async () => {
    await clickReport({
      content: '<p>hello</p>',
      aiSummaryCleansedStats: {
        aiSummaryOriginalBytes: 31204,
        aiSummaryCleansedBytes: 21000,
        aiSummaryCleansedElements: 12,
        aiSummaryCleansedReason: 'ads',
      },
    });

    expect(mockEnqueueFeedback.mock.calls[0][0].removedByReason).toEqual({});
  });

  it('stores an empty count map when the content request fails', async () => {
    await clickReport(null);
    expect(mockEnqueueFeedback.mock.calls[0][0].removedByReason).toEqual({});
  });
});

describe('statusPanel cleansing feedback AI summary passthrough', () => {
  it('passes the AI summary stats as their own field, never inside the count map', async () => {
    await clickReport({
      content: '<p>hello</p>',
      cleanseStats: { hardStripRemoved: 4 },
      aiSummaryCleansedStats: {
        aiSummaryOriginalBytes: 31204,
        aiSummaryCleansedBytes: 21000,
        aiSummaryCleansedElements: 12,
        aiSummaryCleansedReason: 'ads',
        aiSummaryCleansedReasons: ['ads', 'nav'],
      },
    });

    const entry = mockEnqueueFeedback.mock.calls[0][0];
    expect(entry.aiSummary).toEqual({
      reason: 'ads',
      reasons: ['ads', 'nav'],
      elements: 12,
      originalBytes: 31204,
      cleansedBytes: 21000,
    });
    expect(entry.removedByReason).toEqual({ hardStripRemoved: 4 });
  });

  it('omits the AI summary field when the response carries no AI stats', async () => {
    await clickReport({ content: '<p>hello</p>', cleanseStats: { hardStripRemoved: 4 } });

    const entry = mockEnqueueFeedback.mock.calls[0][0];
    expect(entry.aiSummary).toBeUndefined();
    expect('aiSummary' in entry).toBe(false);
  });
});

describe('statusPanel cleansing feedback status render', () => {
  it('keeps the popup-only 2000ms clear and the status-message contract', async () => {
    useTimerClock();
    try {
      mockRequestContentFromTab.mockResolvedValue(null);
      await initStatusPanel();
      document.getElementById('reportCleansingFeedbackBtn')?.click();
      // 0ms advances, never a guessed duration: the clock has to stay below the
      // 2000ms under test or the assertion would be measuring the clear.
      const status = document.getElementById('reportCleansingFeedbackStatus')!;
      for (let i = 0; i < 5 && !status.classList.contains('success'); i++) {
        await vi.advanceTimersByTimeAsync(0);
      }

      expect(status.textContent).toBeTruthy();
      expect(status.className).toBe('status-message success');

      vi.advanceTimersByTime(1999);
      expect(status.textContent).toBeTruthy();

      vi.advanceTimersByTime(1);
      expect(status.textContent).toBe('');
      expect(status.className).toBe('status-message');
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the error message through the same contract', async () => {
    useTimerClock();
    try {
      mockRequestContentFromTab.mockResolvedValue(null);
      mockEnqueueFeedback.mockRejectedValueOnce(new Error('queue full'));
      await initStatusPanel();
      document.getElementById('reportCleansingFeedbackBtn')?.click();
      const status = document.getElementById('reportCleansingFeedbackStatus')!;
      for (let i = 0; i < 5 && !status.classList.contains('error'); i++) {
        await vi.advanceTimersByTimeAsync(0);
      }

      expect(status.className).toBe('status-message error');
      expect(status.textContent).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
