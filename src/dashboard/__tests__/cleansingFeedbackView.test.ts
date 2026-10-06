// @vitest-environment jsdom
/**
 * cleansingFeedbackView.test.ts
 * PBI 2026-09-07-13: テーブル見出しが i18n キー経由で描画されること、
 * キー未定義時は英語フォールバックになることを検証する。
 * PBI 2026-09-28-08: Reason 列は件数だけを描画し、AI 要約のバイト数と
 * 理由ラベルは別のグループに描画されること。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
  const getMessage = vi.fn((key: string) => key);
  return i18nMock(getMessage);
});

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

/** Locale stand-in: the view's labels must come from i18n, not literals. */
const MESSAGES: Record<string, string> = {
  historyAiSummaryCleansing: 'AI Summary Cleansing',
};

function sampleEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fb-1',
    domain: 'example.com',
    url: 'https://example.com/page',
    htmlSnippet: '<div>snippet</div>',
    removedByReason: { keyword: 1 },
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetMessage.mockImplementation(((key: string) => key) as typeof getMessage);
  mockedGetFeedbackQueue.mockResolvedValue([sampleEntry()] as never);
});

async function renderReasonCells(removedByReason: Record<string, unknown>): Promise<HTMLTableCellElement[]> {
  mockedGetFeedbackQueue.mockResolvedValue([sampleEntry({ removedByReason })] as never);
  const container = document.createElement('div');
  await renderCleansingFeedback(container);
  return [...container.querySelectorAll('tbody tr td:nth-child(3)')] as HTMLTableCellElement[];
}

async function renderRows(entries: Array<Record<string, unknown>>): Promise<HTMLTableCellElement[]> {
  mockedGetFeedbackQueue.mockResolvedValue(entries as never);
  const container = document.createElement('div');
  await renderCleansingFeedback(container);
  return [...container.querySelectorAll('tbody tr td:nth-child(3)')] as HTMLTableCellElement[];
}

/** The `key:count` text of a Reason cell, without the appended AI group. */
function countText(td: HTMLTableCellElement): string {
  return [...td.childNodes]
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent)
    .join('');
}

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

// PBI 2026-09-28-08: byte totals and reason labels used to be printed as
// `key:count` pairs inside the number map, so a reader saw a byte size where
// a removal count was expected.
describe('renderCleansingFeedback reason cell', () => {
  it('renders counts as key:count and nothing else', async () => {
    const [td] = await renderReasonCells({ keyword: 1, hard: 3 });
    expect(td.textContent).toBe('keyword:1, hard:3');
    expect(td.querySelector('.cleansing-feedback-ai-summary')).toBeNull();
  });

  it('renders an empty cell when the record has no entries', async () => {
    const [td] = await renderReasonCells({});
    expect(td.textContent).toBe('');
  });

  it('never prints byte totals as counts', async () => {
    const [td] = await renderReasonCells({
      keyword: 1,
      aiSummaryOriginalBytes: 31204,
      aiSummaryCleansedBytes: 21000,
      aiSummaryCleansedElements: 12,
      aiSummaryCleansedReason: 'ads',
    });

    // Only the count side is rendered as `key:count`.
    expect(td.textContent).toContain('keyword:1');
    expect(td.textContent).not.toContain('aiSummaryOriginalBytes');
    expect(td.textContent).not.toContain('aiSummaryCleansedBytes');
    expect(td.textContent).not.toContain('31204:');
    expect(td.textContent).not.toContain('aiSummaryCleansedReason:');

    const group = td.querySelector('.cleansing-feedback-ai-summary');
    expect(group).not.toBeNull();
    expect(group?.textContent).toContain('30.5 KB');
    expect(group?.textContent).toContain('20.5 KB');
    expect(group?.textContent).toContain('Count: 12');
  });

  it('labels the AI summary group with its own i18n key', async () => {
    mockedGetMessage.mockImplementation(((key: string) => MESSAGES[key] ?? '') as typeof getMessage);
    const [td] = await renderReasonCells({ keyword: 1, aiSummaryCleansedElements: 1, aiSummaryCleansedReason: 'ads' });
    const label = td.querySelector('.cleansing-feedback-ai-summary-label');
    expect(label?.textContent).toBe(MESSAGES.historyAiSummaryCleansing);
  });

  it('renders a multi-reason array as a readable list, never a raw stringification', async () => {
    const [td] = await renderReasonCells({
      aiSummaryCleansedElements: 2,
      aiSummaryCleansedReason: 'multiple',
      aiSummaryCleansedReasons: ['ads', 'nav'],
    });
    const details = [...(td.querySelectorAll('.cleansing-feedback-ai-summary-detail') ?? [])]
      .map((el) => el.textContent ?? '');

    const reasonLines = details.filter((line) => line.startsWith('cleansingFeedbackReason'));
    expect(reasonLines).toHaveLength(2);
    expect(reasonLines[0]).toBe('cleansingFeedbackReason: historyAiSummaryCleansedReasonMultiple');
    expect(reasonLines[1]).toBe('cleansingFeedbackReasons: historyAiSummaryCleansedReasonAds, historyAiSummaryCleansedReasonNav');
    expect(td.textContent).not.toContain('ads,nav');
    expect(td.textContent).not.toContain(',,');
  });
});

