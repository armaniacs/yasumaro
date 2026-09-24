// @vitest-environment jsdom
/**
 * tagCooccurrenceTablePanel lifecycle tests (PBI 2026-09-24-06):
 * since/until + limit propagation on the explicit Run trigger ('all'
 * default passes no bounds), tag-select re-ranking from the cached graph
 * (no refetch), row click / Enter navigation with the pair's first tag,
 * empty-state differentiation (no records vs no pairs vs no partners),
 * pre-narrowing and top-20 truncation notices, and destroy safety.
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

import { createTagCooccurrenceTablePanel } from '../tagCooccurrenceTablePanel.js';
import { DAY_MS } from '../../../components/periodFilter.js';

function at(year: number, month1: number, day: number, hour = 12): number {
  return new Date(year, month1 - 1, day, hour, 0, 0, 0).getTime();
}

// Records exercising several co-occurrence weights:
// (a,b) x3, (a,c) x2, (b,c) x1, plus a single-tag record.
const MIXED_ROWS = [
  { id: 1, url: 'https://a/', tags: '#a #b', created_at: at(2026, 9, 21) },
  { id: 2, url: 'https://a/', tags: '#a #b', created_at: at(2026, 9, 22) },
  { id: 3, url: 'https://a/', tags: '#a #b', created_at: at(2026, 9, 23) },
  { id: 4, url: 'https://b/', tags: '#a #c', created_at: at(2026, 9, 23) },
  { id: 5, url: 'https://b/', tags: '#a #c', created_at: at(2026, 9, 24) },
  { id: 6, url: 'https://c/', tags: '#b #c', created_at: at(2026, 9, 24) },
  { id: 7, url: 'https://d/', tags: '#solo', created_at: at(2026, 9, 25) },
];

function mountPanel() {
  const container = document.createElement('div');
  container.innerHTML = `
    <div id="coocTableFilter"></div>
    <div class="form-group cooc-table-controls">
      <label for="coocTableTagSelect">Tag</label>
      <select id="coocTableTagSelect"></select>
      <button type="button" id="coocTableRunBtn">Run</button>
    </div>
    <div id="coocTableEmptyState" hidden></div>
    <div id="coocTableTagsTruncated" class="visit-duration-truncated" hidden></div>
    <div id="coocTableTop20Truncated" class="visit-duration-truncated" hidden></div>
    <div id="coocTableTableWrap"></div>
  `;
  document.body.appendChild(container);
  const panel = createTagCooccurrenceTablePanel();
  panel.mount(container);
  return { panel, container };
}

function tableRows(container: HTMLElement): NodeListOf<Element> {
  return container.querySelectorAll('#coocTableTableWrap tbody tr');
}

function lastQueryArgs(): Record<string, unknown> {
  const calls = mockQueryLogs.mock.calls;
  return calls[calls.length - 1]![0] as Record<string, unknown>;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('tagCooccurrenceTablePanel — PanelLifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockQueryLogs.mockReset();
    mockGetSqliteStatus.mockReset();
    mockTryNavigateTyped.mockReset();
    mockGetSqliteStatus.mockResolvedValue({ initialized: true });
  });

  it('has correct id and category', () => {
    const { panel } = mountPanel();
    expect(panel.id).toBe('panel-tag-cooccurrence-table');
    expect(panel.category).toBe('async-data');
  });

  it('load without mount is safe', async () => {
    const p = createTagCooccurrenceTablePanel();
    await expect(p.load?.()).resolves.toBeUndefined();
    expect(mockQueryLogs).not.toHaveBeenCalled();
  });

  it("initial load with the default 'all' queries without since/until and renders ranked pairs", async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: MIXED_ROWS, total: MIXED_ROWS.length } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(mockQueryLogs).toHaveBeenCalledTimes(1);
    // Byte-identical to the pre-filter call: no since/until keys at all.
    expect(lastQueryArgs()).toEqual({ limit: 10000 });

    const rows = tableRows(container);
    expect(rows).toHaveLength(3);
    // weight desc: (a,b)=3, (a,c)=2, (b,c)=1.
    expect(rows[0]!.textContent).toContain('#a × #b');
    expect(rows[0]!.textContent).toContain('3');
    expect(rows[1]!.textContent).toContain('#a × #c');
    expect(rows[2]!.textContent).toContain('#b × #c');
    // Individual counts from the full graph: a=5, b=4, c=3.
    expect(rows[0]!.children[1]!.textContent).toBe('3');
    expect(rows[0]!.children[2]!.textContent).toBe('5');
    expect(rows[0]!.children[3]!.textContent).toBe('4');
    expect(container.querySelector('#coocTableEmptyState')!.hidden).toBe(true);
  });

  it('populates the tag select from the fetched nodes with an All-tags option', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: MIXED_ROWS, total: MIXED_ROWS.length } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    const select = container.querySelector('#coocTableTagSelect') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values[0]).toBe('');
    expect(values.slice(1)).toEqual(['a', 'b', 'c', 'solo']);
    expect(values.slice(1)).toEqual([...values.slice(1)].sort());
    expect(select.value).toBe('');
  });

  it('Run applies a newly selected preset range to the query', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: MIXED_ROWS, total: MIXED_ROWS.length } });
    const { panel, container } = mountPanel();
    await panel.load?.();
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);

    // Selecting a preset does not refetch; Run reads getRange() (explicit-apply).
    (container.querySelector('button[data-preset="last7"]') as HTMLButtonElement).click();
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);

    (container.querySelector('#coocTableRunBtn') as HTMLButtonElement).click();
    await flush();

    expect(mockQueryLogs).toHaveBeenCalledTimes(2);
    const args = lastQueryArgs();
    expect(args.limit).toBe(10000);
    expect(typeof args.since).toBe('number');
    expect(typeof args.until).toBe('number');
    const span = (args.until as number) - (args.since as number);
    expect(span).toBeGreaterThanOrEqual(7 * DAY_MS - 60_000);
    expect(span).toBeLessThanOrEqual(7 * DAY_MS + 60_000);
  });

  it('changing the tag select re-ranks the cached graph without a refetch', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: MIXED_ROWS, total: MIXED_ROWS.length } });
    const { panel, container } = mountPanel();
    await panel.load?.();
    expect(tableRows(container)).toHaveLength(3);

    const select = container.querySelector('#coocTableTagSelect') as HTMLSelectElement;
    select.value = 'b';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(mockQueryLogs).toHaveBeenCalledTimes(1);
    const rows = tableRows(container);
    // Only pairs involving b, weight desc: (a,b)=3 then (b,c)=1.
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('#a × #b');
    expect(rows[1]!.textContent).toContain('#b × #c');
    // Partner counts stay full-graph values (b=4, a=5 / c=3).
    expect(rows[0]!.children[2]!.textContent).toBe('5');
    expect(rows[0]!.children[3]!.textContent).toBe('4');
    expect(rows[1]!.children[2]!.textContent).toBe('4');
    expect(rows[1]!.children[3]!.textContent).toBe('3');
  });

  it('row click and Enter navigate to history with the pair first tag', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: MIXED_ROWS, total: MIXED_ROWS.length } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    const firstRow = tableRows(container)[0] as HTMLElement;
    expect(firstRow.tabIndex).toBe(0);
    firstRow.click();
    expect(mockTryNavigateTyped).toHaveBeenCalledWith(
      'panel-sqlite-history',
      { searchTag: 'a' },
      expect.any(Function),
    );

    const secondRow = tableRows(container)[1] as HTMLElement;
    secondRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(mockTryNavigateTyped).toHaveBeenCalledTimes(2);
    expect(mockTryNavigateTyped).toHaveBeenLastCalledWith(
      'panel-sqlite-history',
      { searchTag: 'a' },
      expect.any(Function),
    );
  });

  it('shows the no-records empty state for 0 rows', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: [], total: 0 } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    const empty = container.querySelector('#coocTableEmptyState')!;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe('No records in the selected period. Try a wider range.');
    expect(empty.getAttribute('data-i18n')).toBe('cooccurrenceTableNoRecords');
    expect(container.querySelectorAll('#coocTableTableWrap table')).toHaveLength(0);
  });

  it('shows the no-pairs empty state when all records are single-tag only', async () => {
    const rows = [
      { id: 1, url: 'https://a/', tags: '#x', created_at: at(2026, 9, 21) },
      { id: 2, url: 'https://b/', tags: '#y', created_at: at(2026, 9, 22) },
    ];
    mockQueryLogs.mockResolvedValue({ data: { rows, total: rows.length } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    const empty = container.querySelector('#coocTableEmptyState')!;
    expect(empty.hidden).toBe(false);
    expect(empty.getAttribute('data-i18n')).toBe('cooccurrenceTableEmpty');
    expect(empty.textContent).toBe('No co-occurring tag pairs — every record has a single tag.');
    expect(container.querySelectorAll('#coocTableTableWrap table')).toHaveLength(0);
  });

  it('shows the no-partners empty state when the selected tag has no co-occurrences', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: MIXED_ROWS, total: MIXED_ROWS.length } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    const select = container.querySelector('#coocTableTagSelect') as HTMLSelectElement;
    select.value = 'solo';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    const empty = container.querySelector('#coocTableEmptyState')!;
    expect(empty.hidden).toBe(false);
    expect(empty.getAttribute('data-i18n')).toBe('cooccurrenceTableEmptyForTag');
    expect(empty.textContent).toBe('No other tag co-occurs with the selected tag.');
    expect(container.querySelectorAll('#coocTableTableWrap table')).toHaveLength(0);
  });

  it('shows the top-20 truncation notice when more than 20 pairs exist', async () => {
    // 7 tags on one record → C(7,2) = 21 edges, all weight 1.
    const tags = Array.from({ length: 7 }, (_, i) => `#t${String(i).padStart(2, '0')}`).join(' ');
    const rows = [{ id: 1, url: 'https://a/', tags, created_at: at(2026, 9, 21) }];
    mockQueryLogs.mockResolvedValue({ data: { rows, total: 1 } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(tableRows(container)).toHaveLength(20);
    const notice = container.querySelector('#coocTableTop20Truncated')!;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain('21');
    // All weights tie at 1, so rows follow pair-label ascending order.
    expect(tableRows(container)[0]!.textContent).toContain('#t00 × #t01');
  });

  it('does not show truncation notices for a small graph', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: MIXED_ROWS, total: MIXED_ROWS.length } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(container.querySelector('#coocTableTop20Truncated')!.hidden).toBe(true);
    expect(container.querySelector('#coocTableTagsTruncated')!.hidden).toBe(true);
  });

  it('shows the pre-narrowing notice when the tag universe exceeds the cap', async () => {
    // 51 singleton tags + 1 common tag: 52 unique tags > MAX_TAG_CLUSTER_TAGS.
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: i + 1,
      url: `https://r${i}/`,
      tags: `#t${String(i).padStart(2, '0')} #common`,
      created_at: at(2026, 9, 21),
    }));
    mockQueryLogs.mockResolvedValue({ data: { rows, total: rows.length } });
    const { panel, container } = mountPanel();
    await panel.load?.();

    const notice = container.querySelector('#coocTableTagsTruncated')!;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain('50');
    // Narrowing keeps the top-50 tags: #common plus 49 of the singletons.
    expect(tableRows(container).length).toBeGreaterThan(0);
    expect(tableRows(container).length).toBeLessThanOrEqual(20);
  });

  it('shows the no-records empty state when queries keep failing', async () => {
    mockQueryLogs.mockRejectedValue(new Error('boom'));
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(container.querySelector('#coocTableEmptyState')!.hidden).toBe(false);
    expect(container.querySelectorAll('#coocTableTableWrap table')).toHaveLength(0);
  });

  it('shows the no-records empty state when the backend is unavailable', async () => {
    mockGetSqliteStatus.mockResolvedValue({ initialized: false });
    const { panel, container } = mountPanel();
    await panel.load?.();

    expect(mockQueryLogs).not.toHaveBeenCalled();
    expect(container.querySelector('#coocTableEmptyState')!.hidden).toBe(false);
  });

  it('destroy stops further loads and detaches the period filter', async () => {
    mockQueryLogs.mockResolvedValue({ data: { rows: MIXED_ROWS, total: MIXED_ROWS.length } });
    const { panel, container } = mountPanel();
    await panel.load?.();
    expect(container.querySelectorAll('.period-filter')).toHaveLength(1);

    panel.destroy?.();
    await panel.load?.();
    expect(mockQueryLogs).toHaveBeenCalledTimes(1);
  });
});
