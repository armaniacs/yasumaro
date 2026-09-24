// @vitest-environment jsdom
/**
 * tagFrequencyTimelinePanel lifecycle tests (PBI 2026-09-24-05):
 * since/until + limit propagation on the explicit Run trigger, client-side
 * re-aggregation on granularity/top-N change (no refetch), empty and cap
 * states, legend navigate-to-tag, and destroy safety.
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

import { createTagFrequencyTimelinePanel } from '../tagFrequencyTimelinePanel.js';
import { DAY_MS } from '../../../components/periodFilter.js';

function at(year: number, month1: number, day: number, hour = 12): number {
  return new Date(year, month1 - 1, day, hour, 0, 0, 0).getTime();
}

// Two distinct weeks (weeks of Sun 2026-09-20 and Sun 2026-09-27), one month.
const TWO_WEEK_ROWS = [
  { id: 1, url: 'https://a/', tags: '#hot', created_at: at(2026, 9, 21) },
  { id: 2, url: 'https://a/', tags: '#hot', created_at: at(2026, 9, 23) },
  { id: 3, url: 'https://b/', tags: '#cold', created_at: at(2026, 9, 28) },
];

function mountPanel() {
  const container = document.createElement('div');
  container.innerHTML = `
    <div id="tagTimelineFilter"></div>
    <span id="tagTimelineGranularityLabel">Granularity</span>
    <button type="button" id="tagTimelineWeekBtn" aria-pressed="true">Weekly</button>
    <button type="button" id="tagTimelineMonthBtn" aria-pressed="false">Monthly</button>
    <label for="tagTimelineTopN">Top tags</label>
    <input type="number" id="tagTimelineTopN" min="1" max="50" value="10">
    <button type="button" id="tagTimelineRunBtn">Run</button>
    <p id="tagTimelineWeekStartNote">note</p>
    <div id="tagTimelineLegend"></div>
    <div id="tagTimelineEmptyState" hidden></div>
    <div id="tagTimelineCapNotice" hidden></div>
    <div id="tagTimelineChartWrap"></div>
    <div id="tagTimelineTableWrap"></div>
  `;
  document.body.appendChild(container);
  const panel = createTagFrequencyTimelinePanel();
  panel.mount(container);
  return { panel, container };
}

function tableRows(container: HTMLElement): NodeListOf<Element> {
  return container.querySelectorAll('#tagTimelineTableWrap tbody tr');
}

function lastQueryArgs(): Record<string, unknown> {
  const calls = mockQueryLogs.mock.calls;
  return calls[calls.length - 1]![0] as Record<string, unknown>;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('tagFrequencyTimelinePanel — PanelLifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockQueryLogs.mockReset();
    mockGetSqliteStatus.mockReset();
    mockTryNavigateTyped.mockReset();
    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
  });

  it('has correct id and category', () => {
    const { panel } = mountPanel();
    expect(panel.id).toBe('panel-tag-frequency-timeline');
    expect(panel.category).toBe('async-data');
  });

  it('load without mount is safe', async () => {
    const p = createTagFrequencyTimelinePanel();
    await expect(p.load?.()).resolves.toBeUndefined();
    expect(mockQueryLogs).not.toHaveBeenCalled();
  });

  it('initial load queries with the default last30 range and limit 10000', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: TWO_WEEK_ROWS, total: 3 } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(mockQueryLogs).toHaveBeenCalledTimes(1);
    const args = lastQueryArgs();
    expect(args.limit).toBe(10000);
    expect(typeof args.since).toBe('number');
    expect(typeof args.until).toBe('number');
    const span = (args.until as number) - (args.since as number);
    expect(span).toBeGreaterThanOrEqual(30 * DAY_MS - 60_000);
    expect(span).toBeLessThanOrEqual(30 * DAY_MS + 60_000);
    expect(container.querySelector('#tagTimelineEmptyState')!.hidden).toBe(true);
    // Weekly default: two Sunday-start buckets; the chart rendered with points.
    expect(tableRows(container)).toHaveLength(2);
    expect(container.querySelectorAll('#tagTimelineChartWrap circle.tag-timeline-point').length)
      .toBeGreaterThan(0);
  });

  it('Run applies a newly selected preset range to the query', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: TWO_WEEK_ROWS, total: 3 } });
    const { panel, container } = mountPanel();
    await panel.load?.();
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);

    // Selecting a preset does not refetch; Run reads getRange() (explicit-apply).
    (container.querySelector('button[data-preset="last7"]') as HTMLButtonElement).click();
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);

    (container.querySelector('#tagTimelineRunBtn') as HTMLButtonElement).click();
    await flush();

    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
    const args = lastQueryArgs();
    const span = (args.until as number) - (args.since as number);
    expect(span).toBeGreaterThanOrEqual(7 * DAY_MS - 60_000);
    expect(span).toBeLessThanOrEqual(7 * DAY_MS + 60_000);
  });

  it('switching granularity re-aggregates the cached rows without a refetch', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: TWO_WEEK_ROWS, total: 3 } });
    const { panel, container } = mountPanel();
    await panel.load?.();
    expect(tableRows(container)).toHaveLength(2);

    (container.querySelector('#tagTimelineMonthBtn') as HTMLButtonElement).click();
    // One calendar-month bucket for the same rows, no additional queryLogs call.
    expect(tableRows(container)).toHaveLength(1);
    expect(tableRows(container)[0]!.textContent).toContain('2026-09-01');
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);
    expect(
      (container.querySelector('#tagTimelineMonthBtn') as HTMLButtonElement).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');

    (container.querySelector('#tagTimelineWeekBtn') as HTMLButtonElement).click();
    expect(tableRows(container)).toHaveLength(2);
    expect(tableRows(container)[0]!.textContent).toContain('2026-09-20');
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);
  });

  it('changing the top-N input re-aggregates without a refetch and builds an Other column', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      url: `https://t${i}/`,
      tags: `#t${String(i).padStart(2, '0')}`,
      created_at: at(2026, 9, 21),
    }));
    mockQueryLogs.mockResolvedValue({ data: { rows, total: rows.length } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    // Default top-10: 10 tag columns + Other.
    let headerCells = container.querySelectorAll('#tagTimelineTableWrap thead th');
    expect(headerCells).toHaveLength(12);
    expect(headerCells[headerCells.length - 1]!.textContent).toBe('Other');

    const topN = container.querySelector('#tagTimelineTopN') as HTMLInputElement;
    topN.value = '1';
    topN.dispatchEvent(new Event('change', { bubbles: true }));

    headerCells = container.querySelectorAll('#tagTimelineTableWrap thead th');
    expect(headerCells).toHaveLength(3); // corner + 1 tag + Other
    expect(headerCells[1]!.textContent).toBe('t00');
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);
    const firstRow = tableRows(container)[0]!;
    // t00 keeps its count 1; the other 11 tags aggregate into Other.
    expect(firstRow.children[1]!.textContent).toBe('1');
    expect(firstRow.children[2]!.textContent).toBe('11');
  });

  it('legend tag buttons navigate to history with searchTag', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: TWO_WEEK_ROWS, total: 3 } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    const legendButton = container.querySelector(
      '#tagTimelineLegend button',
    ) as HTMLButtonElement;
    expect(legendButton.textContent).toBe('#hot');
    legendButton.click();
    expect(mockTryNavigateTyped).toHaveBeenCalledWith(
      'panel-sqlite-history',
      { searchTag: 'hot' },
      expect.any(Function),
    );
  });

  it('shows the empty state for 0 rows', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(container.querySelector('#tagTimelineEmptyState')!.hidden).toBe(false);
    expect(container.querySelectorAll('#tagTimelineTableWrap table')).toHaveLength(0);
    expect(container.querySelectorAll('#tagTimelineChartWrap svg')).toHaveLength(0);
  });

  it('shows the error state when the backend is unavailable', async () => {
    mockGetSqliteStatus.mockResolvedValue({ initialized: false });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(mockQueryLogs).not.toHaveBeenCalled();
    const empty = container.querySelector('#tagTimelineEmptyState')!;
    expect(empty.hidden).toBe(false);
    expect(empty.getAttribute('data-i18n')).toBe('dashboardTagTimelineError');
  });

  it('shows the error state when queries keep failing, and resets on recovery', async () => {
    mockQueryLogs.mockRejectedValue(new Error('boom'));
    const { panel, container } = mountPanel();
    await panel.load?.();

    // Unified failure policy: a persistent failure shows the distinct error
    // wording, never the "no tagged records" empty message.
    const empty = container.querySelector('#tagTimelineEmptyState')!;
    expect(empty.hidden).toBe(false);
    expect(empty.getAttribute('data-i18n')).toBe('dashboardTagTimelineError');

    // A subsequent successful load resets to the normal empty binding.
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    await panel.load?.();

    const recovered = container.querySelector('#tagTimelineEmptyState')!;
    expect(recovered.getAttribute('data-i18n')).toBe('dashboardTagTimelineEmpty');
    expect(recovered.textContent).toBe('No tagged records in this period.');
    expect(recovered.hidden).toBe(false);
  });

  it('shows the cap notice only when total exceeds the fetched rows', async () => {
    const rows = Array.from({ length: 10000 }, (_, i) => ({
      id: i + 1,
      url: `https://cap${i}/`,
      tags: '#hot',
      created_at: at(2026, 9, 21),
    }));
    // Exactly the cap: the fetch is complete, so claiming a partial set
    // would be false.
    mockQueryLogs.mockResolvedValueOnce({ data: { rows, total: 10000 } });
    const first = mountPanel();
    await first.panel.load?.();
    expect(first.container.querySelector('#tagTimelineCapNotice')!.hidden).toBe(true);

    // Total beyond the fetched rows proves truncation.
    mockQueryLogs.mockResolvedValue({ data: { rows, total: 15000 } });
    const second = mountPanel();
    await second.panel.load?.();
    const cap = second.container.querySelector('#tagTimelineCapNotice')!;
    expect(cap.hidden).toBe(false);
    expect(cap.textContent).toContain('10000');
    expect(second.container.querySelector('#tagTimelineEmptyState')!.hidden).toBe(true);
  });

  it('keeps the cap notice across granularity/top-N re-aggregation of capped rows', async () => {
    const rows = Array.from({ length: 10000 }, (_, i) => ({
      id: i + 1,
      url: `https://cap${i}/`,
      tags: '#hot',
      created_at: at(2026, 9, 21),
    }));
    mockQueryLogs.mockResolvedValue({ data: { rows, total: 12000 } });
    const { panel, container } = mountPanel();
    await panel.load?.();
    expect(container.querySelector('#tagTimelineCapNotice')!.hidden).toBe(false);

    // Re-aggregating the cached capped prefix must not hide the disclosure.
    (container.querySelector('#tagTimelineMonthBtn') as HTMLButtonElement).click();
    await flush();
    expect(container.querySelector('#tagTimelineCapNotice')!.hidden).toBe(false);
  });

  it('focusable chart points carry bucket, tag, and count in their label', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: TWO_WEEK_ROWS, total: 3 } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    const point = container.querySelector(
      '#tagTimelineChartWrap circle.tag-timeline-point',
    ) as SVGElement;
    expect(point.getAttribute('tabindex')).toBe('0');
    expect(point.getAttribute('aria-label')).toMatch(/2026-09-20/);
    expect(point.getAttribute('aria-label')).toMatch(/hot/);
  });

  it('destroy stops further loads and detaches the period filter', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: TWO_WEEK_ROWS, total: 3 } });
    const { panel, container } = mountPanel();
    await panel.load?.();
    expect(container.querySelectorAll('.period-filter')).toHaveLength(1);

    panel.destroy?.();
    await panel.load?.();
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);
  });
});
