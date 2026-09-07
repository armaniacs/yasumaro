// @vitest-environment jsdom
/**
 * cleansingFeedbackView.test.ts
 * PBI 2026-09-07-13: テーブル見出しが i18n キー経由で描画されること、
 * キー未定義時は英語フォールバックになることを検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/i18n.js', () => ({
  getMessage: vi.fn((key: string) => key),
}));

vi.mock('../../utils/aiSummaryCleaner/feedbackQueue.js', () => ({
  getFeedbackQueue: vi.fn(),
  clearFeedbackQueue: vi.fn(),
  removeFeedbackEntry: vi.fn(),
}));

import { renderCleansingFeedback } from '../cleansingFeedbackView.js';
import { getMessage } from '../../utils/i18n.js';
import { getFeedbackQueue } from '../../utils/aiSummaryCleaner/feedbackQueue.js';

const mockedGetMessage = vi.mocked(getMessage);
const mockedGetFeedbackQueue = vi.mocked(getFeedbackQueue);

function sampleEntry() {
  return {
    id: 'fb-1',
    domain: 'example.com',
    url: 'https://example.com/page',
    htmlSnippet: '<div>snippet</div>',
    removedByReason: { keyword: 1 },
    createdAt: Date.now(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetMessage.mockImplementation(((key: string) => key) as typeof getMessage);
  mockedGetFeedbackQueue.mockResolvedValue([sampleEntry()] as never);
});

describe('renderCleansingFeedback header', () => {
  it('renders table headers via i18n keys', async () => {
    const container = document.createElement('div');
    await renderCleansingFeedback(container);
    const ths = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(ths).toEqual([
      'cleansingFeedbackDomain',
      'cleansingFeedbackSnippet',
      'cleansingFeedbackReason',
      'cleansingFeedbackDate',
      'cleansingFeedbackAction',
    ]);
  });

  it('falls back to English headers when keys are missing', async () => {
    mockedGetMessage.mockReturnValue('');
    const container = document.createElement('div');
    await renderCleansingFeedback(container);
    const ths = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(ths).toEqual(['Domain', 'Snippet', 'Reason', 'Date', 'Action']);
  });
});
