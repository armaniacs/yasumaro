// @vitest-environment jsdom
/**
 * domainAnalysisPanel lifecycle tests: ranked tables, empty state, notices,
 * pagination caps, since/until/tagFilter/offset propagation, and the
 * domain-row → history navigation hand-off.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryLogs = vi.fn();
const mockGetSqliteStatus = vi.fn();
const mockTryNavigateTyped = vi.fn();

vi.mock('../../../dashboardSqliteService.js', () => ({
  queryLogs: (...args: unknown[]) => mockQueryLogs(...args),
  getSqliteStatus: (...args: unknown[]) => mockGetSqliteStatus(...args),
  isServiceError: (result: object) => 'error' in result,
}));

vi.mock('../../../utils/retry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/retry.js')>();
  return {
    retryWithExponentialBackoff: (fn: () => Promise<unknown>, options: Record<string, unknown> = {}) =>
      actual.retryWithExponentialBackoff(fn as never, { ...options, baseDelayMs: 0, maxDelayMs: 0 }),
  };
});

vi.mock('../../registryContext.js', () => ({
  tryNavigateTyped: (...args: unknown[]) => mockTryNavigateTyped(...args),
}));

import { createDomainAnalysisPanel, toTagFilter } from '../domainAnalysisPanel.js';

function mountPanel() {
  const container = document.createElement('div');
  container.innerHTML = `
    <div id="domainAnalysisFilter"></div>
    <label for="domainAnalysisTagInput">Tag</label>
    <input type="text" id="domainAnalysisTagInput">
    <button type="button" id="domainAnalysisRunBtn">Run</button>
    <div id="domainAnalysisEmptyState" hidden></div>
    <p id="domainAnalysisUnknownNotice" aria-live="polite" hidden></p>
    <div id="domainAnalysisRowCap" class="data-table-notice is-warning" hidden></div>
    <table><tbody id="domainAnalysisDomainBody"></tbody></table>
    <div id="domainAnalysisDomainTruncated" class="data-table-notice is-warning" hidden></div>
    <table><tbody id="domainAnalysisUrlBody"></tbody></table>
    <div id="domainAnalysisUrlTruncated" class="data-table-notice is-warning" hidden></div>
  `;
  document.body.appendChild(container);
  const panel = createDomainAnalysisPanel();
  panel.mount(container);
  return { panel, container };
}

function row(id: number, domain: string | null, url: string): object {
  return { id, url, title: 't', created_at: Date.now(), domain, tags: null, visit_duration: null };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('domainAnalysisPanel — PanelLifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockQueryLogs.mockReset();
    mockGetSqliteStatus.mockReset();
    mockTryNavigateTyped.mockReset();
    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
  });

  it('has correct id and category', () => {
    const { panel } = mountPanel();
    expect(panel.id).toBe('panel-domain-analysis');
    expect(panel.category).toBe('async-data');
  });

  it('load without mount is safe', async () => {
    const p = createDomainAnalysisPanel();
    await expect(p.load?.()).resolves.toBeUndefined();
    expect(mockQueryLogs).not.toHaveBeenCalled();
  });

  it('renders domain and URL rankings with counts, sorted by count desc', async () => {
    mockQueryLogs.mockResolvedValue({
      data: {
        rows: [
          row(1, 'a.com', 'https://a.com/1'),
          row(2, 'a.com', 'https://a.com/2'),
          row(3, 'b.com', 'https://b.com/1'),
          row(4, 'b.com', 'https://b.com/2'),
          row(5, 'b.com', 'https://b.com/3'),
        ],
        total: 5,
      },
    });
    const { panel, container } = mountPanel();
    await panel.load?.();

    const domainRows = container.querySelectorAll('#domainAnalysisDomainBody tr');
    expect(domainRows).toHaveLength(2);
    expect(domainRows[0]!.textContent).toContain('b.com');
    expect(domainRows[0]!.textContent).toContain('3');
    expect(domainRows[1]!.textContent).toContain('a.com');
    expect(domainRows[1]!.textContent).toContain('2');

    const urlRows = container.querySelectorAll('#domainAnalysisUrlBody tr');
    expect(urlRows).toHaveLength(5);
    // All five URLs have count 1, so ties break by name ascending.
    expect(urlRows[0]!.textContent).toContain('https://a.com/1');
    expect(container.querySelector('#domainAnalysisEmptyState')!.hidden).toBe(true);
    expect(container.querySelector('#domainAnalysisUnknownNotice')!.hidden).toBe(true);
  });

  it('shows the empty state when 0 rows are returned', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(container.querySelector('#domainAnalysisEmptyState')!.hidden).toBe(false);
    expect(container.querySelectorAll('#domainAnalysisDomainBody tr')).toHaveLength(0);
    expect(container.querySelectorAll('#domainAnalysisUrlBody tr')).toHaveLength(0);
  });

  it('shows the error state when the backend is unavailable, and resets on recovery', async () => {
    mockGetSqliteStatus.mockResolvedValue({ initialized: false });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(mockQueryLogs).not.toHaveBeenCalled();
    // Unified failure policy: a persistent failure shows the distinct error
    // wording, never the "no records" empty message.
    const empty = container.querySelector('#domainAnalysisEmptyState')!;
    expect(empty.hidden).toBe(false);
    expect(empty.getAttribute('data-i18n')).toBe('domainAnalysisError');
    expect(empty.textContent).toBe('Failed to load the domain analysis. Try again.');

    // A subsequent successful load resets to the normal empty binding.
    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    await panel.load?.();

    const recovered = container.querySelector('#domainAnalysisEmptyState')!;
    expect(recovered.getAttribute('data-i18n')).toBe('domainAnalysis_empty');
    expect(recovered.textContent).toBe('No browsing records match the selected period and tag.');
    expect(recovered.hidden).toBe(false);
  });

  it('passes preset since/until plus the parsed tagFilter to queryLogs on Run', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const { panel, container } = mountPanel();
    await panel.load?.();
    (container.querySelector('button[data-preset="last7"]') as HTMLButtonElement).click();
    const tagInput = container.querySelector('#domainAnalysisTagInput') as HTMLInputElement;
    tagInput.value = '#travel';
    (container.querySelector('#domainAnalysisRunBtn') as HTMLButtonElement).click();
    await flush();
    await panel.load?.();

    expect(mockQueryLogs).toHaveBeenCalled();
    const args = mockQueryLogs.mock.calls[mockQueryLogs.mock.calls.length - 1]![0] as {
      since: number;
      until: number;
      tagFilter: string;
      limit: number;
      offset?: number;
    };
    expect(args.tagFilter).toBe('travel');
    expect(args.limit).toBe(10000);
    expect('offset' in args).toBe(false);
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(args.until - args.since).toBeGreaterThanOrEqual(sevenDaysMs - 60_000);
    expect(args.until - args.since).toBeLessThanOrEqual(sevenDaysMs + 60_000);
  });

  it('omits tagFilter entirely when the tag input is blank', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const { panel } = mountPanel();
    await panel.load?.();

    const args = mockQueryLogs.mock.calls[0]![0] as Record<string, unknown>;
    expect('tagFilter' in args).toBe(false);
  });

  it('pages queryLogs with a keyset cursor until a short batch ends the loop', async () => {
    const base = Date.now();
    // Page 1: 10000 rows, newest first (ids 1..10000, created_at descending).
    const page1 = Array.from({ length: 10000 }, (_, i) => ({
      id: i + 1,
      url: `https://a.com/${i}`,
      title: 't',
      created_at: base - i,
      domain: 'a.com',
      tags: null,
      visit_duration: null,
    }));
    // Page 2: the keyset cursor (page 1's oldest created_at) re-reads the
    // boundary row (id 10000) plus one genuinely older row — the merged set
    // must count the boundary row once.
    const page2 = [
      { id: 10000, url: 'https://a.com/9999', title: 't', created_at: base - 9999, domain: 'a.com', tags: null, visit_duration: null },
      { id: 90001, url: 'https://b.com/x', title: 't', created_at: base - 12000, domain: 'b.com', tags: null, visit_duration: null },
    ];
    mockQueryLogs
      .mockResolvedValueOnce({ data: { rows: page1, total: 10001 } })
      .mockResolvedValueOnce({ data: { rows: page2, total: 10001 } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
    // No offset key — page 2's cursor is the previous page's oldest
    // created_at (inclusive re-read, merged by unique id).
    const second = mockQueryLogs.mock.calls[1]![0] as { until: number; offset?: number };
    expect('offset' in second).toBe(false);
    expect(second.until).toBe(base - 9999);
    // a.com stays at 10000: the re-read boundary row is deduped by id.
    const domainBody = container.querySelector('#domainAnalysisDomainBody')!;
    expect(domainBody.textContent).toContain('a.com10000');
    expect(domainBody.textContent).not.toContain('10001');
    expect(container.querySelector('#domainAnalysisRowCap')!.hidden).toBe(true);
  });

  it('shows the cap notice and stops after 5 full pages', async () => {
    const base = Date.now();
    let call = 0;
    mockQueryLogs.mockImplementation(() => {
      call += 1;
      const rows = Array.from({ length: 10000 }, (_, i) =>
        row(call * 10000 + i, 'a.com', `https://a.com/${call}-${i}`),
      ).map((r, i) => ({ ...r, created_at: base - (call - 1) * 10000 - i }));
      return Promise.resolve({ data: { rows, total: 99999 } });
    });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(mockQueryLogs).toHaveBeenCalledTimes(5);
    // Each page's cursor is the previous page's oldest created_at.
    const cursors = mockQueryLogs.mock.calls.map((c) => (c[0] as { until: number }).until);
    expect(cursors[1]).toBe(base - 10000 + 1);
    expect(cursors[4]).toBe(base - 40000 + 1);
    const cap = container.querySelector('#domainAnalysisRowCap')!;
    expect(cap.hidden).toBe(false);
    expect(cap.textContent).toContain('50000');
  });

  it('keeps null-domain rows as an (unknown) bucket with a count notice', async () => {
    mockQueryLogs.mockResolvedValue({
      data: {
        rows: [row(1, null, 'https://a.com/1'), row(2, '  ', 'https://a.com/2'), row(3, 'a.com', 'https://a.com/3')],
        total: 3,
      },
    });
    const { panel, container } = mountPanel();
    await panel.load?.();

    const domainRows = container.querySelectorAll('#domainAnalysisDomainBody tr');
    expect(domainRows).toHaveLength(2);
    // The unknown bucket (2 records) outranks a.com (1 record).
    expect(domainRows[0]!.textContent).toContain('(unknown)');
    expect(domainRows[1]!.textContent).toContain('a.com');
    const notice = container.querySelector('#domainAnalysisUnknownNotice')!;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain('2');
  });

  it('shows top-N truncation notices for both tables', async () => {
    const rows: object[] = [];
    for (let i = 0; i < 25; i++) {
      rows.push(row(i + 1, `d${i}.com`, `https://d${i}.com/`));
    }
    mockQueryLogs.mockResolvedValue({ data: { rows, total: 25 } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(container.querySelectorAll('#domainAnalysisDomainBody tr')).toHaveLength(20);
    expect(container.querySelectorAll('#domainAnalysisUrlBody tr')).toHaveLength(20);
    const domainNotice = container.querySelector('#domainAnalysisDomainTruncated')!;
    const urlNotice = container.querySelector('#domainAnalysisUrlTruncated')!;
    expect(domainNotice.hidden).toBe(false);
    expect(domainNotice.textContent).toContain('25');
    expect(urlNotice.hidden).toBe(false);
  });

  it('navigates to history with searchDomain on domain-row click', async () => {
    mockQueryLogs.mockResolvedValue({
      data: { rows: [row(1, 'a.com', 'https://a.com/1')], total: 1 },
    });
    const { panel, container } = mountPanel();
    await panel.load?.();

    const domainBtn = container.querySelector(
      '#domainAnalysisDomainBody button',
    ) as HTMLButtonElement;
    expect(domainBtn).not.toBeNull();
    domainBtn.click();
    expect(mockTryNavigateTyped).toHaveBeenCalledWith(
      'panel-sqlite-history',
      { searchDomain: 'a.com' },
    );
  });

  it('renders URL rows as plain text without navigation', async () => {
    mockQueryLogs.mockResolvedValue({
      data: { rows: [row(1, 'a.com', 'https://a.com/1')], total: 1 },
    });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(container.querySelector('#domainAnalysisUrlBody button')).toBeNull();
    expect(mockTryNavigateTyped).not.toHaveBeenCalled();
  });

  it('toTagFilter trims and strips one leading hash', () => {
    expect(toTagFilter('  travel ')).toBe('travel');
    expect(toTagFilter('#travel')).toBe('travel');
    expect(toTagFilter('  # travel ')).toBe('travel');
    expect(toTagFilter('#')).toBeUndefined();
    expect(toTagFilter('   ')).toBeUndefined();
  });
});
