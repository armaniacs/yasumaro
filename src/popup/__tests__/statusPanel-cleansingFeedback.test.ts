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
import { waitForMock } from '../../../testDir/waitPolicy.js';
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