// PBI 2026-09-28-21: entries saved after the split carry the AI stats in
// their own field; entries saved before it only have the legacy wire record.
describe('renderCleansingFeedback persisted aiSummary field', () => {
  it('renders the AI group from the entry field when no legacy keys are present', async () => {
    const [td] = await renderRows([
      sampleEntry({
        removedByReason: { keyword: 2 },
        aiSummary: {
          reason: 'ads',
          elements: 12,
          originalBytes: 31204,
          cleansedBytes: 21000,
        },
      }),
    ]);

    expect(countText(td)).toBe('keyword:2');
    const group = td.querySelector('.cleansing-feedback-ai-summary');
    expect(group?.textContent).toContain('30.5 KB');
    expect(group?.textContent).toContain('20.5 KB');
    expect(group?.textContent).toContain('Count: 12');
  });

  it('prefers the entry field over the legacy aiSummary* keys when both are present', async () => {
    const [td] = await renderRows([
      sampleEntry({
        removedByReason: { keyword: 2, aiSummaryCleansedElements: 999 },
        aiSummary: {
          reason: 'ads',
          elements: 12,
          originalBytes: 31204,
          cleansedBytes: 21000,
        },
      }),
    ]);

    const group = td.querySelector('.cleansing-feedback-ai-summary');
    expect(group?.textContent).toContain('Count: 12');
    expect(group?.textContent).not.toContain('999');
  });

  it('renders legacy and persisted entries side by side without affecting the old ones', async () => {
    const [legacy, persisted, plain] = await renderRows([
      sampleEntry({ id: 'fb-legacy', removedByReason: { keyword: 1, aiSummaryCleansedElements: 1, aiSummaryCleansedReason: 'ads' } }),
      sampleEntry({
        id: 'fb-persisted',
        removedByReason: {},
        aiSummary: { reason: 'ads', elements: 7, originalBytes: 2048, cleansedBytes: 1024 },
      }),
      sampleEntry({ id: 'fb-plain', removedByReason: { keyword: 1 } }),
    ]);

    expect(legacy.querySelector('.cleansing-feedback-ai-summary')).not.toBeNull();
    expect(countText(legacy)).toBe('keyword:1');

    expect(countText(persisted)).toBe('');
    expect(persisted.querySelector('.cleansing-feedback-ai-summary')?.textContent).toContain('Count: 7');

    expect(plain.querySelector('.cleansing-feedback-ai-summary')).toBeNull();
    expect(countText(plain)).toBe('keyword:1');
  });
});
